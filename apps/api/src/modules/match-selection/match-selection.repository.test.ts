import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { QueryResultRow } from "pg";
import {
  PostgresSelectionMatchRepository,
  type SelectionMatchQuery,
  type SelectionMatchTransaction,
} from "./match-selection.repository.js";

const searchRequestId = randomUUID();
const matchId = randomUUID();
const professionalId = randomUUID();
const shownAt = new Date("2026-09-06T12:00:00.000Z");
const selectedAt = new Date("2026-09-06T12:05:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    match_id: matchId,
    search_request_id: searchRequestId,
    professional_id: professionalId,
    rank_position: 2,
    shown_at: shownAt,
    selected_at: selectedAt,
    display_name: "Ana Eletricista",
    phone_e164: "+5566999999999",
    slug: "ana-eletricista",
    profile_image_url: "https://example.com/ana.jpg",
    is_verified: true,
    service_name: "Eletricista",
    service_description: "Instalações elétricas",
    price_mode: "from",
    price_from_cents: 15000,
    price_to_cents: null,
    distance_meters: 1200,
    effective_available_now: true,
    ...overrides,
  };
}

function fakeDatabase(results: QueryResultRow[][]) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const execute: SelectionMatchQuery = async <T extends QueryResultRow>(text: string, values = []) => {
    calls.push({ text, values });
    let bilateralRows: QueryResultRow[] | undefined;
    if (text.includes("FROM channel_inbound_messages inbound")) bilateralRows = [{ id: selectInput.selectionKey, provider: "test", phone_e164: "+5566977777777", raw_text: selectInput.lastMessageText, created_at: selectedAtForTest, decision_at: selectedAtForTest }];
    if (text.includes("FROM channel_outbound_message_matches presentation")) bilateralRows = [{ id: conversationId, sent_at: shownAt }];
    if (text.includes("SELECT city, state, neighborhood, raw_text")) bilateralRows = [{ city: "Sinop", state: "MT", neighborhood: null, raw_text: "preciso de eletricista" }];
    if (text.includes("INSERT INTO channel_outbound_messages")) bilateralRows = [{ id: randomUUID() }];
    if (bilateralRows) return { rows: bilateralRows as T[] };
    return { rows: (results.shift() ?? []) as T[] };
  };
  let committed = 0;
  let rolledBack = 0;
  const transaction: SelectionMatchTransaction = async (callback) => {
    try {
      const value = await callback({ query: execute });
      committed += 1;
      return value;
    } catch (error) {
      rolledBack += 1;
      throw error;
    }
  };
  return {
    calls,
    transactionState: () => ({ committed, rolledBack }),
    repository: new PostgresSelectionMatchRepository(execute, transaction, () => "CC-23456789"),
  };
}

const conversationId = randomUUID();
const customerId = randomUUID();
const contactId = randomUUID();
const selectedAtForTest = new Date("2026-09-06T12:10:00.000Z");
const selectInput = {
  conversationId,
  customerId,
  searchRequestId,
  position: 2,
  lastMessageText: "quero a segunda",
  selectionKey: randomUUID(),
};

function activeConversation(overrides: Record<string, unknown> = {}) {
  return {
    customer_id: customerId,
    status: "active",
    pending_slot: "selection",
    search_request_id: searchRequestId,
    is_current: true,
    ...overrides,
  };
}

function selectableSearchRequest(overrides: Record<string, unknown> = {}) {
  return { customer_id: customerId, status: "matched", ...overrides };
}

function selectableMatch(overrides: Record<string, unknown> = {}) {
  return {
    match_id: matchId,
    professional_id: professionalId,
    display_name: "Ana Eletricista",
    phone_e164: "+5566999999999",
    service_name: "Eletricista",
    ...overrides,
  };
}

