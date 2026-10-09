import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { buildApp } from "../src/app.js";
import { closeDatabaseConnection, query } from "../src/database/connection.js";
import { PostgresSearchConversationRepository } from "../src/modules/search-conversations/search-conversation.repository.js";
import { PostgresCustomerLastLocationRepository } from "../src/modules/customers/customer-last-location.repository.js";
import { PostgresChannelInboundMessageRepository } from "../src/modules/channel-inbox/channel-inbox.repository.js";
import { DefaultChannelInboxService } from "../src/modules/channel-inbox/channel-inbox.service.js";
import { PostgresChannelOutboundMessageRepository } from "../src/modules/channel-outbox/channel-outbox.repository.js";
import type { LocationResolutionService } from "../src/modules/location-resolution/location-resolution.types.js";

const convRepo = new PostgresSearchConversationRepository();
const lastLocRepo = new PostgresCustomerLastLocationRepository();
const inboxRepo = new PostgresChannelInboundMessageRepository();
const outboxRepo = new PostgresChannelOutboundMessageRepository();

const phone = () => `+556699${Math.floor(1000000 + Math.random() * 8999999).toString()}`;

async function cleanAllLocationTestData() {
  await query("DELETE FROM customer_last_locations");
  await query(
    `DELETE FROM channel_outbound_message_matches WHERE match_id IN (
       SELECT id FROM matches WHERE search_request_id IN (
         SELECT id FROM search_conversations WHERE pin_latitude IS NOT NULL OR pending_slot = 'location_confirmation' OR resume_slot = 'location_confirmation' OR location_source = 'whatsapp_native'
       )
     )`,
  );
  await query(
    "DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (SELECT id FROM channel_inbound_messages WHERE latitude IS NOT NULL OR longitude IS NOT NULL OR provider LIKE 'test-%')",
  );
  await query(
    "DELETE FROM channel_outbound_messages WHERE channel_inbound_message_id IN (SELECT id FROM channel_inbound_messages WHERE latitude IS NOT NULL OR longitude IS NOT NULL OR provider LIKE 'test-%') OR provider LIKE 'test-%'",
  );
  await query(
    "DELETE FROM channel_inbound_messages WHERE latitude IS NOT NULL OR longitude IS NOT NULL OR provider LIKE 'test-%'",
  );
  await query("DELETE FROM contacts WHERE search_request_id IN (SELECT id FROM search_conversations WHERE pin_latitude IS NOT NULL OR pending_slot = 'location_confirmation' OR resume_slot = 'location_confirmation' OR location_source = 'whatsapp_native')");
  await query("DELETE FROM matches WHERE search_request_id IN (SELECT id FROM search_conversations WHERE pin_latitude IS NOT NULL OR pending_slot = 'location_confirmation' OR resume_slot = 'location_confirmation' OR location_source = 'whatsapp_native')");
  await query(
    "DELETE FROM search_conversations WHERE pin_latitude IS NOT NULL OR pending_slot = 'location_confirmation' OR resume_slot = 'location_confirmation' OR location_source = 'whatsapp_native'",
  );
}

async function createCustomer() {
  const customerId = randomUUID();
  const phoneE164 = phone();
  await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, phoneE164]);
  return { customerId, phoneE164 };
}

async function cleanCustomer(customerId: string) {
  await query("DELETE FROM customer_last_locations WHERE customer_id = $1", [customerId]);
  await query(
    `DELETE FROM channel_outbound_message_matches WHERE match_id IN (
       SELECT id FROM matches WHERE search_request_id IN (
         SELECT id FROM search_requests WHERE customer_id = $1
       )
     )`,
    [customerId],
  );
  await query("DELETE FROM contacts WHERE search_request_id IN (SELECT id FROM search_requests WHERE customer_id = $1)", [customerId]);
  await query("DELETE FROM matches WHERE search_request_id IN (SELECT id FROM search_requests WHERE customer_id = $1)", [customerId]);
  await query("DELETE FROM search_conversations WHERE customer_id = $1", [customerId]);
  await query("DELETE FROM search_requests WHERE customer_id = $1", [customerId]);
  await query("DELETE FROM customers WHERE id = $1", [customerId]);
}

