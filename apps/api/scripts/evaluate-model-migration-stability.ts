import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI, { APIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { DEFAULT_OPENAI_CONVERSATION_TIMEOUT_MS } from "../src/config/contextual-conversation.js";
import { CONTEXTUAL_POLICY, contextualInterpretationSchema, normalizeContextualText } from "../src/modules/contextual-conversation/contextual.contract.js";
import { CONTEXTUAL_INSTRUCTIONS, extractStructuredOutput } from "../src/modules/contextual-conversation/contextual.provider.js";
import { agreement, effectiveRuntimeOutcome } from "./model-migration-analysis.js";
import { runCheckpointed, type CheckpointRow } from "./model-migration-checkpoint.js";
import { assess, modelMigrationAnalysisContext, modelMigrationSamples } from "./evaluate-model-migration.js";

const CASE_IDS = ["adaptive-02", "readiness-17"] as const;
const REPETITIONS = 10;
const MAX_OUTPUT_TOKENS = 900;
const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 0;
const VARIANTS = [
  { name: "terra_medium", model: "gpt-5.6-terra", effort: "medium" },
  { name: "terra_high", model: "gpt-5.6-terra", effort: "high" },
] as const;
assert.equal(MAX_OUTPUT_TOKENS, CONTEXTUAL_POLICY.maxOutputTokens);
assert.equal(TIMEOUT_MS, DEFAULT_OPENAI_CONVERSATION_TIMEOUT_MS);
const samples = CASE_IDS.map(id => {
  const sample = modelMigrationSamples.find(item => item.id === id);
  assert.ok(sample, `Missing frozen case: ${id}`);
  assert.ok(sample.expected.slots.hypotheses.length > 0, `No hypothesis oracle: ${id}`);
  return sample;
});
const runtimeById = new Map(modelMigrationAnalysisContext.runtimeCases.map(item => [item.case_id, item]));
const executionPlan = Array.from({ length: REPETITIONS }, (_, index) => index + 1)
  .flatMap(repetition => samples.flatMap((sample, caseIndex) => {
    const order = (repetition + caseIndex) % 2 === 0 ? VARIANTS : [...VARIANTS].reverse();
    return order.map(variant => ({ sample, variant, repetition }));
  })).map((step, index) => ({ ...step, execution_order: index + 1 }));
assert.equal(executionPlan.length, 40);
const checkpointPlan = executionPlan.map(({ sample, variant, repetition, execution_order }) => ({
  case_id: sample.id, category: sample.category, variant: variant.name, model: variant.model,
  reasoning_effort: variant.effort, repetition, execution_order,
  expected_decision: sample.expected.decision, expected_service: sample.expected.slots.service,
  expected_location: sample.expected.slots.location, expected_hypotheses: sample.expected.slots.hypotheses,
}));
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const { corpus_sha256, prompt_sha256 } = modelMigrationAnalysisContext.checkpointMetadata;
const metadata = {
  version: "model-migration-stability-v1-checkpoint" as const,
  corpus_sha256, prompt_sha256, schedule_sha256: digest(JSON.stringify(checkpointPlan)),
  max_output_tokens: MAX_OUTPUT_TOKENS, calls_planned: executionPlan.length,
  variants: VARIANTS.map(item => ({ name: item.name, model: item.model, reasoning_effort: item.effort })),
};
const checkpointPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../..", ".eval-results",
  `model-migration-stability-v1-${corpus_sha256}-${prompt_sha256}.jsonl`);
for (const sample of samples) for (const variant of VARIANTS) {
  const rows = executionPlan.filter(item => item.sample.id === sample.id && item.variant.name === variant.name);
  assert.equal(rows.length, REPETITIONS);
  assert.equal(rows.filter(item => item.execution_order % 2 === 1).length, REPETITIONS / 2);
}
export const stabilityPlan = { metadata, checkpointPlan, checkpointPath };

const hypothesisNames = (names: string[]) => names.map(normalizeContextualText).sort();
function hypothesisExact(row: CheckpointRow): boolean {
  return JSON.stringify(hypothesisNames(row.actual_hypotheses))
    === JSON.stringify(hypothesisNames(row.expected_hypotheses));
}
function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return (ordered[4]! + ordered[5]!) / 2;
}
export function summarizeStabilityRows(rows: CheckpointRow[]) {
  return samples.flatMap(sample => VARIANTS.map(variant => {
    const subset = rows.filter(row => row.case_id === sample.id && row.variant === variant.name);
    assert.equal(subset.length, REPETITIONS);
    const count = (predicate: (row: CheckpointRow) => boolean) => subset.filter(predicate).length;
    const total = (field: "input_tokens" | "cached_input_tokens" | "output_tokens" | "reasoning_tokens" | "total_tokens") =>
      subset.reduce((sum, row) => sum + row[field], 0);
    return { case_id: sample.id, variant: variant.name, repetitions: subset.length,
      structural_valid: count(row => row.structural_valid),
      proposal_semantic_agreement: count(row => row.semantic_agreement),
      controller_outcome_agreement: count(row => agreement(row).controller_outcome_agreement),
      effective_runtime_outcome_agreement: count(row => effectiveRuntimeOutcome(row, runtimeById.get(row.case_id)!).effective_runtime_outcome_agreement),
      hypothesis_exact_match: count(hypothesisExact),
      duration_ms_median: median(subset.map(row => row.duration_ms)),
      duration_ms_min: Math.min(...subset.map(row => row.duration_ms)),
      duration_ms_max: Math.max(...subset.map(row => row.duration_ms)),
      input_tokens: total("input_tokens"), cached_input_tokens: total("cached_input_tokens"),
      output_tokens: total("output_tokens"), reasoning_tokens: total("reasoning_tokens"),
      total_tokens: total("total_tokens"),
      incomplete: count(row => row.response_status === "incomplete"),
      request_errors: count(row => row.response_status === "request_error") };
  }));
}

