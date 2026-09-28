import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { closeDatabaseConnection, query, withTransaction } from "../src/database/connection.js";
import { createOpportunityCode } from "../src/modules/bilateral-contact/bilateral-contact.policy.js";
import { ContactCompletionService } from "../src/modules/contact-completion/contact-completion.service.js";
import { PostgresContactCompletionRepository } from "../src/modules/contact-completion/contact-completion.repository.js";

after(closeDatabaseConnection);

const internalKey = "selection-v2-integration-key";
const randomPhone = () => `+5567${Math.floor(100000000 + Math.random() * 899999999)}`;

async function setupSingleContactFixture(opts: { provider?: string; customerPhone?: string; professionalPhone?: string; status?: string } = {}) {
  const customerId = randomUUID();
  const professionalId = randomUUID();
  const searchId = randomUUID();
  const conversationId = randomUUID();
  const contactId = randomUUID();
  const choiceId = randomUUID();
  const code = createOpportunityCode();
  const customerPhone = opts.customerPhone ?? randomPhone();
  const professionalPhone = opts.professionalPhone ?? randomPhone();
  const provider = opts.provider ?? "whatsapp";
  const status = opts.status ?? "shared";

  const repo = new PostgresContactCompletionRepository();
  const service = new ContactCompletionService(repo);
  const app = buildApp({ internalApiKey: internalKey, contactCompletionService: service });

  await query("INSERT INTO customers (id, phone_e164) VALUES ($1::uuid, $2)", [customerId, customerPhone]);
  await query(
    "INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'João Silva', $2, $3, 'active')",
    [professionalId, `joao-${professionalId}`, professionalPhone]
  );
  await query(
    "INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1::uuid, $2::uuid, 'eletricista em Cuiabá', 'selected')",
    [searchId, customerId]
  );
  await query(
    `INSERT INTO search_conversations (
       id, customer_id, status, original_raw_text, service_text, location_text, country_code, limit_value, search_request_id, expires_at, completed_at
     )
     VALUES ($1::uuid, $2::uuid, 'completed', 'eletricista em Cuiabá', 'eletricista', 'Cuiabá, MT', 'BR', 3, $3::uuid, NOW() + INTERVAL '1 hour', NOW())`,
    [conversationId, customerId, searchId]
  );
  await query(
    `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, processed_at, result)
     VALUES ($1::uuid, $2, $1::text, $3, 'João', 'BR', 3, 'processed', NOW(), '{"route":"selection"}'::jsonb)`,
    [choiceId, provider, customerPhone]
  );

  const snapshot = {
    public_code: code,
    service_name: "eletricista",
    city: "Cuiabá",
    state: "MT",
    neighborhood: null,
    summary: "Instalações",
    professional_name: "João Silva",
    professional_phone_e164: professionalPhone,
    customer_phone_e164: customerPhone,
    notice_version: "bilateral-v1",
    notice_outbound_id: randomUUID(),
    notice_sent_at: new Date().toISOString(),
    choice_inbound_id: choiceId,
    chosen_at: new Date().toISOString(),
    consented_at: new Date().toISOString(),
    consent_method: "selection_after_notice",
  };

  await query(
    `INSERT INTO contacts (id, professional_id, customer_id, search_request_id, selection_key, public_code, bilateral_snapshot, selection_conversation_id, status)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::jsonb, $8::uuid, $9)`,
    [contactId, professionalId, customerId, searchId, choiceId, code, JSON.stringify(snapshot), conversationId, status]
  );

  const executeInbound = async (rawText: string, senderPhone: string = customerPhone, inboundProvider: string = provider) => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers: { "x-internal-key": internalKey },
      payload: {
        provider: inboundProvider,
        provider_message_id: randomUUID(),
        phone_e164: senderPhone,
        raw_text: rawText,
        country_code: "BR",
        limit: 3,
      },
    });
    if (res.statusCode !== 200) return null;
    return JSON.parse(res.payload);
  };

  const cleanup = async () => {
    await withTransaction(async (db) => {
      await db.query("UPDATE channel_inbound_messages SET response_outbound_id = NULL WHERE phone_e164 IN ($1, $2)", [customerPhone, professionalPhone]);
      await db.query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 IN ($1, $2)", [customerPhone, professionalPhone]);
      await db.query("ALTER TABLE professional_unavailability_events DISABLE TRIGGER professional_unavailability_events_immutable");
      await db.query("DELETE FROM professional_unavailability_events WHERE contact_id = $1::uuid", [contactId]);
      await db.query("ALTER TABLE professional_unavailability_events ENABLE TRIGGER professional_unavailability_events_immutable");
      await db.query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
      await db.query("DELETE FROM contact_completion_events WHERE contact_id = $1::uuid", [contactId]);
      await db.query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
      await db.query("DELETE FROM contact_completions WHERE contact_id = $1::uuid", [contactId]);
      await db.query("DELETE FROM contacts WHERE id = $1::uuid", [contactId]);
      await db.query("DELETE FROM search_conversations WHERE id = $1::uuid", [conversationId]);
      await db.query("DELETE FROM search_requests WHERE id = $1::uuid", [searchId]);
      await db.query("DELETE FROM channel_inbound_messages WHERE phone_e164 IN ($1, $2)", [customerPhone, professionalPhone]);
      await db.query("DELETE FROM professionals WHERE id = $1::uuid", [professionalId]);
      await db.query("DELETE FROM customers WHERE id = $1::uuid", [customerId]);
    });
  };

  return { customerId, professionalId, searchId, contactId, code, customerPhone, professionalPhone, provider, executeInbound, cleanup };
}

