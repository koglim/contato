import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import {
  normalizeGatewayEvent,
  extractLocation,
  transcriptionDecision,
  inboxDecision,
  mediaClaimDecision,
  extractPhoneFromJid,
  isOpaqueJid,
  normalizeBrazilianMobilePhone as gwNormalizeBrazilianMobilePhone,
  VALID_BRAZILIAN_DDDS as gwValidDDDs,
  normalizeEvolutionReceiptStatus,
  receiptAdmissionDecision,
} from "./gateway-contract.mjs";
import {
  normalizeBrazilianMobilePhone as sharedNormalizeBrazilianMobilePhone,
  VALID_BRAZILIAN_DDDS as sharedValidDDDs,
} from "../../packages/shared/dist/index.js";
import { transportDecision, claimDecision, confirmationDecision } from "./delivery-contract.mjs";

const config = { instance: "test-instance", provider: "evolution", origin: "https://evolution.example.invalid" };
const now = 1_800_000_000;
const event = (message = { conversation: "A pia \"vazou\"\n😊" }) => ({
  headers: { "content-type": "application/json; charset=utf-8" },
  jwtPayload: { app: "evolution", action: "webhook", iat: now - 1, exp: now + 599 },
  body: { event: "messages.upsert", instance: config.instance, server_url: config.origin,
    data: { key: { id: "SYNTHETIC001", fromMe: false, remoteJid: "5566991234567@s.whatsapp.net" }, message } },
});
const normalize = input => normalizeGatewayEvent(input, config, now);

test("gateway preserves conversation, escaping and historical instance:id idempotency namespace", () => {
  const input = event(); const result = normalize(input);
  assert.equal(result.action, "inbox");
  assert.equal(result.inbound.raw_text, input.body.data.message.conversation);
  assert.equal(result.inbound.provider_message_id, "test-instance:SYNTHETIC001");
  assert.equal(result.inbound.phone_e164, "+5566991234567");
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(input))), result);
  assert.doesNotMatch(JSON.stringify(result), /jwtPayload|headers|apikey|server_url/);
});

test("gateway provider_message_id validation matrix (Meta WAMID and Baileys formats)", () => {
  // 1. Baileys alphanumeric/hyphen/underscore IDs accepted
  const baileysId = "BAILEYS-MSG_1234567890ABCDEF";
  const bInput = event();
  bInput.body.data.key.id = baileysId;
  const bRes = normalize(bInput);
  assert.equal(bRes.action, "inbox");
  assert.equal(bRes.inbound.provider_message_id, `test-instance:${baileysId}`);

  // 2. Real-shaped wamid. IDs accepted (with dots, base64 chars, and equals sign padding)
  const metaWamid = "wamid.HBgMNTU5OTg0MTE5MDcwFQIAEhgUM0E3M0U3MTVGRDA3QUMzNTVEMDEA";
  const mWamidWithPadding = "wamid.HBgNNTU2Njk5MTIzNDU2NxUCMRIA==";
  for (const wamid of [metaWamid, mWamidWithPadding]) {
    const mInput = event();
    mInput.body.data.key.id = wamid;
    const mRes = normalize(mInput);
    assert.equal(mRes.action, "inbox");
    // 3. Exact Meta ID preserved in inbound.provider_message_id without alteration or truncation
    assert.equal(mRes.inbound.provider_message_id, `test-instance:${wamid}`);
  }

  // 4. Empty ID rejected (webhook_id_invalid)
  const emptyInput = event();
  emptyInput.body.data.key.id = "";
  assert.deepEqual(normalize(emptyInput), { action: "reject", reason: "webhook_id_invalid", http_status: 422 });

  // Non-string types rejected
  for (const nonString of [null, undefined, 12345, true, {}, []]) {
    const badTypeInput = event();
    badTypeInput.body.data.key.id = nonString;
    assert.deepEqual(normalize(badTypeInput), { action: "reject", reason: "webhook_id_invalid", http_status: 422 });
  }

  // 5. Whitespace ID rejected
  for (const ws of [" ", "   ", "wamid. 123", "wamid.123 ", " wamid.123", "\twamid.123"]) {
    const wsInput = event();
    wsInput.body.data.key.id = ws;
    assert.deepEqual(normalize(wsInput), { action: "reject", reason: "webhook_id_invalid", http_status: 422 });
  }

  // 6. Newline/control-char ID rejected
  for (const ctrl of ["wamid\n123", "wamid\r\n123", "wamid\x00123", "wamid\x1b123"]) {
    const ctrlInput = event();
    ctrlInput.body.data.key.id = ctrl;
    assert.deepEqual(normalize(ctrlInput), { action: "reject", reason: "webhook_id_invalid", http_status: 422 });
  }

  // 7. Over-255 composite ID rejected
  // config.instance is "test-instance" (13 chars). "test-instance:" is 14 chars.
  // 14 + 241 = 255 -> allowed
  // 14 + 242 = 256 -> rejected
  const allowedLenId = "a".repeat(255 - "test-instance:".length);
  const okCompositeInput = event();
  okCompositeInput.body.data.key.id = allowedLenId;
  assert.equal(normalize(okCompositeInput).action, "inbox");

  const overflowLenId = "a".repeat(256 - "test-instance:".length);
  const overflowInput = event();
  overflowInput.body.data.key.id = overflowLenId;
  assert.deepEqual(normalize(overflowInput), { action: "reject", reason: "webhook_id_invalid", http_status: 422 });

  // 8. Path-like payloads rejected (slashes / and \ are strictly forbidden)
  for (const pathPayload of ["../../etc/passwd", "/root", "foo/bar", "foo\\bar", "..\\..\\windows\\system32"]) {
    const pathInput = event();
    pathInput.body.data.key.id = pathPayload;
    assert.deepEqual(normalize(pathInput), { action: "reject", reason: "webhook_id_invalid", http_status: 422 });
  }

  // SQL/injection syntax rejected
  for (const injection of ["' OR '1'='1", "id; DROP TABLE contacts;--", "id\"--", "id`"]) {
    const injInput = event();
    injInput.body.data.key.id = injection;
    assert.deepEqual(normalize(injInput), { action: "reject", reason: "webhook_id_invalid", http_status: 422 });
  }

  // 9. Valid text message reaches action=inbox
  const validMsgInput = event({ conversation: "Olá, preciso de encanador" });
  validMsgInput.body.data.key.id = metaWamid;
  const validRes = normalize(validMsgInput);
  assert.equal(validRes.action, "inbox");
  assert.equal(validRes.inbound.raw_text, "Olá, preciso de encanador");
  assert.equal(validRes.inbound.provider_message_id, `test-instance:${metaWamid}`);
  assert.equal(validRes.inbound.phone_e164, "+5566991234567");

  // 10. Interactive extraction behavior remains unchanged with Meta WAMID
  const interactiveInput = event({
    buttonsResponseMessage: {
      selectedButtonId: "ia_test_action_1234567890",
      selectedDisplayText: "Confirmar Serviço",
    },
  });
  interactiveInput.body.data.key.id = metaWamid;
  const interRes = normalize(interactiveInput);
  assert.equal(interRes.action, "inbox");
  assert.equal(interRes.inbound.interactive_action_id, "ia_test_action_1234567890");
  assert.equal(interRes.inbound.raw_text, "Confirmar Serviço");
  assert.equal(interRes.inbound.provider_message_id, `test-instance:${metaWamid}`);
});



