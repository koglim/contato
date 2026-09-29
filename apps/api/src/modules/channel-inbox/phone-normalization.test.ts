import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeBrazilianMobilePhone,
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
