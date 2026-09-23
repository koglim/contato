import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { z } from "zod";
import { controlContextualProposal, emptyMemory } from "./contextual.contract.js";
import { deterministicSearchProposal } from "./contextual.fast-path.js";

const corpus = z.object({ version: z.literal("latency-v1"), source: z.literal("synthetic-authored"), cases: z.array(z.object({
  id: z.string(), category: z.string(), message: z.string(), evidence: z.string().nullable(), key: z.string().nullable(), fast_path: z.boolean(),
})) }).parse(JSON.parse(readFileSync(new URL("../../../evaluations/b2/latency-v1.json", import.meta.url), "utf8")));
const catalog = [{ key: "eletricista", name: "Eletricista", description: null },
  { key: "encanador", name: "Encanador", description: null }];

test("latency v1 corpus only allows direct catalog requests with a literal location", () => {
  assert.equal(corpus.cases.length, 30);
  for (const sample of corpus.cases) {
    const proposal = deterministicSearchProposal(sample.message, sample.evidence, sample.key);
    assert.equal(proposal !== null, sample.fast_path, sample.id);
    if (proposal) {
      if (sample.category === "fast_path_politeness") assert.equal(proposal.location?.text, "Cuiabá", sample.id);
      const service = catalog.find(item => item.key === sample.key);
      assert.ok(service);
      const decision = controlContextualProposal(sample.message, randomUUID(), proposal, emptyMemory(), catalog, service.name);
      assert.equal(decision.kind, "search", sample.id);
      assert.equal(decision.memory.service?.value, service.name, sample.id);
      assert.equal(decision.memory.location?.value, proposal.location?.text, sample.id);
    }
  }
});
