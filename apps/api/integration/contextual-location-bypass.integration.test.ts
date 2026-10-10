import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { closeDatabaseConnection, query, withTransaction } from "../src/database/connection.js";
import { ContextualConversationService } from "../src/modules/contextual-conversation/contextual.service.js";
import type { ContextualProvider, ContextualProposal } from "../src/modules/contextual-conversation/contextual.contract.js";
import type { LocationResolutionService } from "../src/modules/location-resolution/location-resolution.types.js";

after(closeDatabaseConnection);

const internalKey = "test-internal-bypass-key";
const headers = { "x-internal-key": internalKey };

const phone = () => `+556699${Math.floor(1000000 + Math.random() * 8999999).toString()}`;

const P1 = {
  latitude: -15.601,
  longitude: -56.097,
  city: "Cuiabá",
  state: "MT",
  label: "Cuiabá - MT",
  name: "Praça da República",
};

const P2 = {
  latitude: -11.854812,
  longitude: -55.508934,
  city: "Sinop",
  state: "MT",
  label: "Sinop - MT",
  name: "Sinop Centro",
};

async function setupTestEnvironment() {
  let contextualCalls = 0;
  const mockProvider: ContextualProvider = {
    model: "mock-model",
    async interpret() {
      contextualCalls += 1;
      return {
        intent: "clarify",
        services: [],
        location: null,
        uncertain: false,
      } as ContextualProposal;
    },
    async composeQuestion(input) {
      return {
        target: input.target,
        question: "Pode esclarecer o que você quer mudar ou qual opção quer escolher?",
      };
    },
  };

  const mockLocationResolution: LocationResolutionService = {
    async resolve(input) {
      if (/sinop/i.test(input.query)) {
        return {
          status: "resolved",
          query: input.query,
          country_code: "BR",
          provider: "fixture",
          candidates: [],
          match: {
            label: "Sinop - MT",
            latitude: P2.latitude,
            longitude: P2.longitude,
            city: "Sinop",
            state: "MT",
            country_code: "BR",
            neighborhood: null,
            confidence: 1,
            layer: "locality",
          },
        };
      }
      return {
        status: "resolved",
        query: input.query,
        country_code: "BR",
        provider: "fixture",
        candidates: [],
        match: {
          label: input.query,
          latitude: P1.latitude,
          longitude: P1.longitude,
          city: "Cuiabá",
          state: "MT",
          country_code: "BR",
          neighborhood: null,
          confidence: 1,
          layer: "locality",
        },
      };
    },
    async reverseGeocode(input) {
      if (Math.abs(input.latitude - P2.latitude) < 0.01) {
        return {
          city: "Sinop",
          state: "MT",
          countryCode: "BR",
        };
      }
      return {
        city: "Cuiabá",
        state: "MT",
        countryCode: "BR",
      };
    },
  };

  const contextualService = new ContextualConversationService(
    mockProvider,
    mockLocationResolution,
    { timeoutMs: 1000 },
  );

  const app = buildApp({
    internalApiKey: internalKey,
    contextualConversation: contextualService,
    locationResolutionService: mockLocationResolution,
  });

  // Ensure Eletricista service exists in catalog
  const existingService = await query<{ id: string }>("SELECT id FROM services WHERE slug = 'eletricista'");
  let serviceId: string;
  let createdService = false;
  if (existingService.rows[0]) {
    serviceId = existingService.rows[0].id;
    await query("UPDATE services SET is_active = TRUE WHERE id = $1", [serviceId]);
  } else {
    createdService = true;
    const cat = (await query<{ id: string }>("SELECT id FROM service_categories LIMIT 1")).rows[0];
    let catId = cat?.id;
    if (!catId) {
      catId = randomUUID();
      await query("INSERT INTO service_categories (id, name, slug) VALUES ($1, 'Serviços Gerais', 'servicos-gerais')", [catId]);
    }
    serviceId = randomUUID();
    await query(
      "INSERT INTO services (id, category_id, name, slug, is_active) VALUES ($1, $2, 'Eletricista', 'eletricista', TRUE)",
      [serviceId, catId],
    );
  }

  // Ensure an active professional with service areas in Cuiabá and Sinop exists for matching
  const proPhone = phone();
  const proId = randomUUID();
  await query(
    `INSERT INTO professionals (id, display_name, slug, phone_e164, status)
     VALUES ($1, 'Richard Eletricista', $2, $3, 'active')`,
    [proId, `richard-${proId}`, proPhone],
  );
  await query(
    `INSERT INTO professional_services (id, professional_id, service_id, price_mode)
     VALUES ($1, $2, $3, 'quote')`,
    [randomUUID(), proId, serviceId],
  );
  await query(
    `INSERT INTO professional_service_areas (id, professional_id, city, state, country_code, center, radius_meters)
     VALUES
     ($1, $2, 'Cuiabá', 'MT', 'BR', ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 50000),
     ($3, $2, 'Sinop', 'MT', 'BR', ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, 50000)`,
    [randomUUID(), proId, randomUUID(), P1.longitude, P1.latitude, P2.longitude, P2.latitude],
  );

  const cleanup = async (phoneE164: string) => {
    await withTransaction(async (client) => {
      await client.query("DELETE FROM customer_last_locations WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)", [phoneE164]);
      await client.query("DELETE FROM contextual_turns WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)", [phoneE164]);
      await client.query("DELETE FROM contextual_budgets WHERE scope IN (SELECT id::text FROM customers WHERE phone_e164 = $1)", [phoneE164]);
      await client.query("DELETE FROM contextual_memories WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)", [phoneE164]);
      await client.query(
        `DELETE FROM channel_outbound_message_matches WHERE channel_outbound_message_id IN (
           SELECT id FROM channel_outbound_messages WHERE recipient_phone_e164 = $1
           OR channel_inbound_message_id IN (SELECT id FROM channel_inbound_messages WHERE phone_e164 = $1)
         ) OR match_id IN (
           SELECT id FROM matches WHERE search_request_id IN (
             SELECT id FROM search_requests WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)
           )
         )`,
        [phoneE164],
      );
      await client.query(
        `DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 = $1
         OR channel_inbound_message_id IN (SELECT id FROM channel_inbound_messages WHERE phone_e164 = $1)`,
        [phoneE164],
      );
      await client.query("DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (SELECT id FROM channel_inbound_messages WHERE phone_e164 = $1)", [phoneE164]);
      await client.query("DELETE FROM channel_inbound_messages WHERE phone_e164 = $1", [phoneE164]);
      await client.query("DELETE FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)", [phoneE164]);
      await client.query("DELETE FROM matches WHERE search_request_id IN (SELECT id FROM search_requests WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1))", [phoneE164]);
      await client.query("DELETE FROM search_conversations WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)", [phoneE164]);
      await client.query("DELETE FROM search_requests WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)", [phoneE164]);
      await client.query("DELETE FROM customers WHERE phone_e164 = $1", [phoneE164]);
    });
  };

  const close = async () => {
    await app.close();
    await query("DELETE FROM professional_service_areas WHERE professional_id = $1", [proId]);
    await query("DELETE FROM professional_services WHERE professional_id = $1", [proId]);
    await query("DELETE FROM professionals WHERE id = $1", [proId]);
    if (createdService) {
      await query("DELETE FROM services WHERE id = $1", [serviceId]);
    }
  };

  return {
    app,
    getContextualCalls: () => contextualCalls,
    cleanup,
    close,
  };
}

