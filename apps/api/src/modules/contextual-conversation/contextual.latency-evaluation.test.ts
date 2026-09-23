import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("latency v1 synthetic evaluation reports safe eligibility without model calls", () => {
  const apiRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const script = fileURLToPath(new URL("../../../scripts/evaluate-latency.ts", import.meta.url));
  const report = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", script, "--summary"],
    { cwd: apiRoot, encoding: "utf8" }));
  assert.equal(report.cases, 30);
  assert.equal(report.passed, 30);
  assert.equal(report.failed, 0);
  assert.equal(report.fast_path_cases, 11);
  assert.equal(report.interpretation_calls_avoided_in_fixture, 11);
  assert.equal(report.benchmark_scope, "pure_eligibility_only");
});

test("controlled paid composition comparison refuses missing authorization before calling OpenAI", () => {
  const apiRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const script = fileURLToPath(new URL("../../../scripts/evaluate-composition-budget.ts", import.meta.url));
  assert.throws(() => execFileSync(process.execPath, ["--import", "tsx", script, "--model=gpt-5-mini", "--max-calls=9"],
    { cwd: apiRoot, encoding: "utf8", stdio: "pipe" }), /Controlled composition evaluation requires explicit authorization/);
});

test("interpretation comparison validates five synthetic fixtures without any model call", () => {
  const apiRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const script = fileURLToPath(new URL("../../../scripts/evaluate-interpretation-budget.ts", import.meta.url));
  const report = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", script, "--self-check"],
    { cwd: apiRoot, encoding: "utf8" }));
  assert.equal(report.cases, 5);
  assert.equal(report.passed, 5);
  assert.equal(report.model_calls, 0);
  assert.throws(() => execFileSync(process.execPath, ["--import", "tsx", script,
    "--model=gpt-5-mini-2025-08-07", "--max-calls=15"],
  { cwd: apiRoot, encoding: "utf8", stdio: "pipe" }), /Controlled interpretation evaluation requires authorization/);
});
