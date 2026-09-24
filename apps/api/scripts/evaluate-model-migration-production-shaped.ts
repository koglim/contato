import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI, { APIError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { DEFAULT_OPENAI_CONVERSATION_TIMEOUT_MS } from "../src/config/contextual-conversation.js";
import { contextualInterpretationSchema } from "../src/modules/contextual-conversation/contextual.contract.js";
import { CONTEXTUAL_INSTRUCTIONS, extractStructuredOutput } from "../src/modules/contextual-conversation/contextual.provider.js";
import { analyzeRows, effectiveRuntimeOutcome } from "./model-migration-analysis.js";
import { runCheckpointed, type CheckpointRow } from "./model-migration-checkpoint.js";
import { assess, estimateCost, modelMigrationAnalysisContext, modelMigrationSamples } from "./evaluate-model-migration.js";

const MAX_OUTPUT_TOKENS = 900;
const MAX_RETRIES = 0;
const VARIANTS = [
  { name: "baseline", model: "gpt-5-mini-2025-08-07", effort: null },
  { name: "terra_medium", model: "gpt-5.6-terra", effort: "medium" },
] as const;
const runtimeCases = modelMigrationAnalysisContext.runtimeCases;
const runtimeById = new Map(runtimeCases.map(item => [item.case_id, item]));
const executionPlan = modelMigrationSamples.flatMap((sample, index) =>
  (index % 2 === 0 ? VARIANTS : [...VARIANTS].reverse()).map((variant, position) =>
    ({ sample, variant, execution_order: index * 2 + position + 1 })));
assert.equal(modelMigrationSamples.length, 40);
assert.equal(executionPlan.length, 80);
const checkpointPlan = executionPlan.map(({ sample, variant, execution_order }) => ({
  case_id: sample.id, category: sample.category, variant: variant.name, model: variant.model,
  reasoning_effort: variant.effort ?? "runtime_default", execution_order,
  expected_decision: sample.expected.decision, expected_service: sample.expected.slots.service,
  expected_location: sample.expected.slots.location, expected_hypotheses: sample.expected.slots.hypotheses,
}));
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const { corpus_sha256, prompt_sha256 } = modelMigrationAnalysisContext.checkpointMetadata;
const metadata = {
  version: "model-migration-production-shaped-v1-checkpoint" as const,
  corpus_sha256, prompt_sha256, schedule_sha256: digest(JSON.stringify(checkpointPlan)),
  max_output_tokens: MAX_OUTPUT_TOKENS, calls_planned: executionPlan.length,
  variants: VARIANTS.map(item => ({ name: item.name, model: item.model,
    reasoning_effort: item.effort ?? "runtime_default" })),
};
const checkpointPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../..", ".eval-results",
  `model-migration-production-v1-${corpus_sha256}-${prompt_sha256}.jsonl`);
for (const variant of VARIANTS) {
  assert.equal(executionPlan.filter(item => item.variant.name === variant.name).length, 40);
  assert.equal(executionPlan.filter(item => item.variant.name === variant.name
    && item.execution_order % 2 === 1).length, 20);
}

export const productionShapedPlan = { metadata, checkpointPlan, checkpointPath, runtimeCases };

function selfCheck() {
  return { mode: "production_shaped_fixture_validation_only", cases: modelMigrationSamples.length,
    calls_planned: executionPlan.length, model_calls: 0,
    max_output_tokens: MAX_OUTPUT_TOKENS, timeout_ms: DEFAULT_OPENAI_CONVERSATION_TIMEOUT_MS,
    max_retries: MAX_RETRIES, store: false, corpus_sha256, prompt_sha256,
    variants: metadata.variants,
    schedule: executionPlan.map(item => ({ case_id: item.sample.id, variant: item.variant.name,
      execution_order: item.execution_order })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-check") {
    console.log(JSON.stringify(selfCheck(), null, 2));
  } else {
    // This separate runner never starts a paid call by default or in CI.
    const allowed = new Set(["--authorize-paid-evaluation", "--max-calls=80", "--resume"]);
    if (args.length !== new Set(args).size || args.some(arg => !allowed.has(arg))
      || !args.includes("--authorize-paid-evaluation") || !args.includes("--max-calls=80")
      || !process.env.OPENAI_API_KEY?.trim()) {
      throw new Error("Production-shaped paid evaluation requires separate authorization, OPENAI_API_KEY and --max-calls=80; no request was made");
    }
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY,
      timeout: DEFAULT_OPENAI_CONVERSATION_TIMEOUT_MS, maxRetries: MAX_RETRIES });
    const invoke = async (executionOrder: number): Promise<CheckpointRow> => {
      const { sample, variant, execution_order } = executionPlan[executionOrder - 1]!;
      const started = Date.now();
      let row: CheckpointRow = { case_id: sample.id, category: sample.category, variant: variant.name,
        model: variant.model, reasoning_effort: variant.effort ?? "runtime_default", execution_order,
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
          total_tokens: data.usage?.total_tokens ?? 0,
          response_status: data.status ?? null,
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
      row.estimated_cost_usd = estimateCost(variant.name, row.input_tokens, row.cached_input_tokens, row.output_tokens);
      row.effective_runtime_outcome_agreement = effectiveRuntimeOutcome(row, runtimeById.get(sample.id)!).effective_runtime_outcome_agreement;
      return row;
    };
    const result = await runCheckpointed({ path: checkpointPath, metadata, plan: checkpointPlan,
      resume: args.includes("--resume"), invoke: step => invoke(step.execution_order),
      progress: line => { process.stderr.write(line + "\n"); } });
    const analysis = analyzeRows(result.rows, metadata, runtimeCases);
    // Each stored row carries the same effective metric that the offline report recomputes.
    for (const row of result.rows) assert.equal(row.effective_runtime_outcome_agreement,
      effectiveRuntimeOutcome(row, runtimeById.get(row.case_id)!).effective_runtime_outcome_agreement);
    console.log(JSON.stringify({ mode: "production_shaped_paid_evaluation_only", model_calls: result.new_model_calls,
      calls_planned: 80, calls_completed: result.rows.length,
      resumed_calls: result.resumed_calls, new_model_calls: result.new_model_calls,
      max_output_tokens: MAX_OUTPUT_TOKENS, timeout_ms: DEFAULT_OPENAI_CONVERSATION_TIMEOUT_MS,
      max_retries: MAX_RETRIES, store: false, corpus_sha256, prompt_sha256,
      summary: analysis.variants, effective_regression_matrix: analysis.effective_regression_matrix,
      rows: result.rows }, null, 2));
  }
}
