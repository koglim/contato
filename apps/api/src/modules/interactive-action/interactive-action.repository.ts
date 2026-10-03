import type { DatabaseClient } from "../../database/connection.js";
import type {
  InteractiveActionRepository,
  InteractiveActionTokenRecord,
  CreateInteractiveActionTokenInput,
} from "./interactive-action.types.js";
import type { InteractiveActionType, InteractiveActionTokenStatus } from "@contatocerto/shared";
import { INTERACTIVE_ACTION_TOKEN_TTL_DAYS } from "./interactive-action.crypto.js";

type InteractiveActionTokenRow = {
  id: string;
  public_token: string;
  action_type: string;
  contact_id: string;
  completion_id: string | null;
  intended_actor_role: "customer" | "professional";
  intended_phone_e164: string;
  outbound_message_id: string;
  status: "active" | "consumed" | "revoked" | "expired";
  expires_at: Date;
  consumed_at: Date | null;
  consumed_inbound_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const tokenColumns = `
  id, public_token, action_type, contact_id, completion_id, intended_actor_role,
  intended_phone_e164, outbound_message_id, status, expires_at, consumed_at,
  consumed_inbound_id, created_at, updated_at
`;

function toRecord(row: InteractiveActionTokenRow): InteractiveActionTokenRecord {
  return {
    id: row.id,
    publicToken: row.public_token,
    actionType: row.action_type as InteractiveActionType,
    contactId: row.contact_id,
    completionId: row.completion_id,
    intendedActorRole: row.intended_actor_role,
    intendedPhoneE164: row.intended_phone_e164,
    outboundMessageId: row.outbound_message_id,
    status: row.status as InteractiveActionTokenStatus,
    expiresAt: new Date(row.expires_at),
    consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
    consumedInboundId: row.consumed_inbound_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class PostgresInteractiveActionRepository implements InteractiveActionRepository {
  async createTokens(
    db: DatabaseClient,
    tokens: CreateInteractiveActionTokenInput[]
  ): Promise<InteractiveActionTokenRecord[]> {
    if (tokens.length === 0) return [];
    const results: InteractiveActionTokenRecord[] = [];
    for (const token of tokens) {
      const expiresAt =
        token.expiresAt ??
        new Date(Date.now() + INTERACTIVE_ACTION_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
      const inserted = await db.query<InteractiveActionTokenRow>(
        `INSERT INTO interactive_action_tokens (
           public_token, action_type, contact_id, completion_id, intended_actor_role,
           intended_phone_e164, outbound_message_id, status, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
         RETURNING ${tokenColumns}`,
        [
          token.publicToken,
          token.actionType,
          token.contactId,
          token.completionId ?? null,
          token.intendedActorRole,
          token.intendedPhoneE164,
          token.outboundMessageId,
          expiresAt.toISOString(),
        ]
      );
      if (!inserted.rows[0]) {
        throw new Error("Failed to insert interactive action token");
      }
      results.push(toRecord(inserted.rows[0]));
    }
    return results;
  }

  async findByPublicToken(
    db: DatabaseClient,
    publicToken: string,
    forUpdate = false
  ): Promise<InteractiveActionTokenRecord | null> {
    const result = await db.query<InteractiveActionTokenRow>(
      `SELECT ${tokenColumns}
         FROM interactive_action_tokens
        WHERE public_token = $1
        ${forUpdate ? "FOR UPDATE" : ""}`,
      [publicToken]
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async markConsumed(
    db: DatabaseClient,
    id: string,
    inboundId: string
  ): Promise<boolean> {
    const result = await db.query<{ id: string }>(
      `UPDATE interactive_action_tokens
          SET status = 'consumed',
              consumed_at = clock_timestamp(),
              consumed_inbound_id = $2
        WHERE id = $1 AND status = 'active'
        RETURNING id`,
      [id, inboundId]
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }

  async markExpired(db: DatabaseClient, id: string): Promise<boolean> {
    const result = await db.query<{ id: string }>(
      `UPDATE interactive_action_tokens
          SET status = 'expired'
        WHERE id = $1 AND status = 'active'
        RETURNING id`,
      [id]
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }
}
