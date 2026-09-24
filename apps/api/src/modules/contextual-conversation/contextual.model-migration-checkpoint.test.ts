import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  runCheckpointed, type CheckpointMetadata, type CheckpointRow, type CheckpointStep,
} from "../../../scripts/model-migration-checkpoint.js";

const metadata: CheckpointMetadata = {
  version: "model-migration-v1-checkpoint",
  corpus_sha256: "a".repeat(64), prompt_sha256: "b".repeat(64), schedule_sha256: "c".repeat(64),
  max_output_tokens: 4096, calls_planned: 3,
  variants: [{ name: "baseline", model: "gpt-5-mini-2025-08-07", reasoning_effort: "runtime_default" }],
};
const plan: CheckpointStep[] = [1, 2, 3].map(execution_order => ({
  case_id: `synthetic-${execution_order}`, category: "synthetic", variant: "baseline",
  model: "gpt-5-mini-2025-08-07", reasoning_effort: "runtime_default", execution_order,
  expected_decision: "clarify", expected_service: null, expected_location: null, expected_hypotheses: [],
}));
function row(step: CheckpointStep): CheckpointRow {
  return { ...step, structural_valid: true, semantic_agreement: true, actual_decision: "clarify",
    actual_service: null, actual_location: null, actual_hypotheses: [], duration_ms: 12,
    input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_tokens: 0,
    total_tokens: 15, response_status: "completed", incomplete_reason: null,
    http_status: 200, estimated_cost_usd: 0.00001 };
}
function temporaryCheckpoint() {
  const dir = mkdtempSync(join(tmpdir(), "model-migration-checkpoint-"));
  return { path: join(dir, "results.jsonl"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("checkpoint persists sanitized rows, progress stays separate, and resume skips completed positions", async () => {
  const temp = temporaryCheckpoint();
  try {
    const progress: string[] = [];
    const invoked: number[] = [];
    await assert.rejects(runCheckpointed({
      path: temp.path, metadata, plan, resume: false, progress: line => progress.push(line),
      invoke: async step => {
        invoked.push(step.execution_order);
        if (step.execution_order === 3) throw new Error("simulated process interruption");
        return row(step);
      },
    }), /simulated process interruption/);
    assert.deepEqual(invoked, [1, 2, 3]);
    const persisted = readFileSync(temp.path, "utf8").trim().split("\n").map(line => JSON.parse(line) as
      { kind: string; value: Record<string, unknown> });
    assert.equal(persisted.length, 3); // Metadata + only two completed positions.
    assert.deepEqual(persisted.map(item => item.kind), ["metadata", "row", "row"]);
    assert.equal(persisted[1]!.value.execution_order, 1);
    assert.equal(persisted[2]!.value.execution_order, 2);
    assert.ok(!readFileSync(temp.path, "utf8").includes("simulated process interruption"));
    assert.ok(progress.some(line => line.startsWith("[1/3] synthetic-1 / baseline")));
    assert.ok(progress.some(line => line.includes("done 12ms valid=true semantic=true")));
    assert.ok(progress.every(line => !line.includes("prompt") && !line.includes("response body")));

    let newCalls = 0;
    const resumed = await runCheckpointed({
      path: temp.path, metadata, plan, resume: true, progress: line => progress.push(line),
      invoke: async step => { newCalls++; return row(step); },
    });
    assert.equal(newCalls, 1);
    assert.equal(resumed.resumed_calls, 2);
    assert.equal(resumed.new_model_calls, 1);
    assert.deepEqual(resumed.rows.map(item => item.execution_order), [1, 2, 3]);
    assert.equal(readFileSync(temp.path, "utf8").trim().split("\n").length, 4);
    const alreadyComplete = await runCheckpointed({
      path: temp.path, metadata, plan, resume: true, progress: () => {},
      invoke: async () => { throw new Error("completed positions must not be retried"); },
    });
    assert.equal(alreadyComplete.resumed_calls, 3);
    assert.equal(alreadyComplete.new_model_calls, 0);
  } finally { temp.cleanup(); }
});

test("stability checkpoint resumes repeated cases by execution order and repetition", async () => {
  const temp = temporaryCheckpoint();
  const repeatedPlan: CheckpointStep[] = [1, 2].map(repetition => ({ ...plan[0]!, case_id: "adaptive-02",
    variant: "terra_medium", model: "gpt-5.6-terra", reasoning_effort: "medium",
    repetition, execution_order: repetition }));
  const repeatedMetadata: CheckpointMetadata = { ...metadata,
    version: "model-migration-stability-v1-checkpoint", max_output_tokens: 900, calls_planned: 2,
    variants: [{ name: "terra_medium", model: "gpt-5.6-terra", reasoning_effort: "medium" }] };
  try {
    await assert.rejects(runCheckpointed({ path: temp.path, metadata: repeatedMetadata,
      plan: repeatedPlan, resume: false, progress: () => {}, invoke: async step => {
        if (step.repetition === 2) throw new Error("interrupted after first repetition");
        return row(step);
      } }), /interrupted after first repetition/);
    let calls = 0;
    const result = await runCheckpointed({ path: temp.path, metadata: repeatedMetadata,
      plan: repeatedPlan, resume: true, progress: () => {}, invoke: async step => {
        calls++;
        return row(step);
      } });
    assert.equal(calls, 1);
    assert.equal(result.resumed_calls, 1);
    assert.deepEqual(result.rows.map(item => item.repetition), [1, 2]);
  } finally { temp.cleanup(); }
});

test("fresh execution refuses an existing checkpoint before invoking a provider", async () => {
  const temp = temporaryCheckpoint();
  try {
    await runCheckpointed({ path: temp.path, plan: plan.slice(0, 1),
      resume: false, progress: () => {}, invoke: async step => row(step),
      // This case uses a one-step plan, so its metadata must match that plan.
      metadata: { ...metadata, calls_planned: 1 },
    });
    let invoked = false;
    await assert.rejects(runCheckpointed({
      path: temp.path, metadata, plan, resume: false, progress: () => {},
      invoke: async step => { invoked = true; return row(step); },
    }), /Checkpoint already exists/);
    assert.equal(invoked, false);
  } finally { temp.cleanup(); }
});

test("resume rejects incompatible corpus, prompt, output limit, variants and schedule before a call", async () => {
  const temp = temporaryCheckpoint();
  try {
    await assert.rejects(runCheckpointed({
      path: temp.path, metadata, plan, resume: false, progress: () => {},
      invoke: async () => { throw new Error("stop after header"); },
    }), /stop after header/);
    assert.ok(existsSync(temp.path));
    const incompatible: CheckpointMetadata[] = [
      { ...metadata, corpus_sha256: "d".repeat(64) },
      { ...metadata, prompt_sha256: "d".repeat(64) },
      { ...metadata, max_output_tokens: 900 },
      { ...metadata, schedule_sha256: "d".repeat(64) },
      { ...metadata, variants: [{ ...metadata.variants[0]!, model: "gpt-5.6-terra" }] },
    ];
    for (const changed of incompatible) {
      let invoked = false;
      await assert.rejects(runCheckpointed({
        path: temp.path, metadata: changed, plan, resume: true, progress: () => {},
        invoke: async step => { invoked = true; return row(step); },
      }), /Checkpoint metadata incompatible/);
      assert.equal(invoked, false);
    }
  } finally { temp.cleanup(); }
});

test("resume discards only an unterminated trailing row and retries that position", async () => {
  const temp = temporaryCheckpoint();
  try {
    await assert.rejects(runCheckpointed({
      path: temp.path, metadata, plan, resume: false, progress: () => {},
      invoke: async step => {
        if (step.execution_order === 2) throw new Error("interrupted");
        return row(step);
      },
    }), /interrupted/);
    appendFileSync(temp.path, '{"kind":"row","value":');
    const resumed = await runCheckpointed({
      path: temp.path, metadata, plan, resume: true, progress: () => {}, invoke: async step => row(step),
    });
    assert.equal(resumed.resumed_calls, 1);
    assert.deepEqual(resumed.rows.map(item => item.execution_order), [1, 2, 3]);
    assert.equal(readFileSync(temp.path, "utf8").trim().split("\n").length, 4);
  } finally { temp.cleanup(); }
});

test("checkpoint lock refuses concurrent runners and permits recovery after a dead process", async () => {
  const temp = temporaryCheckpoint();
  try {
    let startCall: (() => void) | undefined;
    const callStarted = new Promise<void>(resolve => { startCall = resolve; });
    let finishCall: (() => void) | undefined;
    const callMayFinish = new Promise<void>(resolve => { finishCall = resolve; });
    const first = runCheckpointed({
      path: temp.path, metadata: { ...metadata, calls_planned: 1 }, plan: plan.slice(0, 1),
      resume: false, progress: () => {},
      invoke: async step => { startCall!(); await callMayFinish; return row(step); },
    });
    await callStarted;
    await assert.rejects(runCheckpointed({
      path: temp.path, metadata: { ...metadata, calls_planned: 1 }, plan: plan.slice(0, 1),
      resume: true, progress: () => {},
      invoke: async () => { throw new Error("concurrent duplicate call"); },
    }), /already active/);
    finishCall!();
    await first;
    writeFileSync(`${temp.path}.lock`, JSON.stringify({ pid: 2147483647, token: "stale" }) + "\n");
    const resumed = await runCheckpointed({
      path: temp.path, metadata: { ...metadata, calls_planned: 1 }, plan: plan.slice(0, 1),
      resume: true, progress: () => {},
      invoke: async () => { throw new Error("already completed"); },
    });
    assert.equal(resumed.resumed_calls, 1);
    assert.equal(resumed.new_model_calls, 0);
    assert.equal(existsSync(`${temp.path}.lock`), false);
  } finally { temp.cleanup(); }
});

test("known provider error is a persisted completed row and is not retried", async () => {
  const temp = temporaryCheckpoint();
  try {
    const failed = { ...row(plan[0]!), structural_valid: false, semantic_agreement: false,
      actual_decision: null, response_status: "request_error", http_status: 429,
      input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 };
    const first = await runCheckpointed({
      path: temp.path, metadata: { ...metadata, calls_planned: 1 }, plan: plan.slice(0, 1),
      resume: false, progress: () => {}, invoke: async () => failed,
    });
    assert.equal(first.rows[0]?.response_status, "request_error");
    const resumed = await runCheckpointed({
      path: temp.path, metadata: { ...metadata, calls_planned: 1 }, plan: plan.slice(0, 1),
      resume: true, progress: () => {},
      invoke: async () => { throw new Error("request error must not retry"); },
    });
    assert.equal(resumed.resumed_calls, 1);
    assert.equal(resumed.new_model_calls, 0);
  } finally { temp.cleanup(); }
});

test("resume rejects a complete row with altered execution identity", async () => {
  const temp = temporaryCheckpoint();
  try {
    await runCheckpointed({
      path: temp.path, metadata: { ...metadata, calls_planned: 1 }, plan: plan.slice(0, 1),
      resume: false, progress: () => {}, invoke: async step => row(step),
    });
    const original = readFileSync(temp.path, "utf8");
    writeFileSync(temp.path, original.replace('"case_id":"synthetic-1"', '"case_id":"tampered"'));
    let invoked = false;
    await assert.rejects(runCheckpointed({
      path: temp.path, metadata: { ...metadata, calls_planned: 1 }, plan: plan.slice(0, 1),
      resume: true, progress: () => {},
      invoke: async step => { invoked = true; return row(step); },
    }), /checkpoint case_id mismatch/);
    assert.equal(invoked, false);
  } finally { temp.cleanup(); }
});
