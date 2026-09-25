import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { confirmedUniqueHypothesis, rejectedUniqueHypothesis } from "./contextual.confirmation.js";
import { normalizeContextualText } from "./contextual.contract.js";
import type { ServiceResolutionRepository } from "../service-resolution/service-resolution.types.js";

const electrician = () => ({ key: "eletricista", name: "Eletricista", evidence: "chuveiro queimou", inboundId: randomUUID() });
const plumber = () => ({ key: "encanador", name: "Encanador", evidence: "pia vaza", inboundId: randomUUID() });

test("unique hypothesis accepts only an affirmative marker and the same explicit canonical service", () => {
  const hypothesis = electrician();
  for (const message of ["sim", "isso", "isso mesmo", "confirmo",
    "sim, preciso de eletricista", "sim, é eletricista", "confirmo, eletricista", "isso, eletricista",
    "SIM, PRECISO DE ELETRICISTA."]) {
    assert.deepEqual(confirmedUniqueHypothesis(message, [hypothesis]),
      { hypothesis, explicitService: message.includes("eletricista") || message.includes("ELETRICISTA") }, message);
  }
});

test("confirmation refuses negation, hypotheses, questions, conflicts and trailing discourse", () => {
  const hypothesis = electrician();
  for (const message of ["não, eletricista não", "talvez seja eletricista", "se for eletricista...",
    "vocês têm eletricista?", "sim, eletricista?", "sim, mas preciso de encanador",
    "sim, preciso de encanador", "sim, eletricista e encanador", "sim, eletricista urgente",
    "sim, a tomada queimou", "preciso de eletricista", "sim, preciso de eletricista\ne encanador"]) {
    assert.equal(confirmedUniqueHypothesis(message, [hypothesis]), null, message);
  }
  assert.equal(confirmedUniqueHypothesis("sim, preciso de eletricista", []), null);
  assert.equal(confirmedUniqueHypothesis("sim, preciso de eletricista", [hypothesis, plumber()]), null);
});

type RejectionCase = { id: string; message: string; expected: boolean; matched_term?: string;
  method?: "exact" | "phrase" | "fuzzy"; slug?: string; hypotheses?: string[] };
const rejectionCorpus = JSON.parse(readFileSync(new URL("../../../evaluations/b2/hypothesis-rejection-v1.json", import.meta.url), "utf8")) as
  { version: string; cases: RejectionCase[] };
assert.equal(rejectionCorpus.version, "hypothesis-rejection-v1");

for (const sample of rejectionCorpus.cases) {
  test(`unique hypothesis rejection: ${sample.id}`, async () => {
    const hypotheses = (sample.hypotheses ?? ["eletricista"]).map(key => key === "eletricista" ? electrician() : plumber());
    let resolverCalls = 0;
    const services: ServiceResolutionRepository = { async resolve({ text }) {
      resolverCalls++;
      const term = sample.matched_term ?? "eletricista";
      return { status: "resolved", normalized_text: normalizeContextualText(text), candidates: [],
        match: { service: { id: randomUUID(), name: sample.slug === "encanador" ? "Encanador" : "Eletricista",
          slug: sample.slug ?? "eletricista" }, method: sample.method ?? "exact", matched_term: term, confidence: 1 } };
    } };
    const result = await rejectedUniqueHypothesis(sample.message, hypotheses, services);
    assert.equal(result?.hypothesis.key ?? null, sample.expected ? "eletricista" : null);
    if (sample.expected) {
      assert.equal(result?.method, sample.method ?? "exact");
      assert.equal(resolverCalls, 1);
    }
    if (sample.hypotheses && sample.hypotheses.length !== 1) assert.equal(resolverCalls, 0);
  });
}
