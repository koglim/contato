export const INBOX_MAX_ATTEMPTS = 5;
export const INBOX_BACKOFF_SECONDS = [30, 60, 120, 240] as const;

export class InboxFenceError extends Error {
  constructor() { super("inbox_fencing_conflict"); }
}
export class InboxContextChangedError extends Error {}
export const inboxContextSql = `(SELECT md5(row_to_json(c)::text) FROM search_conversations c
  JOIN customers u ON u.id=c.customer_id WHERE u.phone_e164=$1 AND c.status='active' AND c.expires_at>clock_timestamp())`;
export class InboxPermanentError extends Error {
  constructor(readonly code: "persisted_proposal_invalid" | "persisted_draft_invalid" | "conversation_state_invalid" | "dependency_missing") { super(code); }
}
export const inboxErrorCode = (code: string) => new Set([
  "internal_error", "geocoding_rate_limited", "geocoding_unavailable", "geocoding_provider_error",
  "service_unavailable", "customer_conversation_conflict", "conversation_processing", "contextual_processing",
  "selection_show_more_pending", "show_more_reservation_conflict", "selection_idempotency_key_required",
  "channel_message_processing", "persisted_proposal_invalid", "persisted_draft_invalid", "conversation_state_invalid",
  "dependency_missing", "lease_abandoned", "attempts_exhausted", "channel_message_result_invalid",
]).has(code) ? code : "internal_error";

export const isInboxPermanent = (code: string) => ["persisted_proposal_invalid", "persisted_draft_invalid",
  "conversation_state_invalid", "dependency_missing", "channel_message_result_invalid", "selection_idempotency_key_required"].includes(code);

// Applies both to direct requests and recovery. An expired token has no rights even before reclaim.
export const liveInboxLeaseSql = `status = 'processing' AND recovery_state = 'active'
  AND COALESCE(lease_expires_at, processing_started_at + INTERVAL '60 seconds') > clock_timestamp()`;