test("Test 1 (Scenario A): Service-first active conversation pending location bypasses contextual handler when native pin arrives", async () => {
  const env = await setupTestEnvironment();
  const phoneE164 = phone();
  const customerId = randomUUID();

  try {
    // 1. Create customer
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, phoneE164]);

    // 2. Create active conversation with pending_slot = 'location' and service_text = 'Eletricista'
    const convId = randomUUID();
    await query(
      `INSERT INTO search_conversations (
        id, customer_id, status, pending_slot, original_raw_text, service_text,
        country_code, limit_value, expires_at
      ) VALUES ($1, $2, 'active', 'location', 'Preciso de Eletricista', 'Eletricista', 'BR', 3, NOW() + INTERVAL '30 minutes')`,
      [convId, customerId],
    );

    // 3. Inject inbound message with native location pin (no raw_text)
    const pinRes = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        country_code: "BR",
        limit: 3,
        location: {
          latitude: P1.latitude,
          longitude: P1.longitude,
          name: P1.name,
        },
      },
    });

    assert.equal(pinRes.statusCode, 200, pinRes.body);

    // 4. Assert contextual provider was NOT called
    assert.equal(env.getContextualCalls(), 0, "Contextual provider must NOT be called for native pin");

    // 5. Assert conversation was updated with whatsapp_native and coordinates
    const convRow = (await query<{
      status: string;
      pending_slot: string | null;
      location_source: string;
      pin_latitude: number;
      pin_longitude: number;
    }>(
      "SELECT status, pending_slot, location_source, pin_latitude, pin_longitude FROM search_conversations WHERE id = $1",
      [convId],
    )).rows[0];
    assert.ok(convRow, "Conversation must exist");
    assert.equal(convRow.location_source, "whatsapp_native");
    assert.ok(Math.abs(Number(convRow.pin_latitude) - P1.latitude) < 0.0001, "pin_latitude must match");
    assert.ok(Math.abs(Number(convRow.pin_longitude) - P1.longitude) < 0.0001, "pin_longitude must match");
    assert.notEqual(convRow.pending_slot, "location", "pending_slot must no longer be 'location'");

    // 6. Assert customer_last_locations receives coordinates with source = 'whatsapp_native'
    const lastLoc = (await query<{
      latitude: number;
      longitude: number;
      source: string;
    }>(
      "SELECT latitude, longitude, source FROM customer_last_locations WHERE customer_id = $1",
      [customerId],
    )).rows[0];
    assert.ok(lastLoc, "customer_last_locations must have an entry");
    assert.equal(lastLoc.source, "whatsapp_native");
    assert.ok(Math.abs(Number(lastLoc.latitude) - P1.latitude) < 0.0001, "last location latitude must match");
    assert.ok(Math.abs(Number(lastLoc.longitude) - P1.longitude) < 0.0001, "last location longitude must match");

    // 7. Assert outbound message was created and is NOT a clarification
    const outbound = (await query<{ text_content: string }>(
      "SELECT text_content FROM channel_outbound_messages WHERE recipient_phone_e164 = $1 ORDER BY created_at DESC LIMIT 1",
      [phoneE164],
    )).rows[0];
    assert.ok(outbound, "Outbound message must be created");
    assert.doesNotMatch(
      outbound.text_content,
      /esclarecer/i,
      "Outbound message must not be a clarification",
    );

    // 8. Assert active conversation count <= 1
    const activeCount = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM search_conversations WHERE customer_id = $1 AND status = 'active'",
      [customerId],
    )).rows[0].cnt;
    assert.ok(activeCount <= 1, `Active conversation count must be <= 1, got ${activeCount}`);
  } finally {
    await env.close();
    await env.cleanup(phoneE164);
  }
});