test("gateway normalizes Brazilian degraded 8-digit mobile numbers while preserving fixed-line and canonical phones", () => {
  // Scenario A: Degraded Brazilian mobile without 9th digit (e.g. Evolution 2.3.7 bug)
  const degradedMobile = event();
  degradedMobile.body.data.key.remoteJid = "556699029086@s.whatsapp.net";
  assert.equal(normalize(degradedMobile).inbound.phone_e164, "+5566999029086");

  // LID alternative with degraded Brazilian mobile
  const lidDegraded = event();
  lidDegraded.body.data.key.remoteJid = "123456789@lid";
  lidDegraded.body.data.key.remoteJidAlt = "556699029086@s.whatsapp.net";
  assert.equal(normalize(lidDegraded).inbound.phone_e164, "+5566999029086");

  // Scenario B: Already canonical 9-digit Brazilian mobile
  const canonicalMobile = event();
  canonicalMobile.body.data.key.remoteJid = "5566999029086@s.whatsapp.net";
  assert.equal(normalize(canonicalMobile).inbound.phone_e164, "+5566999029086");

  // Scenario C: Brazilian fixed-line (prefix 3) remains 8-digit
  const fixedLine = event();
  fixedLine.body.data.key.remoteJid = "556635321234@s.whatsapp.net";
  assert.equal(normalize(fixedLine).inbound.phone_e164, "+556635321234");

  // Scenario D: Non-Brazilian international number
  const intlPhone = event();
  intlPhone.body.data.key.remoteJid = "14155552671@s.whatsapp.net";
  assert.equal(normalize(intlPhone).inbound.phone_e164, "+14155552671");
});

test("gateway handles Baileys device-qualified PN JIDs and rejects malformed colon JIDs", () => {
  // Pure helper tests for extractPhoneFromJid
  assert.equal(extractPhoneFromJid("5566999029086@s.whatsapp.net"), "+5566999029086");
  assert.equal(extractPhoneFromJid("5566999029086:1@s.whatsapp.net"), "+5566999029086");
  assert.equal(extractPhoneFromJid("5566999029086:10@s.whatsapp.net"), "+5566999029086");
  assert.equal(extractPhoneFromJid("556699029086:2@s.whatsapp.net"), "+5566999029086");
  assert.equal(extractPhoneFromJid("5566999029086::1@s.whatsapp.net"), null);
  assert.equal(extractPhoneFromJid("5566999029086:@s.whatsapp.net"), null);
  assert.equal(extractPhoneFromJid("5566999029086:abc@s.whatsapp.net"), null);
  assert.equal(extractPhoneFromJid("foo:1@s.whatsapp.net"), null);
  assert.equal(extractPhoneFromJid("123456@lid"), null);

  // Pure helper tests for isOpaqueJid
  assert.equal(isOpaqueJid("123456789012345@lid"), true);
  assert.equal(isOpaqueJid("123456789012345:1@lid"), true);
  assert.equal(isOpaqueJid("123456@hosted"), true);
  assert.equal(isOpaqueJid("123456@hosted.lid"), true);
  assert.equal(isOpaqueJid("5566999029086@s.whatsapp.net"), false);
  assert.equal(isOpaqueJid(null), false);

  // Valid device-qualified PN JIDs via gateway event
  const device1 = event();
  device1.body.data.key.remoteJid = "5566999029086:1@s.whatsapp.net";
  assert.equal(normalize(device1).inbound.phone_e164, "+5566999029086");

  const device10 = event();
  device10.body.data.key.remoteJid = "5566999029086:10@s.whatsapp.net";
  assert.equal(normalize(device10).inbound.phone_e164, "+5566999029086");

  const deviceDegraded = event();
  deviceDegraded.body.data.key.remoteJid = "556699029086:2@s.whatsapp.net";
  assert.equal(normalize(deviceDegraded).inbound.phone_e164, "+5566999029086");

  // Malformed colon JIDs must be rejected
  for (const malformedJid of [
    "5566999029086::1@s.whatsapp.net",
    "5566999029086:@s.whatsapp.net",
    "5566999029086:abc@s.whatsapp.net",
    "foo:1@s.whatsapp.net",
    "5566999029086:1:2@s.whatsapp.net",
  ]) {
    const badInput = event();
    badInput.body.data.key.remoteJid = malformedJid;
    assert.equal(normalize(badInput).action, "reject", `Expected rejection for malformed JID: ${malformedJid}`);
  }
});

test("gateway LID and addressingMode matrix handles pn, lid, and absent modes correctly", () => {
  // 1. addressingMode = "lid" with opaque remoteJid and valid remoteJidAlt
  const lidMode = event();
  lidMode.body.data.key.remoteJid = "123456789012345@lid";
  lidMode.body.data.key.remoteJidAlt = "5566999029086@s.whatsapp.net";
  lidMode.body.data.key.addressingMode = "lid";
  assert.equal(normalize(lidMode).inbound.phone_e164, "+5566999029086");

  // 2. addressingMode = "pn" with PN remoteJid and opaque remoteJidAlt
  const pnMode = event();
  pnMode.body.data.key.remoteJid = "5566999029086@s.whatsapp.net";
  pnMode.body.data.key.remoteJidAlt = "123456789012345@lid";
  pnMode.body.data.key.addressingMode = "pn";
  assert.equal(normalize(pnMode).inbound.phone_e164, "+5566999029086");

  // 3. addressingMode absent
  const absentMode = event();
  absentMode.body.data.key.remoteJid = "5566999029086@s.whatsapp.net";
  absentMode.body.data.key.remoteJidAlt = "123456789012345@lid";
  delete absentMode.body.data.key.addressingMode;
  assert.equal(normalize(absentMode).inbound.phone_e164, "+5566999029086");

  // 4. Invalid addressingMode value
  const badMode = event();
  badMode.body.data.key.addressingMode = "invalid";
  assert.equal(normalize(badMode).action, "reject");

  // 5. Opaque LID without PN alternative
  const orphanLid = event();
  orphanLid.body.data.key.remoteJid = "123456789012345@lid";
  delete orphanLid.body.data.key.remoteJidAlt;
  assert.equal(normalize(orphanLid).action, "reject");

  // 6. Opaque LID with another opaque LID in alt
  const doubleLid = event();
  doubleLid.body.data.key.remoteJid = "123456789012345@lid";
  doubleLid.body.data.key.remoteJidAlt = "987654321012345@lid";
  assert.equal(normalize(doubleLid).action, "reject");
});

test("gateway canonicalizes phone candidates before conflict comparison", () => {
  // remoteJid has canonical 9-digit, remoteJidAlt has degraded 8-digit -> identical canonical phone -> ACCEPT
  const eqCandidates = event();
  eqCandidates.body.data.key.remoteJid = "5566999029086@s.whatsapp.net";
  eqCandidates.body.data.key.remoteJidAlt = "556699029086@s.whatsapp.net";
  const eqResult = normalize(eqCandidates);
  assert.equal(eqResult.action, "inbox");
  assert.equal(eqResult.inbound.phone_e164, "+5566999029086");

  // Device-qualified candidate vs plain canonical candidate -> identical canonical phone -> ACCEPT
  const deviceEq = event();
  deviceEq.body.data.key.remoteJid = "5566999029086:1@s.whatsapp.net";
  deviceEq.body.data.key.remoteJidAlt = "5566999029086@s.whatsapp.net";
  const deviceResult = normalize(deviceEq);
  assert.equal(deviceResult.action, "inbox");
  assert.equal(deviceResult.inbound.phone_e164, "+5566999029086");

  // Genuinely conflicting phones -> REJECT webhook_phone_conflict
  const conflict = event();
  conflict.body.data.key.remoteJid = "5566999029086@s.whatsapp.net";
  conflict.body.data.key.remoteJidAlt = "5511988887777@s.whatsapp.net";
  assert.equal(normalize(conflict).action, "reject");
  assert.equal(normalize(conflict).reason, "webhook_phone_conflict");
});

test("gateway enforces Brazilian DDD validation strictly (67 valid DDDs)", () => {
  // Valid DDD 66 with degraded mobile -> repaired to 9 digits
  const validDdd = event();
  validDdd.body.data.key.remoteJid = "556699029086@s.whatsapp.net";
  assert.equal(normalize(validDdd).inbound.phone_e164, "+5566999029086");

  // Invalid DDD 10 (does not exist in Brazil) -> NOT repaired
  const invalidDdd10 = event();
  invalidDdd10.body.data.key.remoteJid = "551099029086@s.whatsapp.net";
  assert.equal(normalize(invalidDdd10).inbound.phone_e164, "+551099029086");

  // Invalid DDD 20 -> NOT repaired
  const invalidDdd20 = event();
  invalidDdd20.body.data.key.remoteJid = "552099029086@s.whatsapp.net";
  assert.equal(normalize(invalidDdd20).inbound.phone_e164, "+552099029086");

  // Fixed line in valid DDD (prefix 3) -> NOT altered
  const fixedLine = event();
  fixedLine.body.data.key.remoteJid = "556635321234@s.whatsapp.net";
  assert.equal(normalize(fixedLine).inbound.phone_e164, "+556635321234");
});

