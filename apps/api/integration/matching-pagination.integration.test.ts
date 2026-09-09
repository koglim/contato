import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { closeDatabaseConnection, query, withTransaction } from "../src/database/connection.js";
import { PostgresSelectionMatchRepository } from "../src/modules/match-selection/match-selection.repository.js";
import { PostgresMatchingRepository } from "../src/modules/matching/matching.repository.js";
import { associateOutboundMessageMatches, MatchReservationConflictError } from "../src/modules/channel-outbox/channel-outbox.repository.js";

const internalApiKey = "pagination-integration-only";
const headers = { "x-internal-key": internalApiKey };
after(closeDatabaseConnection);

async function fixture(count: number) {
  const categoryId = randomUUID();
  const serviceId = randomUUID();
  const serviceName = `Reparopool${serviceId.replaceAll("-", "")}`;
  const phone = `+5566${BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 8)}`).toString().padStart(10, "0")}`;
  const professionals = Array.from({ length: count }, () => randomUUID());
  const cleanup = async () => {
    await withTransaction(async (client) => {
      await client.query("DELETE FROM channel_inbound_messages WHERE phone_e164 = $1", [phone]);
      await client.query("DELETE FROM contacts WHERE search_request_id IN (SELECT id FROM search_requests WHERE service_id = $1)", [serviceId]);
      await client.query("DELETE FROM matches WHERE search_request_id IN (SELECT id FROM search_requests WHERE service_id = $1)", [serviceId]);
      await client.query("DELETE FROM search_conversations WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)", [phone]);
      await client.query("DELETE FROM search_requests WHERE service_id = $1", [serviceId]);
      await client.query("DELETE FROM professional_service_areas WHERE professional_id = ANY($1::uuid[])", [professionals]);
      await client.query("DELETE FROM professional_services WHERE service_id = $1", [serviceId]);
      await client.query("DELETE FROM professionals WHERE id = ANY($1::uuid[])", [professionals]);
      await client.query("DELETE FROM services WHERE id = $1", [serviceId]);
      await client.query("DELETE FROM service_categories WHERE id = $1", [categoryId]);
      await client.query("DELETE FROM customers WHERE phone_e164 = $1", [phone]);
    });
  };
  await withTransaction(async (client) => {
    await client.query("INSERT INTO service_categories (id, name, slug) VALUES ($1::uuid, 'Pool test', $1::text)", [categoryId]);
    await client.query("INSERT INTO services (id, category_id, name, slug) VALUES ($1, $2, $3::text, $3::text)", [serviceId, categoryId, serviceName]);
    for (const [index, id] of professionals.entries()) {
      await client.query(
        `INSERT INTO professionals (id, display_name, slug, phone_e164, status)
         VALUES ($1::uuid, $2, $1::text, $3, 'active')`,
        [id, `Profissional Pool ${index + 1}`, `+556698${(1000000 + index).toString()}`],
      );
      await client.query("INSERT INTO professional_services (professional_id, service_id) VALUES ($1, $2)", [id, serviceId]);
      await client.query(
        `INSERT INTO professional_service_areas (professional_id, city, state, country_code, center, radius_meters)
         VALUES ($1, 'Sinop', 'MT', 'BR', ST_SetSRID(ST_MakePoint(-55.5, -11.86), 4326)::geography, 10000)`, [id],
      );
    }
  });
  let geocoderCalls = 0;
  const app = buildApp({
    internalApiKey,
    // Only the external geocoder is replaced: routing, interpretation, catalog,
    // matching, Inbox, Outbox, conversations and selection use production code.
    locationResolutionService: { async resolve(input) {
      geocoderCalls += 1;
      return {
        status: "resolved", query: input.query, country_code: "BR", provider: "fixture", candidates: [],
        match: { label: "Sinop", latitude: -11.86, longitude: -55.5, city: "Sinop", state: "MT", country_code: "BR", neighborhood: null, confidence: 1, layer: "locality" },
      };
    } },
  });
  const receive = (text: string, messageId = randomUUID(), limit = 3) => app.inject({
    method: "POST", url: "/internal/channel/inbound/messages", headers,
    payload: { provider: "pool-test", provider_message_id: messageId, phone_e164: phone, raw_text: text, limit },
  });
  const send = async (outboundId: string, failFirst = false) => {
    const claim = async () => {
      const response = await app.inject({ method: "POST", url: `/internal/channel/outbound/${outboundId}/claim`, headers });
      assert.equal(response.statusCode, 200, response.body);
      return response.json<{ processing_token: string }>().processing_token;
    };
    let token = await claim();
    if (failFirst) {
      const failed = await app.inject({ method: "POST", url: `/internal/channel/outbound/${outboundId}/failed`, headers, payload: { processing_token: token, error_code: "transport_timeout" } });
      assert.equal(failed.statusCode, 200, failed.body);
      const unshown = await query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count FROM matches m
         JOIN channel_outbound_message_matches r ON r.match_id = m.id
         WHERE r.channel_outbound_message_id = $1 AND m.shown_at IS NOT NULL`, [outboundId],
      );
      assert.equal(unshown.rows[0].count, 0);
      token = await claim();
    }
    const sent = await app.inject({ method: "POST", url: `/internal/channel/outbound/${outboundId}/sent`, headers, payload: { processing_token: token, provider_message_id: randomUUID() } });
    assert.equal(sent.statusCode, 200, sent.body);
    // Repeated confirmation cannot rewrite exposure time.
    const repeated = await app.inject({ method: "POST", url: `/internal/channel/outbound/${outboundId}/sent`, headers, payload: { processing_token: token, provider_message_id: randomUUID() } });
    assert.equal(repeated.statusCode, 409);
  };
  return { app, serviceId, serviceName, phone, receive, send, geocoderCalls: () => geocoderCalls, cleanup };
}

