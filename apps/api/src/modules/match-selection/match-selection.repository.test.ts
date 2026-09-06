import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { QueryResultRow } from "pg";
import {
  PostgresSelectionMatchRepository,
  type SelectionMatchQuery,
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
    return { rows: (results.shift() ?? []) as T[] };
  };
  return { calls, repository: new PostgresSelectionMatchRepository(execute) };
}

test("selection match repository returns an empty state when the search has no matches", async () => {
  const context = fakeDatabase([[{ total_match_count: 0, shown_match_count: 0 }]]);
  assert.deepEqual(await context.repository.getState(searchRequestId), {
    totalMatchCount: 0,
    shownMatchCount: 0,
    hasMore: false,
  });
  assert.match(context.calls[0]!.text, /COUNT\(\*\).*total_match_count/us);
  assert.match(context.calls[0]!.text, /FILTER \(WHERE shown_at IS NOT NULL\)/u);
  assert.deepEqual(context.calls[0]!.values, [searchRequestId]);
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
  assert.deepEqual(context.calls[0]!.values, [searchRequestId, 2]);
  assert.doesNotMatch(context.calls[0]!.text, /UPDATE|INSERT|DELETE|shown_at\s*=|selected_at\s*=/u);
});
