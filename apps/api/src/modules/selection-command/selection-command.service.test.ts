import assert from "node:assert/strict";
import test from "node:test";
import { DefaultSelectionCommandService } from "./selection-command.service.js";
import type { SelectionCommandInput } from "./selection-command.types.js";
import type { SelectionMatchRepository, SelectionMatchState } from "../match-selection/match-selection.types.js";

const input: SelectionCommandInput = {
  conversationId: "11111111-1111-4111-8111-111111111111",
  customerId: "22222222-2222-4222-8222-222222222222",
  searchRequestId: "33333333-3333-4333-8333-333333333333",
  pendingSlot: "selection",
  rawText: "2",
  lastMessageText: "quero o segundo",
  selectionKey: "77777777-7777-4777-8777-777777777777",
};

class FakeSelectionMatchRepository implements SelectionMatchRepository {
  state: SelectionMatchState = { totalMatchCount: 3, shownMatchCount: 2, hasMore: true };
  selected = {
    kind: "selected" as const,
    contactId: "44444444-4444-4444-8444-444444444444",
    matchId: "55555555-5555-4555-8555-555555555555",
    professionalId: "66666666-6666-4666-8666-666666666666",
    professionalDisplayName: "Ana Eletricista",
    professionalPhoneE164: "+5566999999999",
    serviceName: "Eletricista",
    selectedAt: new Date("2026-09-06T12:00:00.000Z"),
    replayed: false,
  };
  getStateCalls = 0;
  selectCalls: Array<Record<string, unknown>> = [];
  recoveryCalls: Array<[string, string]> = [];
  async getState() { this.getStateCalls += 1; return this.state; }
  async findShownByPosition() { return null; }
  async listShown() { return [
    { rankPosition: 1, displayName: "Ana Eletricista" },
    { rankPosition: 2, displayName: "João Encanador" },
  ] as never; }
  async listNextUnshown() { return []; }
  async findSelectedByCustomerAndSelectionKey(customerId: string, selectionKey: string) {
    this.recoveryCalls.push([customerId, selectionKey]);
    return { ...this.selected, replayed: true };
  }
  async selectShownMatch(value: Parameters<SelectionMatchRepository["selectShownMatch"]>[0]) {
    this.selectCalls.push(value);
    return this.selected;
  }
}

function context() {
  const selectionMatchRepository = new FakeSelectionMatchRepository();
  return { selectionMatchRepository, service: new DefaultSelectionCommandService({ selectionMatchRepository }) };
}

test("selection command service selects numbered and ordinal shown matches", async () => {
  for (const rawText of ["2", "quero o segundo"]) {
    const current = context();
    assert.deepEqual(await current.service.process({ ...input, rawText }), current.selectionMatchRepository.selected);
    assert.equal(current.selectionMatchRepository.getStateCalls, 1);
    assert.deepEqual(current.selectionMatchRepository.selectCalls, [{
      conversationId: input.conversationId,
      customerId: input.customerId,
      searchRequestId: input.searchRequestId,
      position: 2,
      lastMessageText: input.lastMessageText,
      selectionKey: input.selectionKey,
    }]);
  }
});

test("selection command service selects shown professionals by name and natural phrase", async () => {
  for (const rawText of ["Ana Eletricista", "ana", "quero a Ana", "pode ser o João"]) {
    const current = context();
    assert.equal((await current.service.process({ ...input, rawText })).kind, "selected");
    assert.equal(current.selectionMatchRepository.selectCalls.length, 1);
  }
});

test("selection command service returns ambiguity without selecting when names are not unique", async () => {
  const current = context();
  current.selectionMatchRepository.listShown = async () => [
    { rankPosition: 1, displayName: "Ana Souza" },
    { rankPosition: 3, displayName: "Ana Silva" },
  ] as never;
  assert.deepEqual(await current.service.process({ ...input, rawText: "quero a Ana" }), {
    kind: "ambiguous_selection",
    options: [
      { position: 1, professionalDisplayName: "Ana Souza" },
      { position: 3, professionalDisplayName: "Ana Silva" },
    ],
  });
  assert.deepEqual(current.selectionMatchRepository.selectCalls, []);
});

test("selection command service keeps the conversation active for non-affirmative or mixed references", async () => {
  for (const rawText of [
    "não quero a Ana",
    "A Ana atende domingo?",
    "quanto cobra a Ana?",
    "se a Ana atender hoje eu escolho ela",
    "opção 1 ou João",
  ]) {
    const current = context();
    const outcome = await current.service.process({ ...input, rawText });
    assert.deepEqual(outcome, { kind: "not_command" }, rawText);
    assert.deepEqual(current.selectionMatchRepository.selectCalls, [], rawText);
  }
});

test("selection command service never returns one-option ambiguity", async () => {
  for (const rawText of ["Ana opção 1", "quero a Ana opção 1", "quero uma Ana", "quero um João"]) {
    const current = context();
    const outcome = await current.service.process({ ...input, rawText });
    assert.equal(outcome.kind, "selected", rawText);
    assert.equal(current.selectionMatchRepository.selectCalls.length, 1, rawText);
  }
  const conflicting = context();
  assert.deepEqual(await conflicting.service.process({ ...input, rawText: "Ana opção 2" }), { kind: "not_command" });
  assert.deepEqual(conflicting.selectionMatchRepository.selectCalls, []);
});

