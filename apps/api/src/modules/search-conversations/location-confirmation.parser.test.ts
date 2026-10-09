import assert from "node:assert/strict";
import test from "node:test";
import { parseLocationConfirmation } from "./location-confirmation.parser.js";

test("parseLocationConfirmation handles affirmative keywords", () => {
  for (const text of ["sim", "Sim", "SIM!", "s", "isso", "isso mesmo", "pode ser", "com certeza", "confirmo", "correto", "pode", "pode sim", "sim pode"]) {
    assert.deepEqual(parseLocationConfirmation(text), { kind: "confirm" }, `Failed for: ${text}`);
  }
});

test("parseLocationConfirmation handles negative keywords", () => {
  for (const text of ["não", "nao", "NÃO", "n", "outra", "outro lugar", "mudar", "trocar", "outra cidade", "nao quero"]) {
    assert.deepEqual(parseLocationConfirmation(text), { kind: "decline" }, `Failed for: ${text}`);
  }
});

test("parseLocationConfirmation marks questions and arbitrary text as ambiguous", () => {
  for (const text of ["sim?", "não?", "é em Cuiabá?", "Cuiabá", "quero saber", "bom dia"]) {
    assert.deepEqual(parseLocationConfirmation(text), { kind: "ambiguous" }, `Failed for: ${text}`);
  }
});
