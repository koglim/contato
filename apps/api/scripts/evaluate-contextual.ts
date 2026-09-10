import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import process from "node:process";
import console from "node:console";
import { z } from "zod";
import { controlContextualProposal, emptyMemory, normalizeContextualText, type ContextualProvider } from "../src/modules/contextual-conversation/contextual.contract.js";
import { OpenAIContextualProvider } from "../src/modules/contextual-conversation/contextual.provider.js";

const step = z.object({ message: z.string(), oracle: z.unknown(), explicit_service: z.string().nullable() });
const caseSchema = z.object({ id: z.string(), category: z.string(), source: z.literal("synthetic-authored"), transcript: z.array(z.string()),
  initial: z.string(), message: z.string(), oracle: z.unknown(), explicit_service: z.string().nullable(), expected: z.string(), failure: z.string().nullable(), setup: z.array(step) });
const schema = z.object({ version: z.literal("b2-eval-1"), split: z.enum(["development", "heldout"]), cases: z.array(caseSchema) });
const args = process.argv.slice(2);
const real = args.includes("--real");
const selected = args.find(arg => arg.startsWith("--split="))?.slice(8) ?? "development";
if (!["development", "heldout", "all"].includes(selected)) throw new Error("Unknown evaluation split");
const model = args.find(arg => arg.startsWith("--model="))?.slice(8);
if (real && (!args.includes("--authorize-paid-evaluation") || !model || !process.env.OPENAI_API_KEY)) {
  throw new Error("Real evaluation requires explicit authorization flag, model and OPENAI_API_KEY; no request was made");
}
// No DB, search, selection, WhatsApp, or environment-default model invocation in this evaluator.
const provider: ContextualProvider | null = real ? new OpenAIContextualProvider(model!, process.env.OPENAI_API_KEY!) : null;
const sources = ["development", "heldout"].map(split => {
  const bytes = readFileSync(new URL(`../evaluations/b2/${split}.json`, import.meta.url), "utf8");
  return { digest: createHash("sha256").update(bytes).digest("hex"), ...schema.parse(JSON.parse(bytes)) };
});
assert.equal(sources[0].cases.length, 210); assert.equal(sources[1].cases.length, 90);
assert.equal(new Set(sources.flatMap(s => s.cases.map(c => c.id))).size, 300);
assert.equal(new Set(sources.flatMap(s => s.cases.map(c => c.message))).size, 300);
const catalog = [{ key: "encanador", name: "Encanador", description: "Serviços hidráulicos e vazamentos" },
  { key: "eletricista", name: "Eletricista", description: "Instalações elétricas" },
  { key: "pedreiro", name: "Pedreiro", description: "Alvenaria" }];
const rows = [];
for (const source of sources.filter(s => selected === "all" || s.split === selected)) {
  for (const sample of source.cases) {
    let memory = emptyMemory();
    let calls = 0;
    const started = Date.now();
    const interpret = async (message: string, oracle: unknown) => {
      if (!provider) return oracle;
      calls++;
      return provider.interpret({ message, service: memory.service?.value ?? null, location: memory.location?.value ?? null,
        pending: memory.location ? "selection" : "location", hypotheses: memory.hypotheses.map(h => h.name), catalog });
    };
    let actual = "fallback", error: string | null = null;
    try {
      for (const setup of sample.setup) {
        memory = controlContextualProposal(setup.message, randomUUID(), await interpret(setup.message, setup.oracle), memory, catalog, setup.explicit_service).memory;
      }
      if (sample.failure) throw new Error("injected_provider_unavailable");
      const proposal = await interpret(sample.message, sample.oracle);
      const explicit = (` ${normalizeContextualText(sample.message)} `).includes(" encanador ") ? "Encanador" : null;
      const result = controlContextualProposal(sample.message, randomUUID(), proposal, memory, catalog, explicit);
      actual = result.kind; memory = result.memory;
    } catch { error = "provider_or_contract_failure"; }
    rows.push({ id: sample.id, category: sample.category, split: source.split, passed: actual === sample.expected, expected: sample.expected,
      actual, error, calls, duration_ms: Date.now() - started, confirmed_service: memory.service?.value ?? null, confirmed_location: memory.location?.value ?? null });
  }
}
const report = {
  mode: real ? "real-model-with-injected-failure-cases" : "mocked-proposals-controller-only", model: model ?? null,
  corpus: sources.map(s => ({ split: s.split, sha256: s.digest, cases: s.cases.length })), cases: rows.length,
  passed: rows.filter(r => r.passed).length, failed: rows.filter(r => !r.passed).length,
  categories: Object.fromEntries([...new Set(rows.map(r => r.category))].map(category => {
    const subset = rows.filter(r => r.category === category);
    return [category, { cases: subset.length, passed: subset.filter(r => r.passed).length }];
  })),
  latency_ms: { p50: rows.map(r => r.duration_ms).sort((a, b) => a - b)[Math.floor(rows.length * .5)], p95: rows.map(r => r.duration_ms).sort((a, b) => a - b)[Math.floor(rows.length * .95)] },
  model_calls: rows.reduce((sum, row) => sum + row.calls, 0),
  human_naturalness: "not_reviewed", monetary_cost: "not_measured", production_effects: "not_executed",
  limitations: ["Synthetic labeled cases, not a representative user study", "Controller evaluation is not end-to-end Inbox or consent verification", "Mocked agreement is not model accuracy", "Real runner never passes oracle/labels/transcript to model", "Question generation requires separate human review", "Failures intentionally injected are not observed model failures"],
  results: rows,
};
console.log(JSON.stringify(report, null, 2));
if (report.failed && !real) process.exitCode = 1;
