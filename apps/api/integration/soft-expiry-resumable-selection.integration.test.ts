import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { query, withTransaction, withIndependentTransaction, closeDatabaseConnection } from "../src/database/connection.js";
import { ContextualConversationService } from "../src/modules/contextual-conversation/contextual.service.js";
import { type ContextualProvider, type ContextualProposal } from "../src/modules/contextual-conversation/contextual.contract.js";
import { CONTEXTUAL_EXPIRED_SELECTION, CONTEXTUAL_RESUMABLE_SELECTION_UNAVAILABLE } from "../src/modules/contextual-conversation/contextual.reply.js";
import { PostgresSelectionMatchRepository } from "../src/modules/match-selection/match-selection.repository.js";
import type { LocationResolutionService } from "../src/modules/location-resolution/location-resolution.types.js";
import type { ConversationAIFallbackEvent } from "../src/modules/contextual-conversation/contextual.provider.js";

after(closeDatabaseConnection);
const headers = { "x-internal-key": "b2-integration" };
const basic = (overrides: Partial<ContextualProposal> = {}): ContextualProposal => ({
  intent: "search",
  services: [],
  location: null,
  uncertain: false,
  ...overrides,
});

async function fixture() {
  const serviceId = randomUUID(), categoryId = randomUUID();
  const serviceIds = [serviceId];
  const suffix = serviceId.replaceAll("-", "").replace(/[0-9]/gu, (digit) => String.fromCharCode(103 + Number(digit)));
  const name = `Hidraulico${suffix}`;
  assert.match(name, /^[A-Za-z]+$/u);
  const phone = `+5566${BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 8)}`).toString().padStart(10, "0")}`;
  const professionalIds = [randomUUID(), randomUUID()];
  const professionalPhones = [
    `+5566${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`,
    `+5566${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`,
  ];

  await query("INSERT INTO service_categories(id,name,slug) VALUES ($1::uuid,'SoftExpiry fixture',$1::text)", [categoryId]);
  await query("INSERT INTO services(id,category_id,name,slug) VALUES ($1,$2,$3,$3)", [serviceId, categoryId, name]);

  for (const [index, id] of professionalIds.entries()) {
    await query(
      "INSERT INTO professionals(id,display_name,slug,phone_e164,status) VALUES ($1::uuid,$2,$1::text,$3,'active')",
      [id, index === 0 ? "Profissional Um" : "Profissional Dois", professionalPhones[index]],
    );
    await query("INSERT INTO professional_services(professional_id,service_id) VALUES ($1,$2)", [id, serviceId]);
    await query(
      `INSERT INTO professional_service_areas(professional_id,city,state,country_code,center,radius_meters)
       VALUES ($1,'Sinop','MT','BR',ST_SetSRID(ST_MakePoint(-55.5,-11.86),4326)::geography,10000)`,
      [id],
    );
  }

  let calls = 0, geoCalls = 0, compositions = 0;
  const fallbackEvents: ConversationAIFallbackEvent[] = [];
  const executionEvents: Array<{ path: string; interpretationCalled: boolean; compositionCalled: boolean; finalStatus: string }> = [];
  let next: (text: string) => Promise<unknown> = async () => basic();
  let compose: ContextualProvider["composeQuestion"];

  const provider: ContextualProvider = {
    model: "unit-fake-no-model-call",
    async interpret(input) {
      calls++;
      return next(input.message);
    },
    async composeQuestion(input) {
      compositions++;
      if (!compose) throw new Error("no fake composer configured");
      return compose(input);
    },
  };

  let resolveLocation: LocationResolutionService["resolve"] = async (input) => ({
    status: "resolved",
    query: input.query,
    country_code: "BR",
    provider: "fake",
    candidates: [],
    match: {
      label: input.query,
      latitude: -11.86,
      longitude: -55.5,
      city: "Sinop",
      state: "MT",
      country_code: "BR",
      neighborhood: null,
      confidence: 1,
      layer: "locality",
    },
  });

  const contextual = new ContextualConversationService(
    provider,
    {
      async resolve(input) {
        geoCalls++;
        return resolveLocation(input);
      },
    },
    {
      timeoutMs: 25,
      onFallback: (event) => fallbackEvents.push(event),
      onExecutionPath: (event) => executionEvents.push(event),
    },
  );

  const set = (fn: typeof next) => {
    next = fn;
  };

  const app = buildApp({ contextualConversation: contextual, internalApiKey: "b2-integration" });

  const receive = async (text: string, messageId = randomUUID()) =>
    app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "b2-test",
        provider_message_id: messageId,
        phone_e164: phone,
        raw_text: text,
        country_code: "BR",
        limit: 3,
      },
    });

  const sent = async (outboundId: string) => {
    const claim = await app.inject({
      method: "POST",
      url: `/internal/channel/outbound/${outboundId}/claim`,
      headers,
      payload: { worker_id: "worker-test", lease_seconds: 30 },
    });
    assert.equal(claim.statusCode, 200, claim.body);
    const sentRes = await app.inject({
      method: "POST",
      url: `/internal/channel/outbound/${outboundId}/sent`,
      headers,
      payload: { processing_token: claim.json().processing_token, provider_message_id: `evo-${outboundId.slice(0, 8)}` },
    });
    assert.equal(sentRes.statusCode, 200, sentRes.body);
  };

  const state = async () => {
    const res = await query<{
      id: string;
      status: string;
      pending_slot: string;
      expires_at: Date;
      search_request_id: string;
      memory: unknown;
    }>(
      `SELECT c.id, c.status, c.pending_slot, c.expires_at, c.search_request_id, m.memory
         FROM search_conversations c
         LEFT JOIN contextual_memories m ON m.customer_id = c.customer_id
        WHERE c.customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)
        ORDER BY c.created_at DESC LIMIT 1`,
      [phone],
    );
    return res.rows[0];
  };

  const cleanup = async () => {
    await withTransaction(async (db) => {
      await db.query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164=$1 OR recipient_phone_e164=ANY($2::text[])", [
        phone,
        professionalPhones,
      ]);
      await db.query("DELETE FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await db.query("DELETE FROM contextual_turns WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await db.query("DELETE FROM contextual_memories WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await db.query("DELETE FROM search_conversations WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await db.query("DELETE FROM matches WHERE search_request_id IN (SELECT id FROM search_requests WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1))", [phone]);
      await db.query("DELETE FROM search_requests WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await db.query("DELETE FROM channel_inbound_messages WHERE phone_e164=$1", [phone]);
      await db.query("DELETE FROM customers WHERE phone_e164=$1", [phone]);
      await db.query("DELETE FROM professional_service_areas WHERE professional_id=ANY($1::uuid[])", [professionalIds]);
      await db.query("DELETE FROM professional_services WHERE professional_id=ANY($1::uuid[])", [professionalIds]);
      await db.query("DELETE FROM professionals WHERE id=ANY($1::uuid[])", [professionalIds]);
      await db.query("DELETE FROM services WHERE id=ANY($1::uuid[])", [serviceIds]);
      await db.query("DELETE FROM service_categories WHERE id=$1", [categoryId]);
    });
  };

  const makePresentation = async () => {
    set(async () => basic({ speech_act: "request", location: { text: "Sinop", evidence: "Sinop" } }));
    const resp = await receive(`preciso de ${name} em Sinop`);
    assert.equal(resp.statusCode, 200, resp.body);
    const outboundId = resp.json().outbound.id;
    await sent(outboundId);
    const conv = await state();
    return { conversationId: conv.id, searchRequestId: conv.search_request_id, outboundId };
  };

  const expireConversation = async (conversationId: string) => {
    await query(
      "UPDATE search_conversations SET expires_at = NOW() - INTERVAL '1 second', status = 'expired', pending_slot = NULL WHERE id = $1",
      [conversationId],
    );
  };

  const addService = async () => {
    const id = randomUUID(),
      sName = `Eletricista${id.replaceAll("-", "").replace(/[0-9]/gu, (digit) => String.fromCharCode(103 + Number(digit)))}`;
    serviceIds.push(id);
    await query("INSERT INTO services(id,category_id,name,slug) VALUES ($1,$2,$3,$3)", [id, categoryId, sName]);
    for (const professionalId of professionalIds) {
      await query("INSERT INTO professional_services(professional_id,service_id) VALUES ($1,$2)", [professionalId, id]);
    }
    return { id, name: sName };
  };

  return {
    name,
    phone,
    serviceId,
    professionalIds,
    professionalPhones,
    app,
    receive,
    sent,
    state,
    cleanup,
    addService,
    calls: () => calls,
    geoCalls: () => geoCalls,
    compositions: () => compositions,
    fallbackEvents: () => fallbackEvents,
    executionEvents: () => executionEvents,
    set: (fn: typeof next) => {
      next = fn;
    },
    setGeo: (fn: typeof resolveLocation) => {
      resolveLocation = fn;
    },
    makePresentation,
    expireConversation,
  };
}

// ============================================================================
// A. NUMERIC RESUME AFTER CONVERSATION TTL
// ============================================================================
test("SoftExpiry A: numeric selection '2' after conversation TTL creates contact for correct professional with zero AI", async () => {
  const f = await fixture();
  try {
    const { conversationId, searchRequestId } = await f.makePresentation();
    await f.expireConversation(conversationId);

    const callsBefore = f.calls(),
      geoBefore = f.geoCalls(),
      compBefore = f.compositions();
    const res = await f.receive("2");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().result.route, "selection");
    assert.notEqual(res.json().reply_text, CONTEXTUAL_EXPIRED_SELECTION);
    assert.notEqual(res.json().reply_text, CONTEXTUAL_RESUMABLE_SELECTION_UNAVAILABLE);

    // One contact created with status='shared'
    const contacts = (
      await query<{ id: string; status: string; professional_id: string }>(
        "SELECT id, status, professional_id FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)",
        [f.phone],
      )
    ).rows;
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].status, "shared");

    // Correct professional selected (rank 2)
    const match2 = (
      await query<{ professional_id: string }>(
        "SELECT professional_id FROM matches WHERE search_request_id=$1 AND rank_position=2",
        [searchRequestId],
      )
    ).rows[0];
    assert.equal(contacts[0].professional_id, match2.professional_id);

    // matches.selected_at present
    const selectedMatches = (
      await query<{ cnt: number }>(
        "SELECT count(*)::int AS cnt FROM matches WHERE search_request_id=$1 AND selected_at IS NOT NULL",
        [searchRequestId],
      )
    ).rows[0].cnt;
    assert.equal(selectedMatches, 1);

    // Initial opportunity notification created for professional
    const profNotifs = (
      await query<{ cnt: number }>(
        "SELECT count(*)::int AS cnt FROM channel_outbound_messages WHERE purpose='professional_contact_notification' AND recipient_phone_e164=ANY($1::text[])",
        [f.professionalPhones],
      )
    ).rows[0].cnt;
    assert.equal(profNotifs, 1);

    // Historical conversation transitioned to completed for audit
    const convStatus = (await query<{ status: string }>("SELECT status FROM search_conversations WHERE id=$1", [conversationId])).rows[0].status;
    assert.equal(convStatus, "completed");

    // Zero AI calls
    assert.equal(f.calls() - callsBefore, 0, "0 interpretation calls during resumed selection");
    assert.equal(f.geoCalls() - geoBefore, 0, "0 geocoder calls during resumed selection");
    assert.equal(f.compositions() - compBefore, 0, "0 composition calls during resumed selection");
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// B. NAMED RESUME
// ============================================================================
test("SoftExpiry B: named selection 'Quero o Profissional Dois' after conversation TTL creates contact", async () => {
  const f = await fixture();
  try {
    const { conversationId } = await f.makePresentation();
    await f.expireConversation(conversationId);

    const callsBefore = f.calls(),
      geoBefore = f.geoCalls(),
      compBefore = f.compositions();
    const res = await f.receive("Quero o Profissional Dois");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().result.route, "selection");

    const contacts = (
      await query<{ id: string; status: string; professional_id: string }>(
        "SELECT id, status, professional_id FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)",
        [f.phone],
      )
    ).rows;
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].status, "shared");

    // The professional named 'Profissional Dois' (f.professionalIds[1]) was selected
    assert.equal(contacts[0].professional_id, f.professionalIds[1]);

    assert.equal(f.calls() - callsBefore, 0);
    assert.equal(f.geoCalls() - geoBefore, 0);
    assert.equal(f.compositions() - compBefore, 0);
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// C. ORDINAL RESUME
// ============================================================================
for (const variant of ["segundo", "opção 2"] as const) {
  test(`SoftExpiry C: ordinal selection '${variant}' resolves deterministically to rank 2 professional`, async () => {
    const f = await fixture();
    try {
      const { conversationId, searchRequestId } = await f.makePresentation();
      await f.expireConversation(conversationId);

      const callsBefore = f.calls(),
        geoBefore = f.geoCalls(),
        compBefore = f.compositions();
      const res = await f.receive(variant);
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().result.route, "selection");

      const contacts = (
        await query<{ id: string; status: string; professional_id: string }>(
          "SELECT id, status, professional_id FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)",
          [f.phone],
        )
      ).rows;
      assert.equal(contacts.length, 1);
      assert.equal(contacts[0].status, "shared");

      const match2 = (
        await query<{ professional_id: string }>(
          "SELECT professional_id FROM matches WHERE search_request_id=$1 AND rank_position=2",
          [searchRequestId],
        )
      ).rows[0];
      assert.equal(contacts[0].professional_id, match2.professional_id);

      assert.equal(f.calls() - callsBefore, 0);
      assert.equal(f.geoCalls() - geoBefore, 0);
      assert.equal(f.compositions() - compBefore, 0);
    } finally {
      await f.cleanup();
    }
  });
}

// ============================================================================
// D. PROFESSIONAL BECOMES INELIGIBLE
// ============================================================================
test("SoftExpiry D: professional becoming ineligible returns deterministic unavailable reply with zero contacts", async () => {
  const f = await fixture();
  try {
    const { conversationId, searchRequestId } = await f.makePresentation();
    await f.expireConversation(conversationId);

    // Make professional at position 2 suspended
    const match2 = (
      await query<{ professional_id: string }>(
        "SELECT professional_id FROM matches WHERE search_request_id=$1 AND rank_position=2",
        [searchRequestId],
      )
    ).rows[0];
    await query("UPDATE professionals SET status='suspended' WHERE id=$1", [match2.professional_id]);

    try {
      const callsBefore = f.calls(),
        geoBefore = f.geoCalls(),
        compBefore = f.compositions();
      const res = await f.receive("2");
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().reply_text, CONTEXTUAL_RESUMABLE_SELECTION_UNAVAILABLE);

      // Contacts created = 0
      const contacts = (
        await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [
          f.phone,
        ])
      ).rows[0].cnt;
      assert.equal(contacts, 0);

      // selected_at remains null
      const selectedMatches = (
        await query<{ cnt: number }>(
          "SELECT count(*)::int AS cnt FROM matches WHERE search_request_id=$1 AND selected_at IS NOT NULL",
          [searchRequestId],
        )
      ).rows[0].cnt;
      assert.equal(selectedMatches, 0);

      // Professional notifications = 0
      const profNotifs = (
        await query<{ cnt: number }>(
          "SELECT count(*)::int AS cnt FROM channel_outbound_messages WHERE purpose='professional_contact_notification' AND recipient_phone_e164=ANY($1::text[])",
          [f.professionalPhones],
        )
      ).rows[0].cnt;
      assert.equal(profNotifs, 0);

      // Zero AI
      assert.equal(f.calls() - callsBefore, 0);
      assert.equal(f.geoCalls() - geoBefore, 0);
      assert.equal(f.compositions() - compBefore, 0);
    } finally {
      await query("UPDATE professionals SET status='active' WHERE id=$1", [match2.professional_id]);
    }
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// E. SERVICE-AREA / ENTITLEMENT REVALIDATION
// ============================================================================
test("SoftExpiry E: service-area deletion causes resumed selection to fail eligibility", async () => {
  const f = await fixture();
  try {
    const { conversationId, searchRequestId } = await f.makePresentation();
    await f.expireConversation(conversationId);

    const match1 = (
      await query<{ professional_id: string }>(
        "SELECT professional_id FROM matches WHERE search_request_id=$1 AND rank_position=1",
        [searchRequestId],
      )
    ).rows[0];
    await query("DELETE FROM professional_service_areas WHERE professional_id=$1", [match1.professional_id]);

    try {
      const res = await f.receive("1");
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().reply_text, CONTEXTUAL_RESUMABLE_SELECTION_UNAVAILABLE);

      const contacts = (
        await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [
          f.phone,
        ])
      ).rows[0].cnt;
      assert.equal(contacts, 0);
    } finally {
      await query(
        `INSERT INTO professional_service_areas(professional_id,city,state,country_code,center,radius_meters)
         VALUES ($1,'Sinop','MT','BR',ST_SetSRID(ST_MakePoint(-55.5,-11.86),4326)::geography,10000)`,
        [match1.professional_id],
      );
    }
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// F. HARD 24H EXPIRY
// ============================================================================
test("SoftExpiry F: shown_at older than 1440 minutes returns CONTEXTUAL_EXPIRED_SELECTION with zero mutations", async () => {
  const f = await fixture();
  try {
    const { conversationId, searchRequestId } = await f.makePresentation();
    await f.expireConversation(conversationId);

    // Set shown_at to 1441 minutes ago
    await query("UPDATE matches SET shown_at = NOW() - INTERVAL '1441 minutes' WHERE search_request_id=$1 AND shown_at IS NOT NULL", [
      searchRequestId,
    ]);

    const res = await f.receive("2");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().reply_text, CONTEXTUAL_EXPIRED_SELECTION);

    const contacts = (
      await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [
        f.phone,
      ])
    ).rows[0].cnt;
    assert.equal(contacts, 0);

    const selected = (
      await query<{ cnt: number }>(
        "SELECT count(*)::int AS cnt FROM matches WHERE search_request_id=$1 AND selected_at IS NOT NULL",
        [searchRequestId],
      )
    ).rows[0].cnt;
    assert.equal(selected, 0);
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// G. EXACT 1440-MINUTE BOUNDARY (TRANSACTIONAL & DETERMINISTIC)
// ============================================================================
test("SoftExpiry G: exact boundary — exactly 1440 min is valid (selected), 1440 min + 1s is expired", async () => {
  const f = await fixture();
  try {
    const { conversationId, searchRequestId } = await f.makePresentation();
    await f.expireConversation(conversationId);

    const custRow = (await query<{ id: string }>("SELECT id FROM customers WHERE phone_e164 = $1", [f.phone])).rows[0];

    // 1. EXACTLY 1440 MINUTES -> VALID (Outcome: selected)
    const selKey1 = randomUUID();
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, customer_id, conversation_id, search_request_id, processing_token, processing_started_at)
       VALUES ($1::uuid, 'test', $1::text, $2, '1', 'BR', 3, 'processing', $3, $4, $5, gen_random_uuid(), NOW())`,
      [selKey1, f.phone, custRow.id, conversationId, searchRequestId],
    );
    await withTransaction(async (client) => {
      const localRepo = new PostgresSelectionMatchRepository(
        (sql, params) => client.query(sql, params),
        (fn) => fn(client),
      );
      await client.query("UPDATE matches SET shown_at = NOW() - INTERVAL '1440 minutes' WHERE search_request_id = $1 AND rank_position = 1", [searchRequestId]);
      const outcome = await localRepo.selectResumableShownMatch({
        historicalConversationId: conversationId,
        customerId: custRow.id,
        searchRequestId,
        position: 1,
        lastMessageText: "1",
        selectionKey: selKey1,
        resumeTtlMinutes: 1440,
      });
      assert.equal(outcome.kind, "selected", `Expected 'selected' at exact 1440m boundary but got ${outcome.kind}`);
    });
    await query("UPDATE channel_inbound_messages SET status = 'processed', result = '{}'::jsonb, processed_at = NOW(), processing_token = NULL, processing_started_at = NULL WHERE id = $1", [selKey1]);

    // 2. JUST OUTSIDE BOUNDARY (1440 MINUTES + 1 SECOND) -> EXPIRED (Outcome: presentation_expired)
    const { conversationId: c2, searchRequestId: sr2 } = await f.makePresentation();
    await f.expireConversation(c2);
    const selKey2 = randomUUID();
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, customer_id, conversation_id, search_request_id, processing_token, processing_started_at)
       VALUES ($1::uuid, 'test', $1::text, $2, '2', 'BR', 3, 'processing', $3, $4, $5, gen_random_uuid(), NOW())`,
      [selKey2, f.phone, custRow.id, c2, sr2],
    );
    await withTransaction(async (client) => {
      const localRepo = new PostgresSelectionMatchRepository(
        (sql, params) => client.query(sql, params),
        (fn) => fn(client),
      );
      await client.query("UPDATE matches SET shown_at = NOW() - INTERVAL '1440 minutes 1 second' WHERE search_request_id = $1 AND rank_position = 2", [sr2]);
      const outcome = await localRepo.selectResumableShownMatch({
        historicalConversationId: c2,
        customerId: custRow.id,
        searchRequestId: sr2,
        position: 2,
        lastMessageText: "2",
        selectionKey: selKey2,
        resumeTtlMinutes: 1440,
      });
      assert.equal(outcome.kind, "presentation_expired", `Expected 'presentation_expired' at 1440m+1s but got ${outcome.kind}`);
    });
    await query("UPDATE channel_inbound_messages SET status = 'processed', result = '{}'::jsonb, processed_at = NOW(), processing_token = NULL, processing_started_at = NULL WHERE id = $1", [selKey2]);

    // 3. HTTP level coverage: 1439 min vs 1441 min
    const { conversationId: c3, searchRequestId: sr3 } = await f.makePresentation();
    await f.expireConversation(c3);
    await query("UPDATE matches SET shown_at = NOW() - INTERVAL '1439 minutes' WHERE search_request_id=$1 AND shown_at IS NOT NULL", [sr3]);
    const res1439 = await f.receive("2");
    assert.equal(res1439.statusCode, 200, res1439.body);
    assert.equal(res1439.json().result.route, "selection");

    const { conversationId: c4, searchRequestId: sr4 } = await f.makePresentation();
    await f.expireConversation(c4);
    await query("UPDATE matches SET shown_at = NOW() - INTERVAL '1441 minutes' WHERE search_request_id=$1 AND shown_at IS NOT NULL", [sr4]);
    const res1441 = await f.receive("2");
    assert.equal(res1441.statusCode, 200, res1441.body);
    assert.equal(res1441.json().reply_text, CONTEXTUAL_EXPIRED_SELECTION);
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// H. NEWER ACTIVE CONTEXT WINS
// ============================================================================
test("SoftExpiry H1: newer active selection context takes precedence over expired presentation", async () => {
  const f = await fixture();
  try {
    // 1. First presentation -> expired
    const { conversationId: c1, searchRequestId: sr1 } = await f.makePresentation();
    await f.expireConversation(c1);

    // 2. Customer starts second search -> active selection context
    const otherService = await f.addService();
    f.set(async () => basic({ speech_act: "request", location: { text: "Sinop", evidence: "Sinop" } }));
    const second = await f.receive(`Preciso de ${otherService.name} em Sinop`);
    assert.equal(second.statusCode, 200, second.body);
    await f.sent(second.json().outbound.id);

    const activeState = await f.state();
    assert.equal(activeState.pending_slot, "selection");
    assert.notEqual(activeState.search_request_id, sr1);

    // 3. Customer sends "2": targets NEW active search, NOT old expired list
    f.set(async () => basic());
    const third = await f.receive("2");
    assert.equal(third.statusCode, 200, third.body);
    assert.equal(third.json().result.route, "selection");

    // Contact created for second search
    const contacts = (
      await query<{ search_request_id: string }>(
        "SELECT search_request_id FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)",
        [f.phone],
      )
    ).rows;
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].search_request_id, activeState.search_request_id);
  } finally {
    await f.cleanup();
  }
});

test("SoftExpiry H2: newer active service intake slot context takes precedence over expired presentation", async () => {
  const f = await fixture();
  try {
    const { conversationId: c1, searchRequestId: sr1 } = await f.makePresentation();
    await f.expireConversation(c1);

    const custRow = (await query<{ id: string }>("SELECT id FROM customers WHERE phone_e164 = $1", [f.phone])).rows[0];
    const newConvId = randomUUID();
    await query(
      `INSERT INTO search_conversations (id, customer_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, expires_at)
       VALUES ($1, $2, 'active', 'service', 'preciso de ajuda', 'preciso de ajuda', 'BR', 3, NOW() + INTERVAL '30 minutes')`,
      [newConvId, custRow.id],
    );

    // Customer now sends "1" (which was in the old expired search)
    // Because pending_slot is 'service', it must NOT resume old expired search
    f.set(async () => basic({ intent: "search", speech_act: "request", services: [], location: null }));
    const nextMsg = await f.receive("1");
    assert.equal(nextMsg.statusCode, 200, nextMsg.body);
    assert.notEqual(nextMsg.json().result.route, "selection");

    // Zero contacts created for the old search
    const contacts = (
      await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE search_request_id=$1", [sr1])
    ).rows[0].cnt;
    assert.equal(contacts, 0);
  } finally {
    await f.cleanup();
  }
});

test("SoftExpiry H3: newer active location intake slot context takes precedence over expired presentation", async () => {
  const f = await fixture();
  try {
    const { conversationId: c1, searchRequestId: sr1 } = await f.makePresentation();
    await f.expireConversation(c1);

    const custRow = (await query<{ id: string }>("SELECT id FROM customers WHERE phone_e164 = $1", [f.phone])).rows[0];
    const newConvId = randomUUID();
    await query(
      `INSERT INTO search_conversations (id, customer_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, expires_at)
       VALUES ($1, $2, 'active', 'location', 'preciso de hidraulico', 'hidraulico', 'BR', 3, NOW() + INTERVAL '30 minutes')`,
      [newConvId, custRow.id],
    );

    // Customer sends "2" (thinking of old search)
    // Because pending_slot is 'location', it must NOT resume the old expired search
    f.set(async () => basic({ intent: "search", speech_act: "request", location: null }));
    const nextMsg = await f.receive("2");
    assert.equal(nextMsg.statusCode, 200, nextMsg.body);
    assert.notEqual(nextMsg.json().result.route, "selection");

    const contacts = (
      await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE search_request_id=$1", [sr1])
    ).rows[0].cnt;
    assert.equal(contacts, 0);
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// I. MOST RECENT HISTORICAL LIST WINS
// ============================================================================
test("SoftExpiry I: most recent historical presentation is the only resume target", async () => {
  const f = await fixture();
  try {
    // 1. Search A -> shown -> expired
    const { conversationId: c1, searchRequestId: sr1 } = await f.makePresentation();
    await f.expireConversation(c1);

    // 2. Search B -> shown -> expired
    const otherService = await f.addService();
    f.set(async () => basic({ speech_act: "request", location: { text: "Sinop", evidence: "Sinop" } }));
    const second = await f.receive(`Preciso de ${otherService.name} em Sinop`);
    await f.sent(second.json().outbound.id);
    const s2State = await f.state();
    await f.expireConversation(s2State.id);

    // 3. Customer sends "1": must target Search B (most recent), not Search A
    const res = await f.receive("1");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().result.route, "selection");

    const contacts = (
      await query<{ search_request_id: string }>(
        "SELECT search_request_id FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)",
        [f.phone],
      )
    ).rows;
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].search_request_id, s2State.search_request_id);
    assert.notEqual(contacts[0].search_request_id, sr1);
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// J. NO FALLBACK TO OLDER LIST
// ============================================================================
test("SoftExpiry J: if most recent presentation is >24h old, do NOT silently fall back to older list", async () => {
  const f = await fixture();
  try {
    // 1. Older search within 24h
    const { conversationId: c1, searchRequestId: sr1 } = await f.makePresentation();
    await f.expireConversation(c1);
    await query("UPDATE matches SET shown_at = NOW() - INTERVAL '100 minutes' WHERE search_request_id=$1 AND shown_at IS NOT NULL", [sr1]);

    // 2. Newer search >24h old
    const otherService = await f.addService();
    f.set(async () => basic({ speech_act: "request", location: { text: "Sinop", evidence: "Sinop" } }));
    const second = await f.receive(`Preciso de ${otherService.name} em Sinop`);
    await f.sent(second.json().outbound.id);
    const s2State = await f.state();
    await f.expireConversation(s2State.id);
    await query("UPDATE matches SET shown_at = NOW() - INTERVAL '1500 minutes' WHERE search_request_id=$1 AND shown_at IS NOT NULL", [
      s2State.search_request_id,
    ]);

    // 3. Customer sends "1": targets newest search which is expired -> returns CONTEXTUAL_EXPIRED_SELECTION
    const res = await f.receive("1");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().reply_text, CONTEXTUAL_EXPIRED_SELECTION);

    const contacts = (
      await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [
        f.phone,
      ])
    ).rows[0].cnt;
    assert.equal(contacts, 0);
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// K. IDEMPOTENT REPLAY
// ============================================================================
test("SoftExpiry K: idempotent replay returns duplicate=true, same outbound.id, same contact.id, 0 extra AI calls", async () => {
  const f = await fixture();
  try {
    const { conversationId, searchRequestId } = await f.makePresentation();
    await f.expireConversation(conversationId);

    const msgId = randomUUID();
    const callsBefore = f.calls(),
      geoBefore = f.geoCalls(),
      compBefore = f.compositions();

    const first = await f.receive("2", msgId);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().duplicate, false);
    assert.equal(first.json().result.route, "selection");
    await f.sent(first.json().outbound.id);

    // Replay same message
    const replay = await f.receive("2", msgId);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().duplicate, true);
    assert.equal(replay.json().outbound.id, first.json().outbound.id);
    assert.equal(replay.json().reply_text, first.json().reply_text);

    // Only one contact created
    const contacts = (
      await query<{ id: string }>("SELECT id FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone])
    ).rows;
    assert.equal(contacts.length, 1);

    // Only one selected match
    const selectedMatches = (
      await query<{ cnt: number }>(
        "SELECT count(*)::int AS cnt FROM matches WHERE search_request_id=$1 AND selected_at IS NOT NULL",
        [searchRequestId],
      )
    ).rows[0].cnt;
    assert.equal(selectedMatches, 1);

    // Only one professional notification
    const profNotifs = (
      await query<{ cnt: number }>(
        "SELECT count(*)::int AS cnt FROM channel_outbound_messages WHERE purpose='professional_contact_notification' AND recipient_phone_e164=ANY($1::text[])",
        [f.professionalPhones],
      )
    ).rows[0].cnt;
    assert.equal(profNotifs, 1);

    // 0 extra AI calls
    assert.equal(f.calls() - callsBefore, 0);
    assert.equal(f.geoCalls() - geoBefore, 0);
    assert.equal(f.compositions() - compBefore, 0);
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// L. CONCURRENT DOUBLE SELECTION
// ============================================================================
test("SoftExpiry L: concurrent double selection creates at most one contact and one selected match", async () => {
  const f = await fixture();
  try {
    const { conversationId, searchRequestId } = await f.makePresentation();
    await f.expireConversation(conversationId);

    const id1 = randomUUID(), id2 = randomUUID();
    const [r1, r2] = await Promise.all([f.receive("2", id1), f.receive("2", id2)]);

    assert.ok([200, 409].includes(r1.statusCode));
    assert.ok([200, 409].includes(r2.statusCode));
    assert.ok(r1.statusCode === 200 || r2.statusCode === 200, "At least one attempt must succeed");

    const failedId = r1.statusCode === 409 ? id1 : r2.statusCode === 409 ? id2 : null;
    if (failedId) {
      await query(
        "UPDATE channel_inbound_messages SET status='failed', recovery_state='active', next_attempt_at=NOW()-INTERVAL '1 second' WHERE provider_message_id=$1",
        [failedId],
      );
      const retry = await f.receive("2", failedId);
      assert.equal(retry.statusCode, 200);
    }

    const contacts = (
      await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [
        f.phone,
      ])
    ).rows[0].cnt;
    assert.equal(contacts, 1, "Exactly one contact must be created across concurrent attempts");

    const selectedMatches = (
      await query<{ cnt: number }>(
        "SELECT count(*)::int AS cnt FROM matches WHERE search_request_id=$1 AND selected_at IS NOT NULL",
        [searchRequestId],
      )
    ).rows[0].cnt;
    assert.equal(selectedMatches, 1, "Exactly one match marked selected");

    const profNotifs = (
      await query<{ cnt: number }>(
        "SELECT count(*)::int AS cnt FROM channel_outbound_messages WHERE purpose='professional_contact_notification' AND recipient_phone_e164=ANY($1::text[])",
        [f.professionalPhones],
      )
    ).rows[0].cnt;
    assert.equal(profNotifs, 1, "Exactly one professional notification");
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// M. REAL CONCURRENT ELIGIBILITY CHANGE TEST (TOCTOU & SERIALIZATION)
// ============================================================================
test("SoftExpiry M: real concurrent professional eligibility change blocks and revalidates fresh state", async () => {
  const f = await fixture();
  try {
    const { conversationId, searchRequestId } = await f.makePresentation();
    await f.expireConversation(conversationId);

    const match2 = (
      await query<{ professional_id: string }>(
        "SELECT professional_id FROM matches WHERE search_request_id=$1 AND rank_position=2",
        [searchRequestId],
      )
    ).rows[0];

    // Hold a transaction that locks and updates the professional to suspended
    let releaseHold: () => void = () => {};
    const holdPromise = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });

    let mutationAcquired = false;
    const mutationPromise = withIndependentTransaction(async (client) => {
      await client.query("SELECT id FROM professionals WHERE id = $1 FOR UPDATE", [match2.professional_id]);
      await client.query("UPDATE professionals SET status = 'suspended' WHERE id = $1", [match2.professional_id]);
      mutationAcquired = true;
      await holdPromise;
    });

    // Wait until the mutation transaction has acquired the lock
    while (!mutationAcquired) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Now start the late selection concurrently
    let selectionFinished = false;
    const selectionPromise = f.receive("2").then((res) => {
      selectionFinished = true;
      return res;
    });

    // Selection MUST be blocked waiting for professional row lock
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(selectionFinished, false, "Selection must not bypass pending professional lock");

    // Release the mutation transaction
    releaseHold();
    await mutationPromise;

    // Selection can now complete and perform fresh eligibility revalidation
    const res = await selectionPromise;
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().reply_text, CONTEXTUAL_RESUMABLE_SELECTION_UNAVAILABLE);

    const contacts = (
      await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [
        f.phone,
      ])
    ).rows[0].cnt;
    assert.equal(contacts, 0, "Zero contacts created");

    const selectedMatches = (
      await query<{ cnt: number }>(
        "SELECT count(*)::int AS cnt FROM matches WHERE search_request_id=$1 AND selected_at IS NOT NULL",
        [searchRequestId],
      )
    ).rows[0].cnt;
    assert.equal(selectedMatches, 0, "selected_at remains null");

    const profNotifs = (
      await query<{ cnt: number }>(
        "SELECT count(*)::int AS cnt FROM channel_outbound_messages WHERE purpose='professional_contact_notification' AND recipient_phone_e164=ANY($1::text[])",
        [f.professionalPhones],
      )
    ).rows[0].cnt;
    assert.equal(profNotifs, 0, "Zero notifications sent");
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// N. ORIGINAL PRESENTATION MUST HAVE BEEN SENT
// ============================================================================
test("SoftExpiry N: match without sent presentation outbound cannot establish connection", async () => {
  const f = await fixture();
  try {
    // 1. Search initiated, matches created, but outbound NOT sent
    f.set(async () => basic({ speech_act: "request", location: { text: "Sinop", evidence: "Sinop" } }));
    const searchResp = await f.receive(`preciso de ${f.name} em Sinop`);
    assert.equal(searchResp.statusCode, 200, searchResp.body);
    const searchState = (
      await query<{ id: string; search_request_id: string }>(
        `SELECT c.id, c.search_request_id FROM search_conversations c
         JOIN customers u ON u.id = c.customer_id WHERE u.phone_e164 = $1 ORDER BY c.created_at DESC LIMIT 1`,
        [f.phone],
      )
    ).rows[0];

    // Manually populate shown_at on matches, but leave outbound in pending state (unsent)
    await query("UPDATE matches SET shown_at = NOW() WHERE search_request_id = $1", [searchState.search_request_id]);
    await f.expireConversation(searchState.id);

    const res = await f.receive("2");
    assert.equal(res.statusCode, 200, res.body);
    // Cannot establish bilateral connection without sent notice
    assert.notEqual(res.json().result.route, "selection");

    const contacts = (
      await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [
        f.phone,
      ])
    ).rows[0].cnt;
    assert.equal(contacts, 0);
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// O. SHOW_MORE / INQUIRY SCOPE REGRESSION
// ============================================================================
test("SoftExpiry O: 'mostrar mais' and inquiries after expiry retain CONTEXTUAL_EXPIRED_SELECTION", async () => {
  const f = await fixture();
  try {
    const { conversationId } = await f.makePresentation();
    await f.expireConversation(conversationId);

    // 'mostrar mais'
    const showMore = await f.receive("mostrar mais");
    assert.equal(showMore.statusCode, 200, showMore.body);
    assert.equal(showMore.json().reply_text, CONTEXTUAL_EXPIRED_SELECTION);

    // Inquiry
    const inquiry = await f.receive("qual o mais barato?");
    assert.equal(inquiry.statusCode, 200, inquiry.body);
    assert.equal(inquiry.json().reply_text, CONTEXTUAL_EXPIRED_SELECTION);

    const contacts = (
      await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [
        f.phone,
      ])
    ).rows[0].cnt;
    assert.equal(contacts, 0);
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// P. CURRENT ACTIVE SELECTION REGRESSIONS
// ============================================================================
test("SoftExpiry P1: active unexpired numeric selection continues working normally", async () => {
  const f = await fixture();
  try {
    // Active search — NOT expired
    await f.makePresentation();

    const res = await f.receive("1");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().result.route, "selection");

    const contacts = (
      await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [
        f.phone,
      ])
    ).rows[0].cnt;
    assert.equal(contacts, 1);
  } finally {
    await f.cleanup();
  }
});

test("SoftExpiry P2: active unexpired named selection continues working normally", async () => {
  const f = await fixture();
  try {
    await f.makePresentation();

    const res = await f.receive("Quero o Profissional Dois");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().result.route, "selection");

    const contacts = (
      await query<{ professional_id: string; status: string }>(
        "SELECT professional_id, status FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)",
        [f.phone],
      )
    ).rows;
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].status, "shared");
    assert.equal(contacts[0].professional_id, f.professionalIds[1]);
  } finally {
    await f.cleanup();
  }
});

test("SoftExpiry P3: active unexpired show_more continues working normally", async () => {
  const f = await fixture();
  try {
    await f.makePresentation();

    const res = await f.receive("mostrar mais");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().result.route, "selection");
  } finally {
    await f.cleanup();
  }
});

test("SoftExpiry P4: active unexpired selection inquiry continues working normally", async () => {
  const f = await fixture();
  try {
    await f.makePresentation();

    const res = await f.receive("qual o mais barato?");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().result.route, "contextual");
    assert.equal(res.json().result.status, "information");

    // Zero contacts created for inquiry
    const contacts = (
      await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [
        f.phone,
      ])
    ).rows[0].cnt;
    assert.equal(contacts, 0);
  } finally {
    await f.cleanup();
  }
});
