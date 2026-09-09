/**
 * Retry policy for transport failures. Attempts are counted when a message is
 * claimed, so a newly inserted message starts at zero and the first delivery
 * claim becomes attempt one.
 */
export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_RETRY_BACKOFF_SECONDS = [30, 60, 120, 240, 480] as const;

export function outboxRetryBackoffSeconds(attemptCount: number) {
  const index = Math.max(0, Math.min(attemptCount, OUTBOX_RETRY_BACKOFF_SECONDS.length) - 1);
  return OUTBOX_RETRY_BACKOFF_SECONDS[index] ?? OUTBOX_RETRY_BACKOFF_SECONDS.at(-1)!;
}

export function outboxAttemptIsDeadLetter(attemptCount: number) {
  return attemptCount >= OUTBOX_MAX_ATTEMPTS;
}
