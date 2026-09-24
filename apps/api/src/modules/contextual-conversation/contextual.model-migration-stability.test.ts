import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stabilityPlan, summarizeStabilityRows } from "../../../scripts/evaluate-model-migration-stability.js";
import type { CheckpointRow } from "../../../scripts/model-migration-checkpoint.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const script = resolve(apiRoot, "scripts/evaluate-model-migration-stability.ts");
function invoke(args: string[]) {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args],
    { cwd: apiRoot, env, encoding: "utf8" });
}

test("stability self-check interleaves two frozen semantic cases and balances 40 planned calls", () => {
  const result = invoke(["--self-check"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim(), "");
  const report = JSON.parse(result.stdout) as {
    cases: string[]; repetitions_per_case_variant: number; calls_planned: number; model_calls: number;
    max_output_tokens: number; timeout_ms: number; max_retries: number; store: boolean;
    variants: { name: string; model: string; reasoning_effort: string }[];
    schedule: { case_id: string; variant: string; repetition: number; execution_order: number }[];
  };
  assert.deepEqual(report.cases, ["adaptive-02", "readiness-17"]);
  assert.equal(report.repetitions_per_case_variant, 10);
  assert.equal(report.calls_planned, 40);
  assert.equal(report.model_calls, 0);
  assert.equal(report.max_output_tokens, 900);
  assert.equal(report.timeout_ms, 20_000);
  assert.equal(report.max_retries, 0);
  assert.equal(report.store, false);
  assert.deepEqual(report.variants, [
    { name: "terra_medium", model: "gpt-5.6-terra", reasoning_effort: "medium" },
    { name: "terra_high", model: "gpt-5.6-terra", reasoning_effort: "high" },
  ]);
  assert.deepEqual(report.schedule.map(item => item.execution_order), Array.from({ length: 40 }, (_, index) => index + 1));
  for (const case_id of report.cases) for (const variant of report.variants) {
    const rows = report.schedule.filter(item => item.case_id === case_id && item.variant === variant.name);
    assert.equal(rows.length, 10);
    assert.deepEqual(rows.map(item => item.repetition), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(rows.filter(item => item.execution_order % 2 === 1).length, 5);
  }
});

test("stability runner refuses unpaid paths and cannot touch either historical checkpoint", () => {
  const source = readFileSync(script, "utf8");
  assert.match(source, /runCheckpointed/u);
  assert.match(source, /hypothesis_exact_match/u);
  const checkpointDirectory = resolve(apiRoot, "../..", ".eval-results");
  const files = () => existsSync(checkpointDirectory) ? readdirSync(checkpointDirectory).sort() : [];
  const before = files();
  for (const args of [[], ["--resume"], ["--max-calls=40"], ["--authorize-paid-evaluation"]]) {
    const result = invoke(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires separate authorization/);
    assert.match(result.stderr, /no request was made/);
  }
  assert.deepEqual(files(), before);
});

test("stability summary reports hypothesis recovery and failures per case and effort", () => {
  const rows: CheckpointRow[] = stabilityPlan.checkpointPlan.map(step => ({ ...step,
    structural_valid: true, semantic_agreement: true,
    actual_decision: step.expected_decision, actual_service: step.expected_service,
    actual_location: step.expected_location, actual_hypotheses: step.expected_hypotheses,
    duration_ms: step.repetition * 100, input_tokens: 10, cached_input_tokens: 0,
    output_tokens: 5, reasoning_tokens: 1, total_tokens: 15,
    response_status: "completed", incomplete_reason: null, http_status: 200, estimated_cost_usd: 0 }));
  const missing = rows.find(row => row.case_id === "adaptive-02" && row.variant === "terra_medium");
  assert.ok(missing);
  missing.actual_hypotheses = [];
  missing.semantic_agreement = false;
  const incomplete = rows.find(row => row.case_id === "readiness-17" && row.variant === "terra_high");
  assert.ok(incomplete);
  incomplete.structural_valid = false;
  incomplete.semantic_agreement = false;
  incomplete.actual_hypotheses = [];
  incomplete.actual_decision = null;
  incomplete.response_status = "incomplete";
  incomplete.incomplete_reason = "max_output_tokens";
  const summary = summarizeStabilityRows(rows);
  assert.equal(summary.length, 4);
  const medium = summary.find(item => item.case_id === "adaptive-02" && item.variant === "terra_medium")!;
  assert.equal(medium.repetitions, 10);
  assert.equal(medium.hypothesis_exact_match, 9);
  assert.equal(medium.effective_runtime_outcome_agreement, 9);
  assert.equal(medium.duration_ms_median, 550);
  assert.equal(medium.duration_ms_min, 100);
  assert.equal(medium.duration_ms_max, 1000);
  const high = summary.find(item => item.case_id === "readiness-17" && item.variant === "terra_high")!;
  assert.equal(high.structural_valid, 9);
  assert.equal(high.incomplete, 1);
  assert.equal(high.hypothesis_exact_match, 9);
  assert.equal(high.input_tokens, 100);
  assert.equal(high.total_tokens, 150);
});