test("Test 2: Pin First -> Service Full Sequence - pin P1 then service text executes search with exact P1 coordinates", async () => {
  const env = await setupTestEnvironment();
  const phoneE164 = phone();

  try {
    // Step 1: Inject native pin P1
    const pinRes = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        country_code: "BR",
        limit: 3,
        location: {
          latitude: P1.latitude,
          longitude: P1.longitude,
          name: P1.name,
        },
      },
    });

    assert.equal(pinRes.statusCode, 200, pinRes.body);
    assert.equal(env.getContextualCalls(), 0, "Contextual provider must NOT be called for pin-first");

    // Assert conversation created with pending_slot = 'service'
    const conv1 = (await query<{
      status: string;
      pending_slot: string;
      location_source: string;
      pin_latitude: number;
      pin_longitude: number;
      customer_id: string;
    }>(
      `SELECT c.status, c.pending_slot, c.location_source, c.pin_latitude, c.pin_longitude, c.customer_id
       FROM search_conversations c
       JOIN customers u ON u.id = c.customer_id
       WHERE u.phone_e164 = $1`,
      [phoneE164],
    )).rows[0];
    assert.ok(conv1, "Conversation must be created");
    assert.equal(conv1.pending_slot, "service");
    assert.equal(conv1.location_source, "whatsapp_native");
    assert.ok(Math.abs(Number(conv1.pin_latitude) - P1.latitude) < 0.0001);
    assert.ok(Math.abs(Number(conv1.pin_longitude) - P1.longitude) < 0.0001);

    // Step 2: Customer sends service text "Eletricista"
    const serviceRes = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        raw_text: "Eletricista",
        country_code: "BR",
        limit: 3,
      },
    });

    assert.equal(serviceRes.statusCode, 200, serviceRes.body);
    assert.equal(env.getContextualCalls(), 0, "Contextual provider must NOT be called for service continuation turn");

    // Assert search executed with exact P1 coordinates
    const searchReq = (await query<{ latitude: number; longitude: number }>(
      "SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude FROM search_requests WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1",
      [conv1.customer_id],
    )).rows[0];
    assert.ok(searchReq, "search_requests must be created");
    assert.ok(Math.abs(Number(searchReq.latitude) - P1.latitude) < 0.0001, "search latitude must match P1");
    assert.ok(Math.abs(Number(searchReq.longitude) - P1.longitude) < 0.0001, "search longitude must match P1");

    // Assert conversation updated with P1 coordinates and source whatsapp_native
    const conv2 = (await query<{ location_source: string; pin_latitude: number; pin_longitude: number }>(
      `SELECT location_source, pin_latitude, pin_longitude FROM search_conversations WHERE customer_id = $1`,
      [conv1.customer_id],
    )).rows[0];
    assert.equal(conv2.location_source, "whatsapp_native");
    assert.ok(Math.abs(Number(conv2.pin_latitude) - P1.latitude) < 0.0001);
    assert.ok(Math.abs(Number(conv2.pin_longitude) - P1.longitude) < 0.0001);

    // Assert customer_last_locations has P1 coordinates and source whatsapp_native
    const lastLoc = (await query<{ latitude: number; longitude: number; source: string }>(
      "SELECT latitude, longitude, source FROM customer_last_locations WHERE customer_id = $1",
      [conv1.customer_id],
    )).rows[0];
    assert.ok(lastLoc);
    assert.equal(lastLoc.source, "whatsapp_native");
    assert.ok(Math.abs(Number(lastLoc.latitude) - P1.latitude) < 0.0001);
    assert.ok(Math.abs(Number(lastLoc.longitude) - P1.longitude) < 0.0001);

    // Assert outbound does not contain clarification
    const outbound = (await query<{ text_content: string }>(
      "SELECT text_content FROM channel_outbound_messages WHERE recipient_phone_e164 = $1 ORDER BY created_at DESC LIMIT 1",
      [phoneE164],
    )).rows[0];
    assert.ok(outbound);
    assert.doesNotMatch(outbound.text_content, /esclarecer/i);

    const activeCount = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM search_conversations WHERE customer_id = $1 AND status = 'active'",
      [conv1.customer_id],
    )).rows[0].cnt;
    assert.ok(activeCount <= 1);
  } finally {
    await env.close();
    await env.cleanup(phoneE164);
  }
});