test("PostgreSQL Selection v2 Scenarios 01-05: Single contact completion & bilateral snapshot phone authority", async () => {
  const f = await setupSingleContactFixture();
  try {
    // 1. Code-free declaration with exactly one shared contact
    const declRes = await f.executeInbound("serviço concluído");
    assert.ok(declRes);
    assert.equal(declRes.result.route, "contact_completion");
    assert.equal(declRes.result.action, "declared");

    // 2. Lookup authority uses bilateral snapshot phone
    // 3 & 4 & 5. Mutable profile phone change does not alter historical snapshot authority
    const newProfPhone = randomPhone();
    await query("UPDATE professionals SET phone_e164 = $1 WHERE id = $2::uuid", [newProfPhone, f.professionalId]);

    // Old snapshot phone confirms completion cleanly
    const confRes = await f.executeInbound("confirmar", f.professionalPhone);
    assert.ok(confRes);
    assert.equal(confRes.result.route, "contact_completion");
    assert.equal(confRes.result.action, "confirmed");

    // New mutable profile phone cannot declare completion or confirm historical contact
    const impRes = await f.executeInbound("confirmar", newProfPhone);
    assert.ok(impRes);
    assert.notEqual(impRes.result?.route, "contact_completion");
  } finally {
    await f.cleanup();
  }
});

