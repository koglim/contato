import { randomUUID } from "node:crypto";
import { query, withTransaction, type DatabaseClient } from "../../database/connection.js";
import { CONTEXTUAL_POLICY, CONTEXTUAL_VERSION, contextualMemorySchema, type ContextualMemory } from "./contextual.contract.js";
import type { ChannelInboundMessageRecord } from "../channel-inbox/channel-inbox.types.js";

export class ContextualBusyError extends Error {}
export type ContextualSnapshot = {
  customerId: string; token: string; revision: number; memory: ContextualMemory; proposal: unknown;
  conversationId: string | null; fingerprint: string; pendingSlot: string | null;
  draft: string | null;
};

export async function contextualFingerprint(client: DatabaseClient, customerId: string) {
  const { rows } = await client.query<{ fingerprint: string; id: string; pending_slot: string; service_text: string; location_text: string | null; resolved_service: string | null }>(`
    SELECT c.id, c.pending_slot, c.service_text, c.location_text, s.name AS resolved_service,
      md5(row_to_json(c)::text) AS fingerprint FROM search_conversations c
      LEFT JOIN search_requests r ON r.id = c.search_request_id LEFT JOIN services s ON s.id = r.service_id
    WHERE c.customer_id = $1 AND c.status = 'active' AND c.expires_at > NOW()`, [customerId]);
  return rows[0] ?? null;
}

export class PostgresContextualRepository {
  async acquire(record: ChannelInboundMessageRecord, model: string): Promise<ContextualSnapshot> {
    const customerId = await withTransaction(async client => {
      const customer = await client.query<{ id: string }>(`INSERT INTO customers(phone_e164) VALUES ($1)
        ON CONFLICT(phone_e164) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164 RETURNING id`, [record.phoneE164]);
      const customerId = customer.rows[0].id;
      await client.query(`INSERT INTO contextual_memories(customer_id) VALUES ($1) ON CONFLICT DO NOTHING`, [customerId]);
      await client.query(`INSERT INTO contextual_turns(inbound_id, customer_id, context_revision, model, version)
        SELECT $1, customer_id, revision, $3, $4 FROM contextual_memories WHERE customer_id = $2
        ON CONFLICT DO NOTHING`, [record.id, customerId, model, CONTEXTUAL_VERSION]);
      return customerId;
    });
    return withTransaction(async client => {
      await client.query(`SELECT id FROM customers WHERE id = $1 FOR NO KEY UPDATE`, [customerId]);
      const token = randomUUID();
      const claimed = await client.query<{ revision: number; memory: unknown; conversation_fingerprint: string | null }>(`UPDATE contextual_memories SET lease_token = $2,
        lease_expires_at = NOW() + ($3 * INTERVAL '1 second') WHERE customer_id = $1
        AND (lease_token IS NULL OR lease_expires_at <= NOW()) RETURNING revision, memory, conversation_fingerprint`, [customerId, token, CONTEXTUAL_POLICY.leaseSeconds]);
      if (!claimed.rows[0]) throw new ContextualBusyError();
      // Arrival order, not UUID or completion order. A later turn stays recoverable in the Inbox.
      const older = await client.query(`SELECT t.inbound_id FROM contextual_turns t
        JOIN channel_inbound_messages i ON i.id = t.inbound_id
        JOIN channel_inbound_messages current ON current.id = $2
        WHERE t.customer_id = $1 AND t.status = 'pending' AND (i.created_at, i.id) < (current.created_at, current.id) LIMIT 1`, [customerId, record.id]);
      if (older.rows.length) throw new ContextualBusyError();
      const current = await contextualFingerprint(client, customerId);
      const memory = contextualMemorySchema.parse(claimed.rows[0].memory);
      if (memory.conversationId !== (current?.id ?? null) || (current && claimed.rows[0].conversation_fingerprint !== current.fingerprint)) {
        const knownService = current?.resolved_service ?? (current?.pending_slot === "location" ? current.service_text.slice(0, 200) : null);
        memory.service = knownService ? { value: knownService, source: "domain", inboundId: record.id } : null;
        memory.location = current?.location_text ? { value: current.location_text, source: "domain", inboundId: record.id } : null;
        memory.hypotheses = [];
        memory.conversationId = current?.id ?? null;
      }
      const turn = await client.query<{ proposal: unknown; reply_draft: string | null; context_revision: number; context_fingerprint: string | null }>(`SELECT proposal, reply_draft, context_revision, context_fingerprint FROM contextual_turns WHERE inbound_id = $1`, [record.id]);
      // Never execute a proposal against a different memory revision.
      const sameContext = turn.rows[0].context_revision === claimed.rows[0].revision && turn.rows[0].context_fingerprint === (current?.fingerprint ?? "none");
      const proposal = sameContext ? turn.rows[0].proposal : null;
      return { customerId, token, revision: claimed.rows[0].revision, memory, proposal, draft: sameContext ? turn.rows[0].reply_draft : null,
        conversationId: current?.id ?? null, fingerprint: current?.fingerprint ?? "none", pendingSlot: current?.pending_slot ?? null };
    });
  }

