import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { query, withTransaction, closeDatabaseConnection } from "../src/database/connection.js";
import { ContextualConversationService } from "../src/modules/contextual-conversation/contextual.service.js";
import { type ContextualProvider, type ContextualProposal } from "../src/modules/contextual-conversation/contextual.contract.js";
import { CONTEXTUAL_EXPIRED_SELECTION, CONTEXTUAL_RESUMABLE_SELECTION_UNAVAILABLE } from "../src/modules/contextual-conversation/contextual.reply.js";
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

  const app = buildApp({ internalApiKey: "b2-integration", contextualConversation: contextual });

  const receive = (text: string, id = randomUUID()) =>
    app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: { provider: "b2-test", provider_message_id: id, phone_e164: phone, raw_text: text },
    });

  const sent = async (id: string) => {
    const claim = await app.inject({ method: "POST", url: `/internal/channel/outbound/${id}/claim`, headers });
    assert.equal(claim.statusCode, 200, claim.body);
    const result = await app.inject({
      method: "POST",
      url: `/internal/channel/outbound/${id}/sent`,
      headers,
      payload: { processing_token: claim.json().processing_token, provider_message_id: randomUUID() },
    });
    assert.equal(result.statusCode, 200, result.body);
  };

  const state = async () =>
    (
      await query<{ id: string; pending_slot: string; search_request_id: string; memory: unknown; revision: number }>(
        `SELECT c.id, c.pending_slot, c.search_request_id, m.memory, m.revision
         FROM contextual_memories m JOIN customers u ON u.id = m.customer_id
         LEFT JOIN search_conversations c ON c.customer_id = u.id AND c.status = 'active' WHERE u.phone_e164 = $1`,
        [phone],
      )
    ).rows[0];

  const cleanup = async () => {
    await app.close();
    await withTransaction(async (client) => {
      await client.query("DELETE FROM contextual_turns WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await client.query("DELETE FROM contextual_budgets WHERE scope IN (SELECT id::text FROM customers WHERE phone_e164=$1)", [phone]);
      await client.query("DELETE FROM contextual_memories WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await client.query(
        "DELETE FROM channel_outbound_messages WHERE recipient_phone_e164=$1 OR recipient_phone_e164=ANY($2::text[]) OR business_key IN (SELECT 'contact:'||id||':initial' FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1))",
        [phone, professionalPhones],
      );
      await client.query("DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (SELECT id FROM channel_inbound_messages WHERE phone_e164=$1)", [phone]);
      await client.query("DELETE FROM channel_inbound_messages WHERE phone_e164=$1", [phone]);
      await client.query("DELETE FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await client.query("DELETE FROM search_conversations WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await client.query("DELETE FROM matches WHERE search_request_id IN (SELECT id FROM search_requests WHERE service_id=ANY($1::uuid[]))", [serviceIds]);
      await client.query("DELETE FROM search_requests WHERE service_id=ANY($1::uuid[])", [serviceIds]);
      await client.query("DELETE FROM customers WHERE phone_e164=$1", [phone]);
      await client.query("DELETE FROM professional_service_areas WHERE professional_id=ANY($1::uuid[])", [professionalIds]);
      await client.query("DELETE FROM professional_services WHERE service_id=ANY($1::uuid[])", [serviceIds]);
      await client.query("DELETE FROM professionals WHERE id=ANY($1::uuid[])", [professionalIds]);
      await client.query("DELETE FROM services WHERE id=ANY($1::uuid[])", [serviceIds]);
      await client.query("DELETE FROM service_categories WHERE id=$1", [categoryId]);
    });
  };

  const makePresentation = async () => {
    next = async () => basic({ speech_act: "request", location: { text: "Sinop", evidence: "Sinop" } });
    const searchResp = await receive(`preciso de ${name} em Sinop`);
    assert.equal(searchResp.statusCode, 200, searchResp.body);
    assert.equal(searchResp.json().result.status, "matched");
    const searchState = (
      await query<{ id: string; search_request_id: string; pending_slot: string }>(
        `SELECT c.id, c.search_request_id, c.pending_slot FROM search_conversations c
         JOIN customers u ON u.id = c.customer_id WHERE u.phone_e164 = $1 ORDER BY c.created_at DESC LIMIT 1`,
        [phone],
      )
    ).rows[0];
    assert.equal(searchState.pending_slot, "selection");
    await sent(searchResp.json().outbound.id);
    return {
      conversationId: searchState.id,
      searchRequestId: searchState.search_request_id,
      outboundId: searchResp.json().outbound.id,
    };
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
      geoBefore = f.geoCalls();
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
  } finally {
    await f.cleanup();
  }
});