test("gateway handles hosted and hosted.lid identity domains safely", () => {
  // hosted.lid with valid PN alt -> ACCEPT PN
  const hostedLid = event();
  hostedLid.body.data.key.remoteJid = "1234567890@hosted.lid";
  hostedLid.body.data.key.remoteJidAlt = "5566999029086@s.whatsapp.net";
  assert.equal(normalize(hostedLid).inbound.phone_e164, "+5566999029086");

  // hosted with valid PN alt -> ACCEPT PN
  const hosted = event();
  hosted.body.data.key.remoteJid = "1234567890@hosted";
  hosted.body.data.key.remoteJidAlt = "5566999029086@s.whatsapp.net";
  assert.equal(normalize(hosted).inbound.phone_e164, "+5566999029086");

  // hosted.lid without PN alt -> REJECT
  const orphanHostedLid = event();
  orphanHostedLid.body.data.key.remoteJid = "1234567890@hosted.lid";
  delete orphanHostedLid.body.data.key.remoteJidAlt;
  assert.equal(normalize(orphanHostedLid).action, "reject");

  // hosted without PN alt -> REJECT
  const orphanHosted = event();
  orphanHosted.body.data.key.remoteJid = "1234567890@hosted";
  delete orphanHosted.body.data.key.remoteJidAlt;
  assert.equal(normalize(orphanHosted).action, "reject");
});

test("parity test: shared and gateway normalizeBrazilianMobilePhone produce identical results across full matrix", () => {
  // 1. DDD set parity
  assert.equal(gwValidDDDs.size, 67);
  assert.equal(sharedValidDDDs.size, 67);
  assert.deepEqual(Array.from(gwValidDDDs).sort(), Array.from(sharedValidDDDs).sort());

  // 2. Full DDD matrix test: degraded mobile (+55<DDD>9XXXXXXX vs +55<DDD>8XXXXXXX)
  for (const ddd of gwValidDDDs) {
    for (const prefix of ["6", "7", "8", "9"]) {
      const degraded = `+55${ddd}${prefix}1234567`;
      const expected = `+55${ddd}9${prefix}1234567`;
      assert.equal(gwNormalizeBrazilianMobilePhone(degraded), expected, `Gateway normalization failed for DDD ${ddd} prefix ${prefix}`);
      assert.equal(sharedNormalizeBrazilianMobilePhone(degraded), expected, `Shared normalization failed for DDD ${ddd} prefix ${prefix}`);
      assert.equal(gwNormalizeBrazilianMobilePhone(degraded), sharedNormalizeBrazilianMobilePhone(degraded));
    }
    // Fixed lines (prefixes 2, 3, 4, 5)
    for (const prefix of ["2", "3", "4", "5"]) {
      const fixed = `+55${ddd}${prefix}1234567`;
      assert.equal(gwNormalizeBrazilianMobilePhone(fixed), fixed);
      assert.equal(sharedNormalizeBrazilianMobilePhone(fixed), fixed);
      assert.equal(gwNormalizeBrazilianMobilePhone(fixed), sharedNormalizeBrazilianMobilePhone(fixed));
    }
    // Already canonical 9 digits
    const canonical = `+55${ddd}998765432`;
    assert.equal(gwNormalizeBrazilianMobilePhone(canonical), canonical);
    assert.equal(sharedNormalizeBrazilianMobilePhone(canonical), canonical);
    assert.equal(gwNormalizeBrazilianMobilePhone(canonical), sharedNormalizeBrazilianMobilePhone(canonical));
  }

  // 3. Invalid DDDs
  const invalidDdds = ["10", "20", "23", "25", "26", "29", "30", "36", "39", "40", "50", "52", "56", "60", "70", "72", "76", "78", "80", "90"];
  for (const invDdd of invalidDdds) {
    const invPhone = `+55${invDdd}98765432`;
    assert.equal(gwNormalizeBrazilianMobilePhone(invPhone), invPhone);
    assert.equal(sharedNormalizeBrazilianMobilePhone(invPhone), invPhone);
    assert.equal(gwNormalizeBrazilianMobilePhone(invPhone), sharedNormalizeBrazilianMobilePhone(invPhone));
  }

  // 4. International numbers
  const intlPhones = ["+14155552671", "+447911123456", "+351912345678", "+4915123456789"];
  for (const intl of intlPhones) {
    assert.equal(gwNormalizeBrazilianMobilePhone(intl), intl);
    assert.equal(sharedNormalizeBrazilianMobilePhone(intl), intl);
    assert.equal(gwNormalizeBrazilianMobilePhone(intl), sharedNormalizeBrazilianMobilePhone(intl));
  }
});
test("extended text uses the reply, never the quoted message or a caption", () => {
  assert.equal(normalize(event({ extendedTextMessage: { text: "quero a Ana", contextInfo: { quotedMessage: { conversation: "cancelar" } } } })).inbound.raw_text, "quero a Ana");
  assert.equal(normalize(event({ imageMessage: { caption: "cancelar" } })).action, "ignore");
});
for (const [name, mutate, action] of [
  ["own", e => { e.body.data.key.fromMe = true; }, "ignore"],
  ["group even with phone alt", e => { e.body.data.key.remoteJid = "123@g.us"; e.body.data.key.remoteJidAlt = "5566991234567@s.whatsapp.net"; }, "ignore"],
  ["wrong instance", e => { e.body.instance = "another"; }, "reject"],
  ["other event", e => { e.body.event = "messages.update"; }, "ignore"],
  ["wrong origin", e => { e.body.server_url = "https://attacker.invalid"; }, "reject"],
  ["invalid phone", e => { e.body.data.key.remoteJid = "0@s.whatsapp.net"; }, "reject"],
  ["missing fromMe", e => { delete e.body.data.key.fromMe; }, "reject"],
  ["no JWT proof", e => { delete e.jwtPayload; }, "reject"],
  ["expired JWT", e => { e.jwtPayload.exp = now; }, "reject"],
  ["wrong JWT claims", e => { e.jwtPayload.action = "other"; }, "reject"],
  ["wrong content type", e => { e.headers["content-type"] = "text/plain"; }, "reject"],
  ["empty text", e => { e.body.data.message.conversation = "  "; }, "reject"],
  ["API text bound", e => { e.body.data.message.conversation = "x".repeat(501); }, "reject"],
  ["oversized envelope", e => { e.body.padding = "x".repeat(5 * 1024 * 1024); }, "reject"],
]) test(`gateway rejects or ignores ${name} without an Inbox call`, () => {
  const input = event(); mutate(input); const result = normalize(input);
  assert.equal(result.action, action); assert.equal(result.inbound, undefined);
});
test("LID uses authenticated remoteJidAlt only; conflicting phones are rejected", () => {
  const input = event(); input.body.data.key.remoteJid = "123@lid";
  assert.equal(normalize(input).action, "reject");
  input.body.data.key.remoteJidAlt = "5566991234567@s.whatsapp.net";
  assert.equal(normalize(input).inbound.phone_e164, "+5566991234567");
  input.body.data.key.remoteJid = "5566997654321@s.whatsapp.net";
  assert.equal(normalize(input).action, "reject");
});
const audio = seconds => event({ audioMessage: { seconds, mimetype: "audio/ogg; codecs=opus" }, base64: Buffer.from("OggS synthetic audio").toString("base64") });
test("gateway persists valid, long and invalid audio under the original event identity without invented text",()=>{
  for(const duration of [120,121,0,-1,undefined,"20"]) {
    const result=normalize(audio(duration));
    assert.equal(result.action,"audio");
    assert.equal(result.media.provider_message_id,"test-instance:SYNTHETIC001");
    assert.equal(result.text,undefined);
    assert.equal(result.inbound.raw_text,undefined);
  }
  const bad=audio(20);bad.body.data.message.base64="@@@=";
  assert.equal(normalize(bad).media.audio_base64,"@@@=");
});
test("consumer persists one validated primary/fallback result or controlled failure; it never creates an Inbox",()=>{
  const context={id:randomUUID(),processing_token:randomUUID(),media_hash:"a".repeat(64)};
  for(const response of [{},{error:"timeout"},{statusCode:503},{statusCode:200,body:{text:""}},{statusCode:200,body:{text:"x".repeat(501)}}]) {
    assert.equal(transcriptionDecision(response,context,false).action,"fallback");
    const failed=transcriptionDecision(response,context,true);
    assert.deepEqual(failed.payload.result,{status:"failed",error_code:"transcription_unavailable"});
    assert.equal(failed.inbound,undefined);assert.equal(failed.text,undefined);
  }
  for(const fallback of [false,true]) {
    const r=transcriptionDecision({statusCode:200,body:{text:"  ajuda  "}},context,fallback);
    assert.equal(r.payload.result.text,"ajuda");assert.equal(r.payload.result.provider,fallback?"openai":"groq");
    assert.equal(r.payload.processing_token,context.processing_token);
  }
  assert.deepEqual(mediaClaimDecision({statusCode:204,body:""}),[]);
  assert.throws(()=>mediaClaimDecision({statusCode:200,body:{}}),/media_claim_invalid/);
});

