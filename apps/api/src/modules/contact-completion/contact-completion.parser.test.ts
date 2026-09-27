import test from "node:test";
import assert from "node:assert/strict";
import { parseContactCompletionCommand } from "./contact-completion.parser.js";

test("parses declaration variations accurately", () => {
  const code = "CC-23456789";
  assert.deepEqual(parseContactCompletionCommand(`concluido ${code}`), { kind: "declare", code });
  assert.deepEqual(parseContactCompletionCommand(`concluído ${code}`), { kind: "declare", code });
  assert.deepEqual(parseContactCompletionCommand(`Concluído ${code}!`), { kind: "declare", code });
  assert.deepEqual(parseContactCompletionCommand(`serviço concluído ${code}`), { kind: "declare", code });
  assert.deepEqual(parseContactCompletionCommand(`servico concluido ${code}.`), { kind: "declare", code });
  assert.deepEqual(parseContactCompletionCommand(`concluído o serviço ${code}`), { kind: "declare", code });
});

test("parses confirmation variations accurately", () => {
  const code = "CC-ABCDEFGH";
  assert.deepEqual(parseContactCompletionCommand(`confirmar ${code}`), { kind: "confirm", code });
  assert.deepEqual(parseContactCompletionCommand(`confirmo ${code}`), { kind: "confirm", code });
  assert.deepEqual(parseContactCompletionCommand(`Confirmar ${code}!`), { kind: "confirm", code });
  assert.deepEqual(parseContactCompletionCommand(`confirmar conclusão ${code}`), { kind: "confirm", code });
});

test("parses contestation variations accurately", () => {
  const code = "CC-23456789";
  assert.deepEqual(parseContactCompletionCommand(`contestar ${code}`), { kind: "contest", code });
  assert.deepEqual(parseContactCompletionCommand(`contesto ${code}`), { kind: "contest", code });
  assert.deepEqual(parseContactCompletionCommand(`Contestar ${code}!`), { kind: "contest", code });
  assert.deepEqual(parseContactCompletionCommand(`contestar conclusão ${code}`), { kind: "contest", code });
});

test("rejects question marks, arbitrary text, or missing codes", () => {
  assert.equal(parseContactCompletionCommand("concluído CC-23456789?"), null);
  assert.equal(parseContactCompletionCommand("confirmar CC-23456789?"), null);
  assert.equal(parseContactCompletionCommand("contestar CC-23456789?"), null);
  assert.equal(parseContactCompletionCommand("concluido"), null);
  assert.equal(parseContactCompletionCommand("o serviço foi concluído com sucesso"), null);
  assert.equal(parseContactCompletionCommand("quero cancelar CC-23456789"), null);
  assert.equal(parseContactCompletionCommand("qual o status do CC-23456789"), null);
});
