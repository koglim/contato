import {
  channelInboundMessageResponseSchema,
  arePhoneIdentitiesEquivalent,
  normalizeBrazilianMobilePhone,
  type ChannelInboundMessageResponse,
  type InteractiveActionResult,
  type InteractiveActionType,
} from "@contatocerto/shared";
import { withTransaction, type DatabaseClient } from "../../database/connection.js";
import { InboxFenceError, liveInboxLeaseSql } from "../channel-inbox/inbox-recovery.policy.js";
import type { ChannelInboundMessageRecord } from "../channel-inbox/channel-inbox.types.js";
import type { InteractiveActionRepository } from "./interactive-action.types.js";
import { PostgresInteractiveActionRepository } from "./interactive-action.repository.js";
import { bilateralSnapshotSchema } from "../bilateral-contact/bilateral-contact.policy.js";
import {
  executeCompletionDeclaration,
  executeCompletionConfirmation,
  executeCompletionContestation,
} from "../contact-completion/contact-completion.domain.js";
import { executeUnavailabilityDeclaration } from "../professional-opportunity/professional-unavailability.domain.js";

type ContactRow = {
  id: string;
  customer_id: string;
  professional_id: string;
  search_request_id: string;
  selection_conversation_id: string;
  public_code: string;
  status: string;
  bilateral_snapshot: unknown;
};

export class InteractiveActionService {
  constructor(
    private readonly repository: InteractiveActionRepository = new PostgresInteractiveActionRepository()
  ) {}

  async handle(
    record: ChannelInboundMessageRecord
  ): Promise<ChannelInboundMessageResponse | null> {
    if (!record.interactiveActionId) {
      return null;
    }

    return withTransaction(async (db) => {
      // 1. Verify and lock the live inbox lease / fencing
      const fenceLock = await db.query(
        `SELECT id FROM channel_inbound_messages
          WHERE id = $1 AND processing_token = $2 AND ${liveInboxLeaseSql}
          FOR UPDATE`,
        [record.id, record.processingToken]
      );
      if (!fenceLock.rows.length) {
        throw new InboxFenceError();
      }

      // 2. Look up the action token with exclusive lock
      const token = await this.repository.findByPublicToken(
        db,
        record.interactiveActionId!,
        true
      );

      if (!token) {
        return this.finishReply(db, record, {
          action: "unavailable",
          replyText: "Esta opção não foi encontrada ou não está mais disponível.",
        });
      }

      // 3. Status checks: consumed, expired, revoked
      if (token.status === "consumed") {
        return this.finishReply(db, record, {
          action: "idempotent_replay",
          action_type: token.actionType,
          replyText: "Essa solicitação já foi respondida anteriormente.",
        });
      }

      if (token.status === "expired" || token.expiresAt.getTime() <= Date.now()) {
        if (token.status === "active") {
          await this.repository.markExpired(db, token.id);
        }
        return this.finishReply(db, record, {
          action: "unavailable",
          action_type: token.actionType,
          replyText: "Esta opção interativa expirou. Por favor, envie uma mensagem com o código da solicitação para continuar.",
        });
      }

      if (token.status === "revoked") {
        return this.finishReply(db, record, {
          action: "unavailable",
          action_type: token.actionType,
          replyText: "Esta opção não está mais ativa.",
        });
      }

      // 4. Outbound Sent Verification
      const outboundRow = (
        await db.query<{ id: string; status: string; recipient_phone_e164: string; provider: string }>(
          `SELECT id, status, recipient_phone_e164, provider
             FROM channel_outbound_messages
            WHERE id = $1`,
          [token.outboundMessageId]
        )
      ).rows[0];

      if (!outboundRow || outboundRow.status !== "sent") {
        return this.finishReply(db, record, {
          action: "unavailable",
          action_type: token.actionType,
          replyText: "Esta opção ainda não está pronta para ser executada.",
        });
      }

      // 5. Phone Triple Authorization: sender phone, token intended phone, and outbound recipient
      if (
        !arePhoneIdentitiesEquivalent(record.phoneE164, token.intendedPhoneE164) ||
        !arePhoneIdentitiesEquivalent(record.phoneE164, outboundRow.recipient_phone_e164)
      ) {
        return this.finishReply(db, record, {
          action: "unavailable",
          action_type: token.actionType,
          replyText: "Você não tem autorização para realizar esta ação.",
        });
      }

      // 6. Target Contact Locking and Snapshot Actor Phone Authorization
      const contact = (
        await db.query<ContactRow>(
          `SELECT id, customer_id, professional_id, search_request_id,
                  selection_conversation_id, public_code, status, bilateral_snapshot
             FROM contacts
            WHERE id = $1
            FOR UPDATE`,
          [token.contactId]
        )
      ).rows[0];

      if (!contact) {
        return this.finishReply(db, record, {
          action: "unavailable",
          action_type: token.actionType,
          replyText: "Solicitação não encontrada.",
        });
      }

      const snapshot = bilateralSnapshotSchema.parse(contact.bilateral_snapshot);
      const actorSnapshotPhone =
        token.intendedActorRole === "customer"
          ? snapshot.customer_phone_e164
          : snapshot.professional_phone_e164;

      if (!arePhoneIdentitiesEquivalent(record.phoneE164, actorSnapshotPhone)) {
        return this.finishReply(db, record, {
          action: "unavailable",
          action_type: token.actionType,
          replyText: "Você não tem autorização para realizar esta ação.",
        });
      }

      // 7. Completion ID consistency check (if token references a completion_id)
      if (token.completionId) {
        const completionRow = (
          await db.query<{ id: string }>(
            `SELECT id FROM contact_completions
              WHERE id = $1 AND contact_id = $2
              FOR UPDATE`,
            [token.completionId, contact.id]
          )
        ).rows[0];

        if (!completionRow) {
          return this.finishReply(db, record, {
            action: "unavailable",
            action_type: token.actionType,
            public_code: contact.public_code,
            replyText: "Essa solicitação não está mais disponível para esta ação.",
          });
        }
      }

      // 8. Establish canonical locks and dispatch to WP6.3 shared domain authority
      let outcomeResult: {
        action: "declared" | "confirmed" | "contested" | "unavailability_declared" | "idempotent_replay" | "unavailable" | "clarification";
        replyText: string;
        publicCode?: string;
      };

      if (token.actionType === "declare_completion") {
        const outcome = await executeCompletionDeclaration(
          db,
          contact,
          "professional",
          record.id,
          { provider: record.provider }
        );
        outcomeResult = {
          action: outcome.action,
          replyText: outcome.replyText,
          publicCode: contact.public_code,
        };
      } else if (token.actionType === "declare_unavailability") {
        // Lock canonical search_requests & search_conversations chain before delegation
        if (contact.search_request_id) {
          await db.query(
            "SELECT id FROM search_requests WHERE id = $1 FOR UPDATE",
            [contact.search_request_id]
          );
        }
        if (contact.selection_conversation_id) {
          await db.query(
            "SELECT id FROM search_conversations WHERE id = $1 FOR UPDATE",
            [contact.selection_conversation_id]
          );
        }
        const outcome = await executeUnavailabilityDeclaration(
          db,
          contact,
          contact.professional_id,
          record.id,
          { provider: record.provider }
        );
        outcomeResult = {
          action: outcome.action,
          replyText: outcome.replyText,
          publicCode: contact.public_code,
        };
      } else if (token.actionType === "confirm_completion") {
        const outcome = await executeCompletionConfirmation(
          db,
          contact,
          "customer",
          record.id,
          { provider: record.provider }
        );
        outcomeResult = {
          action: outcome.action,
          replyText: outcome.replyText,
          publicCode: contact.public_code,
        };
      } else if (token.actionType === "contest_completion") {
        const outcome = await executeCompletionContestation(
          db,
          contact,
          "customer",
          record.id,
          { provider: record.provider }
        );
        outcomeResult = {
          action: outcome.action,
          replyText: outcome.replyText,
          publicCode: contact.public_code,
        };
      } else {
        outcomeResult = {
          action: "unavailable",
          replyText: "Ação não suportada.",
        };
      }

      // 9. Atomic Token Consumption in same transaction
      await this.repository.markConsumed(db, token.id, record.id);

      return this.finishReply(
        db,
        record,
        {
          action: outcomeResult.action,
          action_type: token.actionType,
          public_code: outcomeResult.publicCode ?? contact.public_code,
          replyText: outcomeResult.replyText,
        },
        contact
      );
    });
  }

