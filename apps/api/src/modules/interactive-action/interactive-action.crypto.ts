import { randomBytes } from "node:crypto";
import { INTERACTIVE_ACTION_TOKEN_TTL_DAYS } from "@contatocerto/shared";

export { INTERACTIVE_ACTION_TOKEN_TTL_DAYS };

/**
 * Generates a cryptographically high-entropy opaque action token.
 * Contains no business semantics, roles, phone numbers, contact UUIDs, completion UUIDs, or sequential identifiers.
 * Starts with 'ia_' followed by 48 lowercase hex characters (192 bits of entropy).
 */
export function generateInteractiveActionToken(): string {
  return `ia_${randomBytes(24).toString("hex")}`;
}

export function isValidInteractiveActionToken(token: string): boolean {
  return typeof token === "string" && /^ia_[0-9a-f]{48}$/.test(token);
}
