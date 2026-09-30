import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeBrazilianMobilePhone,
  getPhoneIdentityAliases,
  arePhoneIdentitiesEquivalent,
  channelInboundMessageRequestSchema,
  mediaAdmissionSchema,
  customerSearchMessageRequestSchema,
} from "@contatocerto/shared";

test("normalizeBrazilianMobilePhone: normalizes degraded 8-digit Brazilian mobile numbers to canonical 9-digit E.164", () => {
  // Scenario A: Degraded Brazilian mobile from Sinop/MT (DDD 66)
  assert.equal(normalizeBrazilianMobilePhone("+556699029086"), "+5566999029086");

  // Other historical mobile prefix digits (6, 7, 8, 9) across various Brazilian DDDs
  assert.equal(normalizeBrazilianMobilePhone("+551187654321"), "+5511987654321"); // DDD 11 prefix 8
  assert.equal(normalizeBrazilianMobilePhone("+552176543210"), "+5521976543210"); // DDD 21 prefix 7
  assert.equal(normalizeBrazilianMobilePhone("+553165432109"), "+5531965432109"); // DDD 31 prefix 6
  assert.equal(normalizeBrazilianMobilePhone("+5565988880002"), "+5565988880002"); // already 9 digits
});

test("normalizeBrazilianMobilePhone: preserves already-canonical Brazilian mobile numbers", () => {
  // Scenario B: Canonical 9-digit mobile
  assert.equal(normalizeBrazilianMobilePhone("+5566999029086"), "+5566999029086");
  assert.equal(normalizeBrazilianMobilePhone("+5511999999999"), "+5511999999999");
  assert.equal(normalizeBrazilianMobilePhone("+5565999990001"), "+5565999990001");
});

test("normalizeBrazilianMobilePhone: preserves Brazilian fixed-line numbers (prefixes 2, 3, 4, 5)", () => {
  // Scenario C: Brazilian fixed-line numbers
  assert.equal(normalizeBrazilianMobilePhone("+556635321234"), "+556635321234"); // DDD 66 prefix 3
  assert.equal(normalizeBrazilianMobilePhone("+551123456789"), "+551123456789"); // DDD 11 prefix 2
  assert.equal(normalizeBrazilianMobilePhone("+552140040000"), "+552140040000"); // DDD 21 prefix 4
  assert.equal(normalizeBrazilianMobilePhone("+553155551234"), "+553155551234"); // DDD 31 prefix 5
});

test("normalizeBrazilianMobilePhone: preserves non-Brazilian E.164 phone numbers", () => {
  // Scenario D: Non-Brazilian international numbers
  assert.equal(normalizeBrazilianMobilePhone("+14155552671"), "+14155552671"); // USA
  assert.equal(normalizeBrazilianMobilePhone("+447911123456"), "+447911123456"); // UK
  assert.equal(normalizeBrazilianMobilePhone("+351912345678"), "+351912345678"); // Portugal
  assert.equal(normalizeBrazilianMobilePhone("+4915123456789"), "+4915123456789"); // Germany
});

test("normalizeBrazilianMobilePhone: enforces Brazilian DDD validation strictly (67 valid DDDs)", () => {
  // Valid DDDs with 8-digit mobile are repaired to 9 digits
  assert.equal(normalizeBrazilianMobilePhone("+556699029086"), "+5566999029086"); // DDD 66 (Sinop/MT)
  assert.equal(normalizeBrazilianMobilePhone("+551198765432"), "+5511998765432"); // DDD 11 (SP)
  assert.equal(normalizeBrazilianMobilePhone("+552197654321"), "+5521997654321"); // DDD 21 (RJ)
  assert.equal(normalizeBrazilianMobilePhone("+553196543210"), "+5531996543210"); // DDD 31 (BH/MG)
  assert.equal(normalizeBrazilianMobilePhone("+554195432109"), "+5541995432109"); // DDD 41 (Curitiba/PR)
  assert.equal(normalizeBrazilianMobilePhone("+555194321098"), "+5551994321098"); // DDD 51 (Porto Alegre/RS)
  assert.equal(normalizeBrazilianMobilePhone("+557193210987"), "+5571993210987"); // DDD 71 (Salvador/BA)
  assert.equal(normalizeBrazilianMobilePhone("+558192109876"), "+5581992109876"); // DDD 81 (Recife/PE)
  assert.equal(normalizeBrazilianMobilePhone("+559191098765"), "+5591991098765"); // DDD 91 (Belém/PA)

  // Invalid DDDs (not in Anatel official set) must NOT be repaired
  assert.equal(normalizeBrazilianMobilePhone("+551099029086"), "+551099029086"); // DDD 10 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+552099029086"), "+552099029086"); // DDD 20 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+552399029086"), "+552399029086"); // DDD 23 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+552599029086"), "+552599029086"); // DDD 25 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+552699029086"), "+552699029086"); // DDD 26 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+552999029086"), "+552999029086"); // DDD 29 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+553099029086"), "+553099029086"); // DDD 30 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+553699029086"), "+553699029086"); // DDD 36 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+553999029086"), "+553999029086"); // DDD 39 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+554099029086"), "+554099029086"); // DDD 40 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+555099029086"), "+555099029086"); // DDD 50 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+555299029086"), "+555299029086"); // DDD 52 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+556099029086"), "+556099029086"); // DDD 60 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+557099029086"), "+557099029086"); // DDD 70 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+558099029086"), "+558099029086"); // DDD 80 (invalid)
  assert.equal(normalizeBrazilianMobilePhone("+559099029086"), "+559099029086"); // DDD 90 (invalid)
});

