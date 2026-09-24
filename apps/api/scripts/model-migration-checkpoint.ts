import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const variant = z.object({
  name: z.string().min(1), model: z.string().min(1), reasoning_effort: z.string().min(1),
}).strict();
export const checkpointMetadataSchema = z.object({
  version: z.union([z.literal("model-migration-v1-checkpoint"),
    z.literal("model-migration-production-shaped-v1-checkpoint"),
    z.literal("model-migration-stability-v1-checkpoint")]),
  corpus_sha256: hash, prompt_sha256: hash, schedule_sha256: hash,
  max_output_tokens: z.number().int().positive(), calls_planned: z.number().int().positive(),
  variants: z.array(variant).min(1),
}).strict();
export type CheckpointMetadata = z.infer<typeof checkpointMetadataSchema>;

export const checkpointRowSchema = z.object({
  case_id: z.string().min(1), category: z.string().min(1), variant: z.string().min(1),
  model: z.string().min(1), reasoning_effort: z.string().min(1),
  execution_order: z.number().int().positive(),
  structural_valid: z.boolean(), semantic_agreement: z.boolean(),
  expected_decision: z.string().min(1), actual_decision: z.string().nullable(),
  expected_service: z.string().nullable(), actual_service: z.string().nullable(),
  expected_location: z.string().nullable(), actual_location: z.string().nullable(),
  expected_hypotheses: z.array(z.string()), actual_hypotheses: z.array(z.string()),
  duration_ms: z.number().finite().nonnegative(),
  input_tokens: z.number().int().nonnegative(), cached_input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(), reasoning_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  response_status: z.string().nullable(), incomplete_reason: z.string().nullable(),
  http_status: z.number().int().min(100).max(599).nullable(),
  estimated_cost_usd: z.number().finite().nonnegative(),
  // Optional: historical paid rows must remain valid and unchanged.
  intent_match: z.boolean().optional(), speech_act_match: z.boolean().optional(),
  service_keys_match: z.boolean().optional(), proposal_location_match: z.boolean().optional(),
  decision_match: z.boolean().optional(), slots_match: z.boolean().optional(),
  effective_runtime_outcome_agreement: z.boolean().optional(),
  hypothesis_exact_match: z.boolean().optional(), repetition: z.number().int().positive().optional(),
}).strict();
export type CheckpointRow = z.infer<typeof checkpointRowSchema>;
export type CheckpointStep = Pick<CheckpointRow,
  "case_id" | "category" | "variant" | "model" | "reasoning_effort" | "execution_order"
  | "expected_decision" | "expected_service" | "expected_location" | "expected_hypotheses" | "repetition">;

const metadataLine = z.object({ kind: z.literal("metadata"), value: checkpointMetadataSchema }).strict();
const rowLine = z.object({ kind: z.literal("row"), value: checkpointRowSchema }).strict();

function durableAppend(path: string, text: string, flags: "a" | "wx"): void {
  const fd = openSync(path, flags, 0o600);
  try {
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

function acquireLock(path: string): () => void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lockPath = `${path}.lock`;
  const token = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      durableAppend(lockPath, JSON.stringify({ pid: process.pid, token }) + "\n", "wx");
      return () => {
        const current = JSON.parse(readFileSync(lockPath, "utf8")) as { token?: string };
        assert.equal(current.token, token, "Checkpoint lock changed unexpectedly");
        unlinkSync(lockPath);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let pid: number;
      try {
        const stored = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
        if (!Number.isInteger(stored.pid) || Number(stored.pid) < 1) throw new Error("invalid lock PID");
        pid = Number(stored.pid);
      } catch { throw new Error("Checkpoint lock is unreadable; inspect it before resuming, no request was made"); }
      try {
        process.kill(pid, 0);
        throw new Error("Checkpoint is already active in another process; no request was made");
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe;
      }
      // An interrupted process left a lock. Move that exact file aside before
      // retrying exclusive creation; never delete an active process's lock.
      try { renameSync(lockPath, `${lockPath}.stale-${randomUUID()}`); }
      catch (moveError) {
        if ((moveError as NodeJS.ErrnoException).code !== "ENOENT") throw moveError;
      }
    }
  }
  throw new Error("Could not acquire checkpoint lock; no request was made");
}

