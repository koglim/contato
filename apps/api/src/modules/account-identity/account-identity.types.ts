import { z } from "zod";

export const accountIdentifierInputSchema = z.object({
  accountId: z.uuid(),
  kind: z.enum(["phone", "email"]),
  value: z.string().min(1).max(320),
}).strict();

export type AccountIdentifierInput = z.infer<typeof accountIdentifierInputSchema>;
export type AccountIdentifierKind = AccountIdentifierInput["kind"];

// Identifiers are deliberately independent from professional profile contacts.
// Email case-folding is the product's conservative ASCII policy: no plus-tag or
// dot rewriting, and no assumption that an identifier is verified.
export function normalizeAccountIdentifier(input: AccountIdentifierInput) {
  const parsed = accountIdentifierInputSchema.parse(input);
  const normalizedValue = parsed.value.trim().toLowerCase();
  if (parsed.kind === "phone") {
    if (!/^[+][1-9][0-9]{7,14}$/u.test(normalizedValue)) throw new Error("account_identifier_invalid_phone");
  } else {
    const [local, domain] = normalizedValue.split("@");
    if (!local || local.length > 64 || !domain || normalizedValue.includes("..")
      || !/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(normalizedValue)) {
      throw new Error("account_identifier_invalid_email");
    }
  }
  return { accountId: parsed.accountId, kind: parsed.kind, normalizedValue };
}
