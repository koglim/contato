import { writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { claimDecision, transportDecision, confirmationDecision, httpResponse } from "./delivery-contract.mjs";
import { normalizeGatewayEvent, transcriptionDecision, inboxDecision } from "./gateway-contract.mjs";

const node = (name, type, parameters, x, y = 0, extra = {}) => ({
  id: name.toLowerCase().replaceAll(" ", "-"), name, type: `n8n-nodes-base.${type}`,
  typeVersion: ({ code: 2, if: 2.2, httpRequest: 4.2, executeWorkflow: 1.2, executeWorkflowTrigger: 1.1, scheduleTrigger: 1.2,
    webhook: 2.1, respondToWebhook: 1.4, convertToFile: 1.1 })[type],
  position: [x, y], parameters, ...extra,
});
const code = (name, jsCode, x, y = 0, mode = "runOnceForEachItem") => node(name, "code", { mode, jsCode: `${httpResponse.toString()}\n${jsCode}` }, x, y);
const branch = (name, expression, x, y = 0) => node(name, "if", { conditions: {
  options: { caseSensitive: true, typeValidation: "strict", version: 2 },
  conditions: [{ id: name, leftValue: expression, rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and",
}, options: {} }, x, y);
const http = (name, url, body, credential, x, y = 0, confirm = false) => node(name, "httpRequest", {
  method: "POST", url, authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth",
  ...(body ? { sendBody: true, specifyBody: "json", jsonBody: body } : {}),
  options: { timeout: confirm ? 5000 : 15000, redirect: { redirect: { followRedirects: false } },
    response: { response: { fullResponse: true, neverError: !confirm, responseFormat: "text", outputPropertyName: "body" } } },
}, x, y, { credentials: { httpHeaderAuth: { name: credential } },
  onError: "continueRegularOutput", retryOnFail: confirm, ...(confirm ? { maxTries: 3, waitBetweenTries: 1000 } : {}) });
const edge = (name) => ({ node: name, type: "main", index: 0 });
const flow = (name, nodes, connections, timeout) => ({ name, active: false, nodes, connections,
  settings: { executionOrder: "v1", executionTimeout: timeout, saveDataSuccessExecution: "none",
    saveDataErrorExecution: "none", saveExecutionProgress: false, saveManualExecutions: false }, pinData: {}, tags: [] });

const delivery = flow("ContatoCerto - Shared Outbox Delivery", [
  node("Start", "executeWorkflowTrigger", { inputSource: "passthrough" }, 0),
  code("Validate claim", `${claimDecision.toString()}\nreturn { json: claimDecision($json, $vars.EVOLUTION_PROVIDER) };`, 220),
  branch("Send authorized", "={{ $json.action === 'send' }}", 440),
  http("Send Evolution", "={{ $vars.EVOLUTION_API_BASE_URL + '/message/sendText/' + encodeURIComponent($vars.EVOLUTION_INSTANCE) }}",
    "={{ { number: $json.message.recipient_phone_e164.slice(1), text: $json.message.text_content } }}", "ContatoCerto Evolution", 660),
  code("Classify transport", `${transportDecision.toString()}\nconst message = $('Validate claim').item.json.message;\nreturn { json: { message, outcome: transportDecision($json, message) } };`, 880),
  http("Confirm outcome", "={{ $vars.CONTATOCERTO_API_BASE_URL + '/internal/channel/outbound/' + $json.message.id + '/' + $json.outcome.action }}",
    "={{ $json.outcome.payload }}", "ContatoCerto Internal API", 1100, 0, true),
  code("Check confirmation", `${confirmationDecision.toString()}\nconst context = $('Classify transport').item.json;\nreturn { json: confirmationDecision($json, context.message, context.outcome) };`, 1320),
  branch("Confirmation pending", "={{ $json.action === 'hold' }}", 1540),
  http("Hold unconfirmed send", "={{ $vars.CONTATOCERTO_API_BASE_URL + '/internal/channel/outbound/' + $json.id + '/hold' }}",
    "={{ $json.payload }}", "ContatoCerto Internal API", 1760, 0, true),
  code("Check hold", "const context = $('Check confirmation').item.json;\nconst response = httpResponse($json);\nif (response.statusCode !== 200 || response.body?.id !== context.id || response.body?.delivery_status !== 'reconciliation_required') throw new Error('outbox_reconciliation_required');\nreturn { json: { action: 'complete', id: context.id, provider_message_id: context.provider_message_id, status: 'processing', needs_reconciliation: true } };", 1980),
  code("Complete", "return { json: $json };", 1980, 240),
], {
  Start: { main: [[edge("Validate claim")]] },
  "Validate claim": { main: [[edge("Send authorized")]] },
  "Send authorized": { main: [[edge("Send Evolution")], [edge("Complete")]] },
  "Send Evolution": { main: [[edge("Classify transport")]] },
  "Classify transport": { main: [[edge("Confirm outcome")]] },
  "Confirm outcome": { main: [[edge("Check confirmation")]] },
  "Check confirmation": { main: [[edge("Confirmation pending")]] },
  "Confirmation pending": { main: [[edge("Hold unconfirmed send")], [edge("Complete")]] },
  "Hold unconfirmed send": { main: [[edge("Check hold")]] },
  "Check hold": { main: [[edge("Complete")]] },
}, 55);

const dispatcher = flow("ContatoCerto - Outbox Dispatcher", [
  node("Schedule", "scheduleTrigger", { rule: { interval: [{ field: "seconds", secondsInterval: 10 }] } }, 0),
  code("Budget", "const items = $input.all();\nif (items.length !== 1) throw new Error('dispatcher_expects_one_budget');\nconst input = items[0].json;\nconst started_at = input.started_at ?? Date.now();\nconst count = input.count ?? 0;\nif (count >= 10 || Date.now() - started_at >= 45000) return [];\nreturn [{ json: { started_at, count } }];", 220, 0, "runOnceForAllItems"),
  http("Claim next", "={{ $vars.CONTATOCERTO_API_BASE_URL + '/internal/channel/outbound/next/claim' }}", null, "ContatoCerto Internal API", 440),
  node("Deliver shared", "executeWorkflow", { source: "database", workflowId: { __rl: true, value: "={{ $vars.CONTATOCERTO_DELIVERY_WORKFLOW_ID }}", mode: "id" }, mode: "each", options: { waitForSubWorkflow: true } }, 660),
  code("Continue draining", "const items = $input.all();\nif (items.length !== 1) throw new Error('dispatcher_expects_one_result');\nconst result = items[0].json;\nif (result.action !== 'complete' || result.needs_reconciliation) return [];\nconst budget = $('Budget').item.json;\nreturn [{ json: { started_at: budget.started_at, count: budget.count + 1 } }];", 880, 0, "runOnceForAllItems"),
], {
  Schedule: { main: [[edge("Budget")]] },
  Budget: { main: [[edge("Claim next")]] },
  "Claim next": { main: [[edge("Deliver shared")]] },
  "Deliver shared": { main: [[edge("Continue draining")]] },
  "Continue draining": { main: [[edge("Budget")]] },
}, 105);

const recovery = flow("ContatoCerto - Inbox Recovery", [
  node("Schedule", "scheduleTrigger", { rule: { interval: [{ field: "seconds", secondsInterval: 10 }] } }, 0),
  code("Budget", "const item = $input.all()[0]?.json ?? {};\nconst started_at = item.started_at ?? Date.now();\nconst count = item.count ?? 0;\nif (count >= 10 || Date.now() - started_at >= 45000) return [];\nreturn [{ json: { started_at, count } }];", 220, 0, "runOnceForAllItems"),
  { ...http("Process next", "={{ $vars.CONTATOCERTO_API_BASE_URL + '/internal/channel/inbound/next/process' }}", null, "ContatoCerto Internal API", 440),
    parameters: { ...http("Process next", "", null, "", 0).parameters,
      url: "={{ $vars.CONTATOCERTO_API_BASE_URL + '/internal/channel/inbound/next/process' }}",
      options: { timeout: 70000, redirect: { redirect: { followRedirects: false } }, response: { response: { fullResponse: true, neverError: true, responseFormat: "text", outputPropertyName: "body" } } } } },
  code("Continue recovery", "const response = httpResponse($json);\nif (response.statusCode === 204) return [];\nif (response.statusCode !== 200 || !['processed','retry_scheduled','quarantined','processing'].includes(response.body?.status)) throw new Error('inbox_recovery_failed');\nconst budget = $('Budget').item.json;\nreturn [{ json: { started_at: budget.started_at, count: budget.count + 1 } }];", 660, 0, "runOnceForAllItems"),
], { Schedule: { main: [[edge("Budget")]] }, Budget: { main: [[edge("Process next")]] },
  "Process next": { main: [[edge("Continue recovery")]] }, "Continue recovery": { main: [[edge("Budget")]] } }, 120);

const respond = (name, status, x, y = 0) => node(name, "respondToWebhook", {
  respondWith: "json", responseBody: "={{ { accepted: $json.http_status === 200, code: $json.reason ?? 'accepted' } }}",
  options: { responseCode: status },
}, x, y);
const transcribe = (name, url, model, credential, x) => {
  const request = http(name, url, null, credential, x, 320);
  return { ...request, parameters: { ...request.parameters, sendBody: true, contentType: "multipart-form-data",
    bodyParameters: { parameters: [ { parameterType: "formBinaryData", name: "file", inputDataFieldName: "data" },
      { name: "model", value: model }, { name: "language", value: "pt" }, { name: "response_format", value: "json" } ] },
    options: { ...request.parameters.options, timeout: 10000 } } };
};
const gateway = flow("ContatoCerto - WhatsApp Gateway", [
  node("Evolution webhook", "webhook", { httpMethod: "POST", path: "contatocerto-evolution-inbound", authentication: "jwtAuth",
    responseMode: "responseNode", options: {} }, 0, 0, { credentials: { jwtAuth: { name: "ContatoCerto Evolution Webhook JWT" } } }),
  code("Validate event", `${normalizeGatewayEvent.toString()}\nreturn { json: normalizeGatewayEvent($json, { instance: $vars.EVOLUTION_INSTANCE, provider: $vars.EVOLUTION_PROVIDER, origin: $vars.EVOLUTION_WEBHOOK_ORIGIN }) };`, 220),
  branch("Text input", "={{ $json.action === 'inbox' }}", 440),
  branch("Audio input", "={{ $json.action === 'audio' }}", 660, 320),
  node("Audio binary", "convertToFile", { operation: "toBinary", sourceProperty: "audio_base64", binaryPropertyName: "data",
    options: { fileName: "={{ $json.file_name }}", mimeType: "={{ $json.mime_type }}" } }, 880, 320, { onError: "continueRegularOutput" }),
  transcribe("Transcribe Groq", "https://api.groq.com/openai/v1/audio/transcriptions", "whisper-large-v3-turbo", "ContatoCerto Groq Transcription", 1100),
  code("Primary transcript", `${transcriptionDecision.toString()}\nreturn { json: transcriptionDecision($json, $('Validate event').item.json, false) };`, 1320, 320),
  branch("Primary succeeded", "={{ $json.action === 'inbox' }}", 1540, 320),
  // Reattach the original binary by item linkage. No Merge by position or two
  // parallel branches that could each emit an inbound/fallback notification.
  code("Restore audio for fallback", "const source = $('Audio binary').item;\nreturn { json: {}, ...(source.binary ? { binary: source.binary } : {}) };", 1760, 480),
  transcribe("Transcribe OpenAI fallback", "https://api.openai.com/v1/audio/transcriptions", "gpt-4o-mini-transcribe", "ContatoCerto OpenAI Transcription", 1980),
  code("Fallback transcript", `${transcriptionDecision.toString()}\nreturn { json: transcriptionDecision($json, $('Validate event').item.json, true) };`, 2200, 320),
  branch("Fallback succeeded", "={{ $json.action === 'inbox' }}", 2420, 320),
  { ...http("Channel Inbox", "={{ $vars.CONTATOCERTO_API_BASE_URL + '/internal/channel/inbound/messages' }}", "={{ $json.inbound }}", "ContatoCerto Internal API", 2640),
    parameters: { ...http("Channel Inbox", "", null, "", 0).parameters,
      url: "={{ $vars.CONTATOCERTO_API_BASE_URL + '/internal/channel/inbound/messages' }}", sendBody: true, specifyBody: "json", jsonBody: "={{ $json.inbound }}",
      options: { ...http("", "", null, "", 0).parameters.options, timeout: 70000 } } },
  code("Inspect Inbox", `${inboxDecision.toString()}\nreturn { json: inboxDecision($json) };`, 2860),
  // ACK after the durable Inbox result, before sending. Outbox dispatcher owns
  // recovery if execution terminates after this point.
  respond("Acknowledge Inbox", "={{ $json.http_status }}", 3080),
  branch("Outbox available", "={{ $json.action === 'claim' }}", 3300),
  http("Claim outbound", "={{ $vars.CONTATOCERTO_API_BASE_URL + '/internal/channel/outbound/' + $json.id + '/claim' }}", null, "ContatoCerto Internal API", 3520),
  node("Deliver shared", "executeWorkflow", { source: "database", workflowId: { __rl: true, value: "={{ $vars.CONTATOCERTO_DELIVERY_WORKFLOW_ID }}", mode: "id" }, mode: "each", options: { waitForSubWorkflow: true } }, 3740),
  branch("Audio notice", "={{ $json.action === 'notice' }}", 2640, 640),
  respond("Acknowledge ignored or rejected", "={{ $json.http_status }}", 2860, 880),
  // Explicit transport-only exception: no business action and no fabricated
  // Inbox input. ACK before this one-shot notice; never retry an uncertain send.
  respond("Acknowledge audio notice", 200, 2860, 640),
  http("One-shot audio notice", "={{ $vars.EVOLUTION_API_BASE_URL + '/message/sendText/' + encodeURIComponent($vars.EVOLUTION_INSTANCE) }}",
    "={{ { number: $json.inbound.phone_e164.slice(1), text: $json.text } }}", "ContatoCerto Evolution", 3080, 640),
  code("Inspect audio notice", `${transportDecision.toString()}\nconst source = $('Acknowledge audio notice').item.json;\nconst outcome = transportDecision($json, { recipient_phone_e164: source.inbound.phone_e164 });\nif (outcome.action !== 'sent') throw new Error('audio_notice_reconciliation_required');\nreturn { json: { action: 'complete', provider_message_id: outcome.payload.provider_message_id, transport_notice: true } };`, 3300, 640),
], {
  "Evolution webhook": { main: [[edge("Validate event")]] },
  "Validate event": { main: [[edge("Text input")]] },
  "Text input": { main: [[edge("Channel Inbox")], [edge("Audio input")]] },
  "Audio input": { main: [[edge("Audio binary")], [edge("Audio notice")]] },
  "Audio binary": { main: [[edge("Transcribe Groq")]] },
  "Transcribe Groq": { main: [[edge("Primary transcript")]] },
  "Primary transcript": { main: [[edge("Primary succeeded")]] },
  "Primary succeeded": { main: [[edge("Channel Inbox")], [edge("Restore audio for fallback")]] },
  "Restore audio for fallback": { main: [[edge("Transcribe OpenAI fallback")]] },
  "Transcribe OpenAI fallback": { main: [[edge("Fallback transcript")]] },
  "Fallback transcript": { main: [[edge("Fallback succeeded")]] },
  "Fallback succeeded": { main: [[edge("Channel Inbox")], [edge("Audio notice")]] },
  "Channel Inbox": { main: [[edge("Inspect Inbox")]] },
  "Inspect Inbox": { main: [[edge("Acknowledge Inbox")]] },
  "Acknowledge Inbox": { main: [[edge("Outbox available")]] },
  "Outbox available": { main: [[edge("Claim outbound")], []] },
  "Claim outbound": { main: [[edge("Deliver shared")]] },
  "Audio notice": { main: [[edge("Acknowledge audio notice")], [edge("Acknowledge ignored or rejected")]] },
  "Acknowledge audio notice": { main: [[edge("One-shot audio notice")]] },
  "One-shot audio notice": { main: [[edge("Inspect audio notice")]] },
}, 165);

for (const [filename, contents] of [["shared-delivery.json", delivery], ["outbox-dispatcher.json", dispatcher], ["inbox-recovery.json", recovery], ["gateway.json", gateway]]) {
  writeFileSync(fileURLToPath(new URL(filename, import.meta.url)), `${JSON.stringify(contents, null, 2)}\n`);
}