test("selection match repository returns an empty state when the search has no matches", async () => {
  const context = fakeDatabase([[{ total_match_count: 0, shown_match_count: 0 }]]);
  assert.deepEqual(await context.repository.getState(searchRequestId), {
    totalMatchCount: 0,
    shownMatchCount: 0,
    hasMore: false,
  });
  assert.match(context.calls[0]!.text, /FILTER \(WHERE rank_position IS NOT NULL\).*total_match_count/us);
  assert.match(context.calls[0]!.text, /rank_position IS NOT NULL AND shown_at IS NOT NULL/u);
  assert.deepEqual(context.calls[0]!.values, [searchRequestId, 6]);
  assert.doesNotMatch(context.calls[0]!.text, /UPDATE|INSERT|DELETE|shown_at\s*=|selected_at\s*=/u);
});

test("selection match repository counts shown matches and reports whether unshown matches remain", async () => {
  const context = fakeDatabase([
    [{ total_match_count: "5", shown_match_count: "2" }],
    [{ total_match_count: 5, shown_match_count: 5 }],
  ]);
  assert.deepEqual(await context.repository.getState(searchRequestId), {
    totalMatchCount: 5,
    shownMatchCount: 2,
    hasMore: true,
  });
  assert.deepEqual(await context.repository.getState(searchRequestId), {
    totalMatchCount: 5,
    shownMatchCount: 5,
    hasMore: false,
  });
});

test("selection match repository excludes unranked matches from total and shown counts", async () => {
  const context = fakeDatabase([
    [{ total_match_count: 0, shown_match_count: 0 }],
    [{ total_match_count: 0, shown_match_count: 0 }],
  ]);

  assert.deepEqual(await context.repository.getState(searchRequestId), {
    totalMatchCount: 0,
    shownMatchCount: 0,
    hasMore: false,
  }, "an unranked match does not contribute to the total");
  assert.deepEqual(await context.repository.getState(searchRequestId), {
    totalMatchCount: 0,
    shownMatchCount: 0,
    hasMore: false,
  }, "a shown but unranked match does not contribute to the shown count");
  assert.match(context.calls[0]!.text, /FILTER \(WHERE rank_position IS NOT NULL\)/u);
  assert.match(context.calls[1]!.text, /rank_position IS NOT NULL AND shown_at IS NOT NULL/u);
});

test("selection match repository reports more only for ranked unshown matches", async () => {
  const context = fakeDatabase([
    [{ total_match_count: 2, shown_match_count: 1 }],
    [{ total_match_count: 1, shown_match_count: 1 }],
  ]);

  assert.equal((await context.repository.getState(searchRequestId)).hasMore, true);
  assert.equal(
    (await context.repository.getState(searchRequestId)).hasMore,
    false,
    "only an unranked match remains",
  );
});

test("selection match repository returns only a shown match at the requested position", async () => {
  const context = fakeDatabase([[row()]]);
  const found = await context.repository.findShownByPosition(searchRequestId, 2);
  assert.deepEqual(found, {
    matchId,
    searchRequestId,
    professionalId,
    rankPosition: 2,
    shownAt,
    selectedAt,
    displayName: "Ana Eletricista",
    phoneE164: "+5566999999999",
    slug: "ana-eletricista",
    profileImageUrl: "https://example.com/ana.jpg",
    isVerified: true,
    serviceName: "Eletricista",
    serviceDescription: "Instalações elétricas",
    priceMode: "from",
    priceFromCents: 15000,
    priceToCents: null,
    distanceMeters: 1200,
    effectiveAvailableNow: true,
  });
  assert.match(context.calls[0]!.text, /matches.rank_position = \$2/u);
  assert.match(context.calls[0]!.text, /matches.shown_at IS NOT NULL/u);
  assert.match(context.calls[0]!.text, /score_breakdown ->> 'distance_meters'/u);
  assert.match(context.calls[0]!.text, /score_breakdown ->> 'effective_available_now'/u);
  assert.deepEqual(context.calls[0]!.values, [searchRequestId, 2]);
  assert.doesNotMatch(context.calls[0]!.text, /UPDATE|INSERT|DELETE|shown_at\s*=|selected_at\s*=/u);
});

