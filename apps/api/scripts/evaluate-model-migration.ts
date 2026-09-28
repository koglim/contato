import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI, { APIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { runCheckpointed, type CheckpointRow } from "./model-migration-checkpoint.js";
import { DEFAULT_OPENAI_CONVERSATION_TIMEOUT_MS } from "../src/config/contextual-conversation.js";
import {
  controlContextualProposal, contextualInterpretationSchema, emptyMemory, normalizeContextualText,
  type ContextualCatalogItem, type ContextualInput, type ContextualMemory, type ContextualProposal,
} from "../src/modules/contextual-conversation/contextual.contract.js";
import { CONTEXTUAL_INSTRUCTIONS, extractStructuredOutput } from "../src/modules/contextual-conversation/contextual.provider.js";

const BENCHMARK_ID = "00000000-0000-4000-8000-000000000001";
const MAX_OUTPUT_TOKENS = 4096; // Evaluation-only: the production controller remains at 900.
const SOURCE_NAMES = ["development", "heldout", "readiness", "regression-v1", "latency-v1"] as const;
type SourceName = typeof SOURCE_NAMES[number];
const VARIANTS = [
  { name: "baseline", model: "gpt-5-mini-2025-08-07", effort: null },
  { name: "terra_medium", model: "gpt-5.6-terra", effort: "medium" },
  { name: "terra_low", model: "gpt-5.6-terra", effort: "low" },
  { name: "terra_none", model: "gpt-5.6-terra", effort: "none" },
] as const;
const FROZEN_CATALOG: ContextualCatalogItem[] = [
  { key: "encanador", name: "Encanador", description: "Serviços hidráulicos e vazamentos" },
  { key: "eletricista", name: "Eletricista", description: "Instalações elétricas" },
  { key: "pedreiro", name: "Pedreiro", description: "Alvenaria" },
];
const PRICES_PER_MILLION = {
  baseline: { input: 0.25, cached_input: 0.025, output: 2 },
  terra_medium: { input: 2, cached_input: 0.20, output: 12 },
  terra_low: { input: 2, cached_input: 0.20, output: 12 },
  terra_none: { input: 2, cached_input: 0.20, output: 12 },
} as const;
type Slots = { service: string | null; location: string | null; hypotheses: string[] };
type SourceCase = {
  id: string; category: string; message: string; oracle?: unknown; explicit_service?: string | null;
  expected?: string; expected_slots?: Slots; failure?: string | null;
  setup?: { message: string; oracle: unknown; explicit_service: string | null }[];
};
type SourceFile = { cases: SourceCase[]; catalog?: ContextualCatalogItem[] };
type CorpusRef = {
  source: SourceName | "authored"; id: string; category?: string; message?: string;
  setup?: SourceCase["setup"]; oracle?: unknown; expected?: string; expected_slots?: Slots;
};
type Corpus = { version: string; source_sha256: Record<SourceName, string>; cases: CorpusRef[] };
export type Sample = {
  id: string; category: string; source: SourceName | "authored"; input: ContextualInput; memory: ContextualMemory;
  catalog: ContextualCatalogItem[]; explicitService: string | null; oracle: ContextualProposal;
  expected: { intent: string; speech_act: string; service_keys: string[]; location: string | null;
    decision: string; slots: Slots };
};
type Row = CheckpointRow;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const corpusBytes = readFileSync(new URL("../evaluations/b2/model-migration-v1.json", import.meta.url));
const corpus = JSON.parse(corpusBytes.toString("utf8")) as Corpus;

function normalizeOracle(value: unknown, category = ""): ContextualProposal {
  assert.ok(value && typeof value === "object", "fixture oracle is required");
  const raw = value as Record<string, unknown>;
  const legacySpeechAct = category === "negation" ? "negated"
    : category === "hypothesis" ? "hypothetical"
      : category === "injection" || category === "ambiguity" ? "unclear" : "request";
  return contextualInterpretationSchema.parse({
    target_candidates: null, inquiry_type: null,
    speech_act: legacySpeechAct, natural_reply: null, confidence: raw.uncertain ? "low" : "high", ...raw,
  });
}
function explicitService(message: string, catalog: ContextualCatalogItem[], configured: string | null): string | null {
  if (configured) return configured;
  const names = catalog.filter(item =>
    (` ${normalizeContextualText(message)} `).includes(` ${normalizeContextualText(item.name)} `));
  return names.length === 1 ? names[0]!.name : null;
}
function slots(memory: ContextualMemory): Slots {
  return { service: memory.service?.value ?? null, location: memory.location?.value ?? null,
    hypotheses: memory.hypotheses.map(item => item.name) };
}
function inputFor(message: string, memory: ContextualMemory, catalog: ContextualCatalogItem[]): ContextualInput {
  const current = slots(memory);
  return { message, service: current.service, location: current.location,
    pending: current.service ? current.location ? "selection" : "location" : "service",
    hypotheses: current.hypotheses, catalog };
}
function compile(): Sample[] {
  assert.equal(corpus.version, "model-migration-v1");
  assert.equal(corpus.cases.length, 40);
  assert.equal(new Set(corpus.cases.map(item => `${item.source}:${item.id}`)).size, corpus.cases.length);
  const sources = Object.fromEntries(SOURCE_NAMES.map(name => {
    const bytes = readFileSync(new URL(`../evaluations/b2/${name}.json`, import.meta.url));
    // Git may check out legacy fixtures as CRLF on Windows and LF on CI/Linux.
    assert.equal(digest(bytes.toString("utf8").replace(/\r\n/gu, "\n")),
      corpus.source_sha256[name], `source changed: ${name}`);
    return [name, JSON.parse(bytes.toString("utf8")) as SourceFile];
  })) as Record<SourceName, SourceFile>;
  return corpus.cases.map(ref => {
    const source = ref.source === "authored" ? null : sources[ref.source];
    const fixture: SourceCase | undefined = ref.source === "authored"
      ? { id: ref.id, category: ref.category ?? "authored", message: ref.message ?? "",
        setup: ref.setup, oracle: ref.oracle, expected: ref.expected, expected_slots: ref.expected_slots }
      : source?.cases.find(item => item.id === ref.id);
    assert.ok(fixture, `missing source case: ${ref.source}/${ref.id}`);
    assert.ok(fixture.message, `missing message: ${ref.id}`);
    assert.equal(fixture.failure ?? null, null, `injected failure cannot be benchmarked: ${ref.id}`);
    const catalog = source?.catalog ?? ((ref.source === "latency-v1" || ref.source === "authored")
      ? sources["regression-v1"].catalog! : FROZEN_CATALOG);
    let memory = emptyMemory();
    for (const setup of fixture.setup ?? []) {
      const proposal = normalizeOracle(setup.oracle);
      memory = controlContextualProposal(setup.message, BENCHMARK_ID, proposal, memory, catalog,
        explicitService(setup.message, catalog, setup.explicit_service)).memory;
    }
    const oracle = normalizeOracle(ref.oracle ?? fixture.oracle, ref.category ?? fixture.category);
    const expectedSlots = ref.expected_slots ?? fixture.expected_slots;
    const expectedDecision = ref.expected ?? fixture.expected;
    assert.ok(expectedSlots && expectedDecision, `missing expected result: ${ref.id}`);
    const configuredService = fixture.explicit_service ?? null;
    const service = explicitService(fixture.message, catalog, configuredService);
    const decision = controlContextualProposal(fixture.message, BENCHMARK_ID, oracle,
      structuredClone(memory), catalog, service);
    assert.equal(decision.kind, expectedDecision, `oracle decision: ${ref.id}`);
    assert.deepEqual(slots(decision.memory), expectedSlots, `oracle slots: ${ref.id}`);
    return { id: ref.id, category: ref.category ?? fixture.category, source: ref.source,
      input: inputFor(fixture.message, memory, catalog), memory, catalog, explicitService: service, oracle,
      expected: { intent: oracle.intent, speech_act: oracle.speech_act!, service_keys: oracle.services.map(item => item.key),
        location: oracle.location?.text ?? null, decision: expectedDecision, slots: expectedSlots } };
  });
}
const samples = compile();
export const modelMigrationSamples = samples;
const executionPlan = samples.flatMap((sample, caseIndex) => {
  const offset = caseIndex % VARIANTS.length;
  const order = caseIndex % 8 < 4 ? [...VARIANTS] : [...VARIANTS].reverse();
  return [...order.slice(offset), ...order.slice(0, offset)].map((variant, variantIndex) =>
    ({ sample, variant, execution_order: caseIndex * VARIANTS.length + variantIndex + 1 }));
});
assert.equal(executionPlan.length, 160);
const checkpointPlan = executionPlan.map(({ sample, variant, execution_order }) => ({
  case_id: sample.id, category: sample.category, variant: variant.name, model: variant.model,
  reasoning_effort: variant.effort ?? "runtime_default", execution_order,
  expected_decision: sample.expected.decision, expected_service: sample.expected.slots.service,
  expected_location: sample.expected.slots.location, expected_hypotheses: sample.expected.slots.hypotheses,
}));
const corpusHash = digest(corpusBytes.toString("utf8").replace(/\r\n/gu, "\n"));
const promptHash = digest(CONTEXTUAL_INSTRUCTIONS);
const checkpointMetadata = {
  version: "model-migration-v1-checkpoint" as const,
  corpus_sha256: corpusHash, prompt_sha256: promptHash,
  schedule_sha256: digest(JSON.stringify(checkpointPlan)),
  max_output_tokens: MAX_OUTPUT_TOKENS, calls_planned: executionPlan.length,
  variants: VARIANTS.map(item => ({ name: item.name, model: item.model,
    reasoning_effort: item.effort ?? "runtime_default" })),
};
const checkpointPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../..",
  ".eval-results", `model-migration-v1-${corpusHash}-${promptHash}.jsonl`);