test("normalizeBrazilianMobilePhone: handles edge cases and invalid inputs safely", () => {
  assert.equal(normalizeBrazilianMobilePhone(""), "");
  assert.equal(normalizeBrazilianMobilePhone("invalid"), "invalid");
  assert.equal(normalizeBrazilianMobilePhone("+55"), "+55");
  assert.equal(normalizeBrazilianMobilePhone("+55119"), "+55119");
});

test("channelInboundMessageRequestSchema: automatically normalizes degraded Brazilian mobile phone numbers", () => {
  const parsed = channelInboundMessageRequestSchema.parse({
    provider: "evolution",
    provider_message_id: "msg-123",
    phone_e164: "+556699029086",
    raw_text: "Concluído CC-W98ZLLUP",
  });
  assert.equal(parsed.phone_e164, "+5566999029086");
});

test("mediaAdmissionSchema: automatically normalizes degraded Brazilian mobile phone numbers", () => {
  const parsed = mediaAdmissionSchema.parse({
    provider: "evolution",
    provider_message_id: "msg-123",
    phone_e164: "+556699029086",
    audio_base64: "dGVzdA==",
    mime_type: "audio/ogg",
    duration_seconds: 10,
  });
  assert.equal(parsed.phone_e164, "+5566999029086");
});

test("customerSearchMessageRequestSchema: automatically normalizes degraded Brazilian mobile phone numbers", () => {
  const parsed = customerSearchMessageRequestSchema.parse({
    phone_e164: "+556699029086",
    raw_text: "preciso de encanador",
  });
  assert.equal(parsed.phone_e164, "+5566999029086");
});

test("getPhoneIdentityAliases: returns [canonical, degraded] for Brazilian mobile numbers", () => {
  // From degraded input
  assert.deepEqual(getPhoneIdentityAliases("+559984119070"), ["+5599984119070", "+559984119070"]);
  assert.deepEqual(getPhoneIdentityAliases("+556699029086"), ["+5566999029086", "+556699029086"]);

  // From canonical input
  assert.deepEqual(getPhoneIdentityAliases("+5599984119070"), ["+5599984119070", "+559984119070"]);
  assert.deepEqual(getPhoneIdentityAliases("+5566999029086"), ["+5566999029086", "+556699029086"]);

  // Non-mobile, fixed-line, invalid DDD, international numbers return single original element
  assert.deepEqual(getPhoneIdentityAliases("+551123456789"), ["+551123456789"]);
  assert.deepEqual(getPhoneIdentityAliases("+551099029086"), ["+551099029086"]);
  assert.deepEqual(getPhoneIdentityAliases("+14155552671"), ["+14155552671"]);
  assert.deepEqual(getPhoneIdentityAliases("invalid"), ["invalid"]);
});

test("arePhoneIdentitiesEquivalent: evaluates equivalence across canonical and degraded Brazilian mobile numbers", () => {
  assert.equal(arePhoneIdentitiesEquivalent("+559984119070", "+5599984119070"), true);
  assert.equal(arePhoneIdentitiesEquivalent("+5599984119070", "+559984119070"), true);
  assert.equal(arePhoneIdentitiesEquivalent("+556699029086", "+5566999029086"), true);
  assert.equal(arePhoneIdentitiesEquivalent("+5566999029086", "+5566999029086"), true);
  assert.equal(arePhoneIdentitiesEquivalent("+556699029086", "+556699029086"), true);

  // Different numbers
  assert.equal(arePhoneIdentitiesEquivalent("+5599984119070", "+5566999029086"), false);
  assert.equal(arePhoneIdentitiesEquivalent("+551123456789", "+5511923456789"), false);
  assert.equal(arePhoneIdentitiesEquivalent("+14155552671", "+14155552671"), true);
  assert.equal(arePhoneIdentitiesEquivalent("+14155552671", "+14155552672"), false);
});