test("Inbox outcome exposes only an Outbox ID to claim, never sends reply_text directly", () => {
  const id = randomUUID();
  assert.deepEqual(inboxDecision({ statusCode: 200, body: { outbound: { id, status: "pending" }, reply_text: "private" } }), { action: "claim", id, http_status: 200 });
  assert.equal(inboxDecision({ statusCode: 200, body: { duplicate: true, outbound: { id, status: "sent" } } }).action, "claim");
  assert.equal(inboxDecision({ statusCode: 204 }).action, "stop");
  assert.equal(inboxDecision({ statusCode: 200, body: {} }).http_status, 502);
  for (const statusCode of [401,403,400,422,429,500,503]) assert.equal(inboxDecision({statusCode}).action,"stop");
  assert.equal(inboxDecision({statusCode:409,body:{error:"channel_message_payload_conflict"}}).http_status, 409);
  assert.equal(inboxDecision({statusCode:409,body:{error:"channel_message_processing"}}).http_status, 200);
});
test("Evolution 2.3.7 generic client errors are uncertain, not proof of safe rejection", () => {
  const message = { processing_token: randomUUID(), recipient_phone_e164: "+5566991234567" };
  for (const statusCode of [400,401,403,404,422,429,500,502]) assert.equal(transportDecision({statusCode,body:{}},message).action,"hold");
  assert.equal(transportDecision({statusCode:401,body:{status:401,error:"Unauthorized",response:{message:"Unauthorized"}}},message).action,"failed");
});
test("gateway export is authenticated, inactive, no duplicate delivery branch or credential values", () => {
  const workflow = JSON.parse(readFileSync(new URL("gateway.json",import.meta.url),"utf8"));
  assert.equal(workflow.active,false);
  assert.equal(workflow.settings.saveDataErrorExecution,"none");
  assert.equal(workflow.settings.saveExecutionProgress,false);
  const webhook = workflow.nodes.find(n=>n.type.endsWith(".webhook"));
  assert.equal(webhook.parameters.authentication,"jwtAuth");
  assert.equal(webhook.parameters.httpMethod,"POST");
  assert.equal(webhook.parameters.responseMode,"responseNode");
  assert.ok(workflow.nodes.every(n=>!n.name.match(/Mark Sent|Mark Failed|Hold/)));
  const shared=workflow.nodes.find(n=>n.type.endsWith(".executeWorkflow"));
  assert.equal(shared.parameters.options.waitForSubWorkflow,true);
  assert.match(shared.parameters.workflowId.value,/CONTATOCERTO_DELIVERY_WORKFLOW_ID/);
  const claim=workflow.nodes.find(n=>n.name==="Claim outbound");
  assert.equal(claim.parameters.options.response.response.fullResponse,true);
  assert.equal(claim.parameters.options.response.response.neverError,true);
  for(const n of workflow.nodes){
    for(const credential of Object.values(n.credentials??{})) assert.deepEqual(Object.keys(credential),["name"]);
    if(n.type.endsWith(".httpRequest")) assert.equal(n.retryOnFail,false);
    if(n.type.endsWith(".code")) assert.doesNotThrow(()=>new Function(n.parameters.jsCode));
  }
  const gate=workflow.nodes.find(n=>n.name==="Validate event").parameters.jsCode;
  const result=runInNewContext(`(() => { ${gate} })()`,{$json:event(),$env:{EVOLUTION_INSTANCE:config.instance,EVOLUTION_PROVIDER:config.provider,EVOLUTION_WEBHOOK_ORIGIN:config.origin},Buffer,Date:class extends Date {static now(){return now*1000;}}});
  assert.equal(result.json.action,"inbox");
});

// Small graph simulator: executes the generated Code/If nodes and item links.
// HTTP, JWT verification, ConvertToFile, Respond and ExecuteWorkflow are mocked.
// This does not claim to be the n8n engine or cryptographic authentication QA.
function simulateGateway(input, responses = {}, filename="gateway.json", start="Evolution webhook") {
  const workflow=JSON.parse(readFileSync(new URL(filename,import.meta.url),"utf8"));
  const outputs=new Map(); const calls=[]; const acknowledgements=[];
  let name=start, item={json:input};
  const env={EVOLUTION_INSTANCE:config.instance,EVOLUTION_PROVIDER:config.provider,EVOLUTION_WEBHOOK_ORIGIN:config.origin};
  const evaluate=expression=>runInNewContext(expression.slice(3,-2),{$json:item.json});
  for(let steps=0;name && steps<60;steps++) {
    const node=workflow.nodes.find(n=>n.name===name); assert.ok(node,name);
    let port=0;
    if(node.type.endsWith(".code")) item=runInNewContext(`(() => { ${node.parameters.jsCode} })()`,{
      $json:item.json,$input:{all:()=>[item]},$env:env,$:n=>({item:outputs.get(n)}),Buffer,Date:class extends Date {static now(){return now*1000;}},
    });
    else if(node.type.endsWith(".if")) port=evaluate(node.parameters.conditions.conditions[0].leftValue)?0:1;
    else if(node.type.endsWith(".httpRequest")) {
      calls.push({name,json:item.json,binary:item.binary});
      item={json:responses[name]??{statusCode:503,body:""}};
    } else if(node.type.endsWith(".convertToFile")) item={json:{},binary:{data:{data:item.json.audio_base64}}};
    else if(node.type.endsWith(".respondToWebhook")) acknowledgements.push(typeof node.parameters.options.responseCode==="number"?node.parameters.options.responseCode:evaluate(node.parameters.options.responseCode));
    else if(node.type.endsWith(".executeWorkflow")) { calls.push({name,json:item.json}); item={json:claimDecision(item.json,config.provider)}; }
    if(Array.isArray(item)){if(!item.length){name=undefined;break;}assert.equal(item.length,1);item=item[0];}
    outputs.set(name,item);
    const edges=workflow.connections[name]?.main?.[port]??[];
    assert.ok(edges.length<=1,"no fanout may duplicate audio/business messages");
    name=edges[0]?.node;
  }
  assert.equal(name,undefined,"bounded acyclic gateway");
  return {calls,acknowledgements,item};
}
const inboxReply=()=>({statusCode:200,body:JSON.stringify({outbound:{id:randomUUID(),status:"pending"}})});
test("generated text path calls Inbox once then shared delivery with the entire HTTP claim",()=>{
  const result=simulateGateway(event(),{"Channel Inbox":inboxReply(),"Claim outbound":{statusCode:204,body:""}});
  assert.deepEqual(result.calls.map(c=>c.name),["Channel Inbox","Claim outbound","Deliver shared"]);
  assert.equal(result.calls[2].json.statusCode,204);
  assert.equal(result.item.json.reason,"empty"); assert.deepEqual(result.acknowledgements,[200]);
});
test("generated audio path acknowledges only durable API admission, never sends or transcribes",()=>{
  for(const duration of [20,121]) {
    const result=simulateGateway(audio(duration),{"Persist media":{statusCode:200,body:{id:randomUUID(),status:"pending",duplicate:false}}});
    assert.deepEqual(result.calls.map(c=>c.name),["Persist media"]);
    assert.deepEqual(result.acknowledgements,[200]);
  }
  for(const response of [{error:"timeout"},{statusCode:503},{statusCode:200,body:{}}]) {
    const result=simulateGateway(audio(20),{"Persist media":response});
    assert.deepEqual(result.acknowledgements,[503]);
    assert.deepEqual(result.calls.map(c=>c.name),["Persist media"]);
  }
});

