import { z } from "zod";

/**
 * Normalizes Brazilian mobile phone numbers degraded by upstream WhatsApp / Evolution API
 * where the 9th digit ('9') was omitted in the subscriber number.
 *
 * Rules:
 * 1. Must start with Brazilian country code +55.
 * 2. Followed by a 2-digit DDD [1-9][1-9].
 * 3. Followed by an 8-digit subscriber number starting with [6-9] (historical Brazilian mobile prefix range).
 *    (Fixed-line numbers starting with [2-5] are NOT altered).
 * 4. Inserts digit '9' immediately after the DDD: +55<DDD>9<subscriber>.
 * 5. Already-canonical 9-digit mobile numbers (+55<DDD>9XXXXXXXX), fixed-line (+55<DDD>[2-5]XXXXXXX),
 *    and non-Brazilian E.164 numbers remain completely unchanged.
 */
export function normalizeBrazilianMobilePhone(phone: string): string {
  if (typeof phone !== "string") return phone;
  const match = /^\+55([1-9]{2})([6-9]\d{7})$/.exec(phone);
  if (match) {
    return `+55${match[1]}9${match[2]}`;
  }
  return phone;
}

export const phoneE164Schema = z.string().regex(
  /^\+[1-9]\d{1,14}$/u,
  "phone_e164 must be a canonical E.164 number",
);

