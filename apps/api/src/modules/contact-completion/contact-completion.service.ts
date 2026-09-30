import {
  channelInboundMessageResponseSchema,
  contactCompletionMessageSchema,
  arePhoneIdentitiesEquivalent,
  normalizeBrazilianMobilePhone,
  type ChannelInboundMessageResponse,
} from "@contatocerto/shared";
import { withTransaction, type DatabaseClient } from "../../database/connection.js";
import { bilateralSnapshotSchema } from "../bilateral-contact/bilateral-contact.policy.js";
import { parseGlobalConversationCommand } from "../conversation-commands/conversation-command.parser.js";
import type { ChannelInboundMessageRecord } from "../channel-inbox/channel-inbox.types.js";
import {
  InboxFenceError,
  liveInboxLeaseSql,
} from "../channel-inbox/inbox-recovery.policy.js";
import { parseContactCompletionCommand } from "./contact-completion.parser.js";
import { PostgresContactCompletionRepository } from "./contact-completion.repository.js";
import type {
  ContactCompletionRepository,
  ContactCompletionActorRole,
  ContactCompletionMessage,
} from "./contact-completion.types.js";

type Transaction = <T>(callback: (client: DatabaseClient) => Promise<T>) => Promise<T>;

export class ContactCompletionService {
  constructor(
    private readonly repository: ContactCompletionRepository = new PostgresContactCompletionRepository(),
    private readonly transaction: Transaction = withTransaction
  ) {}