  async reserveBudget(customerId: string) {
    return withTransaction(async client => {
      for (const [scope, limit] of [["global", CONTEXTUAL_POLICY.maxGlobalCallsPerHour], [customerId, CONTEXTUAL_POLICY.maxCallsPerHour]] as const) {
        const result = await client.query(`INSERT INTO contextual_budgets(scope, window_start, calls)
          VALUES ($1, date_trunc('hour', NOW()), 1) ON CONFLICT(scope, window_start)
          DO UPDATE SET calls = contextual_budgets.calls + 1 WHERE contextual_budgets.calls < $2 RETURNING calls`, [scope, limit]);
        if (!result.rows.length) throw new Error("contextual_budget_exhausted");
      }
      return true;
    });
  }

  async saveProposal(record: ChannelInboundMessageRecord, snapshot: ContextualSnapshot, proposal: unknown) {
    const result = await query(`UPDATE contextual_turns t SET proposal = $3::jsonb, reply_draft = NULL, context_revision = $4, context_fingerprint = $5
      FROM contextual_memories m WHERE t.inbound_id = $1 AND t.customer_id = m.customer_id
      AND m.lease_token = $2 AND m.lease_expires_at > NOW() AND m.revision = $4 RETURNING t.inbound_id`,
    [record.id, snapshot.token, JSON.stringify(proposal), snapshot.revision, snapshot.fingerprint]);
    if (!result.rows.length) throw new ContextualBusyError();
  }

  async saveDraft(record: ChannelInboundMessageRecord, snapshot: ContextualSnapshot, draft: string) {
    const result = await query(`UPDATE contextual_turns t SET reply_draft = $3 FROM contextual_memories m
      WHERE t.inbound_id = $1 AND t.customer_id = m.customer_id AND m.lease_token = $2
        AND m.lease_expires_at > NOW() AND m.revision = t.context_revision RETURNING t.inbound_id`, [record.id, snapshot.token, draft]);
    if (!result.rows.length) throw new ContextualBusyError();
  }

  async commit<T>(record: ChannelInboundMessageRecord, snapshot: ContextualSnapshot, apply: (client: DatabaseClient) => Promise<{ value: T; memory: ContextualMemory }>) {
    return withTransaction(async client => {
      const inbound = await client.query(`SELECT id FROM channel_inbound_messages WHERE id = $1
        AND status = 'processing' AND processing_token = $2 FOR UPDATE`, [record.id, record.processingToken]);
      if (!inbound.rows.length) throw new ContextualBusyError();
      await client.query(`SELECT id FROM customers WHERE id = $1 FOR NO KEY UPDATE`, [snapshot.customerId]);
      const lease = await client.query(`SELECT customer_id FROM contextual_memories WHERE customer_id = $1
        AND lease_token = $2 AND revision = $3 AND lease_expires_at > NOW() FOR UPDATE`, [snapshot.customerId, snapshot.token, snapshot.revision]);
      if (!lease.rows.length || ((await contextualFingerprint(client, snapshot.customerId))?.fingerprint ?? "none") !== snapshot.fingerprint) throw new ContextualBusyError();
      const result = await apply(client);
      await client.query(`UPDATE contextual_memories SET memory = $2::jsonb, revision = revision + 1, conversation_fingerprint = $3,
        lease_token = NULL, lease_expires_at = NULL, updated_at = NOW() WHERE customer_id = $1`, [snapshot.customerId, JSON.stringify(contextualMemorySchema.parse(result.memory)), (await contextualFingerprint(client, snapshot.customerId))?.fingerprint ?? "none"]);
      await client.query(`UPDATE contextual_turns SET status = 'completed' WHERE inbound_id = $1`, [record.id]);
      return result.value;
    });
  }

  async release(snapshot: ContextualSnapshot) {
    await query(`UPDATE contextual_memories SET lease_token = NULL, lease_expires_at = NULL WHERE customer_id = $1 AND lease_token = $2`, [snapshot.customerId, snapshot.token]);
  }
}