// ============================================================================
// C. ORDINAL RESUME
// ============================================================================
test("SoftExpiry C: ordinal selection 'segundo' and 'opção 2' resolve identically", async () => {
  const f = await fixture();
  try {
    const { conversationId } = await f.makePresentation();
    await f.expireConversation(conversationId);

    const res = await f.receive("segundo");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().result.route, "selection");

    const contacts = (
      await query<{ id: string }>("SELECT id FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone])
    ).rows;
    assert.equal(contacts.length, 1);
  } finally {
    await f.cleanup();
  }
});

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
        geoBefore = f.geoCalls();
      const res = await f.receive("Quero o Profissional Dois");
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
// G. EXACT BOUNDARY
// ============================================================================
test("SoftExpiry G: exact boundary — 1439 min is valid (resumable), 1441 min is expired", async () => {
  // 1439 min: inside window -> succeeds
  const f1 = await fixture();
  try {
    const { conversationId: c1, searchRequestId: sr1 } = await f1.makePresentation();
    await f1.expireConversation(c1);
    await query("UPDATE matches SET shown_at = NOW() - INTERVAL '1439 minutes' WHERE search_request_id=$1 AND shown_at IS NOT NULL", [sr1]);

    const res1 = await f1.receive("2");
    assert.equal(res1.statusCode, 200, res1.body);
    assert.notEqual(res1.json().reply_text, CONTEXTUAL_EXPIRED_SELECTION);
    assert.equal(res1.json().result.route, "selection");

    const contacts1 = (
      await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [
        f1.phone,
      ])
    ).rows[0].cnt;
    assert.equal(contacts1, 1);
  } finally {
    await f1.cleanup();
  }

  // 1441 min: outside window -> expired
  const f2 = await fixture();
  try {
    const { conversationId: c2, searchRequestId: sr2 } = await f2.makePresentation();
    await f2.expireConversation(c2);
    await query("UPDATE matches SET shown_at = NOW() - INTERVAL '1441 minutes' WHERE search_request_id=$1 AND shown_at IS NOT NULL", [sr2]);

    const res2 = await f2.receive("2");
    assert.equal(res2.statusCode, 200, res2.body);
    assert.equal(res2.json().reply_text, CONTEXTUAL_EXPIRED_SELECTION);

    const contacts2 = (
      await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [
        f2.phone,
      ])
    ).rows[0].cnt;
    assert.equal(contacts2, 0);
  } finally {
    await f2.cleanup();
  }
});

// ============================================================================
// H. NEWER ACTIVE CONTEXT WINS
// ============================================================================
test("SoftExpiry H: newer active selection context takes precedence over expired presentation", async () => {
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
// M. CONCURRENT ELIGIBILITY CHANGE
// ============================================================================
test("SoftExpiry M: professional made suspended before selection fails cleanly", async () => {
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
    await query("UPDATE professionals SET status='suspended' WHERE id=$1", [match2.professional_id]);

    try {
      const res = await f.receive("2");
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().reply_text, CONTEXTUAL_RESUMABLE_SELECTION_UNAVAILABLE);

      const contacts = (
        await query<{ cnt: number }>("SELECT count(*)::int AS cnt FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [
          f.phone,
        ])
      ).rows[0].cnt;
      assert.equal(contacts, 0);
    } finally {
      await query("UPDATE professionals SET status='active' WHERE id=$1", [match2.professional_id]);
    }
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
// P. CURRENT ACTIVE SELECTION REGRESSION
// ============================================================================
test("SoftExpiry P: active unexpired numeric selection continues working normally", async () => {
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
