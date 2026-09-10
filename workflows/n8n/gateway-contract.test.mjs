import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { normalizeGatewayEvent, transcriptionDecision, inboxDecision } from "./gateway-contract.mjs";
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
test("valid audio has one immutable inbound identity and bounded binary", () => {
  const result = normalize(audio(120));
  assert.equal(result.action, "audio");
  assert.equal(result.inbound.raw_text, undefined);
  const transcript = transcriptionDecision({ statusCode: 200, body: { text: "  minha pia vazou  " } }, result, false);
  assert.equal(transcript.action, "inbox");
  assert.equal(transcript.inbound.raw_text, "minha pia vazou");
  assert.equal(transcript.inbound.provider_message_id, result.inbound.provider_message_id);
  assert.equal(transcript.audio_base64, undefined);
});
test("long or unbounded audio is not transcribed", () => {
  for (const duration of [121, 0, -1, undefined, "20"]) assert.equal(normalize(audio(duration)).action, "notice");
  const input = audio(20); input.body.data.message.base64 = "not base64";
  assert.equal(normalize(input).action, "notice");
});
test("primary failure or empty/invalid text uses fallback; total failure yields one controlled notice", () => {
  const context = normalize(audio(20));
  for (const response of [{}, { error: "timeout" }, { statusCode: 503 }, { statusCode: 200, body: { text: " " } }, { statusCode: 200, body: { text: "x".repeat(501) } }]) {
    assert.equal(transcriptionDecision(response, context, false).action, "fallback");
    const failed = transcriptionDecision(response, context, true);
    assert.equal(failed.action, "notice"); assert.equal(failed.inbound.raw_text, undefined);
  }
  assert.equal(transcriptionDecision({ statusCode: 200, body: { text: "encanador em Sinop" } }, context, true).action, "inbox");
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
  const result=runInNewContext(`(() => { ${gate} })()`,{$json:event(),$vars:{EVOLUTION_INSTANCE:config.instance,EVOLUTION_PROVIDER:config.provider,EVOLUTION_WEBHOOK_ORIGIN:config.origin},Buffer,Date:class extends Date {static now(){return now*1000;}}});
  assert.equal(result.json.action,"inbox");
});

// Small graph simulator: executes the generated Code/If nodes and item links.
// HTTP, JWT verification, ConvertToFile, Respond and ExecuteWorkflow are mocked.
// This does not claim to be the n8n engine or cryptographic authentication QA.
function simulateGateway(input, responses = {}) {
  const workflow=JSON.parse(readFileSync(new URL("gateway.json",import.meta.url),"utf8"));
  const outputs=new Map(); const calls=[]; const acknowledgements=[];
  let name="Evolution webhook", item={json:input};
  const vars={EVOLUTION_INSTANCE:config.instance,EVOLUTION_PROVIDER:config.provider,EVOLUTION_WEBHOOK_ORIGIN:config.origin};
  const evaluate=expression=>runInNewContext(expression.slice(3,-2),{$json:item.json});
  for(let steps=0;name && steps<60;steps++) {
    const node=workflow.nodes.find(n=>n.name===name); assert.ok(node,name);
    let port=0;
    if(node.type.endsWith(".code")) item=runInNewContext(`(() => { ${node.parameters.jsCode} })()`,{
      $json:item.json,$vars:vars,$:n=>({item:outputs.get(n)}),Buffer,Date:class extends Date {static now(){return now*1000;}},
    });
    else if(node.type.endsWith(".if")) port=evaluate(node.parameters.conditions.conditions[0].leftValue)?0:1;
    else if(node.type.endsWith(".httpRequest")) {
      calls.push({name,json:item.json,binary:item.binary});
      item={json:responses[name]??{statusCode:503,body:""}};
    } else if(node.type.endsWith(".convertToFile")) item={json:{},binary:{data:{data:item.json.audio_base64}}};
    else if(node.type.endsWith(".respondToWebhook")) acknowledgements.push(typeof node.parameters.options.responseCode==="number"?node.parameters.options.responseCode:evaluate(node.parameters.options.responseCode));
    else if(node.type.endsWith(".executeWorkflow")) { calls.push({name,json:item.json}); item={json:claimDecision(item.json,config.provider)}; }
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
for(const [label,primary,secondary,expected] of [
  ["primary",{statusCode:200,body:'{"text":"ajuda"}'},null,"inbox"],
  ["fallback after timeout",{error:"ETIMEDOUT"},{statusCode:200,body:'{"text":"ajuda"}'},"inbox"],
  ["fallback after empty transcript",{statusCode:200,body:'{"text":""}'},{statusCode:200,body:'{"text":"ajuda"}'},"inbox"],
  ["total failure",{statusCode:500},{statusCode:503},"notice"],
]) test(`generated audio path ${label} has one final path and retains binary for fallback`,()=>{
  const result=simulateGateway(audio(20),{"Transcribe Groq":primary,"Transcribe OpenAI fallback":secondary,"Channel Inbox":inboxReply(),"Claim outbound":{statusCode:409,body:""},
    "One-shot audio notice":{statusCode:201,body:{key:{id:"notice-1",fromMe:true,remoteJid:"5566991234567@s.whatsapp.net"}}}});
  const inboxes=result.calls.filter(c=>c.name==="Channel Inbox");
  const notices=result.calls.filter(c=>c.name==="One-shot audio notice");
  assert.equal(inboxes.length,expected==="inbox"?1:0); assert.equal(notices.length,expected==="notice"?1:0);
  if(secondary) assert.ok(result.calls.find(c=>c.name==="Transcribe OpenAI fallback").binary?.data);
  else assert.ok(!result.calls.some(c=>c.name==="Transcribe OpenAI fallback"));
  assert.deepEqual(result.acknowledgements,[200]);
});
test("long audio graph skips both transcribers and sends only the one-shot notice",()=>{
  const result=simulateGateway(audio(121),{"One-shot audio notice":{statusCode:201,body:{key:{id:"notice-2",fromMe:true,remoteJid:"5566991234567@s.whatsapp.net"}}}});
  assert.deepEqual(result.calls.map(c=>c.name),["One-shot audio notice"]);
  assert.deepEqual(result.acknowledgements,[200]);
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
test("exports only use node versions present in the pinned n8n source; every reference resolves",()=>{
  const allowed={webhook:[1,1.1,2,2.1],code:[1,2],if:[2,2.1,2.2,2.3],httpRequest:[3,4,4.1,4.2,4.3],
    executeWorkflow:[1,1.1,1.2,1.3],executeWorkflowTrigger:[1,1.1],scheduleTrigger:[1,1.1,1.2,1.3],convertToFile:[1,1.1],respondToWebhook:[1,1.1,1.2,1.3,1.4,1.5]};
  for(const file of ["gateway.json","shared-delivery.json","outbox-dispatcher.json","inbox-recovery.json"]) {
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