function selfCheck() {
  return { mode: "model_migration_stability_fixture_validation_only", cases: CASE_IDS,
    repetitions_per_case_variant: REPETITIONS, calls_planned: executionPlan.length, model_calls: 0,
    max_output_tokens: MAX_OUTPUT_TOKENS, timeout_ms: TIMEOUT_MS, max_retries: MAX_RETRIES, store: false,
    corpus_sha256, prompt_sha256, variants: metadata.variants,
    schedule: executionPlan.map(item => ({ case_id: item.sample.id, variant: item.variant.name,
      repetition: item.repetition, execution_order: item.execution_order })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-check") {
    console.log(JSON.stringify(selfCheck(), null, 2));
  } else {
    const allowed = new Set(["--authorize-paid-evaluation", "--max-calls=40", "--resume"]);
    if (args.length !== new Set(args).size || args.some(arg => !allowed.has(arg))
      || !args.includes("--authorize-paid-evaluation") || !args.includes("--max-calls=40")
      || !process.env.OPENAI_API_KEY?.trim()) {
      throw new Error("Stability paid evaluation requires separate authorization, OPENAI_API_KEY and --max-calls=40; no request was made");
    }
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES });
    const invoke = async (executionOrder: number): Promise<CheckpointRow> => {
      const { sample, variant, repetition, execution_order } = executionPlan[executionOrder - 1]!;
      const started = Date.now();
      let row: CheckpointRow = { case_id: sample.id, category: sample.category, variant: variant.name,
        model: variant.model, reasoning_effort: variant.effort, repetition, execution_order,
        structural_valid: false, semantic_agreement: false,
        expected_decision: sample.expected.decision, actual_decision: null,
        expected_service: sample.expected.slots.service, actual_service: null,
        expected_location: sample.expected.slots.location, actual_location: null,
        expected_hypotheses: sample.expected.slots.hypotheses, actual_hypotheses: [],
        duration_ms: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0,
        reasoning_tokens: 0, total_tokens: 0, response_status: null,
        incomplete_reason: null, http_status: null, estimated_cost_usd: 0 };
      try {
        const { data, response: httpResponse } = await client.responses.create({
          model: variant.model, reasoning: { effort: variant.effort }, store: false,
          max_output_tokens: MAX_OUTPUT_TOKENS, instructions: CONTEXTUAL_INSTRUCTIONS,
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
          const assessed = assess(sample, proposal);
          row.semantic_agreement = assessed.semantic;
          row.actual_decision = assessed.decision;
          row.actual_service = assessed.slots.service;
          row.actual_location = assessed.slots.location;
          row.actual_hypotheses = assessed.slots.hypotheses;
          Object.assign(row, assessed.diagnostics);
        } catch { /* Never persist output, prompt or provider error body. */ }
      } catch (error) {
        row.response_status = "request_error";
        row.http_status = error instanceof APIError ? error.status : null;
      }
      row.duration_ms = Date.now() - started;
      row.estimated_cost_usd = ((row.input_tokens - row.cached_input_tokens) * 2
        + row.cached_input_tokens * 0.20 + row.output_tokens * 12) / 1_000_000;
      row.hypothesis_exact_match = hypothesisExact(row);
      row.effective_runtime_outcome_agreement = effectiveRuntimeOutcome(row, runtimeById.get(sample.id)!).effective_runtime_outcome_agreement;
      return row;
    };
    const result = await runCheckpointed({ path: checkpointPath, metadata, plan: checkpointPlan,
      resume: args.includes("--resume"), invoke: step => invoke(step.execution_order),
      progress: line => { process.stderr.write(line + "\n"); } });
    console.log(JSON.stringify({ mode: "model_migration_stability_paid_evaluation_only",
      model_calls: result.new_model_calls, calls_planned: executionPlan.length,
      calls_completed: result.rows.length, resumed_calls: result.resumed_calls,
      new_model_calls: result.new_model_calls, max_output_tokens: MAX_OUTPUT_TOKENS,
      timeout_ms: TIMEOUT_MS, max_retries: MAX_RETRIES, store: false,
      corpus_sha256, prompt_sha256, summary: summarizeStabilityRows(result.rows), rows: result.rows }, null, 2));
  }
}
