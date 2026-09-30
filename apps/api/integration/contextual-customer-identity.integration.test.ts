import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { query, withTransaction, closeDatabaseConnection } from "../src/database/connection.js";
import { PostgresContextualRepository } from "../src/modules/contextual-conversation/contextual.repository.js";
import { ContextualConversationService } from "../src/modules/contextual-conversation/contextual.service.js";
import { type ContextualProvider, type ContextualProposal } from "../src/modules/contextual-conversation/contextual.contract.js";
import { PostgresChannelInboundMessageRepository } from "../src/modules/channel-inbox/channel-inbox.repository.js";
import { CustomerPhoneIdentityCollisionError } from "../src/modules/customers/customer.repository.js";
import { getPhoneIdentityAliases } from "@contatocerto/shared";

after(closeDatabaseConnection);

const headers = { "x-internal-key": "test-contextual-identity" };
const basicProposal = (overrides: Partial<ContextualProposal> = {}): ContextualProposal => ({
  intent: "search",
  services: [],
  location: null,
  uncertain: false,
  ...overrides,
});

function randomTestPhones() {
  const digits = Math.floor(1000000 + Math.random() * 9000000).toString();
  const degradedPhone = `+55998${digits}`;
  const canonicalPhone = `+559998${digits}`;
  return { degradedPhone, canonicalPhone };
}

test("Case 1: contextual acquire + canonical incoming + degraded existing => same customer ID, canonical phone persisted, customer count remains 1", async () => {
  const { degradedPhone, canonicalPhone } = randomTestPhones();
  const historicalCustomerId = randomUUID();
  const inboundRepo = new PostgresChannelInboundMessageRepository();
  const contextualRepo = new PostgresContextualRepository();
  const inboundId = randomUUID();

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [historicalCustomerId, degradedPhone]);

    const registered = await inboundRepo.createOrFind(
      {
        provider: "test",
        provider_message_id: inboundId,
        phone_e164: canonicalPhone,
        raw_text: "Preciso de encanador",
        country_code: "BR",
        limit: 3,
      },
      { contextual: true },
    );

    const claimed = await inboundRepo.claim(registered.record.id, randomUUID(), 60);
    assert.ok(claimed);

    const snapshot = await contextualRepo.acquire(claimed, "unit-fake-model");

    // Must resolve to the existing historical customer ID
    assert.equal(snapshot.customerId, historicalCustomerId);

    // Customer record must have phone updated to canonical representation
    const customerRow = (
      await query<{ id: string; phone_e164: string }>("SELECT id, phone_e164 FROM customers WHERE id = $1", [
        historicalCustomerId,
      ])
    ).rows[0];
    assert.equal(customerRow.phone_e164, canonicalPhone);

    // Exactly one customer record must exist across all aliases
    const aliases = getPhoneIdentityAliases(canonicalPhone);
    const totalCount = (
      await query<{ cnt: number }>(
        "SELECT count(*)::int as cnt FROM customers WHERE phone_e164 = ANY($1)",
        [aliases as string[]],
      )
    ).rows[0].cnt;
    assert.equal(totalCount, 1);

    await contextualRepo.release(snapshot);
  } finally {
    await withTransaction(async (client) => {
      await client.query("DELETE FROM contextual_turns WHERE customer_id = $1", [historicalCustomerId]);
      await client.query("DELETE FROM contextual_memories WHERE customer_id = $1", [historicalCustomerId]);
      await client.query("DELETE FROM channel_inbound_messages WHERE provider_message_id = $1", [inboundId]);
      await client.query("DELETE FROM customers WHERE id = $1", [historicalCustomerId]);
    });
  }
});

