import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const script = resolve(apiRoot, "scripts/evaluate-model-migration-production-shaped.ts");
function invoke(args: string[]) {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args],
    { cwd: apiRoot, env, encoding: "utf8" });
}

test("production-shaped self-check plans only baseline and Terra medium with a balanced 80-call schedule", () => {
  const result = invoke(["--self-check"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim(), "");
  const report = JSON.parse(result.stdout) as {
    cases: number; calls_planned: number; model_calls: number; max_output_tokens: number;
    timeout_ms: number; max_retries: number; store: boolean;
    variants: { name: string; model: string; reasoning_effort: string }[];
    schedule: { case_id: string; variant: string; execution_order: number }[];
  };
  assert.equal(report.cases, 40);
  assert.equal(report.calls_planned, 80);
  assert.equal(report.model_calls, 0);
  assert.equal(report.max_output_tokens, 900);
  assert.equal(report.timeout_ms, 20_000);
  assert.equal(report.max_retries, 0);
  assert.equal(report.store, false);
  assert.deepEqual(report.variants, [
    { name: "baseline", model: "gpt-5-mini-2025-08-07", reasoning_effort: "runtime_default" },
    { name: "terra_medium", model: "gpt-5.6-terra", reasoning_effort: "medium" },
  ]);
  assert.equal(new Set(report.schedule.map(item => item.case_id)).size, 40);
  assert.deepEqual(report.schedule.map(item => item.execution_order), Array.from({ length: 80 }, (_, index) => index + 1));
  for (const variant of report.variants) {
    assert.equal(report.schedule.filter(item => item.variant === variant.name).length, 40);
    assert.equal(report.schedule.filter(item => item.variant === variant.name
      && item.execution_order % 2 === 1).length, 20);
  }
});

test("production-shaped runner refuses every unauthorized path before creating a checkpoint", () => {
  const source = readFileSync(script, "utf8");
  assert.match(source, /runCheckpointed/u);
  assert.match(source, /effective_runtime_outcome_agreement/u);
  const checkpoint = resolve(apiRoot, "../..", ".eval-results");
  const files = () => existsSync(checkpoint)
    ? readdirSync(checkpoint).filter(name => name.startsWith("model-migration-production-v1-")) : [];
  const before = files();
  for (const args of [[], ["--resume"], ["--max-calls=80"], ["--authorize-paid-evaluation"]]) {
    const result = invoke(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires separate authorization/);
    assert.match(result.stderr, /no request was made/);
  }
  // No key was supplied and the paid branch never passed its gate.
  assert.deepEqual(files(), before);
});