test("selection match repository rejects missing and not-yet-shown positions", async () => {
  const context = fakeDatabase([[], []]);
  assert.equal(await context.repository.findShownByPosition(searchRequestId, 9), null);
  assert.equal(await context.repository.findShownByPosition(searchRequestId, 3), null);
  assert.match(context.calls[1]!.text, /matches.shown_at IS NOT NULL/u);
});

test("selection match repository lists ordered unshown matches within the requested limit", async () => {
  const context = fakeDatabase([[
    row({ match_id: randomUUID(), rank_position: 3, shown_at: null, selected_at: null }),
    row({ match_id: randomUUID(), rank_position: 4, shown_at: null, selected_at: null, price_mode: "range", price_to_cents: 22000 }),
  ]]);
  const matches = await context.repository.listNextUnshown(searchRequestId, 2);
  assert.deepEqual(matches.map((match) => match.rankPosition), [3, 4]);
  assert.equal(matches[1]?.priceMode, "range");
  assert.equal(matches[1]?.priceToCents, 22000);
  assert.match(context.calls[0]!.text, /matches.shown_at IS NULL/u);
  assert.match(context.calls[0]!.text, /matches.rank_position IS NOT NULL/u);
  assert.match(context.calls[0]!.text, /ORDER BY matches.rank_position ASC/u);
  assert.match(context.calls[0]!.text, /LIMIT \$2/u);
  assert.match(context.calls[0]!.text, /matches.rank_position <= \$3/u);
  assert.deepEqual(context.calls[0]!.values, [searchRequestId, 2, 6]);
  assert.doesNotMatch(context.calls[0]!.text, /UPDATE|INSERT|DELETE|shown_at\s*=|selected_at\s*=/u);
});

test("selection match repository lists only shown ranked matches for name resolution", async () => {
  const context = fakeDatabase([[
    row({ rank_position: 1, shown_at: shownAt, selected_at: null }),
    row({ match_id: randomUUID(), rank_position: 3, shown_at: shownAt, selected_at: null }),
  ]]);
  const matches = await context.repository.listShown(searchRequestId);
  assert.deepEqual(matches.map((match) => match.rankPosition), [1, 3]);
  assert.match(context.calls[0]!.text, /matches.shown_at IS NOT NULL/u);
  assert.match(context.calls[0]!.text, /matches.rank_position IS NOT NULL/u);
  assert.match(context.calls[0]!.text, /ORDER BY matches.rank_position ASC/u);
  assert.deepEqual(context.calls[0]!.values, [searchRequestId]);
  assert.doesNotMatch(context.calls[0]!.text, /UPDATE|INSERT|DELETE|shown_at\s*=|selected_at\s*=/u);
});

test("selection match repository selects a shown match atomically and completes its conversation", async () => {
  const context = fakeDatabase([
    [],
    [activeConversation()],
    [],
    [selectableSearchRequest()],
    [{ match_id: matchId, professional_id: professionalId }],
    [{ id: professionalId }],
    [selectableMatch()],
    [{ selected_at: selectedAtForTest }],
    [],
    [{ id: contactId }],
    [],
  ]);
  assert.deepEqual(await context.repository.selectShownMatch(selectInput), {
    kind: "selected",
    contactId,
    matchId,
    professionalId,
    professionalDisplayName: "Ana Eletricista",
    professionalPhoneE164: "+5566999999999",
    serviceName: "Eletricista",
    selectedAt: selectedAtForTest,
    replayed: false,
    publicCode: "CC-23456789",
    conversationId,
    searchRequestId,
  });
  assert.equal(context.transactionState().committed, 1);
  assert.match(context.calls[1]!.text, /search_conversations[\s\S]*FOR NO KEY UPDATE/u);
  assert.match(context.calls[1]!.text, /expires_at > NOW\(\) AS is_current/u);
  assert.match(context.calls[3]!.text, /search_requests[\s\S]*FOR NO KEY UPDATE/u);
  assert.match(context.calls[4]!.text, /shown_at IS NOT NULL/u);
  assert.match(context.calls[4]!.text, /selected_at IS NULL/u);
  assert.match(context.calls[5]!.text, /professionals[\s\S]*FOR UPDATE/u);
  assert.match(context.calls[6]!.text, /FOR UPDATE OF matches/u);
  const sql = context.calls.map((call) => call.text).join("\n");
  assert.match(sql, /SET selected_at = NOW\(\)/u);
  assert.match(sql, /status = 'selected'/u);
  assert.match(sql, /INSERT INTO contacts/u);
  assert.match(sql, /status = 'completed'/u);
  assert.match(sql, /processing_token = NULL/u);
  assert.match(sql, /processing_started_at = NULL/u);
  assert.match(sql, /bilateral_snapshot/u);
  assert.equal(context.calls.filter((call) => /INSERT INTO channel_outbound_messages/u.test(call.text)).length, 2);
  assert.doesNotMatch(context.calls.map((call) => call.text).join("\n"), /shown_at\s*=/u);
});

