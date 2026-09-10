import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { test } from "node:test";

const root = new URL("../../../", import.meta.url);
const script = fileURLToPath(new URL("scripts/evaluate-contextual.ts", root));
const run = (...args: string[]) => JSON.parse(execFileSync(process.execPath, ["--import", "tsx", script, ...args], { cwd: fileURLToPath(root), encoding: "utf8", stdio: "pipe", maxBuffer: 4 * 1024 * 1024 }));

test("B2 frozen corpus remains byte-identical, including the reserved split", () => {
  for (const [split, expected] of [["development", "0b71df0a91982c9aaa2749c923f6ad5b46c51f72f815742e6fdc2b76c34bfcdb"],
    ["heldout", "010ef5428f7705c6eb4766604c024ec54575366c5e94ffca04199c8fccf1cf1b"]]) {
    // Git may check out CRLF on Windows; compare canonical repository bytes.
    const content = readFileSync(new URL(`evaluations/b2/${split}.json`, root), "utf8").replaceAll("\r\n", "\n");
    assert.equal(createHash("sha256").update(content).digest("hex"), expected);
  }
});
test("B2 evaluation traces interpretation, composition, fallback and human review separately", () => {
  const report = run("--suite=readiness");
  assert.equal(report.cases, 18); assert.equal(report.failed, 0); assert.equal(report.model_calls, 0);
  assert.ok(report.composition.validated > 0); assert.equal(report.composition.fallback, 2);
  assert.equal(report.human_naturalness, "not_reviewed");
  for (const row of report.results) for (const turn of row.turns) {
    assert.ok(turn.input.message); assert.ok(turn.input.catalog.length === 8);
    assert.equal("oracle" in turn.input, false); assert.equal("expected" in turn.input, false);
    assert.ok("interpretation" in turn && "controller" in turn && "final_response" in turn);
    assert.equal(turn.human_review.naturalness, null);
    if (turn.composition_status === "validated") assert.equal(typeof turn.final_response, "string");
    if (turn.response_boundary === "requires_real_domain_result_in_inbox") assert.equal(turn.final_response, null);
  }
});
test("B2 real evaluation refuses missing authorization before any provider call", () => {
  assert.throws(() => run("--real", "--suite=readiness", "--model=not-authorized", "--max-calls=1"), /Real evaluation requires authorization/);
});
test("B2 evaluation can resume a bounded case window without replaying earlier cases", () => {
  const report = run("--suite=readiness", "--offset=1", "--limit=3");
  assert.equal(report.cases, 3); assert.equal(report.failed, 0); assert.equal(report.results[0].id, "readiness-02");
  assert.equal(report.results.at(-1).id, "readiness-04"); assert.equal(report.model_calls, 0);
});
