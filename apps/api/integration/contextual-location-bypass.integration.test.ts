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
      return {
        status: "resolved",
        query: input.query,
        country_code: "BR",
        provider: "fixture",
        candidates: [],
        match: {
          label: input.query,
          latitude: -15.601,
          longitude: -56.097,
          city: "Cuiabá",
          state: "MT",
          country_code: "BR",
          neighborhood: null,
          confidence: 1,
          layer: "locality",
        },
      };
    },
    async reverseGeocode() {
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

  const cleanup = async (phoneE164: string) => {
    await withTransaction(async (client) => {
      await client.query("DELETE FROM customer_last_locations WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)", [phoneE164]);
      await client.query("DELETE FROM contextual_turns WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)", [phoneE164]);
      await client.query("DELETE FROM contextual_budgets WHERE scope IN (SELECT id::text FROM customers WHERE phone_e164 = $1)", [phoneE164]);
      await client.query("DELETE FROM contextual_memories WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)", [phoneE164]);
      await client.query(
        `DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 = $1
         OR channel_inbound_message_id IN (SELECT id FROM channel_inbound_messages WHERE phone_e164 = $1)`,
        [phoneE164],
      );
      await client.query("DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (SELECT id FROM channel_inbound_messages WHERE phone_e164 = $1)", [phoneE164]);
      await client.query("DELETE FROM channel_inbound_messages WHERE phone_e164 = $1", [phoneE164]);
      await client.query("DELETE FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)", [phoneE164]);
      await client.query("DELETE FROM search_conversations WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)", [phoneE164]);
      await client.query("DELETE FROM search_requests WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)", [phoneE164]);
      await client.query("DELETE FROM customers WHERE phone_e164 = $1", [phoneE164]);
      if (createdService) {
        await client.query("DELETE FROM services WHERE id = $1", [serviceId]);
      }
    });
  };

  return {
    app,
    getContextualCalls: () => contextualCalls,
    cleanup,
  };
}

test("Scenario A: Service-first active conversation pending location bypasses contextual handler when native pin arrives", async () => {
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
    const exactLat = -15.601;
    const exactLon = -56.097;
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
          latitude: exactLat,
          longitude: exactLon,
          name: "Praça da República",
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
    assert.ok(Math.abs(Number(convRow.pin_latitude) - exactLat) < 0.0001, "pin_latitude must match");
    assert.ok(Math.abs(Number(convRow.pin_longitude) - exactLon) < 0.0001, "pin_longitude must match");
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
    assert.ok(Math.abs(Number(lastLoc.latitude) - exactLat) < 0.0001, "last location latitude must match");
    assert.ok(Math.abs(Number(lastLoc.longitude) - exactLon) < 0.0001, "last location longitude must match");

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
    await env.app.close();
    await env.cleanup(phoneE164);
  }
});

test("Scenario B: Pin-first inbound message with contextual enabled bypasses contextual handler and creates conversation pending service", async () => {
  const env = await setupTestEnvironment();
  const phoneE164 = phone();

  try {
    const exactLat = -15.601;
    const exactLon = -56.097;

    // Inject native pin with no pre-existing active conversation
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
          latitude: exactLat,
          longitude: exactLon,
          name: "Praça da República",
        },
      },
    });

    assert.equal(pinRes.statusCode, 200, pinRes.body);

    // 1. Assert contextual provider was NOT called
    assert.equal(env.getContextualCalls(), 0, "Contextual provider must NOT be called for pin-first");

    // 2. Assert conversation created with pending_slot = 'service' and location_source = 'whatsapp_native'
    const convRow = (await query<{
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
    assert.ok(convRow, "Conversation must be created");
    assert.equal(convRow.status, "active");
    assert.equal(convRow.pending_slot, "service");
    assert.equal(convRow.location_source, "whatsapp_native");
    assert.ok(Math.abs(Number(convRow.pin_latitude) - exactLat) < 0.0001);
    assert.ok(Math.abs(Number(convRow.pin_longitude) - exactLon) < 0.0001);

    // 3. Assert outbound message asks for service
    const outbound = (await query<{ text_content: string }>(
      "SELECT text_content FROM channel_outbound_messages WHERE recipient_phone_e164 = $1 ORDER BY created_at DESC LIMIT 1",
      [phoneE164],
    )).rows[0];
    assert.ok(outbound, "Outbound message must exist");
    assert.match(
      outbound.text_content,
      /Recebemos sua localização\. Qual serviço você precisa\?/u,
      "Outbound message must prompt for service",
    );

    // 4. Assert active conversation count <= 1
    const activeCount = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM search_conversations WHERE customer_id = $1 AND status = 'active'",
      [convRow.customer_id],
    )).rows[0].cnt;
    assert.ok(activeCount <= 1, `Active conversation count must be <= 1, got ${activeCount}`);
  } finally {
    await env.app.close();
    await env.cleanup(phoneE164);
  }
});

test("Scenario C: Text-only inbound message still routes to contextual handler when contextual is enabled", async () => {
  const env = await setupTestEnvironment();
  const phoneE164 = phone();

  try {
    const textRes = await env.app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "whatsapp",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        raw_text: "Olá, pode me ajudar?",
        country_code: "BR",
        limit: 3,
      },
    });

    assert.equal(textRes.statusCode, 200, textRes.body);

    // Assert contextual provider WAS called
    assert.equal(env.getContextualCalls(), 1, "Contextual provider MUST be called for text-only messages");
  } finally {
    await env.app.close();
    await env.cleanup(phoneE164);
  }
});