for (const candidateCount of [0, 1, 2, 3, 4, 6, 20, 25]) {
  test(`real matching persists a bounded pool and presents at most six of ${candidateCount} eligible professionals`, async () => {
    const current = await fixture(candidateCount);
    try {
      const initialId = randomUUID();
      const initial = await current.receive(`preciso de ${current.serviceName} aqui em Sinop`, initialId);
      assert.equal(initial.statusCode, 200, initial.body);
      const first = initial.json<{ outbound: { id: string }; reply_text: string }>();
      const request = await query<{ id: string }>("SELECT id FROM search_requests WHERE service_id = $1", [current.serviceId]);
      assert.equal(request.rows.length, 1, initial.body);
      const searchId = request.rows[0].id;
      const reader = new PostgresSelectionMatchRepository();
      assert.equal((await reader.getState(searchId)).totalMatchCount, Math.min(candidateCount, 20));
      const reserved = await query<{ rank_position: number; shown_at: Date | null }>(
        `SELECT rank_position, shown_at FROM matches m JOIN channel_outbound_message_matches r ON r.match_id = m.id
         WHERE m.search_request_id = $1 ORDER BY rank_position`, [searchId],
      );
      assert.deepEqual(reserved.rows.map((row) => row.rank_position), Array.from({ length: Math.min(candidateCount, 3) }, (_, i) => i + 1));
      assert.ok(reserved.rows.every((row) => row.shown_at === null));
      assert.doesNotMatch(first.reply_text, /\+5566|[0-9a-f]{8}-[0-9a-f-]{27}/u);
      if (!candidateCount) {
        assert.equal((await query("SELECT id FROM search_conversations WHERE search_request_id = $1", [searchId])).rows.length, 0);
        return;
      }
      // While the initial page is pending, no second page may leapfrog it.
      const premature = await current.receive("mostrar mais");
      assert.equal(premature.statusCode, 409, premature.body);
      await current.send(first.outbound.id, candidateCount === 20);
      assert.equal((await reader.getState(searchId)).shownMatchCount, Math.min(candidateCount, 3));
      const replay = await current.receive(`preciso de ${current.serviceName} aqui em Sinop`, initialId);
      assert.equal(replay.json().duplicate, true);
      assert.equal(replay.json().outbound.id, first.outbound.id);
      assert.equal(replay.json().reply_text, first.reply_text);
      const firstShown = (await reader.listShown(searchId)).map((match) => match.shownAt?.getTime());

      if (candidateCount > 3) {
        const pageId = randomUUID();
        const [a, b] = await Promise.all([current.receive("mostrar mais", pageId), current.receive("mostrar mais")]);
        const success = [a, b].find((response) => response.statusCode === 200);
        const pending = [a, b].find((response) => response.statusCode === 409);
        assert.ok(success, `${a.body}\n${b.body}`);
        assert.equal(pending?.json().error, "selection_show_more_pending");
        const page = success.json();
        assert.deepEqual(page.result.result.matches.map((match: { position: number }) => match.position), Array.from({ length: Math.min(candidateCount - 3, 3) }, (_, i) => i + 4));
        assert.equal((await reader.getState(searchId)).shownMatchCount, 3);
        await current.send(page.outbound.id, candidateCount === 20);
        assert.deepEqual((await reader.listShown(searchId)).slice(0, 3).map((match) => match.shownAt?.getTime()), firstShown);
      }
      const end = await reader.getState(searchId);
      assert.equal(end.shownMatchCount, Math.min(candidateCount, 6));
      assert.equal(end.hasMore, false, "unpresentable pool candidates must not keep hasMore true");
      assert.deepEqual(await reader.listNextUnshown(searchId, 1000), []);
      const exhausted = await current.receive("mostrar mais");
      assert.equal(exhausted.statusCode, 200, exhausted.body);
      assert.equal(exhausted.json().result.result.kind, "no_more_options");
      const position = Math.min(candidateCount, 6);
      const chosen = await reader.findShownByPosition(searchId, position);
      assert.ok(chosen);
      const selected = await current.receive(String(position));
      assert.equal(selected.statusCode, 200, selected.body);
      assert.equal(selected.json().result.result.professional_name, chosen.displayName);
      assert.match(selected.json().reply_text, new RegExp(chosen.phoneE164.replace("+", "\\+"), "u"));
      assert.equal((await query("SELECT id FROM contacts WHERE search_request_id = $1", [searchId])).rows.length, 1);
      assert.equal((await query("SELECT id FROM search_requests WHERE service_id = $1", [current.serviceId])).rows.length, 1);
      assert.equal(current.geocoderCalls(), 1, "pagination and selection never call the geocoder");
      const ranks = await query<{ rank_position: number }>("SELECT rank_position FROM matches WHERE search_request_id = $1 AND shown_at IS NOT NULL ORDER BY rank_position", [searchId]);
      assert.deepEqual(ranks.rows.map((row) => row.rank_position), Array.from({ length: position }, (_, i) => i + 1));
    } finally {
      await current.app.close();
      await current.cleanup();
    }
  });
}

