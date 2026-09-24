import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import OpenAI, { APIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { DEFAULT_OPENAI_CONVERSATION_TIMEOUT_MS } from "../src/config/contextual-conversation.js";
import { controlContextualProposal, contextualInterpretationSchema, emptyMemory,
  type ContextualCatalogItem, type ContextualInput, type ContextualMemory, type ContextualProposal } from "../src/modules/contextual-conversation/contextual.contract.js";
import { CONTEXTUAL_INSTRUCTIONS, extractStructuredOutput } from "../src/modules/contextual-conversation/contextual.provider.js";
import { CONTEXTUAL_POLICY } from "../src/modules/contextual-conversation/contextual.contract.js";

const MODEL = "gpt-5-mini-2025-08-07";
const MAX_CALLS = 15;
const BENCHMARK_ID = "00000000-0000-4000-8000-000000000001";
const catalog: ContextualCatalogItem[] = [
  { key: "eletricista", name: "Eletricista", description: "Instalações elétricas" },
  { key: "encanador", name: "Encanador", description: "Serviços hidráulicos" },
];
const firstTurn = emptyMemory();
const correctionMemory: ContextualMemory = {
  ...emptyMemory(),
  service: { value: "Encanador", source: "user_explicit", inboundId: BENCHMARK_ID },
  location: { value: "Sinop", source: "user_explicit", inboundId: BENCHMARK_ID },
};
type Expected = { intent: ContextualProposal["intent"]; speechAct: NonNullable<ContextualProposal["speech_act"]>;
  serviceKeys: string[]; location: string | null; decision: string; service: string | null;
  decidedLocation: string | null; hypotheses: string[] };
type BenchmarkCase = { id: string; sourceCase?: string; input: ContextualInput; memory: ContextualMemory;
  explicitService: string | null; oracle: ContextualProposal; expected: Expected };
type BenchmarkRow = { case_id: string; variant: string; execution_order: number; valid: boolean; semantic_agreement: boolean;
  duration_ms: number; input_tokens: number; cached_input_tokens: number; output_tokens: number;
  reasoning_tokens: number; total_tokens: number; response_status: string | null;
  incomplete_reason: string | null; http_status: number | null };
const input = (message: string, memory: ContextualMemory): ContextualInput => ({
  message, service: memory.service?.value ?? null, location: memory.location?.value ?? null,
  pending: memory.service ? memory.location ? "selection" : "location" : null,
  hypotheses: memory.hypotheses.map(item => item.name), catalog,
});
const cases: BenchmarkCase[] = [
  {
    id: "typo", input: input("preciso de um eletricitta", firstTurn), memory: firstTurn, explicitService: null,
    oracle: { intent: "search", speech_act: "request", services: [{ key: "eletricista", evidence: "eletricitta" }],
      location: null, natural_reply: null, confidence: "medium", uncertain: false },
    expected: { intent: "search", speechAct: "request", serviceKeys: ["eletricista"], location: null,
      decision: "clarify", service: null, decidedLocation: null, hypotheses: ["Eletricista"] },
  },
  {
    id: "semantic", input: input("meu chuveiro queimou", firstTurn), memory: firstTurn, explicitService: null,
    oracle: { intent: "search", speech_act: "request", services: [{ key: "eletricista", evidence: "chuveiro queimou" }],
      location: null, natural_reply: null, confidence: "medium", uncertain: false },
    expected: { intent: "search", speechAct: "request", serviceKeys: ["eletricista"], location: null,
      decision: "clarify", service: null, decidedLocation: null, hypotheses: ["Eletricista"] },
  },
  {
    id: "informational", input: input("vocês trabalham com eletricista?", firstTurn), memory: firstTurn, explicitService: "Eletricista",
    oracle: { intent: "catalog_info", speech_act: "information", services: [{ key: "eletricista", evidence: "eletricista" }],
      location: null, natural_reply: null, confidence: "high", uncertain: false },
    expected: { intent: "catalog_info", speechAct: "information", serviceKeys: ["eletricista"], location: null,
      decision: "catalog_info", service: null, decidedLocation: null, hypotheses: [] },
  },
  {
    id: "negation", input: input("não preciso de eletricista", firstTurn), memory: firstTurn, explicitService: "Eletricista",
    oracle: { intent: "clarify", speech_act: "negated", services: [], location: null,
      natural_reply: null, confidence: "low", uncertain: true },
    expected: { intent: "clarify", speechAct: "negated", serviceKeys: [], location: null,
      decision: "clarify", service: null, decidedLocation: null, hypotheses: [] },
  },
  {
    id: "correction-context", sourceCase: "readiness-12", input: input("Na verdade é em Vera", correctionMemory),
    memory: correctionMemory, explicitService: null,
    oracle: { intent: "correct_location", speech_act: "request", services: [], location: { text: "Vera", evidence: "Vera" },
      natural_reply: null, confidence: "high", uncertain: false },
    expected: { intent: "correct_location", speechAct: "request", serviceKeys: [], location: "Vera",
      decision: "search", service: "Encanador", decidedLocation: "Vera", hypotheses: [] },
  },
];
const variants = [
  { name: "current", reasoning: undefined },
  { name: "minimal", reasoning: { effort: "minimal" as const } },
  { name: "low", reasoning: { effort: "low" as const } },
] as const;
type VariantName = (typeof variants)[number]["name"];
// Rotate the deterministic order by case to limit time/cache warm-up bias.
// This is still a five-observation screening, not a statistical benchmark.
const VARIANT_ORDER: readonly (readonly VariantName[])[] = [
  ["current", "minimal", "low"],
  ["minimal", "low", "current"],
  ["low", "current", "minimal"],
  ["current", "low", "minimal"],
  ["low", "minimal", "current"],
];
const executionPlan = cases.flatMap((sample, caseIndex) => VARIANT_ORDER[caseIndex]!.map((name, index) => ({
  sample, variant: variants.find(item => item.name === name)!, execution_order: caseIndex * variants.length + index + 1,
})));

function semanticAgreement(sample: BenchmarkCase, proposal: ContextualProposal): boolean {
  try {
    const decision = controlContextualProposal(sample.input.message, BENCHMARK_ID, proposal,
      structuredClone(sample.memory), catalog, sample.explicitService);
    const expected = sample.expected;
    return proposal.intent === expected.intent && proposal.speech_act === expected.speechAct
      && JSON.stringify(proposal.services.map(item => item.key)) === JSON.stringify(expected.serviceKeys)
      && (proposal.location?.text ?? null) === expected.location
      && decision.kind === expected.decision
      && (decision.memory.service?.value ?? null) === expected.service
      && (decision.memory.location?.value ?? null) === expected.decidedLocation
      && JSON.stringify(decision.memory.hypotheses.map(item => item.name)) === JSON.stringify(expected.hypotheses);
  } catch { return false; }
}

function validateFixtures(): void {
  assert.equal(cases.length, 5);
  assert.equal(new Set(cases.map(item => item.id)).size, cases.length);
  assert.equal(VARIANT_ORDER.length, cases.length);
  assert.equal(executionPlan.length, MAX_CALLS);
  for (const order of VARIANT_ORDER) assert.deepEqual([...order].sort(), variants.map(item => item.name).sort());
  for (const [index, step] of executionPlan.entries()) assert.equal(step.execution_order, index + 1);
  const readiness = JSON.parse(readFileSync(new URL("../evaluations/b2/readiness.json", import.meta.url), "utf8")) as
    { cases: Array<{ id: string; message: string }> };
  const correction = cases.find(item => item.id === "correction-context")!;
  assert.equal(readiness.cases.find(item => item.id === correction.sourceCase)?.message, correction.input.message);
  for (const sample of cases) {
    contextualInterpretationSchema.parse(sample.oracle);
    assert.equal(semanticAgreement(sample, sample.oracle), true, sample.id);
  }
}

const args = process.argv.slice(2);
validateFixtures();
if (args.includes("--self-check")) {
  console.log(JSON.stringify({ mode: "fixture_validation_only", cases: cases.length, passed: cases.length, model_calls: 0,
    schedule: executionPlan.map(step => ({ case_id: step.sample.id, variant: step.variant.name, execution_order: step.execution_order })) }));
} else {
  const model = args.find(arg => arg.startsWith("--model="))?.slice(8);
  const maxCalls = Number(args.find(arg => arg.startsWith("--max-calls="))?.slice(12));
  if (!args.includes("--authorize-paid-evaluation") || model !== MODEL || maxCalls !== MAX_CALLS || !process.env.OPENAI_API_KEY) {
    throw new Error("Controlled interpretation evaluation requires authorization, the pinned model, OPENAI_API_KEY and --max-calls=15; no request was made");
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY,
    timeout: DEFAULT_OPENAI_CONVERSATION_TIMEOUT_MS, maxRetries: 0 });
  const rows: BenchmarkRow[] = [];
  for (const { sample, variant, execution_order } of executionPlan) {
    const started = Date.now();
    try {
      const response = await client.responses.create({ model, store: false,
        max_output_tokens: CONTEXTUAL_POLICY.maxOutputTokens,
        ...(variant.reasoning ? { reasoning: variant.reasoning } : {}),
        instructions: CONTEXTUAL_INSTRUCTIONS,
        input: [{ role: "user", content: JSON.stringify(sample.input) }],
        text: { format: zodTextFormat(contextualInterpretationSchema, "contextual_interpretation") },
      });
      let valid = false;
      let semantic = false;
      try {
        const proposal = extractStructuredOutput(response, contextualInterpretationSchema);
        valid = true;
        semantic = semanticAgreement(sample, proposal);
      } catch { /* No model output or error body is retained. */ }
      rows.push({ case_id: sample.id, variant: variant.name, execution_order, valid, semantic_agreement: semantic,
        duration_ms: Date.now() - started, input_tokens: response.usage?.input_tokens ?? 0,
        cached_input_tokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
        reasoning_tokens: response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
        total_tokens: response.usage?.total_tokens ?? 0,
        response_status: response.status ?? null,
        incomplete_reason: response.incomplete_details?.reason ?? null,
        http_status: null as number | null });
    } catch (error) {
      rows.push({ case_id: sample.id, variant: variant.name, execution_order, valid: false, semantic_agreement: false,
        duration_ms: Date.now() - started, input_tokens: 0, cached_input_tokens: 0,
        output_tokens: 0, reasoning_tokens: 0, total_tokens: 0,
        response_status: "request_error", incomplete_reason: null,
        http_status: error instanceof APIError ? error.status : null });
    }
  }
  const byVariant = variants.map(variant => {
    const subset = rows.filter(row => row.variant === variant.name);
    const durations = subset.map(row => row.duration_ms).sort((a, b) => a - b);
    return { variant: variant.name, calls: subset.length, valid: subset.filter(row => row.valid).length,
      semantic_agreement: subset.filter(row => row.semantic_agreement).length,
      duration_ms_median: durations[Math.floor(durations.length / 2)],
      duration_ms_min: durations[0], duration_ms_max: durations.at(-1),
      input_tokens: subset.reduce((sum, row) => sum + row.input_tokens, 0),
      cached_input_tokens: subset.reduce((sum, row) => sum + row.cached_input_tokens, 0),
      output_tokens: subset.reduce((sum, row) => sum + row.output_tokens, 0),
      reasoning_tokens: subset.reduce((sum, row) => sum + row.reasoning_tokens, 0),
      total_tokens: subset.reduce((sum, row) => sum + row.total_tokens, 0) };
  });
  console.log(JSON.stringify({ mode: "controlled_paid_interpretation_only", model, calls: rows.length,
    max_output_tokens: CONTEXTUAL_POLICY.maxOutputTokens,
    prompt_sha256: createHash("sha256").update(CONTEXTUAL_INSTRUCTIONS).digest("hex"),
    corpus_sha256: createHash("sha256").update(JSON.stringify(cases)).digest("hex"),
    production_effects: "none", by_variant: byVariant, rows }, null, 2));
}