async function cleanInboundByPhone(phoneE164: string) {
  await query(
    "DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (SELECT id FROM channel_inbound_messages WHERE phone_e164 = $1)",
    [phoneE164],
  );
  await query(
    `DELETE FROM channel_outbound_message_matches WHERE channel_outbound_message_id IN (
       SELECT id FROM channel_outbound_messages WHERE recipient_phone_e164 = $1
       OR channel_inbound_message_id IN (SELECT id FROM channel_inbound_messages WHERE phone_e164 = $1)
     )`,
    [phoneE164],
  );
  await query(
    "DELETE FROM channel_outbound_messages WHERE channel_inbound_message_id IN (SELECT id FROM channel_inbound_messages WHERE phone_e164 = $1) OR recipient_phone_e164 = $1",
    [phoneE164],
  );
  await query("DELETE FROM channel_inbound_messages WHERE phone_e164 = $1", [phoneE164]);
}

before(cleanAllLocationTestData);

after(async () => {
  try {
    await cleanAllLocationTestData();
  } finally {
    await closeDatabaseConnection();
  }
});

test("1 & 3 & 4. Pin-first creates a real search_conversations row with whatsapp_native and exact coordinates survive round trip", async () => {
  const { customerId } = await createCustomer();
  try {
    const exactLat = -11.851234;
    const exactLon = -55.509876;

    const conv = await convRepo.createPending({
      customerId,
      pendingSlot: "service",
      originalRawText: "localização enviada",
      serviceText: "",
      locationText: "Sinop Centro",
      countryCode: "BR",
      limitValue: 3,
      ttlMinutes: 60,
      pinLatitude: exactLat,
      pinLongitude: exactLon,
      pinName: "Sinop Centro",
      locationSource: "whatsapp_native",
    });

    assert.ok(conv.id);
    assert.equal(conv.status, "active");
    assert.equal(conv.pendingSlot, "service");
    assert.equal(conv.locationSource, "whatsapp_native");
    assert.equal(conv.pinLatitude, exactLat);
    assert.equal(conv.pinLongitude, exactLon);
    assert.equal(conv.pinName, "Sinop Centro");

    // Round trip via findById
    const fetched = await convRepo.findById(conv.id);
    assert.ok(fetched);
    assert.equal(fetched.locationSource, "whatsapp_native");
    assert.equal(fetched.pinLatitude, exactLat);
    assert.equal(fetched.pinLongitude, exactLon);

    // Direct SQL inspection
    const row = (await query<{ location_source: string; pin_latitude: number; pin_longitude: number }>(
      "SELECT location_source, pin_latitude, pin_longitude FROM search_conversations WHERE id = $1",
      [conv.id],
    )).rows[0];
    assert.equal(row.location_source, "whatsapp_native");
    assert.equal(Number(row.pin_latitude), exactLat);
    assert.equal(Number(row.pin_longitude), exactLon);
  } finally {
    await cleanCustomer(customerId);
  }
});

