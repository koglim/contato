import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { confirmedUniqueHypothesis } from "./contextual.confirmation.js";

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
