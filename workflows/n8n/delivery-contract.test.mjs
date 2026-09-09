import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { runInNewContext } from "node:vm";
import { claimDecision, transportDecision, confirmationDecision, normalizeEvolutionText } from "./delivery-contract.mjs";

const message = () => ({ id: randomUUID(), status: "processing", attempt_count: 1,
  purpose: "professional_contact_notification", provider: "evolution", recipient_phone_e164: "+5566991234567",
  message_type: "text", text_content: "Contato confirmado.\nMensagem com aspas: \"olá\" 😊", processing_token: randomUUID() });
const response = (body, statusCode = 200) => ({ statusCode, body });

test("empty, already sent and busy claims never authorize transport", () => {
  assert.equal(claimDecision(response(null, 204), "evolution").action, "stop");
  assert.equal(claimDecision(response(null, 409), "evolution").action, "stop");
  const sent = message();
  assert.equal(claimDecision(response({ id: sent.id, status: "sent", attempt_count: 1, purpose: sent.purpose }), "evolution").action, "stop");
  for (const body of [{ ...sent, processing_token: undefined }, { ...sent, provider: "other" }, { ...sent, text_content: "" }]) {
    assert.throws(() => claimDecision(response(body), "evolution"), /claim_invalid/u);
  }
});

test("delivery preserves recipient and content from each claimed message, including independent purposes", () => {
  for (const purpose of ["customer_reply", "professional_contact_notification", "professional_reply", "customer_contact_update"]) {
    const item = { ...message(), purpose };
    const decision = claimDecision(response(item), "evolution");
    assert.equal(decision.message.text_content, item.text_content);
    assert.equal(decision.message.recipient_phone_e164, item.recipient_phone_e164);
    assert.equal(decision.message.processing_token, item.processing_token);
    assert.equal(decision.message.purpose, purpose);
  }
});

test("acceptance must match the recipient and provider message id; only proven rejection goes to failed", () => {
  const item = message();
  const accepted = response({ key: { id: "provider-1", fromMe: true, remoteJid: "5566991234567@s.whatsapp.net" } }, 201);
  assert.deepEqual(transportDecision(accepted, item), { action: "sent", payload: { processing_token: item.processing_token, provider_message_id: "provider-1" } });
  for (const result of [response({}, 200), response({}, 500), {}, { error: "timeout" },
    response({ key: { ...accepted.body.key, remoteJid: "another-recipient@s.whatsapp.net" } })]) {
    assert.equal(transportDecision(result, item).action, "hold");
  }
  assert.equal(transportDecision(response({}, 429), item).action, "failed");
});

test("a lost sent confirmation never triggers another transport call or failure", () => {
  const item = message();
  const sent = { action: "sent", payload: { processing_token: item.processing_token, provider_message_id: "accepted" } };
  const decision = confirmationDecision(response({}, 503), item, sent);
  assert.equal(decision.action, "hold");
  assert.equal(decision.payload.reason, "confirmation_pending");
  assert.deepEqual(confirmationDecision(response({ id: item.id, status: "sent" }), item, sent), {
    action: "complete", id: item.id, status: "sent", needs_reconciliation: false,
  });
  assert.equal(confirmationDecision(response({ id: randomUUID(), status: "sent" }), item, sent).action, "hold");
});

test("text normalization handles quotes, newlines, emoji and quoted replies without JSON interpolation", () => {
  const body = { instance: "pilot", event: "messages.upsert", data: { key: { fromMe: false, remoteJid: "5566991234567@s.whatsapp.net", id: "inbound-1" }, message: { conversation: "a pia \"vazou\"\n\\cozinha 😊" } } };
  const normalized = normalizeEvolutionText(body, "pilot", "evolution");
  assert.equal(JSON.parse(JSON.stringify(normalized)).raw_text, body.data.message.conversation);
  body.data.message = { extendedTextMessage: { text: "quero a Ana", contextInfo: { quotedMessage: { conversation: "texto citado" } } } };
  assert.equal(normalizeEvolutionText(body, "pilot", "evolution").raw_text, "quero a Ana");
  assert.throws(() => normalizeEvolutionText(body, "another", "evolution"), /instance_not_allowed/u);
  body.data.key.fromMe = true;
  assert.deepEqual(normalizeEvolutionText(body, "pilot", "evolution"), { ignored: true });
  body.data.key.fromMe = false;
  body.data.key.remoteJid = "group@g.us";
  assert.deepEqual(normalizeEvolutionText(body, "pilot", "evolution"), { ignored: true });
});

test("workflow exports are inactive, connected, credential-free and never retry transport", () => {
  for (const file of ["shared-delivery.json", "outbox-dispatcher.json"]) {
    const raw = readFileSync(new URL(file, import.meta.url), "utf8");
    const workflow = JSON.parse(raw);
    assert.equal(workflow.active, false);
    assert.deepEqual(workflow.pinData, {});
    const names = new Set(workflow.nodes.map((node) => node.name));
    for (const [from, connection] of Object.entries(workflow.connections)) {
      assert.ok(names.has(from));
      for (const edge of connection.main.flat()) assert.ok(names.has(edge.node));
    }
    for (const node of workflow.nodes.filter((node) => node.type === "n8n-nodes-base.code")) {
      assert.doesNotThrow(() => new Function(node.parameters.jsCode));
    }
    for (const node of workflow.nodes.filter((node) => node.credentials)) {
      assert.deepEqual(Object.keys(node.credentials.httpHeaderAuth), ["name"]);
    }
    const send = workflow.nodes.find((node) => node.name === "Send Evolution");
    if (send) {
      assert.equal(send.retryOnFail, false);
      assert.equal(send.parameters.options.timeout, 15000);
      assert.match(send.parameters.jsonBody, /message.recipient_phone_e164/u);
      assert.match(send.parameters.jsonBody, /message.text_content/u);
    }
  }
});

test("exported Code gate evaluates the same contract and dispatcher budgets are bounded", () => {
  const shared = JSON.parse(readFileSync(new URL("shared-delivery.json", import.meta.url), "utf8"));
  const gate = shared.nodes.find((node) => node.name === "Validate claim").parameters.jsCode;
  const runGate = (claim) => runInNewContext(`(() => { ${gate} })()`, { $json: claim, $vars: { EVOLUTION_PROVIDER: "evolution" } });
  assert.equal(runGate(response(null, 204)).json.action, "stop");
  assert.equal(runGate(response(message())).json.action, "send");
  const dispatcher = JSON.parse(readFileSync(new URL("outbox-dispatcher.json", import.meta.url), "utf8"));
  const budget = dispatcher.nodes.find((node) => node.name === "Budget").parameters.jsCode;
  const runBudget = (items) => runInNewContext(`(() => { ${budget} })()`, { $input: { all: () => items } });
  assert.equal(runBudget([{ json: { count: 10, started_at: Date.now() } }]).length, 0);
  assert.equal(runBudget([{ json: { count: 0, started_at: Date.now() - 60000 } }]).length, 0);
  assert.equal(runBudget([{ json: {} }]).length, 1);
  assert.throws(() => runBudget([{ json: {} }, { json: {} }]), /one_budget/u);
});