  async handle(record: ChannelInboundMessageRecord): Promise<ChannelInboundMessageResponse | null> {
    if (parseGlobalConversationCommand(record.rawText)) {
      return null;
    }

    let command = parseContactCompletionCommand(record.rawText);

    return this.transaction(async (db) => {
      // If no explicit command parsed, check if this sender is replying to a persisted disambiguation prompt
      if (!command) {
        const lastClarification = await this.repository.findLastClarification(db, record.provider, record.phoneE164);
        if (lastClarification?.options && lastClarification.requested_action) {
          const normalizedRaw = record.rawText.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
          const hasNegationOrQuestion = /[?\u00bf]/u.test(record.rawText)
            || /\b(?:nao|nem|nunca|jamais|cancelar|cancelamento|recuso|recusar|recusado|parar|sair)\b/u.test(normalizedRaw);
          if (normalizedRaw && !hasNegationOrQuestion) {
            const matched = lastClarification.options.filter((opt) => {
              const code = opt.public_code.toLowerCase();
              const fullName = opt.professional_name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
              const firstName = fullName.split(" ")[0] ?? "";
              const service = opt.service_name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

              if (normalizedRaw === code) return true;

              const allowedPrefixes = ["", "o ", "a ", "com ", "com o ", "com a ", "foi ", "foi o ", "foi a ", "do ", "da ", "servico ", "servico de "];
              for (const prefix of allowedPrefixes) {
                if (firstName && normalizedRaw === prefix + firstName) return true;
                if (fullName && normalizedRaw === prefix + fullName) return true;
                if (service && normalizedRaw === prefix + service) return true;
              }
              return false;
            });
            if (matched.length === 1) {
              command = {
                kind: lastClarification.requested_action,
                code: matched[0]!.public_code,
              };
            }
          }
        }
      }

      if (!command) {
        return null;
      }

      const inboundRes = await db.query<{
        status: string;
        processing_token: string | null;
        result: unknown;
        response_outbound_id: string | null;
      }>(
        "SELECT status, processing_token, result, response_outbound_id FROM channel_inbound_messages WHERE id = $1 FOR UPDATE",
        [record.id]
      );
      const inbound = inboundRes.rows[0];
      if (!inbound) return null;

      if (inbound.status === "processed" && inbound.response_outbound_id) {
        const outboundRes = await db.query<{ id: string; text_content: string; status: "pending" | "processing" | "sent" | "failed" }>(
          "SELECT id, text_content, status FROM channel_outbound_messages WHERE id = $1",
          [inbound.response_outbound_id]
        );
        const outbound = outboundRes.rows[0];
        if (!outbound) throw new Error("Outbound reply record not found for processed inbound");
        return channelInboundMessageResponseSchema.parse({
          message_id: record.id,
          duplicate: true,
          reply_text: outbound.text_content,
          outbound: { id: outbound.id, status: outbound.status },
          result: contactCompletionMessageSchema.parse(inbound.result),
        });
      }

      if (inbound.status !== "processing" || inbound.processing_token !== record.processingToken) {
        return null;
      }

      const live = await db.query(
        `SELECT id FROM channel_inbound_messages WHERE id = $1 AND processing_token = $2 AND ${liveInboxLeaseSql}`,
        [record.id, record.processingToken]
      );
      if (!live.rows.length) throw new InboxFenceError();

      // Resolve contact to operate on (explicit public code vs code-free resolution)
      let targetContactId: string | null = null;

      if (command.code) {
        const found = await this.repository.findContactByPublicCode(db, command.code);
        if (found) targetContactId = found.id;
      } else if (command.kind === "confirm" || command.kind === "contest") {
        const pendingCompletions = await this.repository.findPendingCompletionsByPhone(db, record.phoneE164);
        if (pendingCompletions.length === 1) {
          targetContactId = pendingCompletions[0]!.contact.id;
        } else if (pendingCompletions.length > 1) {
          const optionsList = pendingCompletions.map((item) => {
            const snap = bilateralSnapshotSchema.safeParse(item.contact.bilateral_snapshot);
            return {
              public_code: item.contact.public_code,
              professional_name: snap.success ? snap.data.professional_name.split(" ")[0] ?? snap.data.professional_name : item.contact.public_code,
              service_name: snap.success ? snap.data.service_name : "Serviço",
            };
          });
          const textOptions = optionsList.map(o => `${o.professional_name} (${o.service_name})`).join(" e ");
          const replyText = `Você possui confirmações pendentes para ${textOptions}. Por favor, informe com qual prestador deseja ${command.kind === "confirm" ? "confirmar" : "contestar"}.`;
          return this.finishClarification(db, record, {
            replyText,
            requestedAction: command.kind,
            options: optionsList,
          });
        } else {
          // No pending completion found for a code-free confirm/contest
          return null;
        }
      } else if (command.kind === "declare") {
        const eligible = await this.repository.findEligibleContactsByPhone(db, record.phoneE164);
        if (eligible.length === 0) {
          return this.finishUnavailable(
            db,
            record,
            "Não encontrei nenhuma solicitação ativa em andamento para o seu número."
          );
        }
        if (eligible.length === 1) {
          targetContactId = eligible[0]!.id;
        } else {
          const optionsList = eligible.map((c) => {
            const snap = bilateralSnapshotSchema.safeParse(c.bilateral_snapshot);
            return {
              public_code: c.public_code,
              professional_name: snap.success ? snap.data.professional_name.split(" ")[0] ?? snap.data.professional_name : c.public_code,
              service_name: snap.success ? snap.data.service_name : "Serviço",
            };
          });
          const textOptions = optionsList.map(o => `${o.professional_name} (${o.service_name})`).join(" e ");
          const replyText = `Você possui solicitações em andamento com ${textOptions}. Por favor, informe o nome do prestador ou o código da solicitação que deseja concluir.`;
          return this.finishClarification(db, record, {
            replyText,
            requestedAction: "declare",
            options: optionsList,
          });
        }
      }

      if (!targetContactId) {
        return this.finishUnavailable(
          db,
          record,
          "Não identifiquei uma solicitação ativa correspondente para o seu número."
        );
      }

      // Authoritative serialization point: lock contact row first!
      const lockedContact = await this.repository.lockContact(db, targetContactId);
      if (!lockedContact) {
        return this.finishUnavailable(
          db,
          record,
          "Não identifiquei uma solicitação ativa correspondente para o seu número."
        );
      }

      const snapshotParse = bilateralSnapshotSchema.safeParse(lockedContact.bilateral_snapshot);
      if (!snapshotParse.success) {
        return this.finishUnavailable(
          db,
          record,
          "Não identifiquei uma solicitação ativa correspondente para o seu número."
        );
      }
      const snapshot = snapshotParse.data;

      let actorRole: ContactCompletionActorRole | null = null;
      let counterpartRole: ContactCompletionActorRole | null = null;
      let counterpartPhone: string | null = null;
      let actorLabel = "";
      let counterpartLabel = "";

      if (arePhoneIdentitiesEquivalent(record.phoneE164, snapshot.customer_phone_e164)) {
        actorRole = "customer";
        counterpartRole = "professional";
        counterpartPhone = normalizeBrazilianMobilePhone(snapshot.professional_phone_e164);
        actorLabel = "O cliente";
        counterpartLabel = "do profissional";
      } else if (arePhoneIdentitiesEquivalent(record.phoneE164, snapshot.professional_phone_e164)) {
        actorRole = "professional";
        counterpartRole = "customer";
        counterpartPhone = normalizeBrazilianMobilePhone(snapshot.customer_phone_e164);
        actorLabel = "O profissional";
        counterpartLabel = "do cliente";
      }

      if (!actorRole || !counterpartRole || !counterpartPhone) {
        return this.finishUnavailable(
          db,
          record,
          "Não identifiquei uma solicitação ativa correspondente a esse código para o seu número."
        );
      }

      // Check contact eligibility
      if (lockedContact.status === "completed") {
        const replyText =
          command.kind === "contest"
            ? "Essa solicitação já foi concluída e não pode ser contestada."
            : "Essa solicitação já foi concluída anteriormente.";
        return this.finishReply(db, record, {
          action: "idempotent_replay",
          replyText,
          contact: lockedContact,
          actorRole,
        });
      }

      if (lockedContact.status === "declined") {
        return this.finishReply(db, record, {
          action: "unavailable",
          replyText: "Essa solicitação foi recusada e não pode ser concluída.",
          contact: lockedContact,
          actorRole,
        });
      }

      if (lockedContact.status === "requested") {
        return this.finishReply(db, record, {
          action: "unavailable",
          replyText: "Essa solicitação ainda está aguardando resposta e não pode ser concluída.",
          contact: lockedContact,
          actorRole,
        });
      }

      if (lockedContact.status !== "shared" && lockedContact.status !== "accepted") {
        return this.finishReply(db, record, {
          action: "unavailable",
          replyText: "Essa solicitação não está disponível para conclusão.",
          contact: lockedContact,
          actorRole,
        });
      }

      // Lock completion aggregate (step 2 in lock order)
      let completion = await this.repository.findCompletionByContactId(db, lockedContact.id, true);

      if (!completion) {
        if (command.kind === "confirm") {
          return this.finishReply(db, record, {
            action: "clarification",
            replyText: "Não há declaração de conclusão pendente para essa solicitação.",
            contact: lockedContact,
            actorRole,
          });
        }
        if (command.kind === "contest") {
          return this.finishReply(db, record, {
            action: "clarification",
            replyText: "Não há declaração de conclusão pendente para contestar.",
            contact: lockedContact,
            actorRole,
          });
        }

        // command.kind === "declare"
        completion = await this.repository.createCompletion(db, {
          contactId: lockedContact.id,
          state: "pending_confirmation",
          declaredBy: actorRole,
        });

        const event = await this.repository.createEvent(db, {
          completionId: completion.id,
          contactId: lockedContact.id,
          actorRole,
          action: "declared",
          inboundMessageId: record.id,
        });

        const promptText = `${actorLabel} declarou a conclusão do serviço da solicitação ${lockedContact.public_code}. Se o serviço foi finalizado, responda “confirmar ${lockedContact.public_code}”. Se houver divergência, responda “contestar ${lockedContact.public_code}”.`;
        await this.repository.insertOutboundNotification(db, {
          purpose:
            counterpartRole === "customer"
              ? "customer_contact_update"
              : "professional_contact_notification",
          provider: record.provider,
          recipientPhoneE164: counterpartPhone,
          textContent: promptText,
          businessKey: `contact:${lockedContact.id}:completion:prompt`,
          completionEventId: event.id,
        });

        const replyText = `Solicitação de conclusão registrada para ${lockedContact.public_code}. Aguardando confirmação ${counterpartLabel}.`;
        return this.finishReply(db, record, {
          action: "declared",
          replyText,
          contact: lockedContact,
          actorRole,
          completion,
          event,
        });
      }

      if (completion.state === "pending_confirmation") {
        if (command.kind === "declare") {
          if (completion.declared_by === actorRole) {
            // Same-side replay
            const replyText = `Você já registrou a declaração de conclusão para ${lockedContact.public_code}. Aguardando confirmação ${counterpartLabel}.`;
            return this.finishReply(db, record, {
              action: "idempotent_replay",
              replyText,
              contact: lockedContact,
              actorRole,
              completion,
            });
          }

          // Counterpart declaration acts as confirmation
          completion = await this.repository.updateCompletionState(db, completion.id, {
            state: "confirmed",
            confirmedAt: new Date(),
          });
          await this.repository.updateContactStatus(db, lockedContact.id, "completed");

          const event = await this.repository.createEvent(db, {
            completionId: completion.id,
            contactId: lockedContact.id,
            actorRole,
            action: "confirmed",
            inboundMessageId: record.id,
          });

          const notifText = `${actorLabel} também declarou a conclusão do serviço ${lockedContact.public_code}. O serviço foi finalizado com sucesso!`;
          await this.repository.insertOutboundNotification(db, {
            purpose:
              counterpartRole === "customer"
                ? "customer_contact_update"
                : "professional_contact_notification",
            provider: record.provider,
            recipientPhoneE164: counterpartPhone,
            textContent: notifText,
            businessKey: `contact:${lockedContact.id}:completion:confirmed`,
            completionEventId: event.id,
          });

          const replyText = `Conclusão do serviço ${lockedContact.public_code} confirmada com sucesso.`;
          return this.finishReply(db, record, {
            action: "confirmed",
            replyText,
            contact: lockedContact,
            actorRole,
            completion,
            event,
          });
        }

        if (command.kind === "confirm") {
          if (completion.declared_by === actorRole) {
            const replyText = `Você é quem declarou a conclusão para ${lockedContact.public_code}. A confirmação deve ser feita pela outra parte.`;
            return this.finishReply(db, record, {
              action: "clarification",
              replyText,
              contact: lockedContact,
              actorRole,
              completion,
            });
          }

          // Valid counterpart confirmation
          completion = await this.repository.updateCompletionState(db, completion.id, {
            state: "confirmed",
            confirmedAt: new Date(),
          });
          await this.repository.updateContactStatus(db, lockedContact.id, "completed");

          const event = await this.repository.createEvent(db, {
            completionId: completion.id,
            contactId: lockedContact.id,
            actorRole,
            action: "confirmed",
            inboundMessageId: record.id,
          });

          const notifText = `${actorLabel} confirmou a conclusão do serviço ${lockedContact.public_code}. O serviço foi finalizado com sucesso!`;
          await this.repository.insertOutboundNotification(db, {
            purpose:
              counterpartRole === "customer"
                ? "customer_contact_update"
                : "professional_contact_notification",
            provider: record.provider,
            recipientPhoneE164: counterpartPhone,
            textContent: notifText,
            businessKey: `contact:${lockedContact.id}:completion:confirmed`,
            completionEventId: event.id,
          });

          const replyText = `Conclusão do serviço ${lockedContact.public_code} confirmada com sucesso.`;
          return this.finishReply(db, record, {
            action: "confirmed",
            replyText,
            contact: lockedContact,
            actorRole,
            completion,
            event,
          });
        }

        if (command.kind === "contest") {
          if (completion.declared_by === actorRole) {
            const replyText = `Você registrou a declaração de conclusão para ${lockedContact.public_code}. A contestação só pode ser feita pela outra parte.`;
            return this.finishReply(db, record, {
              action: "clarification",
              replyText,
              contact: lockedContact,
              actorRole,
              completion,
            });
          }

          // Valid counterpart contestation
          completion = await this.repository.updateCompletionState(db, completion.id, {
            state: "contested",
            contestedAt: new Date(),
          });

          const event = await this.repository.createEvent(db, {
            completionId: completion.id,
            contactId: lockedContact.id,
            actorRole,
            action: "contested",
            inboundMessageId: record.id,
          });

          const notifText = `${actorLabel} contestou a declaração de conclusão do serviço ${lockedContact.public_code}. O serviço permanece ativo em andamento.`;
          await this.repository.insertOutboundNotification(db, {
            purpose:
              counterpartRole === "customer"
                ? "customer_contact_update"
                : "professional_contact_notification",
            provider: record.provider,
            recipientPhoneE164: counterpartPhone,
            textContent: notifText,
            businessKey: `contact:${lockedContact.id}:completion:contested`,
            completionEventId: event.id,
          });

          const replyText = `A contestação da conclusão do serviço ${lockedContact.public_code} foi registrada. O serviço permanece em andamento.`;
          return this.finishReply(db, record, {
            action: "contested",
            replyText,
            contact: lockedContact,
            actorRole,
            completion,
            event,
          });
        }
      }

      if (completion.state === "confirmed") {
        if (command.kind === "contest") {
          const replyText = `Essa solicitação já foi concluída e não pode ser contestada.`;
          return this.finishReply(db, record, {
            action: "unavailable",
            replyText,
            contact: lockedContact,
            actorRole,
            completion,
          });
        }
        const replyText = `Essa solicitação já foi concluída anteriormente.`;
        return this.finishReply(db, record, {
          action: "idempotent_replay",
          replyText,
          contact: lockedContact,
          actorRole,
          completion,
        });
      }

      if (completion.state === "contested") {
        const replyText = `Essa solicitação possui uma contestação de conclusão registrada e permanece em andamento.`;
        return this.finishReply(db, record, {
          action: "unavailable",
          replyText,
          contact: lockedContact,
          actorRole,
          completion,
        });
      }

      return null;
    });
  }

