import assert from "node:assert/strict";
import test from "node:test";
import { parseOpportunityMessage } from "./professional-opportunity.parser.js";

for (const text of ["aceito", "posso atender", "vou atender", "sim, consigo", "aceito a CC-7K4P9Q"]) {
  test(`professional acceptance: ${text}`, () => assert.equal(parseOpportunityMessage(text).decision, "accepted"));
}
for (const text of ["não posso atender", "recuso", "não tenho disponibilidade", "não consigo hoje", "recuso a CC-7K4P9Q"]) {
  test(`professional refusal: ${text}`, () => assert.equal(parseOpportunityMessage(text).decision, "declined"));
}
for (const text of ["quanto é?", "onde fica?", "talvez", "e se eu aceitar?", "posso responder depois?", "não sei", "eu penso em aceitar", "aceito ou recuso", "aceito?", "aceito CC-23456789 e CC-ABCDEFGH"]) {
  test(`uncertain decision: ${text}`, () => assert.equal(parseOpportunityMessage(text).decision, null));
}
test("resume and keep are explicit and retain code ownership context", () => {
  assert.equal(parseOpportunityMessage("quero voltar para a busca de eletricista").resume, "eletricista");
  assert.deepEqual(parseOpportunityMessage("retomar cc-23456789").codes, ["CC-23456789"]);
  assert.equal(parseOpportunityMessage("continuar aqui").keep, true);
  assert.equal(parseOpportunityMessage("e se eu retomar?").resume, null);
});