for(const [label,primary,fallback,result] of [
  ['primary',{statusCode:200,body:{text:'ajuda'}},null,'completed'],
  ['fallback timeout',{error:'timeout'},{statusCode:200,body:{text:'ajuda'}},'completed'],
  ['fallback empty',{statusCode:200,body:{text:''}},{statusCode:200,body:{text:'ajuda'}},'completed'],
  ['both failed',{statusCode:503},{statusCode:500},'failed'],
]) test(`generated durable media consumer ${label} persists exactly once and never sends`,()=>{
  const claim={id:randomUUID(),processing_token:randomUUID(),media_hash:'a'.repeat(64),mime_type:'audio/ogg',audio_base64:Buffer.from('OggS fixture').toString('base64')};
  const run=simulateGateway({}, {'Claim media':{statusCode:200,body:claim},'Transcribe Groq':primary,'Transcribe OpenAI fallback':fallback,
    'Persist transcript':{statusCode:200,body:{id:claim.id,status:result,duplicate:false}}},'media-consumer.json','Schedule');
  assert.equal(run.calls.filter(c=>c.name==='Persist transcript').length,1);
  const submitted=run.calls.find(c=>c.name==='Persist transcript').json.payload;
  assert.equal(submitted.processing_token,claim.processing_token);assert.equal(submitted.media_hash,claim.media_hash);
  assert.equal(submitted.result.status,result==='completed'?'transcribed':'failed');
  if(fallback)assert.ok(run.calls.find(c=>c.name==='Transcribe OpenAI fallback').binary.data);
  assert.ok(!run.calls.some(c=>/Evolution|Inbox|Deliver/.test(c.name)));
  assert.doesNotMatch(JSON.stringify(run.item),/audio_base64|phone|token|ajuda/);
});
test('generated media consumer stops at empty claim without external work',()=>{
  const run=simulateGateway({}, {'Claim media':{statusCode:204,body:''}},'media-consumer.json','Schedule');
  assert.deepEqual(run.calls.map(c=>c.name),['Claim media']);
});

test("generated gateway never claims on Inbox errors, conflict or missing Outbox",()=>{
  for(const response of [{error:"timeout"},{statusCode:500},{statusCode:200,body:"{}"},{statusCode:409,body:'{"error":"channel_message_payload_conflict"}'}]) {
    const result=simulateGateway(event(),{"Channel Inbox":response});
    assert.deepEqual(result.calls.map(c=>c.name),["Channel Inbox"]);
    assert.ok(result.acknowledgements[0]>=400);
  }
});
test("text HTTP envelopes handle empty 204, malformed JSON and all uncertain transport failures",()=>{
  assert.equal(claimDecision({statusCode:204,body:""},"evolution").reason,"empty");
  assert.throws(()=>claimDecision({statusCode:200,body:"not json"},"evolution"),/claim_invalid/);
  const message={id:randomUUID(),processing_token:randomUUID(),recipient_phone_e164:"+5566991234567"};
  for(const response of [{statusCode:200,body:"not json"},{error:"ECONNRESET"},{error:"ETIMEDOUT"},{statusCode:502,body:"Bad gateway"}]) {
    assert.equal(transportDecision(response,message).action,"hold");
  }
  const outcome={action:"sent",payload:{processing_token:message.processing_token,provider_message_id:"accepted-id"}};
  assert.equal(confirmationDecision({statusCode:503},message,outcome).provider_message_id,"accepted-id");
});
test("gateway extracts authoritative interactive_action_id from supported provider button reply formats", () => {
  // 1. Evolution buttonsResponseMessage
  const buttonEvent = event({
    buttonsResponseMessage: {
      selectedButtonId: "ia_111111111111111111111111111111111111111111111111",
      selectedDisplayText: "Concluído",
    },
  });
  const res1 = normalize(buttonEvent);
  assert.equal(res1.action, "inbox");
  assert.equal(res1.inbound.interactive_action_id, "ia_111111111111111111111111111111111111111111111111");
  assert.equal(res1.inbound.raw_text, "Concluído");
  assert.equal(res1.inbound.provider_message_id, "test-instance:SYNTHETIC001");
  assert.equal(res1.inbound.phone_e164, "+5566991234567");

  // 2. Evolution templateButtonReplyMessage
  const templateEvent = event({
    templateButtonReplyMessage: {
      selectedId: "ia_222222222222222222222222222222222222222222222222",
      selectedDisplayText: "Não consigo atender",
    },
  });
  const res2 = normalize(templateEvent);
  assert.equal(res2.action, "inbox");
  assert.equal(res2.inbound.interactive_action_id, "ia_222222222222222222222222222222222222222222222222");
  assert.equal(res2.inbound.raw_text, "Não consigo atender");

  // 3. Evolution listResponseMessage
  const listEvent = event({
    listResponseMessage: {
      singleSelectReply: { selectedRowId: "ia_333333333333333333333333333333333333333333333333" },
      title: "Opção Confirmar",
    },
  });
  const res3 = normalize(listEvent);
  assert.equal(res3.action, "inbox");
  assert.equal(res3.inbound.interactive_action_id, "ia_333333333333333333333333333333333333333333333333");
  assert.equal(res3.inbound.raw_text, "Opção Confirmar");

  // 4. Meta Cloud interactive.button_reply
  const metaEvent = event({
    interactive: {
      type: "button_reply",
      button_reply: {
        id: "ia_444444444444444444444444444444444444444444444444",
        title: "Confirmar",
      },
    },
  });
  const res4 = normalize(metaEvent);
  assert.equal(res4.action, "inbox");
  assert.equal(res4.inbound.interactive_action_id, "ia_444444444444444444444444444444444444444444444444");
  assert.equal(res4.inbound.raw_text, "Confirmar");
});

test("structured interactive reply without authoritative action ID is safely ignored as unsupported_interactive_reply", () => {
  // Scenario 1: buttonsResponseMessage with title 'Confirmar' but empty/missing selectedButtonId
  const labelOnlyButton = event({
    buttonsResponseMessage: {
      selectedButtonId: "",
      selectedDisplayText: "Confirmar",
    },
  });
  const res1 = normalize(labelOnlyButton);
  assert.equal(res1.action, "ignore");
  assert.equal(res1.reason, "unsupported_interactive_reply");
  assert.equal(res1.http_status, 200);
  assert.equal(res1.inbound, undefined, "Must NOT route to Inbox");

  // Scenario 2: templateButtonReplyMessage with label 'Concluído' but null selectedId
  const labelOnlyTemplate = event({
    templateButtonReplyMessage: {
      selectedId: null,
      selectedDisplayText: "Concluído",
    },
  });
  const res2 = normalize(labelOnlyTemplate);
  assert.equal(res2.action, "ignore");
  assert.equal(res2.reason, "unsupported_interactive_reply");
  assert.equal(res2.http_status, 200);

  // Scenario 3: Meta interactive button_reply with title 'Não consigo atender' but missing id
  const labelOnlyMeta = event({
    interactive: {
      type: "button_reply",
      button_reply: {
        title: "Não consigo atender",
      },
    },
  });
  const res3 = normalize(labelOnlyMeta);
  assert.equal(res3.action, "ignore");
  assert.equal(res3.reason, "unsupported_interactive_reply");
  assert.equal(res3.http_status, 200);
});

