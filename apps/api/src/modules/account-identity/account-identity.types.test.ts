import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAccountIdentifier } from "./account-identity.types.js";

const accountId = "00000000-0000-4000-8000-000000000001";

test("account phone identifiers require canonical E.164 without profile-derived verification", () => {
  assert.deepEqual(normalizeAccountIdentifier({ accountId, kind: "phone", value: " +5566999999999 " }),
    { accountId, kind: "phone", normalizedValue: "+5566999999999" });
  for (const value of ["66999999999", "+55 66 99999-9999", "+0123456789", "+123", "+1234567890123456"]) {
    assert.throws(() => normalizeAccountIdentifier({ accountId, kind: "phone", value }));
  }
});

test("email normalization case-folds ASCII without stripping plus tags or dots", () => {
  assert.deepEqual(normalizeAccountIdentifier({ accountId, kind: "email", value: "  Ana.Silva+Equipe@Exemplo.COM " }),
    { accountId, kind: "email", normalizedValue: "ana.silva+equipe@exemplo.com" });
  for (const value of ["ana..silva@example.com", "ana@example", "ana @example.com", "aná@example.com"]) {
    assert.throws(() => normalizeAccountIdentifier({ accountId, kind: "email", value }));
  }
  assert.throws(() => normalizeAccountIdentifier({ accountId, kind: "email", value: "ana@example.com", verified_at: new Date() } as never));
});