test("Test 3: Remembered Location -> Service - customer with remembered location sending service text prompts location_confirmation (SILENT_MEMORY_REUSE=NO)", async () => {
  const env = await setupTestEnvironment();
  const phoneE164 = phone();
  const customerId = randomUUID();

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, phoneE164]);
    await query(
      `INSERT INTO customer_last_locations (
        id, customer_id, latitude, longitude, city, state, country_code, label, source, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'BR', $7, 'whatsapp_native', NOW())`,
      [randomUUID(), customerId, P1.latitude, P1.longitude, P1.city, P1.state, P1.label],
    );

    // Customer sends service text "Eletricista" without explicit location
    const serviceRes = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        raw_text: "Eletricista",
        country_code: "BR",
        limit: 3,
      },
    });

    assert.equal(serviceRes.statusCode, 200, serviceRes.body);
    assert.equal(env.getContextualCalls(), 0, "Contextual provider must NOT be called when router owns remembered-location turn");

    // Conversation must be pending location_confirmation
    const convRow = (await query<{ pending_slot: string; location_source: string; location_text: string }>(
      "SELECT pending_slot, location_source, location_text FROM search_conversations WHERE customer_id = $1",
      [customerId],
    )).rows[0];
    assert.ok(convRow);
    assert.equal(convRow.pending_slot, "location_confirmation");
    assert.equal(convRow.location_source, "memory_reuse");

    // Outbound prompts for confirmation without silently executing search
    const outbound = (await query<{ text_content: string }>(
      "SELECT text_content FROM channel_outbound_messages WHERE recipient_phone_e164 = $1 ORDER BY created_at DESC LIMIT 1",
      [phoneE164],
    )).rows[0];
    assert.ok(outbound);
    assert.match(outbound.text_content, /novamente/i, "Must prompt for location confirmation");

    // Search request must NOT have been created yet
    const searchCount = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM search_requests WHERE customer_id = $1",
      [customerId],
    )).rows[0].cnt;
    assert.equal(searchCount, 0, "Search must not be silently executed");
  } finally {
    await env.close();
    await env.cleanup(phoneE164);
  }
});