test("capability boundary: Evolution 2.3.7 flattened conversation (message.conversation = 'Confirmar') remains ordinary text without interactive ID", () => {
  // When Evolution 2.3.7 flattens a button click into an ordinary message.conversation:
  // message = { conversation: "Confirmar" }
  // There is no structured interactive marker and no action ID.
  // The gateway cannot distinguish whether the user clicked a button or manually typed text.
  // It routes to Inbox as regular text without interactive_action_id.
  const flattenedEvent = event({
    conversation: "Confirmar",
  });
  const res = normalize(flattenedEvent);
  assert.equal(res.action, "inbox");
  assert.equal(res.inbound.raw_text, "Confirmar");
  assert.equal(res.inbound.interactive_action_id, undefined, "Must NOT create interactive_action_id for unstructured text");
});

test("gateway rejects malformed interactive action IDs safely", () => {
  // Whitespace in action ID
  const wsEvent = event({
    buttonsResponseMessage: {
      selectedButtonId: "ia_ invalid id",
      selectedDisplayText: "Concluído",
    },
  });
  assert.deepEqual(normalize(wsEvent), {
    action: "reject",
    reason: "webhook_interactive_id_invalid",
    http_status: 422,
  });

  // Action ID length > 120
  const longEvent = event({
    buttonsResponseMessage: {
      selectedButtonId: "a".repeat(121),
      selectedDisplayText: "Concluído",
    },
  });
  assert.deepEqual(normalize(longEvent), {
    action: "reject",
    reason: "webhook_interactive_id_invalid",
    http_status: 422,
  });
});

test("raw Meta Cloud API button_reply capability fixture demonstrates preservation of opaque action tokens", () => {
  const rawMetaCloudEvent = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "109876543210987",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5566999029086",
                phone_number_id: "987654321098765",
              },
              contacts: [
                {
                  profile: { name: "Lucas Profissional" },
                  wa_id: "5566991234567",
                },
              ],
              messages: [
                {
                  from: "5566991234567",
                  id: "wamid.HBgNNTU2Njk5MTIzNDU2NxUCMRIA",
                  timestamp: "1791056800",
                  type: "interactive",
                  interactive: {
                    type: "button_reply",
                    button_reply: {
                      id: "ia_a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f7081",
                      title: "Concluído",
                    },
                  },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };

  // Inspect the raw Meta payload structure:
  const rawMsg = rawMetaCloudEvent.entry[0].changes[0].value.messages[0];
  assert.equal(rawMsg.type, "interactive");
  assert.equal(rawMsg.interactive.type, "button_reply");
  assert.equal(rawMsg.interactive.button_reply.id, "ia_a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f7081");
  assert.equal(rawMsg.interactive.button_reply.title, "Concluído");

  // When adapted into an Evolution/gateway normalized message structure:
  const adaptedMsg = {
    interactive: rawMsg.interactive,
  };
  const gatewayEvt = event(adaptedMsg);
  const normalized = normalize(gatewayEvt);
  assert.equal(normalized.action, "inbox");
  assert.equal(normalized.inbound.interactive_action_id, "ia_a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f7081");
  assert.equal(normalized.inbound.raw_text, "Concluído");
});

test("gateway extracts authoritative interactive_action_id from template quick reply message.button", () => {
  // Evolution normalizes Meta Cloud API template quick-reply callback into message.button { payload, text }
  const buttonEvent = event({
    button: {
      payload: "ia_333333333333333333333333333333333333333333333333",
      text: "Concluído",
    },
  });
  const normalized = normalize(buttonEvent);
  assert.equal(normalized.action, "inbox");
  assert.equal(normalized.inbound.interactive_action_id, "ia_333333333333333333333333333333333333333333333333");
  assert.equal(normalized.inbound.raw_text, "Concluído");

  // If button payload is missing, it must NEVER drop through to text or invent actionId
  const missingPayloadEvent = event({
    button: {
      text: "Concluído",
    },
  });
  const ignored = normalize(missingPayloadEvent);
  assert.equal(ignored.action, "ignore");
  assert.equal(ignored.reason, "unsupported_interactive_reply");
});

test("exports only use node versions present in the pinned n8n source; every reference resolves",()=>{
  const allowed={webhook:[1,1.1,2,2.1],code:[1,2],if:[2,2.1,2.2,2.3],httpRequest:[3,4,4.1,4.2,4.3],
    executeWorkflow:[1,1.1,1.2,1.3],executeWorkflowTrigger:[1,1.1],scheduleTrigger:[1,1.1,1.2,1.3],convertToFile:[1,1.1],respondToWebhook:[1,1.1,1.2,1.3,1.4,1.5]};
  for(const file of ["gateway.json","shared-delivery.json","outbox-dispatcher.json","inbox-recovery.json","media-consumer.json"]) {
    const workflow=JSON.parse(readFileSync(new URL(file,import.meta.url),"utf8"));
    const names=new Set(workflow.nodes.map(n=>n.name));
    assert.equal(names.size,workflow.nodes.length);
    assert.equal(workflow.settings.saveDataErrorExecution,"none");
    for(const node of workflow.nodes) {
      assert.ok(node.type.startsWith("n8n-nodes-base."));
      assert.ok(allowed[node.type.split(".")[1]]?.includes(node.typeVersion),node.name);
      if(node.type.endsWith(".httpRequest")) {
        assert.equal(node.onError,"continueRegularOutput");
        assert.equal(node.parameters.options.response.response.fullResponse,true);
        assert.equal(node.parameters.options.response.response.responseFormat,"text");
        assert.equal(node.parameters.options.response.response.outputPropertyName,"body");
        assert.equal(node.parameters.options.redirect.redirect.followRedirects,false);
      }
    }
    for(const [from,connection] of Object.entries(workflow.connections)) {
      assert.ok(names.has(from)); for(const edge of connection.main.flat()) assert.ok(names.has(edge.node));
    }
  }
});

test("gateway export preserves stable canonical webhook identity and webhookId", () => {
  const workflow = JSON.parse(readFileSync(new URL("gateway.json", import.meta.url), "utf8"));
  const webhookNodes = workflow.nodes.filter(n => n.type === "n8n-nodes-base.webhook");
  assert.equal(webhookNodes.length, 1, "gateway must have exactly one webhook node");

  const [wh] = webhookNodes;
  assert.equal(wh.id, "evolution-webhook");
  assert.equal(wh.name, "Evolution webhook");
  assert.equal(wh.type, "n8n-nodes-base.webhook");
  assert.equal(wh.typeVersion, 2.1);
  assert.equal(wh.webhookId, "3df44b42-e4d3-4080-a1fb-89acaea99659");
  assert.equal(wh.parameters?.path, "contatocerto-evolution-inbound");
  assert.equal(wh.parameters?.httpMethod, "POST");
  assert.equal(wh.parameters?.authentication, "jwtAuth");
  assert.equal(wh.parameters?.responseMode, "responseNode");
  assert.equal(wh.credentials?.jwtAuth?.name, "ContatoCerto Evolution Webhook JWT");
});

test("gateway extracts native Evolution locationMessage and defensive location envelopes", () => {
  // 1. Primary Evolution locationMessage
  const locInput = event({
    locationMessage: {
      degreesLatitude: -11.8548,
      degreesLongitude: -55.5089,
      name: "Sinop Centro",
      address: "Av. das Embaúbas, 100",
    },
  });
  const res1 = normalize(locInput);
  assert.equal(res1.action, "inbox");
  assert.deepEqual(extractLocation(locInput.body.data.message), {
    location: {
      latitude: -11.8548,
      longitude: -55.5089,
      name: "Sinop Centro",
    },
  });
  assert.deepEqual(res1.inbound.location, {
    latitude: -11.8548,
    longitude: -55.5089,
    name: "Sinop Centro",
  });
  assert.equal(res1.inbound.location.address, undefined);
  assert.equal("address" in res1.inbound.location, false);
  assert.equal(res1.inbound.raw_text, undefined);

  // 2. Defensive location envelope without name/address
  const defInput = event({
    location: {
      latitude: -11.8601,
      longitude: -55.5123,
    },
  });
  const res2 = normalize(defInput);
  assert.equal(res2.action, "inbox");
  assert.deepEqual(res2.inbound.location, {
    latitude: -11.8601,
    longitude: -55.5123,
  });
  assert.equal(res2.inbound.raw_text, undefined);

  // 3. Location message with accompanying text/caption
  const withTextInput = event({
    locationMessage: {
      degreesLatitude: -11.8548,
      degreesLongitude: -55.5089,
    },
    conversation: "aqui em frente à praça",
  });
  const res3 = normalize(withTextInput);
  assert.equal(res3.action, "inbox");
  assert.deepEqual(res3.inbound.location, {
    latitude: -11.8548,
    longitude: -55.5089,
  });
  assert.equal(res3.inbound.raw_text, "aqui em frente à praça");
});

