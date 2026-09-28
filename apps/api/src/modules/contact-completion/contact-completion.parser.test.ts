import test from "node:test";
import assert from "node:assert/strict";
import { parseContactCompletionCommand } from "./contact-completion.parser.js";

test("parses declaration variations accurately with public code", () => {
  const code = "CC-23456789";
  assert.deepEqual(parseContactCompletionCommand(`concluido ${code}`), { kind: "declare", code });
  assert.deepEqual(parseContactCompletionCommand(`concluído ${code}`), { kind: "declare", code });
  assert.deepEqual(parseContactCompletionCommand(`Concluído ${code}!`), { kind: "declare", code });
  assert.deepEqual(parseContactCompletionCommand(`serviço concluído ${code}`), { kind: "declare", code });
  assert.deepEqual(parseContactCompletionCommand(`servico concluido ${code}.`), { kind: "declare", code });
  assert.deepEqual(parseContactCompletionCommand(`concluído o serviço ${code}`), { kind: "declare", code });
});

test("parses code-free declaration variations accurately", () => {
  assert.deepEqual(parseContactCompletionCommand("concluido"), { kind: "declare", code: null });
  assert.deepEqual(parseContactCompletionCommand("concluído!"), { kind: "declare", code: null });
  assert.deepEqual(parseContactCompletionCommand("já terminei"), { kind: "declare", code: null });
  assert.deepEqual(parseContactCompletionCommand("serviço concluído"), { kind: "declare", code: null });
  assert.deepEqual(parseContactCompletionCommand("já finalizei"), { kind: "declare", code: null });
});

test("parses confirmation variations accurately with and without code", () => {
  const code = "CC-ABCDEFGH";
  assert.deepEqual(parseContactCompletionCommand(`confirmar ${code}`), { kind: "confirm", code });
  assert.deepEqual(parseContactCompletionCommand(`confirmo ${code}`), { kind: "confirm", code });
  assert.deepEqual(parseContactCompletionCommand("confirmar"), { kind: "confirm", code: null });
  assert.deepEqual(parseContactCompletionCommand("confirmo"), { kind: "confirm", code: null });
  assert.deepEqual(parseContactCompletionCommand("confirmo o atendimento"), { kind: "confirm", code: null });
});

test("parses contestation variations accurately with and without code", () => {
  const code = "CC-23456789";
  assert.deepEqual(parseContactCompletionCommand(`contestar ${code}`), { kind: "contest", code });
  assert.deepEqual(parseContactCompletionCommand(`contesto ${code}`), { kind: "contest", code });
  assert.deepEqual(parseContactCompletionCommand("contestar"), { kind: "contest", code: null });
  assert.deepEqual(parseContactCompletionCommand("não foi concluído"), { kind: "contest", code: null });
  assert.deepEqual(parseContactCompletionCommand("não deu certo"), { kind: "contest", code: null });
});

test("rejects question marks and non-completion text", () => {
  assert.equal(parseContactCompletionCommand("concluído CC-23456789?"), null);
  assert.equal(parseContactCompletionCommand("confirmar CC-23456789?"), null);
  assert.equal(parseContactCompletionCommand("contestar CC-23456789?"), null);
  assert.equal(parseContactCompletionCommand("já terminei?"), null);
  assert.equal(parseContactCompletionCommand("o serviço foi concluído com sucesso"), null);
  assert.equal(parseContactCompletionCommand("quero cancelar CC-23456789"), null);
  assert.equal(parseContactCompletionCommand("qual o status do CC-23456789"), null);
});