test("2. Service-first -> pin can transition a real search_conversations row to selection and completed", async () => {
  const { customerId } = await createCustomer();
  const searchRequestId = randomUUID();
  try {
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1, $2, 'eletricista', 'matched')", [searchRequestId, customerId]);

    const conv = await convRepo.createPending({
      customerId,
      pendingSlot: "location",
      originalRawText: "preciso de eletricista",
      serviceText: "eletricista",
      locationText: null,
      countryCode: "BR",
      limitValue: 3,
      ttlMinutes: 60,
    });

    const leaseToken = randomUUID();
    const claimed = await convRepo.claim(conv.id, leaseToken, 60);
    assert.ok(claimed);

    const exactLat = -11.860123;
    const exactLon = -55.510987;

    // Transition to selection
    const moved = await convRepo.moveToAwaitingSelection({
      id: conv.id,
      processingToken: leaseToken,
      serviceText: "eletricista",
      locationText: "Sinop - MT",
      lastMessageText: "Sinop - MT",
      searchRequestId,
      ttlMinutes: 60,
      pinLatitude: exactLat,
      pinLongitude: exactLon,
      pinName: null,
      locationSource: "whatsapp_native",
    });
    assert.equal(moved, true);

    const selectionRecord = await convRepo.findById(conv.id);
    assert.ok(selectionRecord);
    assert.equal(selectionRecord.status, "active");
    assert.equal(selectionRecord.pendingSlot, "selection");
    assert.equal(selectionRecord.locationSource, "whatsapp_native");
    assert.equal(selectionRecord.pinLatitude, exactLat);
    assert.equal(selectionRecord.pinLongitude, exactLon);

    // Transition conv from selection to completed in real marketplace flow
    await query(
      "UPDATE search_conversations SET status = 'completed', pending_slot = NULL, completed_at = NOW() WHERE id = $1",
      [conv.id],
    );
    const completedSelectionRecord = await convRepo.findById(conv.id);
    assert.ok(completedSelectionRecord);
    assert.equal(completedSelectionRecord.status, "completed");
    assert.equal(completedSelectionRecord.pendingSlot, null);

    // Also verify transition directly from pending location to completed via complete() (e.g. no_matches)
    const noMatchSearchRequestId = randomUUID();
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1, $2, 'eletricista', 'matched')", [noMatchSearchRequestId, customerId]);

    const conv2 = await convRepo.createPending({
      customerId,
      pendingSlot: "location",
      originalRawText: "preciso de eletricista",
      serviceText: "eletricista",
      locationText: null,
      countryCode: "BR",
      limitValue: 3,
      ttlMinutes: 60,
    });

    const completeToken = randomUUID();
    const claimed2 = await convRepo.claim(conv2.id, completeToken, 60);
    assert.ok(claimed2);

    const completed = await convRepo.complete({
      id: conv2.id,
      processingToken: completeToken,
      serviceText: "eletricista",
      locationText: "Sinop - MT",
      lastMessageText: "Sinop - MT",
      searchRequestId: noMatchSearchRequestId,
    });
    assert.equal(completed, true);

    const completedRecord = await convRepo.findById(conv2.id);
    assert.ok(completedRecord);
    assert.equal(completedRecord.status, "completed");
    assert.equal(completedRecord.pendingSlot, null);
  } finally {
    await cleanCustomer(customerId);
  }
});

test("3b. DB CHECK constraint rejects non-canonical location_source like native_pin", async () => {
  const { customerId } = await createCustomer();
  try {
    await assert.rejects(
      () => query(
        `INSERT INTO search_conversations (
           customer_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, expires_at, location_source
         ) VALUES ($1, 'active', 'service', 'test', 'test', 'BR', 3, NOW() + INTERVAL '1 hour', 'native_pin')`,
        [customerId],
      ),
      (err: Error) => err.message.includes("search_conversations_location_source_chk"),
    );
  } finally {
    await cleanCustomer(customerId);
  }
});

test("5. location_confirmation pending slot can be persisted, claimed, and updated", async () => {
  const { customerId } = await createCustomer();
  try {
    const conv = await convRepo.createPending({
      customerId,
      pendingSlot: "location_confirmation",
      originalRawText: "preciso de pintor",
      serviceText: "pintor",
      locationText: "Sinop - MT",
      countryCode: "BR",
      limitValue: 3,
      ttlMinutes: 60,
      pinLatitude: -11.85,
      pinLongitude: -55.50,
      locationSource: "memory_reuse",
    });

    assert.equal(conv.pendingSlot, "location_confirmation");
    assert.equal(conv.locationSource, "memory_reuse");

    const leaseToken = randomUUID();
    const claimed = await convRepo.claim(conv.id, leaseToken, 60);
    assert.ok(claimed);
    assert.equal(claimed.pendingSlot, "location_confirmation");

    // Decline transition -> updates pending slot to 'location'
    const updated = await convRepo.updatePending({
      id: conv.id,
      processingToken: leaseToken,
      pendingSlot: "location",
      serviceText: "pintor",
      locationText: null,
      lastMessageText: "não",
      ttlMinutes: 60,
      pinLatitude: null,
      pinLongitude: null,
      pinName: null,
      locationSource: null,
    });
    assert.equal(updated, true);

    const updatedRecord = await convRepo.findById(conv.id);
    assert.ok(updatedRecord);
    assert.equal(updatedRecord.pendingSlot, "location");
    assert.equal(updatedRecord.pinLatitude, null);
    assert.equal(updatedRecord.locationSource, null);
  } finally {
    await cleanCustomer(customerId);
  }
});