// Importing this plan is offline: the OpenAI client is created only by the paid CLI branch below.
export const modelMigrationAnalysisContext = { checkpointPath, checkpointMetadata, checkpointPlan,
  runtimeCases: samples.map(sample => ({ case_id: sample.id, message: sample.input.message,
    pendingSlot: sample.input.pending })) };
for (const variant of VARIANTS) {
  assert.equal(executionPlan.filter(step => step.variant.name === variant.name).length, samples.length);
  for (let position = 0; position < VARIANTS.length; position++) {
    assert.equal(executionPlan.filter(step => step.variant.name === variant.name
      && (step.execution_order - 1) % VARIANTS.length === position).length, 10);
  }
}
export function assess(sample: Sample, proposal: ContextualProposal) {
  const decision = controlContextualProposal(sample.input.message, BENCHMARK_ID, proposal,
    structuredClone(sample.memory), sample.catalog, sample.explicitService);
  const actual = slots(decision.memory);
  const expected = sample.expected;
  const diagnostics = {
    intent_match: proposal.intent === expected.intent,
    speech_act_match: proposal.speech_act === expected.speech_act,
    service_keys_match: JSON.stringify([...proposal.services.map(item => item.key)].sort())
      === JSON.stringify([...expected.service_keys].sort()),
    proposal_location_match: normalizeContextualText(proposal.location?.text ?? "")
      === normalizeContextualText(expected.location ?? ""),
    decision_match: decision.kind === expected.decision,
    slots_match: JSON.stringify(actual) === JSON.stringify(expected.slots),
  };
  // Preserve the original strict semantic metric exactly; these booleans only diagnose future rows.
  const semantic = Object.values(diagnostics).every(Boolean);
  return { decision: decision.kind, slots: actual, semantic, diagnostics };
}
export function estimateCost(variant: typeof VARIANTS[number]["name"], inputTokens: number, cachedTokens: number, outputTokens: number) {
  const price = PRICES_PER_MILLION[variant];
  return ((inputTokens - cachedTokens) * price.input + cachedTokens * price.cached_input
    + outputTokens * price.output) / 1_000_000;
}
function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}
function selfCheck() {
  const categories = Object.fromEntries([...new Set(samples.map(item => item.category))]
    .map(category => [category, samples.filter(item => item.category === category).length]));
  return { mode: "fixture_validation_only", cases: samples.length, variants: VARIANTS.map(item =>
    ({ name: item.name, model: item.model, reasoning_effort: item.effort ?? "runtime_default" })),
    max_output_tokens: MAX_OUTPUT_TOKENS, calls_planned: executionPlan.length, model_calls: 0,
    categories, source_sha256: corpus.source_sha256,
    corpus_sha256: corpusHash, prompt_sha256: promptHash,
    schedule: executionPlan.map(step => ({ case_id: step.sample.id, variant: step.variant.name,
      execution_order: step.execution_order })) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--self-check") {
  console.log(JSON.stringify(selfCheck(), null, 2));
} else {
  // A separate, explicit authorization is required after PR review. No network client exists before this gate.
  const allowed = new Set(["--authorize-paid-evaluation", "--max-calls=160", "--resume"]);
  if (args.length !== new Set(args).size || args.some(arg => !allowed.has(arg))
    || !args.includes("--authorize-paid-evaluation") || !args.includes("--max-calls=160")
    || !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("Paid evaluation needs separate authorization, OPENAI_API_KEY and --max-calls=160; no request was made");
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY,
    timeout: DEFAULT_OPENAI_CONVERSATION_TIMEOUT_MS, maxRetries: 0 });
  const invoke = async (executionOrder: number): Promise<Row> => {
    const { sample, variant, execution_order } = executionPlan[executionOrder - 1]!;
    const started = Date.now();
    let row: Row = { case_id: sample.id, category: sample.category, variant: variant.name, model: variant.model,
      reasoning_effort: variant.effort ?? "runtime_default", execution_order,
      structural_valid: false, semantic_agreement: false, expected_decision: sample.expected.decision,
      actual_decision: null, expected_service: sample.expected.slots.service, actual_service: null,
      expected_location: sample.expected.slots.location, actual_location: null,
      expected_hypotheses: sample.expected.slots.hypotheses, actual_hypotheses: [],
      duration_ms: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0,
      reasoning_tokens: 0, total_tokens: 0, response_status: null, incomplete_reason: null,
      http_status: null, estimated_cost_usd: 0 };
    try {
      const { data, response: httpResponse } = await client.responses.create({
        model: variant.model, store: false, max_output_tokens: MAX_OUTPUT_TOKENS,
        ...(variant.effort ? { reasoning: { effort: variant.effort } } : {}),
        instructions: CONTEXTUAL_INSTRUCTIONS,
        input: [{ role: "user", content: JSON.stringify(sample.input) }],
        text: { format: zodTextFormat(contextualInterpretationSchema, "contextual_interpretation") },
      }).withResponse();
      row = { ...row, input_tokens: data.usage?.input_tokens ?? 0,
        cached_input_tokens: data.usage?.input_tokens_details?.cached_tokens ?? 0,
        output_tokens: data.usage?.output_tokens ?? 0,
        reasoning_tokens: data.usage?.output_tokens_details?.reasoning_tokens ?? 0,
        total_tokens: data.usage?.total_tokens ?? 0, response_status: data.status ?? null,
        incomplete_reason: data.incomplete_details?.reason ?? null, http_status: httpResponse.status };
      try {
        const proposal = extractStructuredOutput(data, contextualInterpretationSchema);
        row.structural_valid = true;
        const result = assess(sample, proposal);
        row.semantic_agreement = result.semantic;
        row.actual_decision = result.decision;
        row.actual_service = result.slots.service;
        row.actual_location = result.slots.location;
        row.actual_hypotheses = result.slots.hypotheses;
        Object.assign(row, result.diagnostics);
      } catch { /* Never log model output, request, prompt or provider error body. */ }
    } catch (error) {
      row.response_status = "request_error";
      row.http_status = error instanceof APIError ? error.status : null;
    }
    row.duration_ms = Date.now() - started;
    row.estimated_cost_usd = estimateCost(variant.name, row.input_tokens, row.cached_input_tokens, row.output_tokens);
    return row;
  };
  const result = await runCheckpointed({
    path: checkpointPath, metadata: checkpointMetadata, plan: checkpointPlan,
    resume: args.includes("--resume"), invoke: step => invoke(step.execution_order),
    progress: line => { process.stderr.write(line + "\n"); },
  });
  const { rows } = result;
  const summary = VARIANTS.map(variant => {
    const subset = rows.filter(row => row.variant === variant.name);
    const estimatedCost = subset.reduce((sum, row) => sum + row.estimated_cost_usd, 0);
    const success = subset.filter(row => row.semantic_agreement).length;
    return { variant: variant.name, model: variant.model, reasoning_effort: variant.effort ?? "runtime_default",
      calls: subset.length, structural_valid: subset.filter(row => row.structural_valid).length,
      semantic_agreement: success, duration_ms_median: median(subset.map(row => row.duration_ms)),
      duration_ms_min: Math.min(...subset.map(row => row.duration_ms)),
      duration_ms_max: Math.max(...subset.map(row => row.duration_ms)),
      input_tokens: subset.reduce((sum, row) => sum + row.input_tokens, 0),
      cached_input_tokens: subset.reduce((sum, row) => sum + row.cached_input_tokens, 0),
      output_tokens: subset.reduce((sum, row) => sum + row.output_tokens, 0),
      reasoning_tokens: subset.reduce((sum, row) => sum + row.reasoning_tokens, 0),
      total_tokens: subset.reduce((sum, row) => sum + row.total_tokens, 0),
      incomplete_count: subset.filter(row => row.response_status === "incomplete").length,
      request_error_count: subset.filter(row => row.response_status === "request_error").length,
      estimated_cost_usd: estimatedCost,
      estimated_cost_per_semantic_success_usd: success ? estimatedCost / success : null };
  });
  console.log(JSON.stringify({ mode: "controlled_paid_model_migration_only", cases: samples.length,
    calls: rows.length, calls_planned: executionPlan.length, calls_completed: rows.length,
    resumed_calls: result.resumed_calls, new_model_calls: result.new_model_calls,
    max_output_tokens: MAX_OUTPUT_TOKENS, corpus_sha256: corpusHash,
    prompt_sha256: promptHash, production_effects: "none",
    cost_note: "Approximation at documented standard token rates; cache writes and unknown usage are not priced",
    summary, rows }, null, 2));
}
}