test("selection match repository returns controlled outcomes before writing", async () => {
  const cases: Array<{ name: string; rows: QueryResultRow[][]; input?: Partial<typeof selectInput>; expected: string }> = [
    { name: "missing conversation", rows: [[], []], expected: "conversation_not_found" },
    { name: "wrong customer", rows: [[], [activeConversation({ customer_id: randomUUID() })], []], expected: "conversation_customer_mismatch" },
    { name: "completed conversation", rows: [[], [activeConversation({ status: "completed", pending_slot: null })], []], expected: "conversation_not_active" },
    { name: "wrong pending slot", rows: [[], [activeConversation({ pending_slot: "location" })], []], expected: "conversation_not_active" },
    { name: "wrong search request", rows: [[], [activeConversation({ search_request_id: randomUUID() })], []], expected: "conversation_not_active" },
    { name: "expired conversation", rows: [[], [activeConversation({ is_current: false })], []], expected: "conversation_expired" },
    { name: "missing search request", rows: [[], [activeConversation()], [], []], expected: "search_request_not_selectable" },
    { name: "foreign search request", rows: [[], [activeConversation()], [], [selectableSearchRequest({ customer_id: randomUUID() })]], expected: "search_request_not_selectable" },
    { name: "unmatched search request", rows: [[], [activeConversation()], [], [selectableSearchRequest({ status: "ready" })]], expected: "search_request_not_selectable" },
    { name: "missing, hidden, unranked, or selected match", rows: [[], [activeConversation()], [], [selectableSearchRequest()], []], expected: "match_not_available" },
  ];

  for (const currentCase of cases) {
    const context = fakeDatabase(currentCase.rows);
    const outcome = await context.repository.selectShownMatch({ ...selectInput, ...currentCase.input });
    assert.equal(outcome.kind, currentCase.expected, currentCase.name);
    assert.equal(context.calls.some((call) => /UPDATE matches|INSERT INTO contacts|UPDATE search_requests/u.test(call.text)), false, currentCase.name);
  }
});

test("selection match repository rolls back if an atomic write fails", async () => {
  // The contact insertion receives no row, which simulates a database write that
  // cannot produce the required contact. The transaction must not commit it.
  const failing = fakeDatabase([
    [], [activeConversation()], [], [selectableSearchRequest()],
    [{ match_id: matchId, professional_id: professionalId }],
    [{ id: professionalId }],
    [selectableMatch()],
    [{ selected_at: selectedAtForTest }], [], [],
  ]);
  await assert.rejects(failing.repository.selectShownMatch(selectInput));
  assert.deepEqual(failing.transactionState(), { committed: 0, rolledBack: 1 });
});

test("selection match repository replays an existing selection without writes", async () => {
  const existing = {
    contact_id: contactId,
    customer_id: customerId,
    search_request_id: searchRequestId,
    match_id: matchId,
    professional_id: professionalId,
    display_name: "Ana Eletricista",
    phone_e164: "+5566999999999",
    service_name: "Eletricista",
    selected_at: selectedAtForTest,
  };
  const context = fakeDatabase([[existing], [{ id: conversationId }]]);
  assert.deepEqual(await context.repository.selectShownMatch(selectInput), {
    kind: "selected",
    contactId,
    matchId,
    professionalId,
    professionalDisplayName: "Ana Eletricista",
    professionalPhoneE164: "+5566999999999",
    serviceName: "Eletricista",
    selectedAt: selectedAtForTest,
    replayed: true,
  });
  assert.equal(context.calls.some((call) => /\b(?:UPDATE|INSERT)\s+(?!OF\b)/u.test(call.text)), false);
});

