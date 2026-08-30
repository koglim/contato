import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { readServiceResolutionConfig } from "../../config/service-resolution.js";
import { resolveFuzzyCandidates, type FuzzyCandidate } from "./service-resolution.repository.js";

function candidate(name: string, confidence: number): FuzzyCandidate {
  return { id: randomUUID(), name, slug: name.toLowerCase(), term: name.toLowerCase(), confidence };
}

const config = readServiceResolutionConfig({});

test("fuzzy resolution accepts small typos when their PostgreSQL similarity clears the default threshold", () => {
  for (const [text, name, confidence] of [
    ["eletrisista", "Eletricista", 0.6],
    ["eletrcista", "Eletricista", 0.642857],
    ["encanadro", "Encanador", 0.538462],
  ] as const) {
    const result = resolveFuzzyCandidates(text, [candidate(name, confidence)], config);
    assert.equal(result.status, "resolved");
    assert.equal(result.match?.method, "fuzzy");
    assert.equal(result.match?.service.name, name);
  }
});

test("fuzzy resolution preserves ambiguity and a clear leading candidate", () => {
  const ambiguous = resolveFuzzyCandidates("manutencao", [candidate("Eletricista", 0.6), candidate("Encanador", 0.55)], config);
  const resolved = resolveFuzzyCandidates("eletrisista", [candidate("Eletricista", 0.6), candidate("Encanador", 0.4)], config);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(resolved.status, "resolved");
});

test("fuzzy resolution remains unresolved when PostgreSQL returns no sufficiently similar candidate", () => {
  for (const text of ["problema", "manutencao", "residencial"]) {
    assert.equal(resolveFuzzyCandidates(text, [], config).status, "unresolved");
  }
});