test("gateway rejects malformed or out-of-range location coordinates", () => {
  const invalidLocations = [
    { degreesLatitude: 91, degreesLongitude: -55.5 }, // lat > 90
    { degreesLatitude: -91, degreesLongitude: -55.5 }, // lat < -90
    { degreesLatitude: -11.8, degreesLongitude: 181 }, // lng > 180
    { degreesLatitude: -11.8, degreesLongitude: -181 }, // lng < -180
    { degreesLatitude: "not-a-number", degreesLongitude: -55.5 },
    { degreesLatitude: -11.8, degreesLongitude: null },
    { degreesLatitude: NaN, degreesLongitude: -55.5 },
    { degreesLatitude: Infinity, degreesLongitude: -55.5 },
  ];

  for (const loc of invalidLocations) {
    const badInput = event({ locationMessage: loc });
    const res = normalize(badInput);
    assert.equal(res.action, "reject");
    assert.equal(res.reason, "webhook_location_invalid");
    assert.equal(res.http_status, 422);
  }
});

test("generated Validate event Code node runtime parity for native location messages", () => {
  const workflow = JSON.parse(readFileSync(new URL("gateway.json", import.meta.url), "utf8"));
  const gate = workflow.nodes.find(n => n.name === "Validate event").parameters.jsCode;

  const locInput = event({
    locationMessage: {
      degreesLatitude: -11.8548,
      degreesLongitude: -55.5089,
      name: "Sinop",
    },
  });

  const vmResult = runInNewContext(`(() => { ${gate} })()`, {
    $json: locInput,
    $env: {
      EVOLUTION_INSTANCE: config.instance,
      EVOLUTION_PROVIDER: config.provider,
      EVOLUTION_WEBHOOK_ORIGIN: config.origin,
    },
    Buffer,
    Date: class extends Date { static now() { return now * 1000; } },
  });

  assert.equal(vmResult.json.action, "inbox");
  assert.deepEqual(JSON.parse(JSON.stringify(vmResult.json.inbound.location)), {
    latitude: -11.8548,
    longitude: -55.5089,
    name: "Sinop",
  });
  assert.equal(vmResult.json.inbound.raw_text, undefined);
});

test("normalizeEvolutionReceiptStatus maps standard, legacy and unknown Evolution/Meta receipt statuses", () => {
  assert.equal(normalizeEvolutionReceiptStatus("DELIVERY_ACK"), "delivered");
  assert.equal(normalizeEvolutionReceiptStatus("delivered"), "delivered");
  assert.equal(normalizeEvolutionReceiptStatus("DELIVERED"), "delivered");
  assert.equal(normalizeEvolutionReceiptStatus("READ"), "read");
  assert.equal(normalizeEvolutionReceiptStatus("read"), "read");
  assert.equal(normalizeEvolutionReceiptStatus("PLAYED"), "read");
  assert.equal(normalizeEvolutionReceiptStatus("FAILED"), "failed");
  assert.equal(normalizeEvolutionReceiptStatus("failed"), "failed");
  assert.equal(normalizeEvolutionReceiptStatus("ERROR"), "failed");
  assert.equal(normalizeEvolutionReceiptStatus("SERVER_ACK"), "accepted");
  assert.equal(normalizeEvolutionReceiptStatus("SENT"), "accepted");
  assert.equal(normalizeEvolutionReceiptStatus("sent"), "accepted");
  assert.equal(normalizeEvolutionReceiptStatus("UNKNOWN_PROVIDER_EVENT"), "unknown");
  assert.equal(normalizeEvolutionReceiptStatus("custom_state"), "unknown");
  assert.equal(normalizeEvolutionReceiptStatus(null), null);
  assert.equal(normalizeEvolutionReceiptStatus(undefined), null);
  assert.equal(normalizeEvolutionReceiptStatus(""), null);
  assert.equal(normalizeEvolutionReceiptStatus("   "), null);
  assert.equal(normalizeEvolutionReceiptStatus(12345), null);
});

test("receiptAdmissionDecision acknowledges recorded and unknown_provider_message_id with 200, handles errors defensively", () => {
  assert.deepEqual(
    receiptAdmissionDecision({ statusCode: 200, body: { outcome: "recorded", receipt_id: randomUUID() } }),
    { http_status: 200, reason: "receipt_recorded" }
  );
  assert.deepEqual(
    receiptAdmissionDecision({ statusCode: 200, body: { outcome: "unknown_provider_message_id" } }),
    { http_status: 200, reason: "receipt_recorded" }
  );
  assert.deepEqual(
    receiptAdmissionDecision({ statusCode: 400, body: { error: "validation_failed" } }),
    { http_status: 400, reason: "receipt_not_acknowledged" }
  );
  assert.deepEqual(
    receiptAdmissionDecision({ statusCode: 500, body: { error: "internal" } }),
    { http_status: 503, reason: "receipt_not_acknowledged" }
  );
  assert.deepEqual(
    receiptAdmissionDecision({ statusCode: 502, body: null }),
    { http_status: 503, reason: "receipt_not_acknowledged" }
  );
  assert.deepEqual(
    receiptAdmissionDecision(null),
    { http_status: 503, reason: "receipt_not_acknowledged" }
  );
});

