import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDatabaseConnection, query } from "../src/database/connection.js";
import { PostgresSearchConversationRepository } from "../src/modules/search-conversations/search-conversation.repository.js";
import { PostgresCustomerLastLocationRepository } from "../src/modules/customers/customer-last-location.repository.js";
import { PostgresChannelInboundMessageRepository } from "../src/modules/channel-inbox/channel-inbox.repository.js";
import { DefaultChannelInboxService } from "../src/modules/channel-inbox/channel-inbox.service.js";
import { PostgresChannelOutboundMessageRepository } from "../src/modules/channel-outbox/channel-outbox.repository.js";

after(closeDatabaseConnection);

const convRepo = new PostgresSearchConversationRepository();
const lastLocRepo = new PostgresCustomerLastLocationRepository();
const inboxRepo = new PostgresChannelInboundMessageRepository();
const outboxRepo = new PostgresChannelOutboundMessageRepository();

const phone = () => `+556699${Math.floor(1000000 + Math.random() * 8999999).toString()}`;

async function createCustomer() {
  const customerId = randomUUID();
  const phoneE164 = phone();
  await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, phoneE164]);
  return { customerId, phoneE164 };
}

test("1 & 3 & 4. Pin-first creates a real search_conversations row with whatsapp_native and exact coordinates survive round trip", async () => {
  const { customerId } = await createCustomer();
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
});

test("2. Service-first -> pin can transition a real search_conversations row to selection and completed", async () => {
  const { customerId } = await createCustomer();
  const searchRequestId = randomUUID();
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

  // Transition to completed (no_matches or finished)
  const completeToken = randomUUID();
  await convRepo.claim(conv.id, completeToken, 60);
  const completed = await convRepo.complete({
    id: conv.id,
    processingToken: completeToken,
    serviceText: "eletricista",
    locationText: "Sinop - MT",
    lastMessageText: "Sinop - MT",
    searchRequestId,
  });
  assert.equal(completed, true);

  const completedRecord = await convRepo.findById(conv.id);
  assert.ok(completedRecord);
  assert.equal(completedRecord.status, "completed");
  assert.equal(completedRecord.pendingSlot, null);
});

test("3b. DB CHECK constraint rejects non-canonical location_source like native_pin", async () => {
  const { customerId } = await createCustomer();
  await assert.rejects(
    () => query(
      `INSERT INTO search_conversations (
         customer_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, expires_at, location_source
       ) VALUES ($1, 'active', 'service', 'test', 'test', 'BR', 3, NOW() + INTERVAL '1 hour', 'native_pin')`,
      [customerId],
    ),
    (err: Error) => err.message.includes("search_conversations_location_source_chk"),
  );
});

test("5. location_confirmation pending slot can be persisted, claimed, and updated", async () => {
  const { customerId } = await createCustomer();
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
});

test("6. Duplicate native Inbox is exactly-once", async () => {
  const phoneE164 = phone();
  const providerMessageId = `native-uniq-${randomUUID()}`;

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
});

test("7. Same provider_message_id + different coordinates produces payload conflict", async () => {
  const phoneE164 = phone();
  const providerMessageId = `conflict-${randomUUID()}`;

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
});

test("8. raw_text NULL + valid location is persisted and recovered from channel_inbound_messages", async () => {
  const phoneE164 = phone();
  const providerMessageId = `null-raw-${randomUUID()}`;

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
});

test("9. Partial coordinate DB rows are rejected by PostgreSQL CHECK constraints", async () => {
  const phoneE164 = phone();

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
  const { customerId } = await createCustomer();
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
});

test("10. customer_last_locations upsert is unique and atomic per customer", async () => {
  const { customerId } = await createCustomer();

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
