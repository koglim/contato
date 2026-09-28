import type { DatabaseClient } from "../../database/connection.js";
import type {
  ContactCompletionRepository,
  ContactRow,
  ContactCompletionRow,
  ContactCompletionEventRow,
  ContactCompletionState,
  ContactCompletionActorRole,
  ContactCompletionAction,
  ContactCompletionMessage,
} from "./contact-completion.types.js";

export class PostgresContactCompletionRepository implements ContactCompletionRepository {
  async findEligibleContactsByPhone(db: DatabaseClient, phoneE164: string): Promise<ContactRow[]> {
    const res = await db.query<ContactRow>(
      `SELECT c.id, c.customer_id, c.professional_id, c.search_request_id, c.selection_conversation_id, c.public_code, c.status, c.bilateral_snapshot
       FROM contacts c
       JOIN customers cust ON cust.id = c.customer_id
       JOIN professionals prof ON prof.id = c.professional_id
       WHERE (cust.phone_e164 = $1 OR prof.phone_e164 = $1)
         AND c.status IN ('shared', 'accepted')
       ORDER BY c.created_at DESC`,
      [phoneE164]
    );
    return res.rows;
  }

  async findPendingCompletionsByPhone(db: DatabaseClient, phoneE164: string): Promise<{ contact: ContactRow; completion: ContactCompletionRow }[]> {
    const res = await db.query<ContactRow & { completion_id: string; state: ContactCompletionState; declared_by: ContactCompletionActorRole; declared_at: Date; confirmed_at: Date | null; contested_at: Date | null; completion_created_at: Date; completion_updated_at: Date }>(
      `SELECT c.id, c.customer_id, c.professional_id, c.search_request_id, c.selection_conversation_id, c.public_code, c.status, c.bilateral_snapshot,
              cc.id AS completion_id, cc.state, cc.declared_by, cc.declared_at, cc.confirmed_at, cc.contested_at, cc.created_at AS completion_created_at, cc.updated_at AS completion_updated_at
       FROM contacts c
       JOIN contact_completions cc ON cc.contact_id = c.id
       JOIN customers cust ON cust.id = c.customer_id
       JOIN professionals prof ON prof.id = c.professional_id
       WHERE (cust.phone_e164 = $1 OR prof.phone_e164 = $1)
         AND cc.state = 'pending_confirmation'
       ORDER BY cc.created_at DESC`,
      [phoneE164]
    );
    return res.rows.map((row) => ({
      contact: {
        id: row.id,
        customer_id: row.customer_id,
        professional_id: row.professional_id,
        search_request_id: row.search_request_id,
        selection_conversation_id: row.selection_conversation_id,
        public_code: row.public_code,
        status: row.status,
        bilateral_snapshot: row.bilateral_snapshot,
      },
      completion: {
        id: row.completion_id,
        contact_id: row.id,
        state: row.state,
        declared_by: row.declared_by,
        declared_at: row.declared_at,
        confirmed_at: row.confirmed_at,
        contested_at: row.contested_at,
        created_at: row.completion_created_at,
        updated_at: row.completion_updated_at,
      },
    }));
  }

  async findContactByPublicCode(db: DatabaseClient, code: string): Promise<ContactRow | null> {
    const res = await db.query<ContactRow>(
      `SELECT id, customer_id, professional_id, search_request_id, selection_conversation_id, public_code, status, bilateral_snapshot
       FROM contacts
       WHERE lower(public_code) = lower($1)
       LIMIT 1`,
      [code]
    );
    return res.rows[0] ?? null;
  }

  async lockContact(db: DatabaseClient, contactId: string): Promise<ContactRow | null> {
    const res = await db.query<ContactRow>(
      `SELECT id, customer_id, professional_id, search_request_id, selection_conversation_id, public_code, status, bilateral_snapshot
       FROM contacts
       WHERE id = $1
       FOR UPDATE`,
      [contactId]
    );
    return res.rows[0] ?? null;
  }

  async findCompletionByContactId(
    db: DatabaseClient,
    contactId: string,
    forUpdate = false
  ): Promise<ContactCompletionRow | null> {
    const sql = `SELECT id, contact_id, state, declared_by, declared_at, confirmed_at, contested_at, created_at, updated_at
       FROM contact_completions
       WHERE contact_id = $1 ${forUpdate ? "FOR UPDATE" : ""}`;
    const res = await db.query<ContactCompletionRow>(sql, [contactId]);
    return res.rows[0] ?? null;
  }