test("Test 4: Location Confirmation -> Sim - sending 'sim' confirms remembered location and executes search with memory_reuse", async () => {
  const env = await setupTestEnvironment();
  const phoneE164 = phone();
  const customerId = randomUUID();

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, phoneE164]);
    await query(
      `INSERT INTO customer_last_locations (
        id, customer_id, latitude, longitude, city, state, country_code, label, source, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'BR', $7, 'whatsapp_native', NOW())`,
      [randomUUID(), customerId, P1.latitude, P1.longitude, P1.city, P1.state, P1.label],
    );

    const convId = randomUUID();
    await query(
      `INSERT INTO search_conversations (
        id, customer_id, status, pending_slot, original_raw_text, service_text,
        location_text, pin_latitude, pin_longitude, location_source, location_city, location_state,
        country_code, limit_value, expires_at
      ) VALUES ($1, $2, 'active', 'location_confirmation', 'eletricista', 'eletricista', $3, $4, $5, 'memory_reuse', $6, $7, 'BR', 3, NOW() + INTERVAL '30 minutes')`,
      [convId, customerId, P1.label, P1.latitude, P1.longitude, P1.city, P1.state],
    );

    // Customer sends "sim"
    const confirmRes = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        raw_text: "sim",
        country_code: "BR",
        limit: 3,
      },
    });

    assert.equal(confirmRes.statusCode, 200, confirmRes.body);
    assert.equal(env.getContextualCalls(), 0, "Contextual provider must NOT be called for 'sim' in location_confirmation");

    // Search request executed with exact remembered coordinates
    const searchReq = (await query<{ latitude: number; longitude: number }>(
      "SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude FROM search_requests WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1",
      [customerId],
    )).rows[0];
    assert.ok(searchReq);
    assert.ok(Math.abs(Number(searchReq.latitude) - P1.latitude) < 0.0001);
    assert.ok(Math.abs(Number(searchReq.longitude) - P1.longitude) < 0.0001);

    // Conversation source is memory_reuse
    const convRow = (await query<{ location_source: string; pending_slot: string }>(
      "SELECT location_source, pending_slot FROM search_conversations WHERE id = $1",
      [convId],
    )).rows[0];
    assert.ok(convRow);
    assert.equal(convRow.location_source, "memory_reuse");
    assert.notEqual(convRow.pending_slot, "location_confirmation");

    // customer_last_locations confirmed with source memory_reuse
    const lastLoc = (await query<{ source: string }>(
      "SELECT source FROM customer_last_locations WHERE customer_id = $1",
      [customerId],
    )).rows[0];
    assert.ok(lastLoc);
    assert.equal(lastLoc.source, "memory_reuse");
  } finally {
    await env.close();
    await env.cleanup(phoneE164);
  }
});