test("6. Duplicate native Inbox is exactly-once", async () => {
  const phoneE164 = phone();
  const providerMessageId = `native-uniq-${randomUUID()}`;
  try {
    const first = await inboxRepo.createOrFind({
      provider: "test-native",
      provider_message_id: providerMessageId,
      phone_e164: phoneE164,
      country_code: "BR",
      limit: 3,
      location: {
        latitude: -11.8548,
        longitude: -55.5089,
        name: "Sinop Centro",
      },
    });
    assert.equal(first.created, true);
    assert.equal(first.record.latitude, -11.8548);
    assert.equal(first.record.longitude, -55.5089);
    assert.equal(first.record.locationName, "Sinop Centro");

    // Re-submission of identical message
    const second = await inboxRepo.createOrFind({
      provider: "test-native",
      provider_message_id: providerMessageId,
      phone_e164: phoneE164,
      country_code: "BR",
      limit: 3,
      location: {
        latitude: -11.8548,
        longitude: -55.5089,
        name: "Sinop Centro",
      },
    });
    assert.equal(second.created, false);
    assert.equal(second.record.id, first.record.id);
  } finally {
    await cleanInboundByPhone(phoneE164);
  }
});

test("7. Same provider_message_id + different coordinates produces payload conflict", async () => {
  const phoneE164 = phone();
  const providerMessageId = `conflict-${randomUUID()}`;
  try {
    // First ingestion
    await inboxRepo.createOrFind({
      provider: "test-conflict",
      provider_message_id: providerMessageId,
      phone_e164: phoneE164,
      country_code: "BR",
      limit: 3,
      location: {
        latitude: -11.85,
        longitude: -55.50,
      },
    });

    const inboxService = new DefaultChannelInboxService(
      inboxRepo,
      { route: async () => ({ kind: "response", response: {} as never, conversationId: null, searchRequestId: null, presentedMatchIds: [] }) },
      { processingLeaseSeconds: 60, retryLimit: 3 },
      { present: () => "ok" },
      outboxRepo,
    );

    // Ingest same provider and message ID but with different coordinates
    const outcome = await inboxService.receive({
      provider: "test-conflict",
      provider_message_id: providerMessageId,
      phone_e164: phoneE164,
      country_code: "BR",
      limit: 3,
      location: {
        latitude: -11.86,
        longitude: -55.51,
      },
    });

    assert.equal(outcome.kind, "channel_message_payload_conflict");
  } finally {
    await cleanInboundByPhone(phoneE164);
  }
});

test("8. raw_text NULL + valid location is persisted and recovered from channel_inbound_messages", async () => {
  const phoneE164 = phone();
  const providerMessageId = `null-raw-${randomUUID()}`;
  try {
    const { record, created } = await inboxRepo.createOrFind({
      provider: "test-native",
      provider_message_id: providerMessageId,
      phone_e164: phoneE164,
      country_code: "BR",
      limit: 3,
      location: {
        latitude: -11.8548,
        longitude: -55.5089,
      },
    });
    assert.equal(created, true);
    assert.equal(record.rawText, null);
    assert.equal(record.latitude, -11.8548);
    assert.equal(record.longitude, -55.5089);

    // Query database directly
    const row = (await query<{ raw_text: string | null; latitude: number; longitude: number }>(
      "SELECT raw_text, latitude, longitude FROM channel_inbound_messages WHERE id = $1",
      [record.id],
    )).rows[0];
    assert.equal(row.raw_text, null);
    assert.equal(Number(row.latitude), -11.8548);
    assert.equal(Number(row.longitude), -55.5089);
  } finally {
    await cleanInboundByPhone(phoneE164);
  }
});

