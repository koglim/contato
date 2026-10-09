import assert from "node:assert/strict";
import test from "node:test";
import { parseLocationConfirmation } from "./location-confirmation.parser.js";

test("parseLocationConfirmation handles affirmative keywords", () => {
  const affirmative = ["sim", "s", "isso", "isso mesmo", "mesmo lugar", "pode ser", "Sim", "SIM!", "com certeza", "confirmo", "correto", "pode", "pode sim", "sim pode"];
  for (const text of affirmative) {
    assert.deepEqual(parseLocationConfirmation(text), { kind: "confirm" }, `Failed for: ${text}`);
  }
});

test("parseLocationConfirmation handles negative keywords", () => {
  const negative = ["não", "nao", "n", "outra", "outro lugar", "mudar", "mudar localização", "mudar localizacao", "NÃO", "trocar", "outra cidade", "nao quero"];
  for (const text of negative) {
    assert.deepEqual(parseLocationConfirmation(text), { kind: "decline" }, `Failed for: ${text}`);
  }
});

test("parseLocationConfirmation specific required assertions", () => {
  assert.deepEqual(parseLocationConfirmation("mesmo lugar"), { kind: "confirm" });
  assert.deepEqual(parseLocationConfirmation("mudar localização"), { kind: "decline" });
  assert.deepEqual(parseLocationConfirmation("mudar localizacao"), { kind: "decline" });
});

test("parseLocationConfirmation marks questions and arbitrary text as ambiguous", () => {
  for (const text of ["sim?", "não?", "é em Cuiabá?", "Cuiabá", "quero saber", "bom dia"]) {
    assert.deepEqual(parseLocationConfirmation(text), { kind: "ambiguous" }, `Failed for: ${text}`);
  }
});
