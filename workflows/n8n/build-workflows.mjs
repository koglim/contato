import { writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { claimDecision, transportDecision, confirmationDecision } from "./delivery-contract.mjs";

const node = (name, type, parameters, x, y = 0, extra = {}) => ({
  id: name.toLowerCase().replaceAll(" ", "-"), name, type: `n8n-nodes-base.${type}`,
  typeVersion: ({ code: 2, if: 2.2, httpRequest: 4.2, executeWorkflow: 1.2, executeWorkflowTrigger: 1.1, scheduleTrigger: 1.2 })[type],
  position: [x, y], parameters, ...extra,
});
const code = (name, jsCode, x, y = 0, mode = "runOnceForEachItem") => node(name, "code", { mode, jsCode }, x, y);
const branch = (name, expression, x, y = 0) => node(name, "if", { conditions: {
  options: { caseSensitive: true, typeValidation: "strict", version: 2 },
  conditions: [{ id: name, leftValue: expression, rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and",
}, options: {} }, x, y);
const http = (name, url, body, credential, x, y = 0, confirm = false) => node(name, "httpRequest", {
  method: "POST", url, authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth",
  ...(body ? { sendBody: true, specifyBody: "json", jsonBody: body } : {}),
  options: { timeout: confirm ? 5000 : 15000, redirect: { redirect: { followRedirects: false } },
    response: { response: { fullResponse: true, neverError: !confirm, responseFormat: "json" } } },
}, x, y, { credentials: { httpHeaderAuth: { name: credential } },
  onError: "continueRegularOutput", retryOnFail: confirm, ...(confirm ? { maxTries: 3, waitBetweenTries: 1000 } : {}) });
const edge = (name) => ({ node: name, type: "main", index: 0 });
const flow = (name, nodes, connections, timeout) => ({ name, active: false, nodes, connections,
  settings: { executionOrder: "v1", executionTimeout: timeout, saveDataSuccessExecution: "none",
    saveDataErrorExecution: "all", saveManualExecutions: false }, pinData: {}, tags: [] });

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
  code("Check hold", "const expected = $('Check confirmation').item.json.id;\nif ($json.statusCode !== 200 || $json.body?.id !== expected || $json.body?.delivery_status !== 'reconciliation_required') throw new Error('outbox_reconciliation_required');\nreturn { json: { action: 'complete', id: expected, status: 'processing', needs_reconciliation: true } };", 1980),
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
      options: { timeout: 70000, redirect: { redirect: { followRedirects: false } }, response: { response: { fullResponse: true, neverError: true, responseFormat: "json" } } } } },
  code("Continue recovery", "if ($json.statusCode === 204) return [];\nif ($json.statusCode !== 200 || !['processed','retry_scheduled','quarantined','processing'].includes($json.body?.status)) throw new Error('inbox_recovery_failed');\nconst budget = $('Budget').item.json;\nreturn [{ json: { started_at: budget.started_at, count: budget.count + 1 } }];", 660, 0, "runOnceForAllItems"),
], { Schedule: { main: [[edge("Budget")]] }, Budget: { main: [[edge("Process next")]] },
  "Process next": { main: [[edge("Continue recovery")]] }, "Continue recovery": { main: [[edge("Budget")]] } }, 120);

for (const [filename, contents] of [["shared-delivery.json", delivery], ["outbox-dispatcher.json", dispatcher], ["inbox-recovery.json", recovery]]) {
  writeFileSync(fileURLToPath(new URL(filename, import.meta.url)), `${JSON.stringify(contents, null, 2)}\n`);
}
