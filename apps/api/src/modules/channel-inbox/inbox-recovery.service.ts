import { channelInboundMessageRequestSchema, inboxDispositionResponseSchema, inboxQueueStatusSchema, inboxRecoveryResponseSchema, type InboxDisposition } from "@contatocerto/shared";
import { query, withTransaction } from "../../database/connection.js";
import { PostgresChannelInboundMessageRepository } from "./channel-inbox.repository.js";
import type { ChannelInboxService } from "./channel-inbox.types.js";
import { InboxPermanentError } from "./inbox-recovery.policy.js";

export class InboxRecoveryService {
  constructor(private readonly inbox: ChannelInboxService, private readonly leaseSeconds: number,
    private readonly contextualEnabled = false, private readonly repository = new PostgresChannelInboundMessageRepository()) {}

  async processNext() {
    if (!this.inbox.processClaimed) throw new Error("Inbox recovery processor is not configured");
    const record = await this.repository.claimNext(this.leaseSeconds, this.contextualEnabled);
    if (!record) return null;
    try {
      if (!channelInboundMessageRequestSchema.safeParse({ provider: record.provider, provider_message_id: record.providerMessageId,
        phone_e164: record.phoneE164, raw_text: record.rawText, country_code: record.countryCode, limit: record.limitValue }).success) {
        throw new InboxPermanentError("conversation_state_invalid");
      }
      await this.inbox.processClaimed(record);
    } catch (error) {
      // Processing may already have recorded the failure. Token fencing makes this idempotent.
      await this.repository.markFailed(record.id, record.processingToken!, error instanceof InboxPermanentError ? error.code : "internal_error");
    }
    const current = await this.repository.findById(record.id);
    return inboxRecoveryResponseSchema.parse({ id: record.id,
      status: current?.recoveryState === "quarantined" ? "quarantined" : current?.status === "processed" ? "processed"
        : current?.status === "failed" ? "retry_scheduled" : "processing" });
  }

  async dispose(id: string, input: InboxDisposition) {
    return withTransaction(async db => {
      const record = (await db.query<{ status: string; recovery_state: string; recovery_reason: string; result: unknown }>(
        "SELECT status,recovery_state,recovery_reason,result FROM channel_inbound_messages WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!record) return { error: "inbound_not_found" as const };
      const prior = (await db.query<{ action: string; reason: string; operator_id: string }>(
        "SELECT action,reason,operator_id FROM channel_inbound_recovery_events WHERE inbound_id=$1 AND event_key=$2", [id, input.request_id])).rows[0];
      if (prior) {
        if (prior.action !== input.action || prior.reason !== input.reason || prior.operator_id !== input.operator_id) return { error: "disposition_payload_conflict" as const };
        return { response: inboxDispositionResponseSchema.parse({ id, action: input.action, recovery_state: input.action === "retry" ? "active" : "closed", duplicate: true }) };
      }
      if (record.recovery_state !== "quarantined") return { error: "inbound_not_quarantined" as const };
      // No retry of completed/corrupt results or uncertain legacy effects; reconcile then close explicitly.
      if (input.action === "retry" && (record.status === "processed" || record.result !== null
        || ["legacy_effects_uncertain", "channel_message_result_invalid", "persisted_proposal_invalid", "persisted_draft_invalid"].includes(record.recovery_reason))) {
        return { error: "inbound_retry_unsafe" as const };
      }
      await db.query(`INSERT INTO channel_inbound_recovery_events(inbound_id,event_key,action,reason,operator_id)
        VALUES($1,$2,$3,$4,$5)`, [id, input.request_id, input.action, input.reason, input.operator_id]);
      if (input.action === "retry") {
        await db.query(`UPDATE channel_inbound_messages SET recovery_state='active', status='failed', attempt_count=0,
          next_attempt_at=NULL, quarantined_at=NULL, recovery_reason=NULL, processing_token=NULL, processing_started_at=NULL,lease_expires_at=NULL WHERE id=$1`, [id]);
      } else {
        await db.query(`UPDATE channel_inbound_messages SET recovery_state='closed',
          status=CASE WHEN status='processed' THEN status ELSE 'failed'::channel_inbound_message_status END,
          next_attempt_at=NULL,processing_token=NULL,processing_started_at=NULL,lease_expires_at=NULL WHERE id=$1`, [id]);
      }
      return { response: inboxDispositionResponseSchema.parse({ id, action: input.action, recovery_state: input.action === "retry" ? "active" : "closed", duplicate: false }) };
    });
  }

  async queueStatus() {
    const result = await query(`SELECT
      count(*) FILTER (WHERE recovery_state='active' AND status IN ('received','failed') AND (next_attempt_at IS NULL OR next_attempt_at<=NOW()))::int AS pending,
      count(*) FILTER (WHERE recovery_state='active' AND next_attempt_at>NOW())::int AS scheduled_retry,
      count(*) FILTER (WHERE recovery_state='active' AND status='processing')::int AS processing,
      count(*) FILTER (WHERE recovery_state='active' AND status='processing' AND COALESCE(lease_expires_at,processing_started_at+INTERVAL '60 seconds')<=NOW())::int AS expired_lease,
      count(*) FILTER (WHERE recovery_state='quarantined')::int AS quarantined,
      count(*) FILTER (WHERE recovery_state='closed')::int AS closed,
      count(*) FILTER (WHERE recovery_state IN ('quarantined','closed'))::int AS permanent_failures,
      count(DISTINCT phone_e164) FILTER (WHERE recovery_state='quarantined' OR (status<>'processed' AND recovery_state<>'closed'))::int AS blocked_clients,
      count(*) FILTER (WHERE status='processed' AND recovered_at IS NOT NULL)::int AS recovered_completed,
      (SELECT count(*)::int FROM channel_inbound_recovery_events WHERE action='fencing_conflict') AS fencing_conflicts,
      jsonb_build_object(
        'pending',max(GREATEST(0,EXTRACT(EPOCH FROM NOW()-created_at))) FILTER (WHERE recovery_state='active' AND status IN ('received','failed') AND (next_attempt_at IS NULL OR next_attempt_at<=NOW())),
        'scheduled_retry',max(GREATEST(0,EXTRACT(EPOCH FROM NOW()-created_at))) FILTER (WHERE recovery_state='active' AND next_attempt_at>NOW()),
        'processing',max(GREATEST(0,EXTRACT(EPOCH FROM NOW()-created_at))) FILTER (WHERE recovery_state='active' AND status='processing'),
        'quarantined',max(GREATEST(0,EXTRACT(EPOCH FROM NOW()-created_at))) FILTER (WHERE recovery_state='quarantined'),
        'closed',max(GREATEST(0,EXTRACT(EPOCH FROM NOW()-created_at))) FILTER (WHERE recovery_state='closed')) AS oldest_seconds,
      jsonb_build_object('zero',count(*) FILTER (WHERE attempt_count=0),'one',count(*) FILTER (WHERE attempt_count=1),
        'two_to_four',count(*) FILTER (WHERE attempt_count BETWEEN 2 AND 4),'five',count(*) FILTER (WHERE attempt_count=5)) AS attempts
      FROM channel_inbound_messages`);
    return inboxQueueStatusSchema.parse(result.rows[0]);
  }
}
