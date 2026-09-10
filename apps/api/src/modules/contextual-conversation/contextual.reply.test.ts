import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { emptyMemory, validateContextualQuestion, type ContextualDecision, type ContextualReplyContext } from "./contextual.contract.js";
import { contextualQuestionContext, contextualClarificationText, contextualCatalogText, validatePersistedContextualQuestion } from "./contextual.reply.js";

const slot = (value: string) => ({ value, source: "user_explicit" as const, inboundId: randomUUID() });
test("B2 asks only missing fields and distinguishes ambiguous location", () => {
  const decision: ContextualDecision = { kind: "search", memory: emptyMemory(), correction: false };
  decision.memory.location = slot("Sinop");
  assert.deepEqual(contextualQuestionContext(decision, false, false), { target: "service", services: [], location: "Sinop", reason: "missing" });
  decision.memory.service = slot("Encanador");
  assert.equal(contextualQuestionContext(decision, true, true), null);
  assert.equal(contextualQuestionContext(decision, true, false)?.reason, "ambiguous");
  decision.memory.location = null;
  assert.deepEqual(contextualQuestionContext(decision, true, false), { target: "location", services: ["Encanador"], location: null, reason: "missing" });
});
test("B2 information and interruptions do not ask about remembered hypotheses", () => {
  const memory = emptyMemory(); memory.hypotheses = [{ key: "encanador", name: "Encanador", evidence: "pia", inboundId: randomUUID() }];
  for (const kind of ["faq_cost", "catalog_info", "out_of_scope", "delegate"] as const) {
    assert.equal(contextualQuestionContext({ kind, memory, correction: false }, false, false), null);
  }
});
test("B2 question composition is constrained to the controller target and allowed facts", () => {
  const context: ContextualReplyContext = { target: "location", services: ["Encanador"], location: null, reason: "missing" };
  assert.equal(validateContextualQuestion({ target: "location", question: "Em qual cidade precisa desse atendimento?" }, context), "Em qual cidade precisa desse atendimento?");
  for (const value of [
    { target: "service", question: "Qual serviço você precisa?" },
    { target: "location", question: "Qual serviço você precisa?" },
    { target: "location", question: "Já avisei o profissional, pode aguardar?" },
    { target: "location", question: "Vou avisar alguém agora, pode esperar?" },
    { target: "location", question: "Já agendei o atendimento, tudo bem?" },
    { target: "location", question: "O profissional está disponível?" },
    { target: "location", question: "O preço é R$ 50, aceita?" },
    { target: "location", question: "Posso enviar para +5566999999999?" },
    { target: "location", question: "Qual cidade?", action: "send_contact" },
  ]) assert.throws(() => validateContextualQuestion(value, context));
  assert.throws(() => validateContextualQuestion({ target: "service", question: "Em qual cidade você está?" }, { ...context, target: "service", services: [], location: "Sinop" }));
  assert.throws(() => validateContextualQuestion({ target: "service_confirmation", question: "Você precisa de pedreiro?" }, { ...context, target: "service_confirmation", reason: "ambiguous" }));
  assert.equal(validateContextualQuestion({ target: "service_confirmation", question: "É de encanador que você precisa?" }, { ...context, target: "service_confirmation", reason: "ambiguous" }), "É de encanador que você precisa?");
});
test("B2 deterministic fallback and catalog reply do not claim availability or completed actions", () => {
  assert.match(contextualClarificationText({ target: "location", services: ["Encanador"], location: null, reason: "missing" }), /cidade/);
  assert.match(contextualClarificationText({ target: "location", services: ["Encanador"], location: "Centro", reason: "ambiguous" }), /ainda não ficou clara/);
  assert.match(contextualCatalogText(["Encanador"]), /Isso não confirma profissionais/);
  assert.match(contextualCatalogText([]), /Não identifiquei/);
});

test("Persisted deterministic fallbacks are reusable only for their current validated question context", () => {
  const contexts: ContextualReplyContext[] = [
    {target:"location",services:["Reparo 24h"],location:null,reason:"missing"},
    {target:"location",services:["Encanador"],location:"Centro",reason:"ambiguous"},
    {target:"service",services:[],location:"Sinop",reason:"missing"},
    {target:"service_confirmation",services:["Encanador"],location:null,reason:"ambiguous"},
  ];
  for (const context of contexts) {
    const text=contextualClarificationText(context);
    assert.equal(validatePersistedContextualQuestion(text,context),text);
    assert.throws(()=>validatePersistedContextualQuestion(`${text} Enviei seu contato.`,context));
  }
  assert.throws(()=>validatePersistedContextualQuestion(contextualClarificationText(contexts[0]),{...contexts[0],services:["Eletricista"]}));
  assert.throws(()=>validatePersistedContextualQuestion("Já selecionei o profissional?",contexts[0]));
  const question="Em qual cidade precisa desse atendimento?";
  assert.equal(validatePersistedContextualQuestion(question,contexts[0]),question);
});