test("selection command service rejects positions that were not presented without writes", async () => {
  const current = context();
  assert.deepEqual(await current.service.process({ ...input, rawText: "3" }), {
    kind: "invalid_selection", requestedPosition: 3, visibleMatchCount: 2,
  });
  assert.equal(current.selectionMatchRepository.getStateCalls, 1);
  assert.deepEqual(current.selectionMatchRepository.selectCalls, []);
});

test("selection command service returns show-more state without changing matches", async () => {
  for (const state of [
    { totalMatchCount: 3, shownMatchCount: 2, hasMore: true },
    { totalMatchCount: 2, shownMatchCount: 2, hasMore: false },
  ]) {
    const current = context();
    current.selectionMatchRepository.state = state;
    assert.deepEqual(await current.service.process({ ...input, rawText: "mostrar mais" }), {
      kind: "show_more_requested", hasMore: state.hasMore, shownMatchCount: state.shownMatchCount,
    });
    assert.deepEqual(current.selectionMatchRepository.selectCalls, []);
  }
});

test("selection command service returns the next ranked page using the conversation limit", async () => {
  const current = context();
  const next = [
    { matchId: "88888888-8888-4888-8888-888888888888", rankPosition: 4, displayName: "Maria", serviceName: "Eletricista" },
    { matchId: "99999999-9999-4999-8999-999999999999", rankPosition: 5, displayName: "Carlos", serviceName: "Eletricista" },
  ] as never;
  let requestedLimit = 0;
  current.selectionMatchRepository.listNextUnshown = async (_searchRequestId: string, limit: number) => { requestedLimit = limit; return next; };
  const outcome = await current.service.process({ ...input, rawText: "mostrar mais", limit: 2 });
  assert.equal(requestedLimit, 2);
  assert.equal(outcome.kind, "show_more_requested");
  if (outcome.kind === "show_more_requested") assert.deepEqual(outcome.matches, next);
});

test("selection command service leaves free text and global commands without writes", async () => {
  const cases = [
    ["preciso de dois eletricistas", { kind: "not_command" }],
    ["cancelar", { kind: "global_command", command: { kind: "cancel" } }],
    ["recomeçar", { kind: "global_command", command: { kind: "restart" } }],
    ["ajuda", { kind: "global_command", command: { kind: "help" } }],
  ] as const;
  for (const [rawText, expected] of cases) {
    const current = context();
    assert.deepEqual(await current.service.process({ ...input, rawText }), expected);
    assert.equal(current.selectionMatchRepository.getStateCalls, 1);
    assert.deepEqual(current.selectionMatchRepository.selectCalls, []);
  }
});

test("selection command service rejects invalid contexts without querying or writing", async () => {
  const cases: Array<[Partial<SelectionCommandInput>, string]> = [
    [{ conversationId: "" }, "missing_conversation_id"],
    [{ customerId: null }, "missing_customer_id"],
    [{ searchRequestId: null }, "missing_search_request_id"],
    [{ pendingSlot: "location" }, "not_awaiting_selection"],
  ];
  for (const [override, reason] of cases) {
    const current = context();
    assert.deepEqual(await current.service.process({ ...input, ...override }), { kind: "invalid_context", reason });
    assert.equal(current.selectionMatchRepository.getStateCalls, 0);
    assert.deepEqual(current.selectionMatchRepository.selectCalls, []);
  }
});

test("selection command service recovers a selection without parsing or selecting again", async () => {
  const current = context();
  assert.deepEqual(
    await current.service.recoverSelection(input.customerId!, input.selectionKey),
    { ...current.selectionMatchRepository.selected, replayed: true },
  );
  assert.deepEqual(current.selectionMatchRepository.recoveryCalls, [[input.customerId, input.selectionKey]]);
  assert.equal(current.selectionMatchRepository.getStateCalls, 0);
  assert.deepEqual(current.selectionMatchRepository.selectCalls, []);
});

test("selection command service waits for a reserved page and caps the next page", async () => {
  const current = context();
  let calls = 0;
  current.selectionMatchRepository.listNextUnshown = async (_id: string, limit: number) => {
    calls += 1;
    assert.equal(limit, 3);
    return [];
  };
  current.selectionMatchRepository.state = { totalMatchCount: 20, shownMatchCount: 3, hasMore: true, hasPendingReservations: true };
  assert.deepEqual(await current.service.process({ ...input, rawText: "mostrar mais", limit: 10 }), {
    kind: "show_more_requested", shownMatchCount: 3, hasMore: true,
  });
  assert.equal(calls, 0);
  current.selectionMatchRepository.state.hasPendingReservations = false;
  await current.service.process({ ...input, rawText: "mostrar mais", limit: 10 });
  assert.equal(calls, 1);
  assert.deepEqual(current.selectionMatchRepository.selectCalls, []);
});
