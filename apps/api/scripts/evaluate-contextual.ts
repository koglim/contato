import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import process from "node:process";
import console from "node:console";
import { z } from "zod";
import { CONTEXTUAL_VERSION, controlContextualProposal, emptyMemory, normalizeContextualText, validateContextualQuestion, type ContextualInput, type ContextualDecision, type ContextualProvider } from "../src/modules/contextual-conversation/contextual.contract.js";
import { OpenAIContextualProvider, CONTEXTUAL_INSTRUCTIONS, CONTEXTUAL_COMPOSITION_INSTRUCTIONS, type ContextualUsage } from "../src/modules/contextual-conversation/contextual.provider.js";
import { contextualQuestionContext, contextualClarificationText, contextualCatalogText, CONTEXTUAL_COST_POLICY, CONTEXTUAL_SCOPE, CONTEXTUAL_CLARIFY, CONTEXTUAL_FALLBACK } from "../src/modules/contextual-conversation/contextual.reply.js";

const step = z.object({ message: z.string(), oracle: z.unknown(), explicit_service: z.string().nullable() });
const caseSchema = z.object({ id: z.string(), category: z.string(), source: z.literal("synthetic-authored"), transcript: z.array(z.string()),
  initial: z.string(), message: z.string(), oracle: z.unknown(), explicit_service: z.string().nullable(), expected: z.string(), failure: z.string().nullable(), setup: z.array(step),
  expected_slots: z.object({ service: z.string().nullable(), location: z.string().nullable(), hypotheses: z.array(z.string()) }),
  composition: z.enum(["valid", "invalid", "unavailable"]).optional(), expected_target: z.enum(["service", "location", "service_confirmation"]).nullable().optional() });
const schema = z.object({ version: z.literal("b2-eval-1"), split: z.enum(["development", "heldout"]), cases: z.array(caseSchema) });
const args = process.argv.slice(2);
const output = args.find(arg => arg.startsWith("--report="))?.slice(9);
if (output && (isAbsolute(output) || relative(process.cwd(), resolve(output)).startsWith(".."))) throw new Error("Report must be inside the current workspace");
if (output && existsSync(resolve(output))) throw new Error("Evaluation report already exists; choose a new path before making any call");
const suite = args.find(arg => arg.startsWith("--suite="))?.slice(8) ?? "frozen";
if (!["frozen", "readiness", "regression"].includes(suite)) throw new Error("Unknown evaluation suite");
const real = args.includes("--real");
const selected = args.find(arg => arg.startsWith("--split="))?.slice(8) ?? "development";
if (!["development", "heldout", "all"].includes(selected)) throw new Error("Unknown evaluation split");
const offset = Number(args.find(arg => arg.startsWith("--offset="))?.slice(9) ?? 0);
const limit = Number(args.find(arg => arg.startsWith("--limit="))?.slice(8) ?? 300);
if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error("Invalid case window");
if (selected === "all" && offset) throw new Error("Select one split when resuming at an offset");
const model = args.find(arg => arg.startsWith("--model="))?.slice(8);
const maxCalls = Number(args.find(arg => arg.startsWith("--max-calls="))?.slice(12));
if (real && (!args.includes("--authorize-paid-evaluation") || !model || !process.env.OPENAI_API_KEY || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 1000)) {
  throw new Error("Real evaluation requires authorization, model, OPENAI_API_KEY and --max-calls=1..1000; no request was made");
}
// No DB, search, selection, WhatsApp, or environment-default model invocation in this evaluator.
const usage: ContextualUsage[] = [];
const provider: ContextualProvider | null = real ? new OpenAIContextualProvider(model!, process.env.OPENAI_API_KEY!, { observeUsage: row => { usage.push(row); } }) : null;
const sources = ["development", "heldout"].map(split => {
  const bytes = readFileSync(new URL(`../evaluations/b2/${split}.json`, import.meta.url), "utf8");
  return { digest: createHash("sha256").update(bytes).digest("hex"), ...schema.parse(JSON.parse(bytes)) };
});
assert.equal(sources[0].cases.length, 210); assert.equal(sources[1].cases.length, 90);
assert.equal(new Set(sources.flatMap(s => s.cases.map(c => c.id))).size, 300);
assert.equal(new Set(sources.flatMap(s => s.cases.map(c => c.message))).size, 300);
const frozenCatalog = [{ key: "encanador", name: "Encanador", description: "Serviços hidráulicos e vazamentos" },
  { key: "eletricista", name: "Eletricista", description: "Instalações elétricas" },
  { key: "pedreiro", name: "Pedreiro", description: "Alvenaria" }];