  private async finishClarification(
    db: DatabaseClient,
    record: ChannelInboundMessageRecord,
    params: {
      replyText: string;
      requestedAction: "declare" | "confirm" | "contest";
      options: Array<{ public_code: string; professional_name: string; service_name: string }>;
    }
  ): Promise<ChannelInboundMessageResponse> {
    const outboundId = await this.repository.insertOutboundReply(db, {
      inboundId: record.id,
      purpose: "customer_reply",
      provider: record.provider,
      recipientPhoneE164: record.phoneE164,
      textContent: params.replyText,
    });

    const result: ContactCompletionMessage = {
      route: "contact_completion",
      action: "clarification",
      clarification_kind: "contact_disambiguation",
      requested_action: params.requestedAction,
      options: params.options,
      reply_text: params.replyText,
    };

    await this.repository.markInboundProcessed(db, {
      inboundId: record.id,
      result,
      responseOutboundId: outboundId,
    });

    return channelInboundMessageResponseSchema.parse({
      message_id: record.id,
      duplicate: false,
      reply_text: params.replyText,
      outbound: { id: outboundId, status: "pending" },
      result,
    });
  }

  private async finishUnavailable(
    db: DatabaseClient,
    record: ChannelInboundMessageRecord,
    replyText: string
  ): Promise<ChannelInboundMessageResponse> {
    const outboundId = await this.repository.insertOutboundReply(db, {
      inboundId: record.id,
      purpose: "customer_reply",
      provider: record.provider,
      recipientPhoneE164: record.phoneE164,
      textContent: replyText,
    });

    const result: ContactCompletionMessage = {
      route: "contact_completion",
      action: "unavailable",
      reply_text: replyText,
    };

    await this.repository.markInboundProcessed(db, {
      inboundId: record.id,
      result,
      responseOutboundId: outboundId,
    });

    return channelInboundMessageResponseSchema.parse({
      message_id: record.id,
      duplicate: false,
      reply_text: replyText,
      outbound: { id: outboundId, status: "pending" },
      result,
    });
  }