test("Test 5: Location Confirmation -> Não - old location not searched, pending_slot becomes location, new pin P2 becomes authority", async () => {
  const env = await setupTestEnvironment();
  const phoneE164 = phone();
  const customerId = randomUUID();

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, phoneE164]);
    await query(
      `INSERT INTO customer_last_locations (
        id, customer_id, latitude, longitude, city, state, country_code, label, source, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'BR', $7, 'whatsapp_native', NOW())`,
      [randomUUID(), customerId, P1.latitude, P1.longitude, P1.city, P1.state, P1.label],
    );

    const convId = randomUUID();
    await query(
      `INSERT INTO search_conversations (
        id, customer_id, status, pending_slot, original_raw_text, service_text,
        location_text, pin_latitude, pin_longitude, location_source, location_city, location_state,
        country_code, limit_value, expires_at
      ) VALUES ($1, $2, 'active', 'location_confirmation', 'eletricista', 'eletricista', $3, $4, $5, 'memory_reuse', $6, $7, 'BR', 3, NOW() + INTERVAL '30 minutes')`,
      [convId, customerId, P1.label, P1.latitude, P1.longitude, P1.city, P1.state],
    );

    // Step 1: Customer sends "não"
    const naoRes = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        raw_text: "não",
        country_code: "BR",
        limit: 3,
      },
    });

    assert.equal(naoRes.statusCode, 200, naoRes.body);
    assert.equal(env.getContextualCalls(), 0, "Contextual provider must NOT be called for 'não' in location_confirmation");

    // Verify conversation moved to pending_slot = 'location' and no search request was created
    const convRow1 = (await query<{ pending_slot: string }>(
      "SELECT pending_slot FROM search_conversations WHERE id = $1",
      [convId],
    )).rows[0];
    assert.equal(convRow1.pending_slot, "location");

    const searchCount = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM search_requests WHERE customer_id = $1",
      [customerId],
    )).rows[0].cnt;
    assert.equal(searchCount, 0, "Old location must NOT be searched");

    // Step 2: Customer sends new pin P2
    const pin2Res = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        country_code: "BR",
        limit: 3,
        location: {
          latitude: P2.latitude,
          longitude: P2.longitude,
          name: P2.name,
        },
      },
    });

    assert.equal(pin2Res.statusCode, 200, pin2Res.body);
    assert.equal(env.getContextualCalls(), 0, "Contextual provider must NOT be called for new pin P2");

    // P2 becomes authority: search executed with P2 coordinates
    const searchReq = (await query<{ latitude: number; longitude: number }>(
      "SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude FROM search_requests WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1",
      [customerId],
    )).rows[0];
    assert.ok(searchReq, "Search request must be created for P2");
    assert.ok(Math.abs(Number(searchReq.latitude) - P2.latitude) < 0.0001, "search_requests latitude must be P2");
    assert.ok(Math.abs(Number(searchReq.longitude) - P2.longitude) < 0.0001, "search_requests longitude must be P2");

    // Conversation coordinates are P2
    const convRow2 = (await query<{ pin_latitude: number; pin_longitude: number; location_source: string }>(
      "SELECT pin_latitude, pin_longitude, location_source FROM search_conversations WHERE id = $1",
      [convId],
    )).rows[0];
    assert.equal(convRow2.location_source, "whatsapp_native");
    assert.ok(Math.abs(Number(convRow2.pin_latitude) - P2.latitude) < 0.0001);
    assert.ok(Math.abs(Number(convRow2.pin_longitude) - P2.longitude) < 0.0001);

    // customer_last_locations updated to P2
    const lastLoc = (await query<{ latitude: number; longitude: number; source: string }>(
      "SELECT latitude, longitude, source FROM customer_last_locations WHERE customer_id = $1",
      [customerId],
    )).rows[0];
    assert.ok(lastLoc);
    assert.equal(lastLoc.source, "whatsapp_native");
    assert.ok(Math.abs(Number(lastLoc.latitude) - P2.latitude) < 0.0001);
    assert.ok(Math.abs(Number(lastLoc.longitude) - P2.longitude) < 0.0001);
  } finally {
    await env.close();
    await env.cleanup(phoneE164);
  }
});