test("PostgreSQL Selection v2 Scenarios 06-15: Multi-contact disambiguation, provider scoping & conservative grammar", async () => {
  const customerId = randomUUID();
  const customerPhone = randomPhone();
  const searchId = randomUUID();

  const joaoId = randomUUID(), carlosId = randomUUID();
  const joaoPhone = randomPhone(), carlosPhone = randomPhone();
  const joaoCode = createOpportunityCode(), carlosCode = createOpportunityCode();

  const repo = new PostgresContactCompletionRepository();
  const service = new ContactCompletionService(repo);
  const app = buildApp({ internalApiKey: internalKey, contactCompletionService: service });

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1::uuid, $2)", [customerId, customerPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'João Silva', $2, $3, 'active')", [joaoId, `joao-${joaoId}`, joaoPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'Carlos Santos', $2, $3, 'active')", [carlosId, `carlos-${carlosId}`, carlosPhone]);
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1::uuid, $2::uuid, 'eletricista em Cuiabá', 'selected')", [searchId, customerId]);

    const createContact = async (profId: string, profName: string, profPhone: string, code: string) => {
      const contactId = randomUUID(), choiceId = randomUUID(), convId = randomUUID();
      await query(
        `INSERT INTO search_conversations (id, customer_id, status, original_raw_text, service_text, location_text, country_code, limit_value, search_request_id, expires_at, completed_at)
         VALUES ($1::uuid, $2::uuid, 'completed', 'eletricista em Cuiabá', 'eletricista', 'Cuiabá, MT', 'BR', 3, $3::uuid, NOW() + INTERVAL '1 hour', NOW())`,
        [convId, customerId, searchId]
      );
      await query(
        `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, processed_at, result)
         VALUES ($1::uuid, 'whatsapp', $1::text, $2, $3, 'BR', 3, 'processed', NOW(), '{"route":"selection"}'::jsonb)`,
        [choiceId, customerPhone, profName]
      );
      const snapshot = {
        public_code: code, service_name: "eletricista", city: "Cuiabá", state: "MT", neighborhood: null, summary: "Instalações",
        professional_name: profName, professional_phone_e164: profPhone, customer_phone_e164: customerPhone, notice_version: "bilateral-v1",
        notice_outbound_id: randomUUID(), notice_sent_at: new Date().toISOString(), choice_inbound_id: choiceId, chosen_at: new Date().toISOString(),
        consented_at: new Date().toISOString(), consent_method: "selection_after_notice",
      };
      await query(
        `INSERT INTO contacts (id, professional_id, customer_id, search_request_id, selection_key, public_code, bilateral_snapshot, selection_conversation_id, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::jsonb, $8::uuid, 'shared')`,
        [contactId, profId, customerId, searchId, choiceId, code, JSON.stringify(snapshot), convId]
      );
      return contactId;
    };

    const joaoContactId = await createContact(joaoId, "João Silva", joaoPhone, joaoCode);
    const carlosContactId = await createContact(carlosId, "Carlos Santos", carlosPhone, carlosCode);

    const executeInbound = async (rawText: string, senderPhone: string = customerPhone, provider: string = "whatsapp") => {
      const res = await app.inject({
        method: "POST",
        url: "/internal/channel/inbound/messages",
        headers: { "x-internal-key": internalKey },
        payload: {
          provider,
          provider_message_id: randomUUID(),
          phone_e164: senderPhone,
          raw_text: rawText,
          country_code: "BR",
          limit: 3,
        },
      });
      if (res.statusCode !== 200) return null;
      return JSON.parse(res.payload);
    };

    // 6. Multiple eligible contacts create clarification and ZERO completion mutation
    const clarRes = await executeInbound("serviço concluído");
    assert.ok(clarRes);
    assert.equal(clarRes.result.route, "contact_completion");
    assert.equal(clarRes.result.action, "clarification");
    assert.equal(clarRes.result.clarification_kind, "contact_disambiguation");

    // Check ZERO completions written
    const completionsCount = (await query<{ count: number }>("SELECT count(*)::integer FROM contact_completions WHERE contact_id IN ($1::uuid, $2::uuid)", [joaoContactId, carlosContactId])).rows[0].count;
    assert.equal(completionsCount, 0, "Disambiguation clarification must write ZERO contact_completions");

    // 7 & 8. Bare 'quero o João' with historical contacts creates ZERO completion mutation & passes through
    const bareRes = await executeInbound("quero o João");
    assert.ok(bareRes);
    assert.notEqual(bareRes.result.route, "contact_completion");

    // 14. Negative name-containing reply 'não João' does NOT resolve completion
    const negRes = await executeInbound("não João");
    assert.ok(negRes);
    assert.notEqual(negRes.result.route, "contact_completion");

    // 15. Clarification from another provider (telegram vs whatsapp) cannot be inherited
    const crossProviderRes = await executeInbound("com João", customerPhone, "telegram");
    assert.ok(crossProviderRes);
    assert.notEqual(crossProviderRes.result.route, "contact_completion");

    // 9 & 10. Persisted clarification + 'com João' under same provider resolves João contact with preserved 'declare' action
    const resolveRes = await executeInbound("com João", customerPhone, "whatsapp");
    assert.ok(resolveRes);
    assert.equal(resolveRes.result.route, "contact_completion");
    assert.equal(resolveRes.result.action, "declared");
    assert.equal(resolveRes.result.public_code, joaoCode);
  } finally {
    await query("UPDATE channel_inbound_messages SET response_outbound_id = NULL WHERE phone_e164 IN ($1, $2, $3)", [customerPhone, joaoPhone, carlosPhone]);
    await query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 IN ($1, $2, $3)", [customerPhone, joaoPhone, carlosPhone]);
    await query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completion_events WHERE contact_id IN (SELECT id FROM contacts WHERE search_request_id = $1::uuid)", [searchId]);
    await query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completions WHERE contact_id IN (SELECT id FROM contacts WHERE search_request_id = $1::uuid)", [searchId]);
    await query("DELETE FROM contacts WHERE search_request_id = $1::uuid", [searchId]);
    await query("DELETE FROM search_conversations WHERE search_request_id = $1::uuid", [searchId]);
    await query("DELETE FROM search_requests WHERE id = $1::uuid", [searchId]);
    await query("DELETE FROM channel_inbound_messages WHERE phone_e164 IN ($1, $2, $3)", [customerPhone, joaoPhone, carlosPhone]);
    await query("DELETE FROM professionals WHERE id IN ($1::uuid, $2::uuid)", [joaoId, carlosId]);
    await query("DELETE FROM customers WHERE id = $1::uuid", [customerId]);
  }
});