  private async finishReply(
    db: DatabaseClient,
    record: ChannelInboundMessageRecord,
    params: {
      action: ContactCompletionMessage["action"];
      replyText: string;
      contact: { id: string; public_code: string };
      actorRole: ContactCompletionActorRole;
      completion?: { id: string; state: ContactCompletionMessage["state"] };
      event?: { id: string };
    }
  ): Promise<ChannelInboundMessageResponse> {
    const outboundPurpose =
      params.actorRole === "customer" ? "customer_reply" : "professional_reply";

    const outboundId = await this.repository.insertOutboundReply(db, {
      inboundId: record.id,
      purpose: outboundPurpose,
      provider: record.provider,
      recipientPhoneE164: record.phoneE164,
      textContent: params.replyText,
      completionEventId: params.event?.id ?? null,
    });

    const result: ContactCompletionMessage = {
      route: "contact_completion",
      action: params.action,
      public_code: params.contact.public_code,
      contact_id: params.contact.id,
      completion_id: params.completion?.id,
      event_id: params.event?.id,
      state: params.completion?.state,
      reply_text: params.replyText,
    };

    await this.repository.markInboundProcessed(db, {
      inboundId: record.id,
      result,
      responseOutboundId: outboundId,
    });

    return channelInboundMessageResponseSchema.parse({
      message_id: record.id,
      duplicate: false,
      reply_text: params.replyText,
      outbound: { id: outboundId, status: "pending" },
      result,
    });
  }
}
