import { z } from "zod";

/**
 * Official Brazilian Area Codes (DDD / Código Nacional - CN) approved by Anatel (67 codes).
 */
export const VALID_BRAZILIAN_DDDS: ReadonlySet<string> = new Set([
  // SP (Região 1)
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  // RJ / ES (Região 2)
  "21", "22", "24", "27", "28",
  // MG (Região 3)
  "31", "32", "33", "34", "35", "37", "38",
  // PR / SC (Região 4)
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  // RS (Região 5)
  "51", "53", "54", "55",
  // DF / GO / TO / MT / MS / AC / RO (Região 6)
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  // BA / SE (Região 7)
  "71", "73", "74", "75", "77", "79",
  // PE / AL / PB / RN / CE / PI (Região 8)
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  // PA / AM / RR / AP / MA (Região 9)
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

const BRAZILIAN_DEGRADED_MOBILE_REGEX = /^\+55([1-9]{2})([6-9]\d{7})$/;
const BRAZILIAN_CANONICAL_MOBILE_REGEX = /^\+55([1-9]{2})9([6-9]\d{7})$/;

/**
 * Normalizes Brazilian mobile phone numbers degraded by upstream WhatsApp / Evolution API
 * where the 9th digit ('9') was omitted in the subscriber number.
 *
 * Rules:
 * 1. Must start with Brazilian country code +55.
 * 2. Followed by a valid 2-digit Brazilian DDD in VALID_BRAZILIAN_DDDS.
 * 3. Followed by an 8-digit subscriber number starting with [6-9] (historical Brazilian mobile prefix range).
 *    (Fixed-line numbers starting with [2-5] are NOT altered).
 * 4. Inserts digit '9' immediately after the DDD: +55<DDD>9<subscriber>.
 * 5. Already-canonical 9-digit mobile numbers (+55<DDD>9XXXXXXXX), fixed-line (+55<DDD>[2-5]XXXXXXX),
 *    and non-Brazilian E.164 numbers remain completely unchanged.
 */
export function normalizeBrazilianMobilePhone(phone: string): string {
  if (typeof phone !== "string") return phone;
  const match = BRAZILIAN_DEGRADED_MOBILE_REGEX.exec(phone);
  if (match) {
    const [, ddd, subscriberNumber] = match;
    if (VALID_BRAZILIAN_DDDS.has(ddd)) {
      return `+55${ddd}9${subscriberNumber}`;
    }
  }
  return phone;
}

/**
 * Returns all equivalent phone identity representations for database queries.
 * For valid Brazilian mobile numbers, returns [canonical, degraded] (e.g. ['+5599984119070', '+559984119070']).
 * For non-mobile, invalid DDD, or international numbers, returns [phone].
 */
export function getPhoneIdentityAliases(phone: string): readonly string[] {
  if (typeof phone !== "string") return [phone];
  const canonical = normalizeBrazilianMobilePhone(phone);
  const match = BRAZILIAN_CANONICAL_MOBILE_REGEX.exec(canonical);
  if (match) {
    const [, ddd, subscriber8] = match;
    if (VALID_BRAZILIAN_DDDS.has(ddd)) {
      const degraded = `+55${ddd}${subscriber8}`;
      return [canonical, degraded];
    }
  }
  return [phone];
}

/**
 * Checks whether two phone numbers represent the same canonical identity.
 */
export function arePhoneIdentitiesEquivalent(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return normalizeBrazilianMobilePhone(a) === normalizeBrazilianMobilePhone(b);
}

export const phoneE164Schema = z.string().regex(
  /^\+[1-9]\d{1,14}$/u,
  "phone_e164 must be a canonical E.164 number",
);

