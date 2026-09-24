import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const script = resolve(apiRoot, "scripts/evaluate-model-migration.ts");
function invoke(args: string[]) {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args],
    { cwd: apiRoot, env, encoding: "utf8" });
}

test("model-migration corpus and deterministic four-variant schedule self-check without API calls", () => {
  const result = invoke(["--self-check"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as {
    mode: string; cases: number; calls_planned: number; model_calls: number; max_output_tokens: number;
    variants: { name: string; model: string; reasoning_effort: string }[];
    schedule: { case_id: string; variant: string; execution_order: number }[];
    categories: Record<string, number>;
  };
  assert.equal(report.mode, "fixture_validation_only");
  assert.equal(report.cases, 40);
  assert.equal(report.calls_planned, 160);
  assert.equal(report.model_calls, 0);
  assert.equal(report.max_output_tokens, 4096);
  assert.deepEqual(report.variants.map(item => [item.model, item.reasoning_effort]), [
    ["gpt-5-mini-2025-08-07", "runtime_default"], ["gpt-5.6-terra", "medium"],
    ["gpt-5.6-terra", "low"], ["gpt-5.6-terra", "none"],
  ]);
  assert.equal(new Set(report.schedule.map(item => item.case_id)).size, 40);
  assert.deepEqual(report.schedule.map(item => item.execution_order), Array.from({ length: 160 }, (_, i) => i + 1));
  for (const variant of report.variants) {
    assert.equal(report.schedule.filter(item => item.variant === variant.name).length, 40);
    for (let position = 0; position < 4; position++) {
      assert.equal(report.schedule.filter(item => item.variant === variant.name
        && (item.execution_order - 1) % 4 === position).length, 10);
    }
  }
  assert.ok((report.categories.typos ?? 0) + (report.categories.noisy_portuguese ?? 0) >= 2);
  assert.ok((report.categories.semantic ?? 0) + (report.categories.colloquial_portuguese ?? 0) >= 4);
  assert.equal(report.categories.confirmation, 1);
});

test("paid runner refuses execution without separate authorization", () => {
  const result = invoke(["--max-calls=160"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /separate authorization/);
  assert.match(result.stderr, /no request was made/);
});