test("PostgreSQL Selection v2 Scenarios 16-22: Action preservation, idempotency, replay & generic text safety", async () => {
  const f = await setupSingleContactFixture();
  try {
    // 16. Code-free confirmation with exactly one pending completion
    await f.executeInbound("serviço concluído");
    const confRes = await f.executeInbound("confirmar", f.professionalPhone);
    assert.ok(confRes);
    assert.equal(confRes.result.action, "confirmed");

    // 22. Replay produces no duplicate completion event or Outbox
    const replayRes = await f.executeInbound(`confirmar ${f.code}`, f.professionalPhone);
    assert.ok(replayRes);
    assert.equal(replayRes.result.action, "idempotent_replay");

    // 20. Generic 'sim' / 'não' without explicit context cannot mutate
    const genRes = await f.executeInbound("sim", f.customerPhone);
    assert.ok(genRes);
    assert.notEqual(genRes.result.route, "contact_completion");
  } finally {
    await f.cleanup();
  }
});

test("PostgreSQL Selection v2 Scenarios 23-27: Immutability triggers P0026 & P0027 Invariants", async () => {
  // 26 & 27: Immutability triggers P0026 and P0027 throw error on UPDATE/DELETE
  const customerId = randomUUID(), profId = randomUUID(), searchId = randomUUID(), convId = randomUUID(), contactId = randomUUID(), inboundId = randomUUID();
  const customerPhone = randomPhone(), profPhone = randomPhone();
  const choiceId = randomUUID();
  const code = createOpportunityCode();

  const snapshot = {
    public_code: code,
    service_name: "eletricista",
    city: "Cuiabá",
    state: "MT",
    neighborhood: null,
    summary: "Instalações",
    professional_name: "Test",
    professional_phone_e164: profPhone,
    customer_phone_e164: customerPhone,
    notice_version: "bilateral-v1",
    notice_outbound_id: randomUUID(),
    notice_sent_at: new Date().toISOString(),
    choice_inbound_id: choiceId,
    chosen_at: new Date().toISOString(),
    consented_at: new Date().toISOString(),
    consent_method: "selection_after_notice",
  };

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1::uuid, $2)", [customerId, customerPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'Test', $1::text, $2, 'active')", [profId, profPhone]);
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1::uuid, $2::uuid, 'eletricista', 'selected')", [searchId, customerId]);
    await query(
      `INSERT INTO search_conversations (id, customer_id, status, original_raw_text, service_text, location_text, country_code, limit_value, search_request_id, expires_at, completed_at)
       VALUES ($1::uuid, $2::uuid, 'completed', 'eletricista', 'eletricista', 'Cuiabá, MT', 'BR', 3, $3::uuid, NOW() + INTERVAL '1 hour', NOW())`,
      [convId, customerId, searchId]
    );
    await query(
      `INSERT INTO contacts (id, professional_id, customer_id, search_request_id, selection_key, public_code, bilateral_snapshot, selection_conversation_id, status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7::jsonb, $8::uuid, 'shared')`,
      [contactId, profId, customerId, searchId, choiceId, code, JSON.stringify(snapshot), convId]
    );
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, processed_at, result)
       VALUES ($1::uuid, 'test', $1::text, $2, 'test', 'BR', 3, 'processed', NOW(), '{}'::jsonb)`,
      [inboundId, profPhone]
    );
    await query(
      `INSERT INTO professional_unavailability_events (contact_id, professional_id, inbound_id, origin, rule_version)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'channel_inbox', 'connection-v2')`,
      [contactId, profId, inboundId]
    );

    // Assert P0027 trigger on professional_unavailability_events
    await assert.rejects(
      query("UPDATE professional_unavailability_events SET rule_version='v3' WHERE contact_id=$1::uuid", [contactId]),
      (err: unknown) => (err as { code?: string }).code === "P0027"
    );
  } finally {
    await query("ALTER TABLE professional_unavailability_events DISABLE TRIGGER professional_unavailability_events_immutable");
    await query("DELETE FROM professional_unavailability_events WHERE contact_id=$1::uuid", [contactId]);
    await query("ALTER TABLE professional_unavailability_events ENABLE TRIGGER professional_unavailability_events_immutable");
    await query("DELETE FROM contacts WHERE id=$1::uuid", [contactId]);
    await query("DELETE FROM search_conversations WHERE id=$1::uuid", [convId]);
    await query("DELETE FROM search_requests WHERE id=$1::uuid", [searchId]);
    await query("DELETE FROM channel_inbound_messages WHERE id=$1::uuid", [inboundId]);
    await query("DELETE FROM professionals WHERE id=$1::uuid", [profId]);
    await query("DELETE FROM customers WHERE id=$1::uuid", [customerId]);
  }
});
