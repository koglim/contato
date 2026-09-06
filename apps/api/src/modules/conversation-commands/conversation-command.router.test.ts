import assert from "node:assert/strict";
import test from "node:test";
import { routeConversationCommand } from "./conversation-command.router.js";
import type { ConversationCommandState } from "./conversation-command.types.js";

const states: ConversationCommandState[] = [
  { kind: "awaiting_service" },
  { kind: "awaiting_location" },
  { kind: "awaiting_selection", visibleMatchCount: 3 },
];

test("routes every global command in every conversation state", () => {
  const commands = [
    ["cancelar", { kind: "cancel" }],
    ["nova busca", { kind: "restart" }],
    ["ajuda", { kind: "help" }],
  ] as const;

  for (const state of states) {
    for (const [rawText, command] of commands) {
      assert.deepEqual(
        routeConversationCommand(rawText, state),
        { kind: "global_command", command },
        `${state.kind}: ${rawText}`,
      );
    }
  }
});

test("rejects selection commands outside awaiting_selection", () => {
  const selectionTexts = ["mais opções", "2", "segundo", "opção dois"];
  const statesOutsideSelection: ConversationCommandState[] = [
    { kind: "awaiting_service" },
    { kind: "awaiting_location" },
  ];

  for (const state of statesOutsideSelection) {
    for (const rawText of selectionTexts) {
      assert.deepEqual(routeConversationCommand(rawText, state), { kind: "not_command" }, `${state.kind}: ${rawText}`);
    }
  }
});

test("routes selections within every valid visible-match count", () => {
  for (const visibleMatchCount of [1, 3, 5, 6, 10]) {
    const state = { kind: "awaiting_selection", visibleMatchCount } as const;
    assert.deepEqual(
      routeConversationCommand(String(visibleMatchCount), state),
      { kind: "selection_command", command: { kind: "select_match", position: visibleMatchCount } },
      String(visibleMatchCount),
    );
  }
});

test("reports selections beyond the visible list as invalid", () => {
  for (const [visibleMatchCount, requestedPosition] of [[1, 2], [3, 4], [5, 6], [6, 7]] as const) {
    assert.deepEqual(
      routeConversationCommand(String(requestedPosition), { kind: "awaiting_selection", visibleMatchCount }),
      { kind: "invalid_selection", requestedPosition, visibleMatchCount },
    );
  }
});

test("treats every selection as invalid when no matches are visible", () => {
  for (const rawText of ["1", "primeiro", "opção dois"]) {
    const requestedPosition = rawText === "opção dois" ? 2 : 1;
    assert.deepEqual(
      routeConversationCommand(rawText, { kind: "awaiting_selection", visibleMatchCount: 0 }),
      { kind: "invalid_selection", requestedPosition, visibleMatchCount: 0 },
    );
  }
});

test("routes show_more only while awaiting selection", () => {
  assert.deepEqual(
    routeConversationCommand("quero ver mais", { kind: "awaiting_selection", visibleMatchCount: 0 }),
    { kind: "selection_command", command: { kind: "show_more" } },
  );
});

test("leaves ambiguous phrases as not_command", () => {
  for (const rawText of [
    "preciso de 2 eletricistas",
    "quero alguém mais barato",
    "mais perto",
    "não quero o segundo",
    "2 eletricistas",
  ]) {
    assert.deepEqual(
      routeConversationCommand(rawText, { kind: "awaiting_selection", visibleMatchCount: 10 }),
      { kind: "not_command" },
      rawText,
    );
  }
});
