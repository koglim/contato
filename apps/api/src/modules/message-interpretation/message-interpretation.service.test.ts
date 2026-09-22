import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicMessageInterpreter } from "./message-interpretation.service.js";

const interpreter = new DeterministicMessageInterpreter();

test("message interpretation extracts only explicit high-confidence location phrases", () => {
  const cases = [
    ["Preciso de eletricista em Sinop, MT", "Sinop, MT"],
    ["Minha tomada queimou aqui em Sinop", "Sinop"],
    ["Minha tomada queimou aqui em Sinop, MT", "Sinop, MT"],
    ["Preciso de encanador na cidade de Cuiabá", "Cuiabá"],
    ["Preciso de encanador na cidade de Cuiabá, MT", "Cuiabá, MT"],
    ["Preciso de eletricista no município de Sinop", "Sinop"],
    ["Preciso de eletricista no municipio de Sinop", "Sinop"],
    ["Preciso de eletricista em São José do Rio Claro, MT.", "São José do Rio Claro, MT"],
    ["minha tomada queimou aqui em cuiabá", "cuiabá"],
    ["preciso de encanador na cidade de são paulo", "são paulo"],
    ["preciso de eletricista no município de são josé do rio claro", "são josé do rio claro"],
    ["preciso de eletricista em sinop, mt", "sinop, MT"],
    ["preciso de eletricista em Sinop, mt", "Sinop, MT"],
    ["Preciso de eletricista em Cuiabá", "Cuiabá"],
    ["Preciso de eletricista lá em Cuiabá", "Cuiabá"],
  ] as const;
  for (const [rawText, locationText] of cases) {
    const result = interpreter.interpret({ raw_text: rawText, country_code: "BR" });
    assert.equal(result.status, "interpreted", rawText);
    assert.equal(result.location_text, locationText, rawText);
    assert.equal(result.service_text, rawText, rawText);
    assert.deepEqual(result.interpretation, { service_strategy: "full_message", location_strategy: "locative_phrase" });
  }
});

test("message interpretation conservatively requires an explicit useful location", () => {
  for (const rawText of [
    "minha tomada queimou",
    "preciso de eletricista",
    "meu ar condicionado parou",
    "estou com problema em tomada",
    "preciso de reparo em ar condicionado",
    "quero ajuda em instalação elétrica",
    "preciso de manutenção em chuveiro elétrico",
    "estou com vazamento em torneira",
    "aqui em casa",
    "na minha casa",
    "em casa mesmo",
    "preciso de ajuda em casa mesmo",
    "preciso de ajuda no trabalho",
    "preciso de ajuda na empresa",
    "preciso de ajuda no meu apartamento",
    "Minha tomada queimou aqui em Sinop para amanhã",
    "minha tomada queimou aqui em sinop para amanhã",
    "Aqui em Sinop preciso de encanador",
    "Estou em Cuiabá e preciso de um eletricista",
  ]) {
    const result = interpreter.interpret({ raw_text: rawText, country_code: "BR" });
    assert.equal(result.status, "needs_location", rawText);
    assert.equal(result.location_text, null, rawText);
    assert.equal(result.service_text, rawText, rawText);
    assert.deepEqual(result.interpretation, { service_strategy: "full_message", location_strategy: "none" });
  }
});

test("message interpretation preserves the complete trimmed message and country", () => {
  const rawText = "Minha tomada queimou aqui em Sinop";
  const result = interpreter.interpret({ raw_text: rawText, country_code: "BR" });
  assert.equal(result.raw_text, rawText);
  assert.equal(result.service_text, rawText);
  assert.equal(result.country_code, "BR");
});