  async createCompletion(
    db: DatabaseClient,
    input: {
      contactId: string;
      state: ContactCompletionState;
      declaredBy: ContactCompletionActorRole;
      declaredAt?: Date;
      confirmedAt?: Date | null;
      contestedAt?: Date | null;
    }
  ): Promise<ContactCompletionRow> {
    const res = await db.query<ContactCompletionRow>(
      `INSERT INTO contact_completions (contact_id, state, declared_by, declared_at, confirmed_at, contested_at)
       VALUES ($1, $2, $3, COALESCE($4, NOW()), $5, $6)
       RETURNING id, contact_id, state, declared_by, declared_at, confirmed_at, contested_at, created_at, updated_at`,
      [
        input.contactId,
        input.state,
        input.declaredBy,
        input.declaredAt ?? null,
        input.confirmedAt ?? null,
        input.contestedAt ?? null,
      ]
    );
    return res.rows[0]!;
  }

  async updateCompletionState(
    db: DatabaseClient,
    id: string,
    input: {
      state: ContactCompletionState;
      confirmedAt?: Date | null;
      contestedAt?: Date | null;
    }
  ): Promise<ContactCompletionRow> {
    const res = await db.query<ContactCompletionRow>(
      `UPDATE contact_completions
       SET state = $2, confirmed_at = $3, contested_at = $4, updated_at = NOW()
       WHERE id = $1
       RETURNING id, contact_id, state, declared_by, declared_at, confirmed_at, contested_at, created_at, updated_at`,
      [id, input.state, input.confirmedAt ?? null, input.contestedAt ?? null]
    );
    return res.rows[0]!;
  }

  async createEvent(
    db: DatabaseClient,
    input: {
      completionId: string;
      contactId: string;
      actorRole: ContactCompletionActorRole;
      action: ContactCompletionAction;
      inboundMessageId: string;
    }
  ): Promise<ContactCompletionEventRow> {
    const res = await db.query<ContactCompletionEventRow>(
      `INSERT INTO contact_completion_events (completion_id, contact_id, actor_role, action, inbound_message_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, completion_id, contact_id, actor_role, action, inbound_message_id, created_at`,
      [input.completionId, input.contactId, input.actorRole, input.action, input.inboundMessageId]
    );
    return res.rows[0]!;
  }

  async updateContactStatus(db: DatabaseClient, contactId: string, status: string): Promise<void> {
    await db.query(
      `UPDATE contacts
       SET status = $2, updated_at = NOW()
       WHERE id = $1`,
      [contactId, status]
    );
  }

  async insertOutboundReply(
    db: DatabaseClient,
    input: {
      inboundId: string;
      purpose: "customer_reply" | "professional_reply";
      provider: string;
      recipientPhoneE164: string;
      textContent: string;
      completionEventId?: string | null;
    }
  ): Promise<string> {
    const businessKey = `inbound:${input.inboundId}:reply`;
    const res = await db.query<{ id: string }>(
      `INSERT INTO channel_outbound_messages (
         channel_inbound_message_id, purpose, provider, recipient_phone_e164, text_content, business_key, completion_event_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (business_key) WHERE business_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        input.inboundId,
        input.purpose,
        input.provider,
        input.recipientPhoneE164,
        input.textContent,
        businessKey,
        input.completionEventId ?? null,
      ]
    );
    if (res.rows[0]?.id) return res.rows[0].id;
    const existing = await db.query<{ id: string }>(
      "SELECT id FROM channel_outbound_messages WHERE business_key = $1",
      [businessKey]
    );
    return existing.rows[0]!.id;
  }

  async insertOutboundNotification(
    db: DatabaseClient,
    input: {
      purpose: "customer_contact_update" | "professional_contact_notification";
      provider: string;
      recipientPhoneE164: string;
      textContent: string;
      businessKey: string;
      completionEventId?: string | null;
    }
  ): Promise<string> {
    const res = await db.query<{ id: string }>(
      `INSERT INTO channel_outbound_messages (
         purpose, provider, recipient_phone_e164, text_content, business_key, completion_event_id
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (business_key) WHERE business_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        input.purpose,
        input.provider,
        input.recipientPhoneE164,
        input.textContent,
        input.businessKey,
        input.completionEventId ?? null,
      ]
    );
    if (res.rows[0]?.id) return res.rows[0].id;
    const existing = await db.query<{ id: string }>(
      "SELECT id FROM channel_outbound_messages WHERE business_key = $1",
      [input.businessKey]
    );
    return existing.rows[0]!.id;
  }

  async markInboundProcessed(
    db: DatabaseClient,
    input: {
      inboundId: string;
      result: ContactCompletionMessage;
      responseOutboundId: string;
    }
  ): Promise<void> {
    await db.query(
      `UPDATE channel_inbound_messages
       SET status = 'processed',
           result = $2,
           response_outbound_id = $3,
           processed_at = NOW(),
           processing_token = NULL,
           processing_started_at = NULL
       WHERE id = $1`,
      [input.inboundId, input.result, input.responseOutboundId]
    );
  }
}