test("Case 2: contextual acquire + degraded incoming + canonical existing => same customer ID, customer count remains 1", async () => {
  const { degradedPhone, canonicalPhone } = randomTestPhones();
  const historicalCustomerId = randomUUID();
  const inboundRepo = new PostgresChannelInboundMessageRepository();
  const contextualRepo = new PostgresContextualRepository();
  const inboundId = randomUUID();

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [historicalCustomerId, canonicalPhone]);

    const registered = await inboundRepo.createOrFind(
      {
        provider: "test",
        provider_message_id: inboundId,
        phone_e164: degradedPhone,
        raw_text: "Preciso de encanador",
        country_code: "BR",
        limit: 3,
      },
      { contextual: true },
    );

    const claimed = await inboundRepo.claim(registered.record.id, randomUUID(), 60);
    assert.ok(claimed);

    const snapshot = await contextualRepo.acquire(claimed, "unit-fake-model");

    // Must resolve to the existing historical customer ID
    assert.equal(snapshot.customerId, historicalCustomerId);

    // Customer record remains canonical
    const customerRow = (
      await query<{ id: string; phone_e164: string }>("SELECT id, phone_e164 FROM customers WHERE id = $1", [
        historicalCustomerId,
      ])
    ).rows[0];
    assert.equal(customerRow.phone_e164, canonicalPhone);

    // Exactly one customer record must exist across all aliases
    const aliases = getPhoneIdentityAliases(canonicalPhone);
    const totalCount = (
      await query<{ cnt: number }>(
        "SELECT count(*)::int as cnt FROM customers WHERE phone_e164 = ANY($1)",
        [aliases as string[]],
      )
    ).rows[0].cnt;
    assert.equal(totalCount, 1);

    await contextualRepo.release(snapshot);
  } finally {
    await withTransaction(async (client) => {
      await client.query("DELETE FROM contextual_turns WHERE customer_id = $1", [historicalCustomerId]);
      await client.query("DELETE FROM contextual_memories WHERE customer_id = $1", [historicalCustomerId]);
      await client.query("DELETE FROM channel_inbound_messages WHERE provider_message_id = $1", [inboundId]);
      await client.query("DELETE FROM customers WHERE id = $1", [historicalCustomerId]);
    });
  }
});

test("Case 3: contextual acquire with no customer => one canonical customer created", async () => {
  const { degradedPhone, canonicalPhone } = randomTestPhones();
  const inboundRepo = new PostgresChannelInboundMessageRepository();
  const contextualRepo = new PostgresContextualRepository();
  const inboundId = randomUUID();
  let createdCustomerId: string | null = null;

  try {
    const registered = await inboundRepo.createOrFind(
      {
        provider: "test",
        provider_message_id: inboundId,
        phone_e164: degradedPhone,
        raw_text: "Preciso de encanador",
        country_code: "BR",
        limit: 3,
      },
      { contextual: true },
    );

    const claimed = await inboundRepo.claim(registered.record.id, randomUUID(), 60);
    assert.ok(claimed);

    const snapshot = await contextualRepo.acquire(claimed, "unit-fake-model");
    createdCustomerId = snapshot.customerId;
    assert.ok(createdCustomerId);

    // Persisted customer record must be canonical
    const customerRow = (
      await query<{ id: string; phone_e164: string }>("SELECT id, phone_e164 FROM customers WHERE id = $1", [
        createdCustomerId,
      ])
    ).rows[0];
    assert.equal(customerRow.phone_e164, canonicalPhone);

    // Exactly one customer record created
    const aliases = getPhoneIdentityAliases(canonicalPhone);
    const totalCount = (
      await query<{ cnt: number }>(
        "SELECT count(*)::int as cnt FROM customers WHERE phone_e164 = ANY($1)",
        [aliases as string[]],
      )
    ).rows[0].cnt;
    assert.equal(totalCount, 1);

    await contextualRepo.release(snapshot);
  } finally {
    if (createdCustomerId) {
      await withTransaction(async (client) => {
        await client.query("DELETE FROM contextual_turns WHERE customer_id = $1", [createdCustomerId]);
        await client.query("DELETE FROM contextual_memories WHERE customer_id = $1", [createdCustomerId]);
        await client.query("DELETE FROM channel_inbound_messages WHERE provider_message_id = $1", [inboundId]);
        await client.query("DELETE FROM customers WHERE id = $1", [createdCustomerId]);
      });
    }
  }
});

