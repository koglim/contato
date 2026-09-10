import assert from "node:assert/strict";
import test from "node:test";
import { ProfessionalOpportunityService } from "./professional-opportunity.service.js";
import type { DatabaseClient } from "../../database/connection.js";
import type { ChannelInboundMessageRecord } from "../channel-inbox/channel-inbox.types.js";

const id = "11111111-1111-4111-8111-111111111111";
const record: ChannelInboundMessageRecord = { id, provider:"test", providerMessageId:"unit", phoneE164:"+5566999999999",
  rawText:"retomar eletricista", countryCode:"BR", limitValue:3, status:"processing", customerId:null, conversationId:null,
  searchRequestId:null, result:null, errorCode:null, processingToken:id, processingStartedAt:new Date() };

function harness(targets: object[], current?: object, persisted?: object) {
  const writes: string[] = [];
  let text = "";
  const db = { async query(sql: string, values: unknown[] = []) {
    if (/^(INSERT|UPDATE)/u.test(sql)) writes.push(sql);
    if (sql.startsWith("SELECT status, processing_token")) return { rows:[persisted ?? { status:"processing", processing_token:id }] };
    if (sql.startsWith("SELECT id FROM channel_inbound_messages") || sql.startsWith("UPDATE channel_inbound_messages")) return { rows:[{id}] };
    if (sql.startsWith("SELECT id FROM customers")) return { rows:[{id}] };
    if (sql.includes("SELECT contacts.*")) return { rows:[] };
    if (sql.includes("conversation.resume_slot IS NOT NULL")) return { rows:targets };
    if (sql.includes("FROM search_conversations")) return { rows:current ? [current] : [] };
    if (sql.startsWith("INSERT INTO channel_outbound_messages")) { text = String(values[3]); return { rows:[{id}] }; }
    if (sql.startsWith("SELECT id, status, text_content")) return { rows:[{id,status:"pending",text_content:text || "Já respondido"}] };
    return { rows:[] };
  } } as unknown as DatabaseClient;
  return { writes, service:new ProfessionalOpportunityService(async (work) => work(db)) };
}

test("global commands bypass opportunity decisions and all writes", async () => {
  const h = harness([]);
  assert.equal(await h.service.handle({...record,rawText:"cancelar"}), null);
  assert.deepEqual(h.writes, []);
});
test("keep does not suspend or resume the current search", async () => {
  const h = harness([],{id:"current"});
  const response = await h.service.handle({...record,rawText:"manter atual"});
  assert.equal(response?.result.route === "opportunity" && response.result.result.kind, "kept");
  assert.ok(h.writes.every((sql) => !sql.includes("UPDATE search_conversations")));
});
test("a question about resuming asks for confirmation without changing context", async () => {
  const h = harness([],{id:"current"});
  const response = await h.service.handle({...record,rawText:"posso retomar?"});
  assert.equal(response?.result.route === "opportunity" && response.result.result.kind, "clarification");
  assert.ok(h.writes.every((sql) => !sql.includes("UPDATE search_conversations")));
});
test("unambiguous resume suspends the current slot before activating the old search", async () => {
  const h = harness([{id:"old",service_text:"eletricista",public_code:null,valid:true,resume_slot:"selection"}],{id:"current"});
  await h.service.handle(record);
  const mutations = h.writes.filter((sql) => sql.includes("UPDATE search_conversations"));
  assert.equal(mutations.length, 2);
  assert.match(mutations[0], /resume_slot = pending_slot/);
  assert.match(mutations[1], /pending_slot = resume_slot/);
});
for (const [label, targets, kind] of [
  ["expired", [{id:"old",service_text:"eletricista",public_code:null,valid:false}], "expired"],
  ["ambiguous", [{service_text:"eletricista",public_code:null},{service_text:"eletricista",public_code:null}], "clarification"],
] as const) {
  test(`${label} resume never changes active context`, async () => {
    const h = harness([...targets],{id:"current"});
    const response = await h.service.handle(record);
    assert.equal(response?.result.route === "opportunity" && response.result.result.kind, kind);
    assert.ok(h.writes.every((sql) => !sql.includes("UPDATE search_conversations")));
  });
}
test("replay reads the saved outbound without applying a context switch again", async () => {
  const result = {route:"opportunity",result:{kind:"resumed",text:"Já respondido"}};
  const h = harness([],undefined,{status:"processed",response_outbound_id:id,result});
  assert.equal((await h.service.handle(record))?.duplicate, true);
  assert.deepEqual(h.writes, []);
});