test("Test 6: Second Pin -> Service - P1 followed by P2 then service text executes search with P2 and zero P1 residue", async () => {
  const env = await setupTestEnvironment();
  const phoneE164 = phone();

  try {
    // Step 1: P1 arrives -> pending service
    const pin1Res = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        country_code: "BR",
        limit: 3,
        location: {
          latitude: P1.latitude,
          longitude: P1.longitude,
          name: P1.name,
        },
      },
    });
    assert.equal(pin1Res.statusCode, 200);
    assert.equal(env.getContextualCalls(), 0);

    // Step 2: P2 arrives while awaiting service -> updates to P2
    const pin2Res = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        country_code: "BR",
        limit: 3,
        location: {
          latitude: P2.latitude,
          longitude: P2.longitude,
          name: P2.name,
        },
      },
    });
    assert.equal(pin2Res.statusCode, 200);
    assert.equal(env.getContextualCalls(), 0);

    const convRow = (await query<{ status: string; pending_slot: string; pin_latitude: number; pin_longitude: number; customer_id: string }>(
      `SELECT c.status, c.pending_slot, c.pin_latitude, c.pin_longitude, c.customer_id
       FROM search_conversations c
       JOIN customers u ON u.id = c.customer_id
       WHERE u.phone_e164 = $1`,
      [phoneE164],
    )).rows[0];
    assert.ok(convRow);
    assert.equal(convRow.pending_slot, "service");
    assert.ok(Math.abs(Number(convRow.pin_latitude) - P2.latitude) < 0.0001);
    assert.ok(Math.abs(Number(convRow.pin_longitude) - P2.longitude) < 0.0001);

    // Step 3: Service text "Eletricista" arrives
    const serviceRes = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        raw_text: "Eletricista",
        country_code: "BR",
        limit: 3,
      },
    });
    assert.equal(serviceRes.statusCode, 200);
    assert.equal(env.getContextualCalls(), 0);

    // Assert search executed with P2
    const searchReq = (await query<{ latitude: number; longitude: number }>(
      "SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude FROM search_requests WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1",
      [convRow.customer_id],
    )).rows[0];
    assert.ok(searchReq);
    assert.ok(Math.abs(Number(searchReq.latitude) - P2.latitude) < 0.0001, "search coordinates must be P2");
    assert.ok(Math.abs(Number(searchReq.longitude) - P2.longitude) < 0.0001, "search coordinates must be P2");

    // customer_last_locations has P2
    const lastLoc = (await query<{ latitude: number; longitude: number; source: string }>(
      "SELECT latitude, longitude, source FROM customer_last_locations WHERE customer_id = $1",
      [convRow.customer_id],
    )).rows[0];
    assert.ok(lastLoc);
    assert.equal(lastLoc.source, "whatsapp_native");
    assert.ok(Math.abs(Number(lastLoc.latitude) - P2.latitude) < 0.0001);
    assert.ok(Math.abs(Number(lastLoc.longitude) - P2.longitude) < 0.0001);
  } finally {
    await env.close();
    await env.cleanup(phoneE164);
  }
});