  private async finishReply(
    db: DatabaseClient,
    record: ChannelInboundMessageRecord,
    outcome: {
      action: "declared" | "confirmed" | "contested" | "unavailability_declared" | "idempotent_replay" | "unavailable" | "clarification";
      action_type?: InteractiveActionType;
      public_code?: string;
      replyText: string;
    },
    contact?: ContactRow
  ): Promise<ChannelInboundMessageResponse> {
    const result: InteractiveActionResult = {
      action: outcome.action,
      ...(outcome.action_type ? { action_type: outcome.action_type } : {}),
      ...(outcome.public_code ? { public_code: outcome.public_code } : {}),
      reply_text: outcome.replyText,
    };

    const purpose =
      outcome.action === "unavailability_declared" || outcome.action === "declared"
        ? "professional_reply"
        : "customer_reply";

    const outbound = (
      await db.query<{ id: string; status: "pending" | "processing" | "sent" | "failed"; text_content: string }>(
        `INSERT INTO channel_outbound_messages (
           channel_inbound_message_id, purpose, provider, recipient_phone_e164, text_content
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (channel_inbound_message_id) WHERE channel_inbound_message_id IS NOT NULL DO UPDATE
           SET channel_inbound_message_id = EXCLUDED.channel_inbound_message_id
         RETURNING id, status, text_content`,
        [
          record.id,
          purpose,
          record.provider,
          normalizeBrazilianMobilePhone(record.phoneE164),
          outcome.replyText,
        ]
      )
    ).rows[0];

    await db.query(
      `UPDATE channel_inbound_messages
          SET status = 'processed',
              customer_id = $3,
              conversation_id = $4,
              search_request_id = $5,
              result = $6::jsonb,
              error_code = NULL,
              processing_token = NULL,
              processing_started_at = NULL,
              processed_at = NOW(),
              lease_expires_at = NULL,
              next_attempt_at = NULL
        WHERE id = $1 AND processing_token = $2`,
      [
        record.id,
        record.processingToken,
        contact?.customer_id ?? record.customerId ?? null,
        contact?.selection_conversation_id ?? record.conversationId ?? null,
        contact?.search_request_id ?? record.searchRequestId ?? null,
        JSON.stringify(result),
      ]
    );

    return channelInboundMessageResponseSchema.parse({
      message_id: record.id,
      duplicate: false,
      reply_text: outbound.text_content,
      outbound: { id: outbound.id, status: outbound.status },
      result,
    });
  }
}