test("Case 4: canonical + degraded duplicate rows already present => deterministic customer_phone_identity_collision => no implicit merge", async () => {
  const { degradedPhone, canonicalPhone } = randomTestPhones();
  const customerIdA = randomUUID();
  const customerIdB = randomUUID();
  const inboundRepo = new PostgresChannelInboundMessageRepository();
  const contextualRepo = new PostgresContextualRepository();
  const inboundId = randomUUID();

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerIdA, degradedPhone]);
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerIdB, canonicalPhone]);

    const registered = await inboundRepo.createOrFind(
      {
        provider: "test",
        provider_message_id: inboundId,
        phone_e164: canonicalPhone,
        raw_text: "Preciso de encanador",
        country_code: "BR",
        limit: 3,
      },
      { contextual: true },
    );

    const claimed = await inboundRepo.claim(registered.record.id, randomUUID(), 60);
    assert.ok(claimed);

    await assert.rejects(
      contextualRepo.acquire(claimed, "unit-fake-model"),
      (err: unknown) => {
        assert.ok(err instanceof CustomerPhoneIdentityCollisionError);
        assert.equal(err.code, "customer_phone_identity_collision");
        return true;
      },
    );

    // Both rows must remain intact without silent data merging
    const rows = (
      await query<{ id: string; phone_e164: string }>(
        "SELECT id, phone_e164 FROM customers WHERE id IN ($1, $2) ORDER BY phone_e164",
        [customerIdA, customerIdB],
      )
    ).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].phone_e164, degradedPhone);
    assert.equal(rows[1].phone_e164, canonicalPhone);
  } finally {
    await withTransaction(async (client) => {
      await client.query("DELETE FROM channel_inbound_messages WHERE provider_message_id = $1", [inboundId]);
      await client.query("DELETE FROM customers WHERE id IN ($1, $2)", [customerIdA, customerIdB]);
    });
  }
});

test("Case 5: contextual_memories is attached to the resolved historical customer ID", async () => {
  const { degradedPhone, canonicalPhone } = randomTestPhones();
  const historicalCustomerId = randomUUID();
  const inboundRepo = new PostgresChannelInboundMessageRepository();
  const contextualRepo = new PostgresContextualRepository();
  const inboundId = randomUUID();

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [historicalCustomerId, degradedPhone]);

    const registered = await inboundRepo.createOrFind(
      {
        provider: "test",
        provider_message_id: inboundId,
        phone_e164: canonicalPhone,
        raw_text: "Preciso de encanador",
        country_code: "BR",
        limit: 3,
      },
      { contextual: true },
    );

    const claimed = await inboundRepo.claim(registered.record.id, randomUUID(), 60);
    assert.ok(claimed);

    const snapshot = await contextualRepo.acquire(claimed, "unit-fake-model");

    const memories = (
      await query<{ customer_id: string }>("SELECT customer_id FROM contextual_memories WHERE customer_id = $1", [
        snapshot.customerId,
      ])
    ).rows;
    assert.equal(memories.length, 1);
    assert.equal(memories[0].customer_id, historicalCustomerId);

    await contextualRepo.release(snapshot);
  } finally {
    await withTransaction(async (client) => {
      await client.query("DELETE FROM contextual_turns WHERE customer_id = $1", [historicalCustomerId]);
      await client.query("DELETE FROM contextual_memories WHERE customer_id = $1", [historicalCustomerId]);
      await client.query("DELETE FROM channel_inbound_messages WHERE provider_message_id = $1", [inboundId]);
      await client.query("DELETE FROM customers WHERE id = $1", [historicalCustomerId]);
    });
  }
});

test("Case 6: contextual_turns uses the resolved historical customer identity", async () => {
  const { degradedPhone, canonicalPhone } = randomTestPhones();
  const historicalCustomerId = randomUUID();
  const inboundRepo = new PostgresChannelInboundMessageRepository();
  const contextualRepo = new PostgresContextualRepository();
  const inboundId = randomUUID();

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [historicalCustomerId, degradedPhone]);

    const registered = await inboundRepo.createOrFind(
      {
        provider: "test",
        provider_message_id: inboundId,
        phone_e164: canonicalPhone,
        raw_text: "Preciso de encanador",
        country_code: "BR",
        limit: 3,
      },
      { contextual: true },
    );

    const claimed = await inboundRepo.claim(registered.record.id, randomUUID(), 60);
    assert.ok(claimed);

    const snapshot = await contextualRepo.acquire(claimed, "unit-fake-model");

    const turn = (
      await query<{ customer_id: string; inbound_id: string }>(
        "SELECT customer_id, inbound_id FROM contextual_turns WHERE inbound_id = $1",
        [registered.record.id],
      )
    ).rows[0];
    assert.ok(turn);
    assert.equal(turn.customer_id, historicalCustomerId);
    assert.equal(turn.inbound_id, registered.record.id);

    await contextualRepo.release(snapshot);
  } finally {
    await withTransaction(async (client) => {
      await client.query("DELETE FROM contextual_turns WHERE customer_id = $1", [historicalCustomerId]);
      await client.query("DELETE FROM contextual_memories WHERE customer_id = $1", [historicalCustomerId]);
      await client.query("DELETE FROM channel_inbound_messages WHERE provider_message_id = $1", [inboundId]);
      await client.query("DELETE FROM customers WHERE id = $1", [historicalCustomerId]);
    });
  }
});

