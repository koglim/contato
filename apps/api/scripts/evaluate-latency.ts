import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { deterministicSearchProposal } from "../src/modules/contextual-conversation/contextual.fast-path.js";

const corpus = z.object({ version: z.literal("latency-v1"), source: z.literal("synthetic-authored"), cases: z.array(z.object({
  id: z.string(), category: z.string(), message: z.string(), evidence: z.string().nullable(), key: z.string().nullable(), fast_path: z.boolean(),
})) }).parse(JSON.parse(readFileSync(new URL("../evaluations/b2/latency-v1.json", import.meta.url), "utf8")));
const results = corpus.cases.map(sample => {
  const eligible = deterministicSearchProposal(sample.message, sample.evidence, sample.key) !== null;
  return { id: sample.id, category: sample.category, passed: eligible === sample.fast_path,
    expected_fast_path: sample.fast_path, actual_fast_path: eligible };
});
// Measures only the pure eligibility check. Network, DB, geocoding and matching
// dominate real turn latency and are intentionally outside this microbenchmark.
const durations: number[] = [];
for (let repeat = 0; repeat < 100; repeat++) for (const sample of corpus.cases) {
  const started = performance.now();
  deterministicSearchProposal(sample.message, sample.evidence, sample.key);
  durations.push(performance.now() - started);
}
durations.sort((a, b) => a - b);
const report = { suite: corpus.version, cases: results.length, passed: results.filter(row => row.passed).length,
  failed: results.filter(row => !row.passed).length,
  fast_path_cases: results.filter(row => row.actual_fast_path).length,
  interpretation_calls_avoided_in_fixture: results.filter(row => row.actual_fast_path).length,
  benchmark_scope: "pure_eligibility_only", benchmark_iterations: durations.length,
  benchmark_ms: { p50: durations[Math.floor(durations.length * .5)], p95: durations[Math.floor(durations.length * .95)] },
  results: process.argv.includes("--summary") ? undefined : results };
console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