test("selection match repository rejects a reused key with incompatible context", async () => {
  const context = fakeDatabase([[{
    contact_id: contactId,
    customer_id: customerId,
    search_request_id: searchRequestId,
    match_id: matchId,
    professional_id: professionalId,
    display_name: "Ana Eletricista",
    phone_e164: "+5566999999999",
    service_name: "Eletricista",
    selected_at: selectedAtForTest,
  }], []]);
  assert.deepEqual(
    await context.repository.selectShownMatch({ ...selectInput, conversationId: randomUUID() }),
    { kind: "idempotency_conflict" },
  );
  assert.equal(context.calls.some((call) => /\b(?:UPDATE|INSERT)\s+(?!OF\b)/u.test(call.text)), false);
});

test("selection match repository recovers a selected contact by customer and selection key without writes", async () => {
  const context = fakeDatabase([[{
    contact_id: contactId,
    customer_id: customerId,
    search_request_id: searchRequestId,
    match_id: matchId,
    professional_id: professionalId,
    display_name: "Ana Eletricista",
    phone_e164: "+5566999999999",
    service_name: "Eletricista",
    selected_at: selectedAtForTest,
  }], [{
    contact_id: contactId,
    customer_id: customerId,
    search_request_id: searchRequestId,
    match_id: matchId,
    professional_id: professionalId,
    display_name: "Ana Eletricista",
    phone_e164: "+5566999999999",
    service_name: "Eletricista",
    selected_at: selectedAtForTest,
  }], [], []]);
  const expected = {
    kind: "selected" as const,
    contactId,
    matchId,
    professionalId,
    professionalDisplayName: "Ana Eletricista",
    professionalPhoneE164: "+5566999999999",
    serviceName: "Eletricista",
    selectedAt: selectedAtForTest,
    replayed: true,
  };
  assert.deepEqual(await context.repository.findSelectedByCustomerAndSelectionKey(customerId, selectInput.selectionKey), expected);
  assert.deepEqual(await context.repository.findSelectedByCustomerAndSelectionKey(customerId, selectInput.selectionKey), expected);
  assert.equal(await context.repository.findSelectedByCustomerAndSelectionKey(customerId, randomUUID()), null);
  assert.equal(await context.repository.findSelectedByCustomerAndSelectionKey(randomUUID(), selectInput.selectionKey), null);
  assert.match(context.calls[0]!.text, /contacts.customer_id = \$1/u);
  assert.match(context.calls[0]!.text, /contacts.selection_key = \$2/u);
  assert.equal(context.calls.some((call) => /UPDATE|INSERT|DELETE/u.test(call.text)), false);
});

test("selection match repository serializes competing selections through row locks", async () => {
  const first = fakeDatabase([
    [], [activeConversation()], [], [selectableSearchRequest()],
    [{ match_id: matchId, professional_id: professionalId }],
    [{ id: professionalId }],
    [selectableMatch()],
    [{ selected_at: selectedAtForTest }], [], [{ id: contactId }], [],
  ]);
  assert.equal((await first.repository.selectShownMatch(selectInput)).kind, "selected");
  const second = fakeDatabase([[], [activeConversation({ status: "completed", pending_slot: null })], []]);
  assert.equal((await second.repository.selectShownMatch({ ...selectInput, position: 1 })).kind, "conversation_not_active");
  assert.match(first.calls[1]!.text, /search_conversations[\s\S]*FOR NO KEY UPDATE/u);
  assert.match(first.calls[3]!.text, /search_requests[\s\S]*FOR NO KEY UPDATE/u);
  assert.match(first.calls[5]!.text, /professionals[\s\S]*FOR UPDATE/u);
  assert.match(first.calls[6]!.text, /FOR UPDATE OF matches/u);
});