test("9. Partial coordinate DB rows are rejected by PostgreSQL CHECK constraints", async () => {
  const phoneE164 = phone();
  const { customerId } = await createCustomer();
  try {
    // channel_inbound_messages: latitude present, longitude NULL
    await assert.rejects(
      () => query(
        `INSERT INTO channel_inbound_messages (
           provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, latitude, longitude
         ) VALUES ('test-partial', $1, $2, 'text', 'BR', 3, -11.85, NULL)`,
        [randomUUID(), phoneE164],
      ),
      (err: Error) => err.message.includes("channel_inbound_messages_coords_chk"),
    );

    // channel_inbound_messages: latitude NULL, longitude present
    await assert.rejects(
      () => query(
        `INSERT INTO channel_inbound_messages (
           provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, latitude, longitude
         ) VALUES ('test-partial', $1, $2, 'text', 'BR', 3, NULL, -55.50)`,
        [randomUUID(), phoneE164],
      ),
      (err: Error) => err.message.includes("channel_inbound_messages_coords_chk"),
    );

    // search_conversations: pin_latitude present, pin_longitude NULL
    await assert.rejects(
      () => query(
        `INSERT INTO search_conversations (
           customer_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, expires_at, pin_latitude, pin_longitude
         ) VALUES ($1, 'active', 'service', 'test', 'test', 'BR', 3, NOW() + INTERVAL '1 hour', -11.85, NULL)`,
        [customerId],
      ),
      (err: Error) => err.message.includes("search_conversations_pin_coords_chk"),
    );

    // search_conversations: pin_latitude NULL, pin_longitude present
    await assert.rejects(
      () => query(
        `INSERT INTO search_conversations (
           customer_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, expires_at, pin_latitude, pin_longitude
         ) VALUES ($1, 'active', 'service', 'test', 'test', 'BR', 3, NOW() + INTERVAL '1 hour', NULL, -55.50)`,
        [customerId],
      ),
      (err: Error) => err.message.includes("search_conversations_pin_coords_chk"),
    );
  } finally {
    await cleanCustomer(customerId);
    await cleanInboundByPhone(phoneE164);
  }
});

test("10. customer_last_locations upsert is unique and atomic per customer", async () => {
  const { customerId } = await createCustomer();
  try {
    // First upsert (whatsapp_native)
    await lastLocRepo.upsert({
      customerId,
      latitude: -11.8548,
      longitude: -55.5089,
      city: "Sinop",
      state: "MT",
      countryCode: "BR",
      label: "Sinop - MT",
      source: "whatsapp_native",
    });

    const first = await lastLocRepo.findByCustomerId(customerId);
    assert.ok(first);
    assert.equal(first.source, "whatsapp_native");
    assert.equal(first.latitude, -11.8548);
    assert.equal(first.longitude, -55.5089);
    assert.equal(first.label, "Sinop - MT");

    // Second upsert for same customer (overwrites cleanly, source text_resolved)
    await lastLocRepo.upsert({
      customerId,
      latitude: -11.8600,
      longitude: -55.5100,
      city: "Sinop",
      state: "MT",
      countryCode: "BR",
      label: "Sinop Centro - MT",
      source: "text_resolved",
    });

    const second = await lastLocRepo.findByCustomerId(customerId);
    assert.ok(second);
    assert.equal(second.source, "text_resolved");
    assert.equal(second.latitude, -11.8600);
    assert.equal(second.longitude, -55.5100);
    assert.equal(second.label, "Sinop Centro - MT");

    // Verify exactly 1 row exists in table for this customer
    const countRow = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM customer_last_locations WHERE customer_id = $1",
      [customerId],
    )).rows[0];
    assert.equal(countRow.cnt, 1);
  } finally {
    await cleanCustomer(customerId);
  }
});

test("11. No full street address columns exist anywhere in schema", async () => {
  const inboundAddressCol = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM information_schema.columns WHERE table_name = 'channel_inbound_messages' AND column_name = 'location_address'",
  )).rows[0].cnt;
  assert.equal(inboundAddressCol, 0, "location_address column must NOT exist on channel_inbound_messages");

  const convAddressCol = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM information_schema.columns WHERE table_name = 'search_conversations' AND column_name = 'pin_address'",
  )).rows[0].cnt;
  assert.equal(convAddressCol, 0, "pin_address column must NOT exist on search_conversations");

  const memoryAddressCols = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM information_schema.columns WHERE table_name = 'customer_last_locations' AND column_name LIKE '%address%'",
  )).rows[0].cnt;
  assert.equal(memoryAddressCols, 0, "No address columns may exist on customer_last_locations");
});