test("Test 7: Selection Pin Safety - pin in pending_slot='selection' does not select any professional", async () => {
  const env = await setupTestEnvironment();
  const phoneE164 = phone();
  const customerId = randomUUID();
  const searchRequestId = randomUUID();

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, phoneE164]);
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1, $2, 'eletricista', 'matched')", [searchRequestId, customerId]);

    const convId = randomUUID();
    await query(
      `INSERT INTO search_conversations (
        id, customer_id, search_request_id, status, pending_slot, original_raw_text, service_text,
        country_code, limit_value, expires_at
      ) VALUES ($1, $2, $3, 'active', 'selection', 'Preciso de Eletricista', 'Eletricista', 'BR', 3, NOW() + INTERVAL '30 minutes')`,
      [convId, customerId, searchRequestId],
    );

    const pinRes = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        country_code: "BR",
        limit: 3,
        location: {
          latitude: P1.latitude,
          longitude: P1.longitude,
          name: P1.name,
        },
      },
    });

    assert.equal(pinRes.statusCode, 200, pinRes.body);
    assert.equal(env.getContextualCalls(), 0, "Contextual provider must NOT be called for native pin in selection");

    // Assert zero contacts created
    const contactCount = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM contacts WHERE customer_id = $1",
      [customerId],
    )).rows[0].cnt;
    assert.equal(contactCount, 0, "Pin must NOT select any professional");

    // Assert conversation remains active in selection
    const convRow = (await query<{ status: string; pending_slot: string }>(
      "SELECT status, pending_slot FROM search_conversations WHERE id = $1",
      [convId],
    )).rows[0];
    assert.ok(convRow);
    assert.equal(convRow.status, "active");
    assert.equal(convRow.pending_slot, "selection");
  } finally {
    await env.close();
    await env.cleanup(phoneE164);
  }
});

test("Contextual Regressions: Normal text turns route to contextual provider", async () => {
  const env = await setupTestEnvironment();
  const phoneE164 = phone();

  try {
    // 1. Greeting
    const greetRes = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        raw_text: "Olá, bom dia",
        country_code: "BR",
        limit: 3,
      },
    });
    assert.equal(greetRes.statusCode, 200);
    assert.equal(env.getContextualCalls(), 1, "Contextual provider must be called for greeting");

    // 2. Question
    const questionRes = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        raw_text: "Quanto custa uma consulta?",
        country_code: "BR",
        limit: 3,
      },
    });
    assert.equal(questionRes.statusCode, 200);
    assert.equal(env.getContextualCalls(), 2, "Contextual provider must be called for question");

    // 3. Search text with explicit location ("Eletricista em Sinop") when customer has remembered location (Cuiabá)
    const customer = (await query<{ id: string }>("SELECT id FROM customers WHERE phone_e164 = $1", [phoneE164])).rows[0];
    if (customer) {
      await query(
        `INSERT INTO customer_last_locations (
          id, customer_id, latitude, longitude, city, state, country_code, label, source, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'BR', $7, 'whatsapp_native', NOW())
        ON CONFLICT (customer_id) DO UPDATE SET latitude = EXCLUDED.latitude`,
        [randomUUID(), customer.id, P1.latitude, P1.longitude, P1.city, P1.state, P1.label],
      );
    }

    const explicitRes = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        raw_text: "Eletricista em Sinop",
        country_code: "BR",
        limit: 3,
      },
    });
    assert.equal(explicitRes.statusCode, 200);
    assert.equal(env.getContextualCalls(), 3, "Contextual provider must be called for search with explicit location");
  } finally {
    await env.close();
    await env.cleanup(phoneE164);
  }
});
