/**
 * Conversational replies lose their meaning quickly. This limit is deliberately
 * fixed in code: it is a product safety rule, not a deployment tuning knob.
 */
export const CUSTOMER_REPLY_MAX_AGE_SECONDS = 5 * 60;
export const CUSTOMER_REPLY_EXPIRY_REASON = "customer_reply_expired";