let verticalGeocoderCalls = 0;
const verticalLocationResolutionService: LocationResolutionService = {
  async resolve(input) {
    verticalGeocoderCalls += 1;
    if (input.query?.toLowerCase().includes("sorriso")) {
      return {
        status: "resolved",
        query: input.query,
        country_code: "BR",
        provider: "fixture",
        candidates: [],
        match: {
          label: "Sorriso - MT",
          latitude: -12.543210,
          longitude: -55.712340,
          city: "Sorriso",
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
        label: "Sinop - MT",
        latitude: -11.854812,
        longitude: -55.508934,
        city: "Sinop",
        state: "MT",
        country_code: "BR",
        neighborhood: null,
        confidence: 1,
        layer: "locality",
      },
    };
  },
  async reverseGeocode(coords) {
    verticalGeocoderCalls += 1;
    if (Math.abs(coords.latitude - (-12.543210)) < 0.01) {
      return {
        city: "Sorriso",
        state: "MT",
        country: "BR",
      };
    }
    return {
      city: "Sinop",
      state: "MT",
      country: "BR",
    };
  },
};

async function setupCatalogAndProfessional() {
  const cat = await query<{ id: string }>("SELECT id FROM service_categories LIMIT 1");
  let catId = cat.rows[0]?.id;
  if (!catId) {
    catId = randomUUID();
    await query("INSERT INTO service_categories (id, name, slug) VALUES ($1, 'Serviços Gerais', 'servicos-gerais')", [catId]);
  }

  let serviceId: string;
  const existingService = await query<{ id: string }>("SELECT id FROM services WHERE slug = 'eletricista'");
  if (existingService.rows[0]) {
    serviceId = existingService.rows[0].id;
    await query("UPDATE services SET is_active = TRUE WHERE id = $1", [serviceId]);
  } else {
    serviceId = randomUUID();
    await query(
      "INSERT INTO services (id, category_id, name, slug, is_active) VALUES ($1, $2, 'Eletricista', 'eletricista', TRUE)",
      [serviceId, catId],
    );
  }

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
     ($1, $2, 'Sinop', 'MT', 'BR', ST_SetSRID(ST_MakePoint(-55.508934, -11.854812), 4326)::geography, 50000),
     ($3, $2, 'Sorriso', 'MT', 'BR', ST_SetSRID(ST_MakePoint(-55.712340, -12.543210), 4326)::geography, 50000)`,
    [randomUUID(), proId, randomUUID()],
  );

  return {
    serviceId,
    proId,
    proPhone,
    cleanup: async () => {
      await query("DELETE FROM professional_service_areas WHERE professional_id = $1", [proId]);
      await query("DELETE FROM professional_services WHERE professional_id = $1", [proId]);
      await query("DELETE FROM professionals WHERE id = $1", [proId]);
    },
  };
}

test("12. Vertical Test A: Native pin -> service text -> search executes with whatsapp_native and exact coordinates unchanged", async () => {
  const { customerId, phoneE164 } = await createCustomer();
  const catalog = await setupCatalogAndProfessional();
  const app = buildApp({ internalApiKey: "test-internal-key", locationResolutionService: verticalLocationResolutionService });
  const headers = { "x-internal-key": "test-internal-key" };

  try {
    const exactLat = -11.854812;
    const exactLon = -55.508934;

    // Step 1: Customer sends native WhatsApp location pin
    const pinRes = await app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "test-v2",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        country_code: "BR",
        limit: 3,
        location: {
          latitude: exactLat,
          longitude: exactLon,
          name: "Sinop Centro",
        },
      },
    });
    assert.equal(pinRes.statusCode, 200);

    // Verify conversation created in pending 'service' with whatsapp_native
    const pinConv = (await query<{ location_source: string; pin_latitude: number; pin_longitude: number; pending_slot: string }>(
      "SELECT location_source, pin_latitude, pin_longitude, pending_slot FROM search_conversations WHERE customer_id = $1",
      [customerId],
    )).rows[0];
    assert.ok(pinConv);
    assert.equal(pinConv.pending_slot, "service");
    assert.equal(pinConv.location_source, "whatsapp_native");
    assert.equal(Number(pinConv.pin_latitude), exactLat);
    assert.equal(Number(pinConv.pin_longitude), exactLon);

    // Step 2: Customer sends service text "eletricista"
    const serviceRes = await app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "test-v2",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        raw_text: "eletricista",
        country_code: "BR",
        limit: 3,
      },
    });
    assert.equal(serviceRes.statusCode, 200);

    // Direct DB assertions after search execution
    const lastLoc = await lastLocRepo.findByCustomerId(customerId);
    assert.ok(lastLoc);
    assert.equal(lastLoc.source, "whatsapp_native");
    assert.equal(lastLoc.latitude, exactLat);
    assert.equal(lastLoc.longitude, exactLon);
    assert.equal(lastLoc.city, "Sinop");
    assert.equal(lastLoc.state, "MT");

    const convAfter = (await query<{ location_source: string; pin_latitude: number; pin_longitude: number; location_city: string; location_state: string; pending_slot: string }>(
      "SELECT location_source, pin_latitude, pin_longitude, location_city, location_state, pending_slot FROM search_conversations WHERE customer_id = $1",
      [customerId],
    )).rows[0];
    assert.ok(convAfter);
    assert.equal(convAfter.pending_slot, "selection");
    assert.equal(convAfter.location_source, "whatsapp_native");
    assert.equal(Number(convAfter.pin_latitude), exactLat);
    assert.equal(Number(convAfter.pin_longitude), exactLon);
    assert.equal(convAfter.location_city, "Sinop");
    assert.equal(convAfter.location_state, "MT");
  } finally {
    await cleanCustomer(customerId);
    await cleanInboundByPhone(phoneE164);
    await catalog.cleanup();
  }
});

test("13. Vertical Test B: Customer with remembered location -> service text -> confirmation prompt -> 'sim' -> 0 geocoder calls and memory_reuse", async () => {
  const { customerId, phoneE164 } = await createCustomer();
  const catalog = await setupCatalogAndProfessional();
  const app = buildApp({ internalApiKey: "test-internal-key", locationResolutionService: verticalLocationResolutionService });
  const headers = { "x-internal-key": "test-internal-key" };

  try {
    const exactLat = -11.854812;
    const exactLon = -55.508934;

    // Seed customer remembered location
    await lastLocRepo.upsert({
      customerId,
      latitude: exactLat,
      longitude: exactLon,
      city: "Sinop",
      state: "MT",
      label: "Sinop - MT",
      source: "whatsapp_native",
      countryCode: "BR",
    });

    // Step 1: Customer sends service text "eletricista"
    const serviceRes = await app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "test-v2",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        raw_text: "eletricista",
        country_code: "BR",
        limit: 3,
      },
    });
    assert.equal(serviceRes.statusCode, 200);

    const confConv = (await query<{ pending_slot: string; location_source: string; location_city: string; location_state: string; pin_latitude: number; pin_longitude: number }>(
      "SELECT pending_slot, location_source, location_city, location_state, pin_latitude, pin_longitude FROM search_conversations WHERE customer_id = $1",
      [customerId],
    )).rows[0];
    assert.ok(confConv);
    assert.equal(confConv.pending_slot, "location_confirmation");
    assert.equal(confConv.location_source, "memory_reuse");
    assert.equal(confConv.location_city, "Sinop");
    assert.equal(confConv.location_state, "MT");
    assert.equal(Number(confConv.pin_latitude), exactLat);
    assert.equal(Number(confConv.pin_longitude), exactLon);

    // Reset verticalGeocoderCalls counter
    verticalGeocoderCalls = 0;

    // Step 2: Customer confirms with "sim"
    const confirmRes = await app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "test-v2",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        raw_text: "sim",
        country_code: "BR",
        limit: 3,
      },
    });
    assert.equal(confirmRes.statusCode, 200);

    // Assert 0 geocoder calls occurred during confirmation
    assert.equal(verticalGeocoderCalls, 0, "Zero geocoder calls made during memory confirmation");

    // Direct DB assertions
    const searchReq = (await query<{ city: string; state: string }>(
      "SELECT city, state FROM search_requests WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1",
      [customerId],
    )).rows[0];
    assert.ok(searchReq);
    assert.equal(searchReq.city, "Sinop");
    assert.equal(searchReq.state, "MT");

    const lastLoc = await lastLocRepo.findByCustomerId(customerId);
    assert.ok(lastLoc);
    assert.equal(lastLoc.city, "Sinop");
    assert.equal(lastLoc.state, "MT");
    assert.equal(lastLoc.source, "memory_reuse");
    assert.equal(lastLoc.latitude, exactLat);
    assert.equal(lastLoc.longitude, exactLon);

    const convAfter = (await query<{ pending_slot: string; location_source: string; location_city: string; location_state: string; pin_latitude: number; pin_longitude: number }>(
      "SELECT pending_slot, location_source, location_city, location_state, pin_latitude, pin_longitude FROM search_conversations WHERE customer_id = $1",
      [customerId],
    )).rows[0];
    assert.ok(convAfter);
    assert.equal(convAfter.pending_slot, "selection");
    assert.equal(convAfter.location_source, "memory_reuse");
    assert.equal(convAfter.location_city, "Sinop");
    assert.equal(convAfter.location_state, "MT");
    assert.equal(Number(convAfter.pin_latitude), exactLat);
    assert.equal(Number(convAfter.pin_longitude), exactLon);
  } finally {
    await cleanCustomer(customerId);
    await cleanInboundByPhone(phoneE164);
    await catalog.cleanup();
  }
});

test("14. Vertical Test C: Customer at location_confirmation with coords A replies 'Sorriso' -> coords B replace A (TEXT_OVERRIDE_STALE_COORDINATES = 0)", async () => {
  const { customerId, phoneE164 } = await createCustomer();
  const catalog = await setupCatalogAndProfessional();
  const app = buildApp({ internalApiKey: "test-internal-key", locationResolutionService: verticalLocationResolutionService });
  const headers = { "x-internal-key": "test-internal-key" };

  try {
    const coordsALat = -11.854812;
    const coordsALon = -55.508934;
    const coordsBLat = -12.543210;
    const coordsBLon = -55.712340;

    // Seed customer with remembered Sinop coords A
    await lastLocRepo.upsert({
      customerId,
      latitude: coordsALat,
      longitude: coordsALon,
      city: "Sinop",
      state: "MT",
      label: "Sinop - MT",
      source: "whatsapp_native",
      countryCode: "BR",
    });

    // Step 1: Customer sends "eletricista" -> prompts for location_confirmation
    const serviceRes = await app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "test-v2",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        raw_text: "eletricista",
        country_code: "BR",
        limit: 3,
      },
    });
    assert.equal(serviceRes.statusCode, 200);

    // Step 2: Customer replies with "Sorriso" (text override)
    const overrideRes = await app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "test-v2",
        provider_message_id: randomUUID(),
        phone_e164: phoneE164,
        raw_text: "Sorriso",
        country_code: "BR",
        limit: 3,
      },
    });
    assert.equal(overrideRes.statusCode, 200);

    // Direct DB assertions: verify NO field still contains coords A!
    const convRow = (await query<{ location_source: string; pin_latitude: number; pin_longitude: number; location_city: string; location_state: string; pending_slot: string }>(
      "SELECT location_source, pin_latitude, pin_longitude, location_city, location_state, pending_slot FROM search_conversations WHERE customer_id = $1",
      [customerId],
    )).rows[0];
    assert.ok(convRow);
    assert.equal(convRow.pending_slot, "selection");

    const staleCoordsFound = (Number(convRow.pin_latitude) === coordsALat || Number(convRow.pin_longitude) === coordsALon) ? 1 : 0;
    assert.equal(staleCoordsFound, 0, "TEXT_OVERRIDE_STALE_COORDINATES must be 0");

    assert.equal(convRow.location_source, "text_resolved");
    assert.equal(convRow.location_city, "Sorriso");
    assert.equal(convRow.location_state, "MT");
    assert.equal(Number(convRow.pin_latitude), coordsBLat);
    assert.equal(Number(convRow.pin_longitude), coordsBLon);

    const lastLoc = await lastLocRepo.findByCustomerId(customerId);
    assert.ok(lastLoc);
    assert.equal(lastLoc.city, "Sorriso");
    assert.equal(lastLoc.state, "MT");
    assert.equal(lastLoc.source, "text_resolved");
    assert.equal(lastLoc.latitude, coordsBLat);
    assert.equal(lastLoc.longitude, coordsBLon);
  } finally {
    await cleanCustomer(customerId);
    await cleanInboundByPhone(phoneE164);
    await catalog.cleanup();
  }
});

