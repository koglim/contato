import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGlobalConversationCommand,
  parseSelectionConversationCommand,
} from "./conversation-command.parser.js";

test("parses only unequivocal global conversation commands", () => {
  const cases = [
    ["cancelar", "cancel"],
    ["CANCELA", "cancel"],
    ["  parar  ", "cancel"],
    ["Encerrar!", "cancel"],
    ["recomeçar", "restart"],
    ["RECOMECAR.", "restart"],
    ["começar   novamente", "restart"],
    ["comecar novamente?", "restart"],
    ["nova busca", "restart"],
    ["AJUDA", "help"],
    ["preciso de ajuda.", "help"],
    ["não entendi", "help"],
    ["NAO ENTENDI!", "help"],
  ] as const;

  for (const [rawText, kind] of cases) {
    assert.deepEqual(parseGlobalConversationCommand(rawText), { kind }, rawText);
  }
});

test("parses show-more commands only in their complete conservative forms", () => {
  for (const rawText of ["mais", "VER MAIS", " mostrar   mais! ", "outras opções", "OUTRAS OPCOES."]) {
    assert.deepEqual(parseSelectionConversationCommand(rawText), { kind: "show_more" }, rawText);
  }
});

test("parses isolated positions from 1 to 10", () => {
  for (let position = 1; position <= 10; position += 1) {
    assert.deepEqual(
      parseSelectionConversationCommand(`  ${position}.  `),
      { kind: "select_match", position },
      String(position),
    );
  }
});

test("parses explicit option phrases and supported ordinals", () => {
  const cases = [
    ["opção 2", 2],
    ["OPCAO   10!", 10],
    ["quero a opção 2", 2],
    ["Quero a OPCAO 7.", 7],
    ["primeiro", 1],
    ["PRIMEIRA!", 1],
    ["segundo", 2],
    ["segunda.", 2],
    ["terceiro", 3],
    ["terceira?", 3],
  ] as const;

  for (const [rawText, position] of cases) {
    assert.deepEqual(parseSelectionConversationCommand(rawText), { kind: "select_match", position }, rawText);
  }
});

test("rejects invalid positions and ambiguous free text", () => {
  for (const rawText of [
    "0",
    "01",
    "-1",
    "11",
    "opção 0",
    "opção 01",
    "opcao 11",
    "quero a opção 20",
    "preciso de 2 eletricistas",
    "quero alguém mais barato",
    "mais perto",
    "não quero o segundo",
    "pode mostrar eletricistas?",
    "quero o primeiro",
    "opção dois",
    "2 eletricistas",
  ]) {
    assert.equal(parseSelectionConversationCommand(rawText), null, rawText);
  }
});

test("keeps global and selection command scopes separate", () => {
  for (const rawText of ["cancelar", "recomeçar", "ajuda", "não entendi"]) {
    assert.equal(parseSelectionConversationCommand(rawText), null, rawText);
  }
  for (const rawText of ["mais", "ver mais", "opção 2", "3", "primeiro"]) {
    assert.equal(parseGlobalConversationCommand(rawText), null, rawText);
  }
});

test("does not accept extra leading or trailing conversation text", () => {
  for (const rawText of [
    "por favor cancelar",
    "cancelar minha busca",
    "ajuda com eletricista",
    "nova busca de encanador",
    "mostrar mais profissionais",
    "opção 2 por favor",
  ]) {
    assert.equal(parseGlobalConversationCommand(rawText), null, rawText);
    assert.equal(parseSelectionConversationCommand(rawText), null, rawText);
  }
});
