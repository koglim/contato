import assert from "node:assert/strict";
import test from "node:test";
import { selectionMessageContractSchema } from "@contatocerto/shared";
import { BILATERAL_NOTICE, createOpportunityCode, parseBilateralConfirmation, safeOpportunityText } from "./bilateral-contact.policy.js";
import { mapSelectionCommandOutcome } from "../selection-message/selection-message.mapper.js";
import { presentSelectionMessage } from "../selection-message/selection-message.presenter.js";

test("bilateral confirmation accepts only complete affirmative phrases", () => {
  for (const text of ["sim", "PODE!", " quero ", "confirmo.", "pode compartilhar", "pode passar meu telefone", "sim confirmo"]) assert.equal(parseBilateralConfirmation(text), "confirm", text);
  for (const text of ["não", "não quero", "NÃO AUTORIZO", "prefiro não", "desisto"]) assert.equal(parseBilateralConfirmation(text), "decline", text);
  for (const text of ["sim?", "pode?", "se puder eu confirmo", "quero saber mais", "não sei", "talvez", "pode ser perigoso", "sim ou não", "pode, mas não passe meu telefone"]) assert.equal(parseBilateralConfirmation(text), null, text);
});

test("public opportunity codes are random, readable, fixed-length and carry no identifiers", () => {
  const codes = Array.from({ length: 100 }, createOpportunityCode);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) assert.match(code, /^CC-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/u);
});

test("opportunity text strips markup, phones, links, emails, UUIDs and control characters", () => {
  const raw = "*Tomada*\nTelefone: +55 (66) 99999-9999 email@teste.com https://x.com 11111111-1111-4111-8111-111111111111 \u202E x";
  const text = safeOpportunityText(raw);
  assert.doesNotMatch(text, /\n|\*|99999|@|https|11111111|\u202E/u);
  assert.ok(text.includes("Tomada"));
  assert.equal(safeOpportunityText("a".repeat(400)).length, 160);
});

test("legacy confirmation and refusal expose no phones or internal IDs", () => {
  const prompt = mapSelectionCommandOutcome({ kind: "consent_required", professionalDisplayName: "Ana" });
  assert.equal(selectionMessageContractSchema.safeParse(prompt).success, true);
  assert.ok(presentSelectionMessage(prompt)?.includes(BILATERAL_NOTICE));
  assert.equal(selectionMessageContractSchema.safeParse({ ...prompt, professional_phone_e164: "+5566999999999" }).success, false);
  const refused = mapSelectionCommandOutcome({ kind: "consent_declined" });
  assert.match(presentSelectionMessage(refused)!, /não foram compartilhados/u);
});