test("legacy limit controls only the page, never the internal pool", async () => {
  const current = await fixture(25);
  try {
    const repository = new PostgresMatchingRepository();
    for (const limit of [1, 2, 3, 10]) {
      const result = await repository.search({ service_id: current.serviceId, raw_text: "pool", latitude: -11.86, longitude: -55.5, limit });
      assert.equal(result.kind, "success");
      if (result.kind !== "success") throw new Error("expected matching success");
      assert.equal(result.response.matches.length, Math.min(limit, 3));
      assert.equal(result.response.meta.limit, Math.min(limit, 3));
      assert.equal((await new PostgresSelectionMatchRepository().getState(result.response.search_request_id)).totalMatchCount, 20);
    }
  } finally {
    await current.app.close();
    await current.cleanup();
  }
});

test("page reservations serialize safely when both transactions already hold foreign-key locks", { timeout: 15000 }, async () => {
  const current = await fixture(6);
  try {
    const result = await new PostgresMatchingRepository().search({ service_id: current.serviceId, raw_text: "pool", latitude: -11.86, longitude: -55.5, limit: 3 });
    if (result.kind !== "success") throw new Error("expected successful search");
    const searchId = result.response.search_request_id;
    const matchIds = result.response.matches.map((match) => match.match_id);
    let arrived = 0;
    let release!: () => void;
    const bothHoldForeignKeyLock = new Promise<void>((resolve) => { release = resolve; });
    const reserve = () => withTransaction(async (client) => {
      // Real FK insertion takes KEY SHARE before the production page lock.
      const inbound = await client.query<{ id: string }>(
        `INSERT INTO channel_inbound_messages (provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, search_request_id)
         VALUES ('pool-lock-test', $1, $2, 'mostrar mais', 'BR', 3, $3) RETURNING id`, [randomUUID(), current.phone, searchId],
      );
      const outbound = await client.query<{ id: string }>(
        `INSERT INTO channel_outbound_messages (channel_inbound_message_id, provider, recipient_phone_e164, text_content)
         VALUES ($1, 'pool-lock-test', $2, 'opções de teste') RETURNING id`, [inbound.rows[0].id, current.phone],
      );
      arrived += 1;
      if (arrived === 2) release();
      await bothHoldForeignKeyLock;
      await associateOutboundMessageMatches(client, outbound.rows[0].id, { searchRequestId: searchId, matchIds });
    });
    const outcomes = await Promise.allSettled([reserve(), reserve()]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof MatchReservationConflictError, "loser must get a controlled reservation conflict, not a PostgreSQL deadlock");
    assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE recipient_phone_e164 = $1", [current.phone])).rows.length, 1);
  } finally {
    await current.app.close();
    await current.cleanup();
  }
});