function validateRow(row: CheckpointRow, step: CheckpointStep): void {
  assert.equal(row.execution_order, step.execution_order, "checkpoint execution_order mismatch");
  assert.equal(row.repetition, step.repetition, "checkpoint repetition mismatch");
  for (const field of ["case_id", "category", "variant", "model", "reasoning_effort",
    "expected_decision", "expected_service", "expected_location"] as const) {
    assert.equal(row[field], step[field], `checkpoint ${field} mismatch`);
  }
  assert.deepEqual(row.expected_hypotheses, step.expected_hypotheses, "checkpoint hypotheses mismatch");
}

function loadCheckpoint(path: string, metadata: CheckpointMetadata, plan: CheckpointStep[]): CheckpointRow[] {
  if (!existsSync(path)) throw new Error("Resume requires an existing checkpoint; no request was made");
  const raw = readFileSync(path, "utf8");
  const lastNewline = raw.lastIndexOf("\n");
  if (lastNewline < 0) throw new Error("Checkpoint header is incomplete; no request was made");
  const complete = raw.slice(0, lastNewline + 1);
  const lines = complete.trimEnd().split("\n");
  const storedMetadata = metadataLine.parse(JSON.parse(lines[0]!));
  assert.deepEqual(storedMetadata.value, metadata, "Checkpoint metadata incompatible; no request was made");
  const rows = lines.slice(1).map((line, index) => {
    const parsed = rowLine.parse(JSON.parse(line));
    const step = plan[index];
    assert.ok(step, "Checkpoint has more rows than the execution plan");
    validateRow(parsed.value, step);
    return parsed.value;
  });
  // Only an unterminated trailing line may be discarded. It was never fsynced
  // as a complete row, so its call must be retried on resume.
  if (complete.length !== raw.length) truncateSync(path, Buffer.byteLength(complete, "utf8"));
  return rows;
}

export async function runCheckpointed(options: {
  path: string; metadata: CheckpointMetadata; plan: CheckpointStep[]; resume: boolean;
  invoke: (step: CheckpointStep) => Promise<CheckpointRow>;
  progress: (line: string) => void;
}): Promise<{ rows: CheckpointRow[]; resumed_calls: number; new_model_calls: number }> {
  const { path, plan, resume, invoke, progress } = options;
  const metadata = checkpointMetadataSchema.parse(options.metadata);
  assert.equal(metadata.calls_planned, plan.length);
  const releaseLock = acquireLock(path);
  try {
    let rows: CheckpointRow[];
    if (resume) {
      rows = loadCheckpoint(path, metadata, plan);
    } else {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      try {
        durableAppend(path, JSON.stringify({ kind: "metadata", value: metadata }) + "\n", "wx");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error("Checkpoint already exists; use --resume after review, no request was made");
        }
        throw error;
      }
      rows = [];
    }
    const resumedCalls = rows.length;
    for (const step of plan.slice(resumedCalls)) {
      progress(`[${step.execution_order}/${plan.length}] ${step.case_id} / ${step.variant}`);
      const row = checkpointRowSchema.parse(await invoke(step));
      validateRow(row, step);
      durableAppend(path, JSON.stringify({ kind: "row", value: row }) + "\n", "a");
      rows.push(row);
      progress(`[${step.execution_order}/${plan.length}] done ${row.duration_ms}ms valid=${row.structural_valid} semantic=${row.semantic_agreement} status=${row.response_status ?? "null"} incomplete=${row.incomplete_reason ?? "null"} http=${row.http_status ?? "null"}`);
    }
    return { rows, resumed_calls: resumedCalls, new_model_calls: plan.length - resumedCalls };
  } finally { releaseLock(); }
}