test("Case 7: no second active search/customer context is created solely because of 8/9-digit representation differences", async () => {
  const { degradedPhone, canonicalPhone } = randomTestPhones();
  const customerId = randomUUID();
  const categoryId = randomUUID();
  const serviceId = randomUUID();
  const conversationId = randomUUID();

  const provider: ContextualProvider = {
    model: "unit-fake-no-model-call",
    async interpret() {
      return basicProposal({ intent: "faq_cost" });
    },
    async composeQuestion() {
      return { target: "location", question: "Qual a sua cidade?" };
    },
  };

  const contextual = new ContextualConversationService(
    provider,
    {
      async resolve(input) {
        return {
          status: "resolved",
          query: input.query,
          country_code: "BR",
          provider: "fake",
          candidates: [],
          match: {
            label: input.query,
            latitude: -11.86,
            longitude: -55.5,
            city: input.query,
            state: "MT",
            country_code: "BR",
            neighborhood: null,
            confidence: 1,
            layer: "locality",
          },
        };
      },
    },
    { timeoutMs: 25 },
  );

  const app = buildApp({
    internalApiKey: "test-contextual-identity",
    contextualConversation: contextual,
  });

  try {
    // Seed customer with degraded phone and an active search conversation
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, degradedPhone]);
    await query("INSERT INTO service_categories (id, name, slug) VALUES ($1, 'Teste', $2)", [categoryId, `cat-${categoryId}`]);
    await query("INSERT INTO services (id, category_id, name, slug) VALUES ($1, $2, 'Eletricista', $3)", [serviceId, categoryId, `eletricista-${serviceId}`]);
    await query(
      `INSERT INTO search_conversations (id, customer_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, search_request_id, expires_at)
       VALUES ($1, $2, 'active', 'location', 'eletricista', 'eletricista', 'BR', 3, NULL, NOW() + INTERVAL '1 hour')`,
      [conversationId, customerId],
    );

    // Customer sends message with canonical phone
    const response = await app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers,
      payload: {
        provider: "test",
        provider_message_id: randomUUID(),
        phone_e164: canonicalPhone,
        raw_text: "Quanto custa usar?",
      },
    });

    assert.equal(response.statusCode, 200, response.body);

    // Exactly 1 customer must exist
    const aliases = getPhoneIdentityAliases(canonicalPhone);
    const customers = (
      await query<{ id: string; phone_e164: string }>(
        "SELECT id, phone_e164 FROM customers WHERE phone_e164 = ANY($1)",
        [aliases as string[]],
      )
    ).rows;
    assert.equal(customers.length, 1);
    assert.equal(customers[0].id, customerId);

    // Exactly 1 active search conversation must exist for this customer
    const conversations = (
      await query<{ id: string; customer_id: string }>(
        "SELECT id, customer_id FROM search_conversations WHERE customer_id = $1 AND status = 'active'",
        [customerId],
      )
    ).rows;
    assert.equal(conversations.length, 1);
    assert.equal(conversations[0].id, conversationId);
  } finally {
    await app.close();
    await withTransaction(async (client) => {
      await client.query("DELETE FROM contextual_turns WHERE customer_id = $1", [customerId]);
      await client.query("DELETE FROM contextual_memories WHERE customer_id = $1", [customerId]);
      await client.query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 = ANY($1)", [[degradedPhone, canonicalPhone]]);
      await client.query("DELETE FROM channel_inbound_messages WHERE phone_e164 = ANY($1)", [[degradedPhone, canonicalPhone]]);
      await client.query("DELETE FROM search_conversations WHERE customer_id = $1", [customerId]);
      await client.query("DELETE FROM customers WHERE id = $1", [customerId]);
      await client.query("DELETE FROM services WHERE id = $1", [serviceId]);
      await client.query("DELETE FROM service_categories WHERE id = $1", [categoryId]);
    });
  }
});