test("gateway normalizes messages.update events across status lifecycle and error structures", () => {
  const updateEvent = (updateData, eventName = "messages.update") => ({
    headers: { "content-type": "application/json; charset=utf-8" },
    jwtPayload: { app: "evolution", action: "webhook", iat: now - 1, exp: now + 599 },
    body: {
      event: eventName,
      instance: config.instance,
      server_url: config.origin,
      data: updateData,
    },
  });

  // 1. Delivered event with numeric epoch timestamp (seconds)
  const deliveredEvt = updateEvent({
    key: { id: "wamid.HBgMNTU2Njk5MTIzNDU2NxUCMRIA", fromMe: true, remoteJid: "5566991234567@s.whatsapp.net" },
    status: "DELIVERY_ACK",
    messageTimestamp: 1713000000,
  });
  const resDelivered = normalize(deliveredEvt);
  assert.equal(resDelivered.action, "receipt");
  assert.equal(resDelivered.receipt.provider, "evolution");
  assert.equal(resDelivered.receipt.provider_message_id, "test-instance:wamid.HBgMNTU2Njk5MTIzNDU2NxUCMRIA");
  assert.equal(resDelivered.receipt.provider_status, "DELIVERY_ACK");
  assert.equal(resDelivered.receipt.normalized_status, "delivered");
  assert.equal(resDelivered.receipt.provider_event_at, new Date(1713000000 * 1000).toISOString());

  // 2. Read event with milliseconds timestamp
  const readEvt = updateEvent({
    key: { id: "BAILEYS_MSG_001", fromMe: true },
    status: "READ",
    timestamp: 1713000100000,
  });
  const resRead = normalize(readEvt);
  assert.equal(resRead.action, "receipt");
  assert.equal(resRead.receipt.provider_message_id, "test-instance:BAILEYS_MSG_001");
  assert.equal(resRead.receipt.provider_status, "READ");
  assert.equal(resRead.receipt.normalized_status, "read");
  assert.equal(resRead.receipt.provider_event_at, new Date(1713000100000).toISOString());

  // 3. Synthetic Meta 131047 failure (customer service window closed)
  const meta131047Evt = updateEvent({
    key: { id: "wamid.HBgMNTU2Njk5OTAyOTA4NxUCMRIA", fromMe: true, remoteJid: "5566999029086@s.whatsapp.net" },
    status: "FAILED",
    messageTimestamp: 1713000200,
    error: {
      code: 131047,
      error_data: {
        details: "Message failed to send because more than 24 hours have passed since the customer last replied to this number.",
      },
    },
  });
  const resFailed = normalize(meta131047Evt);
  assert.equal(resFailed.action, "receipt");
  assert.equal(resFailed.receipt.provider, "evolution");
  assert.equal(resFailed.receipt.provider_message_id, "test-instance:wamid.HBgMNTU2Njk5OTAyOTA4NxUCMRIA");
  assert.equal(resFailed.receipt.provider_status, "FAILED");
  assert.equal(resFailed.receipt.normalized_status, "failed");
  assert.equal(resFailed.receipt.provider_error_code, "131047");
  assert.equal(resFailed.receipt.provider_error_reason, "Message failed to send because more than 24 hours have passed since the customer last replied to this number.");
  assert.equal(resFailed.receipt.provider_event_at, new Date(1713000200 * 1000).toISOString());

  // 4. Unknown provider status preserved
  const unknownEvt = updateEvent({
    key: { id: "wamid.HBgMNTU2Njk5MTIzNDU2NxUCMRIA" },
    status: "REVOKED",
  });
  const resUnknown = normalize(unknownEvt);
  assert.equal(resUnknown.action, "receipt");
  assert.equal(resUnknown.receipt.provider_status, "REVOKED");
  assert.equal(resUnknown.receipt.normalized_status, "unknown");

  // 5. Alternate event name 'messages_update' and array data payload
  const arrayEvt = updateEvent([
    {
      key: { id: "wamid.HBgMNTU2Njk5MTIzNDU2NxUCMRIA" },
      update: { status: "DELIVERED" },
    },
  ], "messages_update");
  const resArray = normalize(arrayEvt);
  assert.equal(resArray.action, "receipt");
  assert.equal(resArray.receipt.normalized_status, "delivered");
  assert.equal(resArray.receipt.provider_status, "DELIVERED");

  // 6. fromMe === true is preserved and NOT rejected or ignored for receipts
  // (In contrast to messages.upsert where fromMe === true triggers own_message ignore)
  const fromMeEvt = updateEvent({
    key: { id: "wamid.HBgMNTU2Njk5MTIzNDU2NxUCMRIA", fromMe: true },
    status: "SERVER_ACK",
  });
  const resFromMe = normalize(fromMeEvt);
  assert.equal(resFromMe.action, "receipt");
  assert.equal(resFromMe.receipt.normalized_status, "accepted");

  // 7. Malformed payloads
  // Missing key
  assert.deepEqual(normalize(updateEvent({ status: "DELIVERED" })), {
    action: "reject",
    reason: "webhook_key_invalid",
    http_status: 422,
  });

  // Invalid key.id
  assert.deepEqual(normalize(updateEvent({ key: { id: "" }, status: "DELIVERED" })), {
    action: "reject",
    reason: "webhook_id_invalid",
    http_status: 422,
  });
  assert.deepEqual(normalize(updateEvent({ key: { id: "bad id with spaces" }, status: "DELIVERED" })), {
    action: "reject",
    reason: "webhook_id_invalid",
    http_status: 422,
  });

  // Missing status is safely ignored with 200
  assert.deepEqual(normalize(updateEvent({ key: { id: "wamid.123" } })), {
    action: "ignore",
    reason: "missing_update_status",
    http_status: 200,
  });

  // Empty data is rejected
  assert.deepEqual(normalize(updateEvent(null)), {
    action: "reject",
    reason: "webhook_message_invalid",
    http_status: 422,
  });
});

test("generated Validate event Code node runtime parity for messages.update receipt events", () => {
  const workflow = JSON.parse(readFileSync(new URL("gateway.json", import.meta.url), "utf8"));
  const gate = workflow.nodes.find(n => n.name === "Validate event").parameters.jsCode;

  const updateEvt = {
    headers: { "content-type": "application/json; charset=utf-8" },
    jwtPayload: { app: "evolution", action: "webhook", iat: now - 1, exp: now + 599 },
    body: {
      event: "messages.update",
      instance: config.instance,
      server_url: config.origin,
      data: {
        key: { id: "wamid.HBgMNTU2Njk5OTAyOTA4NxUCMRIA", fromMe: true, remoteJid: "5566999029086@s.whatsapp.net" },
        status: "FAILED",
        messageTimestamp: 1713000200,
        error: {
          code: 131047,
          error_data: {
            details: "Message failed to send because more than 24 hours have passed since the customer last replied to this number.",
          },
        },
      },
    },
  };

  const vmResult = runInNewContext(`(() => { ${gate} })()`, {
    $json: updateEvt,
    $env: {
      EVOLUTION_INSTANCE: config.instance,
      EVOLUTION_PROVIDER: config.provider,
      EVOLUTION_WEBHOOK_ORIGIN: config.origin,
    },
    Buffer,
    Date: class extends Date { static now() { return now * 1000; } },
  });

  assert.equal(vmResult.json.action, "receipt");
  assert.equal(vmResult.json.receipt.provider, "evolution");
  assert.equal(vmResult.json.receipt.provider_message_id, "test-instance:wamid.HBgMNTU2Njk5OTAyOTA4NxUCMRIA");
  assert.equal(vmResult.json.receipt.provider_status, "FAILED");
  assert.equal(vmResult.json.receipt.normalized_status, "failed");
  assert.equal(vmResult.json.receipt.provider_error_code, "131047");
  assert.equal(vmResult.json.receipt.provider_error_reason, "Message failed to send because more than 24 hours have passed since the customer last replied to this number.");
  assert.equal(vmResult.json.receipt.provider_event_at, new Date(1713000200 * 1000).toISOString());
});

test("gateway export topology includes complete receipt recording pipeline", () => {
  const workflow = JSON.parse(readFileSync(new URL("gateway.json", import.meta.url), "utf8"));

  // Verify all required nodes exist
  const nodeNames = new Set(workflow.nodes.map(n => n.name));
  for (const expected of ["Receipt input", "Record receipt", "Inspect receipt", "Acknowledge receipt"]) {
    assert.ok(nodeNames.has(expected), `Node ${expected} must exist in gateway.json`);
  }

  // Verify Record receipt node parameters
  const recordReceiptNode = workflow.nodes.find(n => n.name === "Record receipt");
  assert.equal(recordReceiptNode.type, "n8n-nodes-base.httpRequest");
  assert.equal(recordReceiptNode.parameters.method, "POST");
  assert.equal(recordReceiptNode.parameters.url, "={{ $env.CONTATOCERTO_API_BASE_URL + '/internal/channel/outbound/receipts' }}");
  assert.equal(recordReceiptNode.onError, "continueRegularOutput");

  // Verify connectivity: Audio input (false) -> Receipt input (true) -> Record receipt -> Inspect receipt -> Acknowledge receipt
  const audioConn = workflow.connections["Audio input"].main;
  assert.ok(audioConn[1].some(edge => edge.node === "Receipt input"), "Audio input false branch must route to Receipt input");

  const receiptInputConn = workflow.connections["Receipt input"].main;
  assert.ok(receiptInputConn[0].some(edge => edge.node === "Record receipt"), "Receipt input true branch must connect to Record receipt");
  assert.ok(receiptInputConn[1].some(edge => edge.node === "Acknowledge ignored or rejected"), "Receipt input false branch must connect to Acknowledge ignored or rejected");

  const recordReceiptConn = workflow.connections["Record receipt"].main[0];
  assert.ok(recordReceiptConn.some(edge => edge.node === "Inspect receipt"), "Record receipt must connect to Inspect receipt");

  const inspectReceiptConn = workflow.connections["Inspect receipt"].main[0];
  assert.ok(inspectReceiptConn.some(edge => edge.node === "Acknowledge receipt"), "Inspect receipt must connect to Acknowledge receipt");

  // Verify Inspect receipt code node evaluates receiptAdmissionDecision
  const inspectCode = workflow.nodes.find(n => n.name === "Inspect receipt").parameters.jsCode;
  assert.ok(inspectCode.includes("receiptAdmissionDecision"), "Inspect receipt code must call receiptAdmissionDecision");
});


