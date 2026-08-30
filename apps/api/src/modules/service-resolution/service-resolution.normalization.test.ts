import assert from "node:assert/strict";
import test from "node:test";
import { normalizeServiceText } from "./service-resolution.normalization.js";

test("normalizeServiceText lowercases, removes accents and collapses spaces", () => {
  assert.equal(normalizeServiceText("  Eletricista!!! "), "eletricista");
  assert.equal(normalizeServiceText("Montador de móveis"), "montador de moveis");
  assert.equal(normalizeServiceText("  quero   uma   diarista  "), "quero uma diarista");
});

test("normalizeServiceText converts punctuation and hyphens to word boundaries", () => {
  assert.equal(normalizeServiceText("AR-CONDICIONADO"), "ar condicionado");
  assert.equal(normalizeServiceText("tomada/chuveiro_elétrico"), "tomada chuveiro eletrico");
});