const readinessBytes = readFileSync(new URL("../evaluations/b2/readiness.json", import.meta.url), "utf8");
const readiness = z.object({ version: z.literal("b2-readiness-1"), catalog: z.array(z.object({ key: z.string(), name: z.string(), description: z.string().nullable() })), cases: z.array(caseSchema) }).parse(JSON.parse(readinessBytes));
const regressionBytes = readFileSync(new URL("../evaluations/b2/regression-v1.json", import.meta.url), "utf8");
const regression = z.object({ version: z.literal("b2-regression-1"), catalog: z.array(z.object({ key: z.string(), name: z.string(), description: z.string().nullable() })), cases: z.array(caseSchema) }).parse(JSON.parse(regressionBytes));
const catalog = suite === "frozen" ? frozenCatalog : suite === "readiness" ? readiness.catalog : regression.catalog;
const selectedSources = suite === "frozen" ? sources.filter(s => selected === "all" || s.split === selected)
  : suite === "readiness"
    ? [{ split: "development-readiness", version: readiness.version, digest: createHash("sha256").update(readinessBytes).digest("hex"), cases: readiness.cases }]
    : [{ split: "regression", version: regression.version, digest: createHash("sha256").update(regressionBytes).digest("hex"), cases: regression.cases }];
const rows = [];
let totalCalls = 0;
const deadline = Date.now() + 15 * 60_000;
for (const source of selectedSources) {
  for (const sample of source.cases.slice(offset, offset + limit)) {
    let memory = emptyMemory();
    let calls = 0;
    const started = Date.now();
    const traces: Record<string, unknown>[] = [];
    const reserve = () => {
      if (!provider) return;
      if (totalCalls >= maxCalls || Date.now() >= deadline) throw new Error("evaluation_budget_exhausted");
      totalCalls++;
      calls++;
    };
    const executeTurn = async (message: string, oracle: unknown, failure: string | null, composition: string | undefined, explicitService: string | null) => {
      const input: ContextualInput = { message, service: memory.service?.value ?? null, location: memory.location?.value ?? null,
        pending: memory.service ? memory.location ? "selection" : "location" : "service", hypotheses: memory.hypotheses.map(h => h.name), catalog };
      const trace: Record<string, unknown> = { input, interpretation: null, controller: null, composition_context: null, composition_output: null,
        composition_status: "not_needed", final_response: null, domain_execution: "not_executed", human_review: { clarity: null, naturalness: null, factual_fidelity: null, unsafe_action: null, notes: null } };
      traces.push(trace);
      try {
        if (failure === "unavailable") throw new Error("injected_provider_unavailable");
        if (provider && failure !== "invalid_output") reserve();
        const proposal = provider && failure !== "invalid_output" ? await provider.interpret(input) : oracle;
        trace.interpretation = proposal;
        const names = catalog.filter(item => (` ${normalizeContextualText(message)} `).includes(` ${normalizeContextualText(item.name)} `));
        const decision = controlContextualProposal(message, randomUUID(), proposal, memory, catalog, explicitService ?? (names.length === 1 ? names[0].name : null));
        trace.controller = decision;
        // Domain resolution is an explicit fixture in this harness, not geocoding or matching.
        const context = contextualQuestionContext(decision, !!decision.memory.service, !!decision.memory.location);
        trace.composition_context = context;
        let reply: string | null = null;
        if (context) {
          try {
            if (composition === "unavailable") throw new Error("injected_composition_unavailable");
            if (provider && composition !== "invalid") reserve();
            const output = composition === "invalid" ? { target: context.target, question: "Já enviei seu contato, pode aguardar?" }
              : provider ? await provider.composeQuestion!(context)
              : { target: context.target, question: context.target === "location" ? "Em qual cidade precisa desse atendimento?"
                : context.target === "service" ? "Qual atendimento você precisa?" : `Você precisa de ${context.services.join(" ou ")}?` };
            trace.composition_output = output;
            reply = validateContextualQuestion(output, context); trace.composition_status = "validated";
          } catch (caught) {
            if (caught instanceof Error && caught.message === "evaluation_budget_exhausted") throw caught;
            trace.composition_status = "fallback"; reply = contextualClarificationText(context);
          }
        } else {
          reply = deterministicReply(decision);
        }
        trace.final_response = reply;
        trace.response_boundary = reply === null ? "requires_real_domain_result_in_inbox" : "shared_runtime_presenter";
        memory = decision.memory;
        return decision.kind;
      } catch (caught) {
        trace.final_response = CONTEXTUAL_FALLBACK;
        trace.error = caught instanceof Error && caught.message === "evaluation_budget_exhausted" ? "evaluation_budget_exhausted" : "provider_or_contract_failure";
        throw caught;
      }
    };
    let actual = "fallback", error: string | null = null;
    try {
      for (const setup of sample.setup) {
        await executeTurn(setup.message, setup.oracle, null, undefined, setup.explicit_service);
      }
      actual = await executeTurn(sample.message, sample.oracle, sample.failure, sample.composition, sample.explicit_service);
    } catch (caught) {
      error = caught instanceof Error && caught.message === "evaluation_budget_exhausted" ? "evaluation_budget_exhausted" : "provider_or_contract_failure";
      if (error === "evaluation_budget_exhausted") actual = "not_evaluated";
    }
    const slots = { service: memory.service?.value ?? null, location: memory.location?.value ?? null, hypotheses: memory.hypotheses.map(h => h.name) };
    const slotsPassed = JSON.stringify(slots) === JSON.stringify(sample.expected_slots);
    const last = traces.at(-1);
    const targetPassed = sample.expected_target === undefined || ((last?.composition_context as { target?: string } | null)?.target ?? null) === sample.expected_target;
    const compositionPassed = !sample.composition || (last?.composition_status === (sample.composition === "valid" ? "validated" : "fallback"));
    rows.push({ id: sample.id, category: sample.category, split: source.split, passed: actual === sample.expected && slotsPassed && targetPassed && compositionPassed, slots_passed: slotsPassed,
      target_passed: targetPassed, composition_passed: compositionPassed, injected_failure: sample.failure, injected_composition_failure: sample.composition === "valid" ? null : sample.composition ?? null, expected: sample.expected,
      actual, error, calls, duration_ms: Date.now() - started, confirmed_service: memory.service?.value ?? null, confirmed_location: memory.location?.value ?? null, turns: traces });
  }
}
const report = {
  mode: real ? "real-model-interpretation-and-composition-with-domain-fixtures" : "mocked-interpretation-and-composition", model: model ?? null,
  version: CONTEXTUAL_VERSION, suite, prompt_sha256: createHash("sha256").update(CONTEXTUAL_INSTRUCTIONS + CONTEXTUAL_COMPOSITION_INSTRUCTIONS).digest("hex"),
  selection: { split: selected, offset, limit },
  catalog_sha256: createHash("sha256").update(JSON.stringify(catalog)).digest("hex"),
  corpus: selectedSources.map(s => ({ version: s.version, split: s.split, sha256: s.digest, cases: s.cases.length })), cases: rows.length,
  passed: rows.filter(r => r.passed).length, failed: rows.filter(r => !r.passed && r.actual !== "not_evaluated").length,
  not_evaluated: rows.filter(r => r.actual === "not_evaluated").length,
  categories: Object.fromEntries([...new Set(rows.map(r => r.category))].map(category => {
    const subset = rows.filter(r => r.category === category);
    return [category, { cases: subset.length, passed: subset.filter(r => r.passed).length }];
  })),
  latency_ms: { p50: rows.map(r => r.duration_ms).sort((a, b) => a - b)[Math.floor(rows.length * .5)], p95: rows.map(r => r.duration_ms).sort((a, b) => a - b)[Math.floor(rows.length * .95)] },
  model_calls: rows.reduce((sum, row) => sum + row.calls, 0),
  usage, tokens: { input: usage.reduce((n, u) => n + u.input_tokens, 0), output: usage.reduce((n, u) => n + u.output_tokens, 0) },
  composition: { validated: rows.flatMap(r => r.turns).filter(t => t.composition_status === "validated").length, fallback: rows.flatMap(r => r.turns).filter(t => t.composition_status === "fallback").length },
  human_naturalness: "not_reviewed", monetary_cost: "not_measured", production_effects: "not_executed",
  limitations: ["Synthetic labeled cases, not a representative user study", "Matching/selection require separate real PostgreSQL Inbox journeys; final response is null at that boundary, never fabricated", "Mocked agreement is not model accuracy", "Real runner never passes oracle/labels/transcript to model", "Question semantic fidelity and naturalness require human review even after validation", "Failures intentionally injected are not observed model failures", "Provider errors may be billable even when no usage is returned"],
  results: rows,
};
if (output) writeFileSync(resolve(output), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(args.includes("--summary") ? { ...report, results: undefined, usage: undefined } : report, null, 2));
if (report.failed) process.exitCode = 1;
else if (report.not_evaluated) process.exitCode = 2;

function deterministicReply(decision: ContextualDecision): string | null {
  if (decision.kind === "faq_cost") return CONTEXTUAL_COST_POLICY;
  if (decision.kind === "out_of_scope") return CONTEXTUAL_SCOPE;
  if (decision.kind === "catalog_info") return contextualCatalogText(decision.catalogServices ?? []);
  if (decision.kind === "clarify") return CONTEXTUAL_CLARIFY;
  // Never invent a completed search, selection or contact in an evaluation with no database.
  return null;
}
