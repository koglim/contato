import { z } from "zod";

export const inboxRecoveryResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["processed", "retry_scheduled", "quarantined", "processing"]),
}).strict();
export const inboxDispositionSchema = z.object({
  request_id: z.string().uuid(),
  operator_id: z.string().uuid(),
  action: z.enum(["retry", "close"]),
  reason: z.enum(["dependency_restored", "payload_reviewed", "context_reviewed", "unrecoverable", "duplicate_confirmed"]),
}).strict();
export const inboxDispositionResponseSchema = z.object({
  id: z.string().uuid(), action: z.enum(["retry", "close"]),
  recovery_state: z.enum(["active", "closed"]), duplicate: z.boolean(),
}).strict();
const count = z.number().int().nonnegative();
const age = z.number().nonnegative().nullable();
export const inboxQueueStatusSchema = z.object({
  pending: count, scheduled_retry: count, processing: count, expired_lease: count,
  quarantined: count, closed: count, permanent_failures: count, blocked_clients: count,
  recovered_completed: count, fencing_conflicts: count,
  oldest_seconds: z.object({ pending: age, scheduled_retry: age, processing: age, quarantined: age, closed: age }).strict(),
  attempts: z.object({ zero: count, one: count, two_to_four: count, five: count }).strict(),
}).strict();
export type InboxDisposition = z.infer<typeof inboxDispositionSchema>;
