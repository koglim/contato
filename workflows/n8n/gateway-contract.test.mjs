import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import {
  normalizeGatewayEvent,
  transcriptionDecision,
  inboxDecision,
  mediaClaimDecision,
  extractPhoneFromJid,
  isOpaqueJid,
  normalizeBrazilianMobilePhone as gwNormalizeBrazilianMobilePhone,
  VALID_BRAZILIAN_DDDS as gwValidDDDs,
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
