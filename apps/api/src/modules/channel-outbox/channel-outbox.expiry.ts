/**
 * Conversational replies lose their meaning quickly. This limit is deliberately
 * fixed in code: it is a product safety rule, not a deployment tuning knob.
 */
export const CUSTOMER_REPLY_MAX_AGE_SECONDS = 5 * 60;
export const CUSTOMER_REPLY_EXPIRY_REASON = "customer_reply_expired";

/**
 * Authentication codes must retain enough lifetime for provider delivery and
 * user entry. Keep this versioned product safety rule in code, not in ENV.
 */
export const AUTH_OUTBOUND_MIN_REMAINING_SECONDS = 30;
