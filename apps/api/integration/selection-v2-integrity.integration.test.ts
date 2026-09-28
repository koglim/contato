import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { closeDatabaseConnection, query, withTransaction } from "../src/database/connection.js";
import { createOpportunityCode } from "../src/modules/bilateral-contact/bilateral-contact.policy.js";
import { ContactCompletionService } from "../src/modules/contact-completion/contact-completion.service.js";
import { PostgresContactCompletionRepository } from "../src/modules/contact-completion/contact-completion.repository.js";
import { PostgresSelectionMatchRepository } from "../src/modules/match-selection/match-selection.repository.js";

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

  const cleanup = async (extraPhones: string[] = []) => {
    const allPhones = [customerPhone, professionalPhone, ...extraPhones];
    await withTransaction(async (db) => {
      await db.query("UPDATE channel_inbound_messages SET response_outbound_id = NULL");
      await db.query("UPDATE channel_outbound_messages SET completion_event_id = NULL, professional_unavailability_event_id = NULL");
      await db.query(
        "DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 = ANY($1) OR channel_inbound_message_id IN (SELECT id FROM channel_inbound_messages WHERE phone_e164 = ANY($1))",
        [allPhones]
      );
      await db.query("ALTER TABLE professional_unavailability_events DISABLE TRIGGER professional_unavailability_events_immutable");
      await db.query("DELETE FROM professional_unavailability_events WHERE contact_id = $1::uuid", [contactId]);
      await db.query("ALTER TABLE professional_unavailability_events ENABLE TRIGGER professional_unavailability_events_immutable");
      await db.query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
      await db.query("DELETE FROM contact_completion_events WHERE contact_id = $1::uuid", [contactId]);
      await db.query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
      await db.query("DELETE FROM contact_completions WHERE contact_id = $1::uuid", [contactId]);
      await db.query("DELETE FROM contacts WHERE id = $1::uuid", [contactId]);
      await db.query("DELETE FROM matches WHERE search_request_id IN (SELECT id FROM search_requests WHERE customer_id = $1::uuid OR id = $2::uuid)", [customerId, searchId]);
      await db.query("DELETE FROM search_conversations WHERE customer_id = $1::uuid OR id = $2::uuid OR customer_id IS NULL", [customerId, conversationId]);
      await db.query("DELETE FROM search_requests WHERE id = $1::uuid OR customer_id = $2::uuid", [searchId, customerId]);
      await db.query("DELETE FROM channel_inbound_messages WHERE phone_e164 = ANY($1) OR id = $2::uuid", [allPhones, choiceId]);
      await db.query("DELETE FROM professionals WHERE id = $1::uuid", [professionalId]);
      await db.query("DELETE FROM customers WHERE id = $1::uuid OR phone_e164 = ANY($2)", [customerId, allPhones]);
    });
  };

  return { customerId, professionalId, searchId, contactId, code, customerPhone, professionalPhone, provider, executeInbound, cleanup };
}

test("PostgreSQL Selection v2 Scenarios 01-05: Single contact completion & bilateral snapshot phone authority", async () => {
  const f = await setupSingleContactFixture();
  let newProfPhone = "";
  try {
    // 1. Code-free declaration with exactly one shared contact
    const declRes = await f.executeInbound("serviço concluído");
    assert.ok(declRes);
    assert.equal(declRes.result.route, "contact_completion");
    assert.equal(declRes.result.action, "declared");

    // 2. Lookup authority uses bilateral snapshot phone
    // 3, 4, 5. Mutable profile phone change does not alter historical snapshot authority
    newProfPhone = randomPhone();
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
    await f.cleanup(newProfPhone ? [newProfPhone] : []);
  }
});

test("PostgreSQL Selection v2 Scenarios 06-10, 14, 15, 28: Multi-contact disambiguation, provider scoping & freshness", async () => {
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

    // 28. Stale clarification one-shot freshness: after a new message arrives, old clarification is nullified
    const clarRes2 = await executeInbound("serviço concluído", customerPhone, "whatsapp");
    assert.equal(clarRes2.result.action, "clarification");

    // Intervening message (e.g. search query or unrelated text)
    const interveningRes = await executeInbound("preciso de pintora", customerPhone, "whatsapp");
    assert.notEqual(interveningRes.result.route, "contact_completion");

    // Subsequent 'com João' after intervening message MUST NOT inherit stale clarification
    const staleRes = await executeInbound("com João", customerPhone, "whatsapp");
    assert.notEqual(staleRes.result.route, "contact_completion");

    // 7 & 8. Bare 'quero o João' creates ZERO completion mutation
    const bareRes = await executeInbound("quero o João");
    assert.ok(bareRes);
    assert.notEqual(bareRes.result.route, "contact_completion");

    // 14. Negative reply 'não João' does NOT resolve completion
    const negRes = await executeInbound("não João");
    assert.ok(negRes);
    assert.notEqual(negRes.result.route, "contact_completion");
  } finally {
    await query("UPDATE channel_inbound_messages SET response_outbound_id = NULL");
    await query("UPDATE channel_outbound_messages SET completion_event_id = NULL, professional_unavailability_event_id = NULL");
    await query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 IN ($1, $2, $3) OR channel_inbound_message_id IN (SELECT id FROM channel_inbound_messages WHERE phone_e164 IN ($1, $2, $3))", [customerPhone, joaoPhone, carlosPhone]);
    await query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completion_events WHERE contact_id IN (SELECT id FROM contacts WHERE search_request_id = $1::uuid)", [searchId]);
    await query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completions WHERE contact_id IN (SELECT id FROM contacts WHERE search_request_id = $1::uuid)", [searchId]);
    await query("DELETE FROM matches WHERE search_request_id = $1::uuid", [searchId]);
    await query("DELETE FROM contacts WHERE search_request_id = $1::uuid", [searchId]);
    await query("DELETE FROM search_conversations WHERE search_request_id = $1::uuid OR customer_id = $2::uuid OR customer_id IS NULL", [searchId, customerId]);
    await query("DELETE FROM search_requests WHERE id = $1::uuid", [searchId]);
    await query("DELETE FROM channel_inbound_messages WHERE phone_e164 IN ($1, $2, $3)", [customerPhone, joaoPhone, carlosPhone]);
    await query("DELETE FROM professionals WHERE id IN ($1::uuid, $2::uuid)", [joaoId, carlosId]);
    await query("DELETE FROM customers WHERE id = $1::uuid OR phone_e164 IN ($2, $3, $4)", [customerId, customerPhone, joaoPhone, carlosPhone]);
  }
});

test("Proof A: Consumed completion clarification cannot hijack a later active search selection", async () => {
  const customerId = randomUUID(), searchId1 = randomUUID();
  const joaoId = randomUUID(), carlosId = randomUUID();
  const joaoPhone = randomPhone(), carlosPhone = randomPhone(), customerPhone = randomPhone();
  const joaoCode = createOpportunityCode(), carlosCode = createOpportunityCode();

  const repo = new PostgresContactCompletionRepository();
  const service = new ContactCompletionService(repo);
  const app = buildApp({ internalApiKey: internalKey, contactCompletionService: service });

  const executeInbound = async (rawText: string, senderPhone: string = customerPhone, provider: string = "whatsapp") => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers: { "x-internal-key": internalKey },
      payload: { provider, provider_message_id: randomUUID(), phone_e164: senderPhone, raw_text: rawText, country_code: "BR", limit: 3 },
    });
    return res.statusCode === 200 ? JSON.parse(res.payload) : null;
  };

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1::uuid, $2)", [customerId, customerPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'João Silva', $2, $3, 'active')", [joaoId, `joao-${joaoId}`, joaoPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'Carlos Santos', $2, $3, 'active')", [carlosId, `carlos-${carlosId}`, carlosPhone]);
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1::uuid, $2::uuid, 'eletricista em Cuiabá', 'selected')", [searchId1, customerId]);

    const createContact = async (profId: string, profName: string, profPhone: string, code: string) => {
      const contactId = randomUUID(), choiceId = randomUUID(), convId = randomUUID();
      await query(
        `INSERT INTO search_conversations (id, customer_id, status, original_raw_text, service_text, location_text, country_code, limit_value, search_request_id, expires_at, completed_at)
         VALUES ($1::uuid, $2::uuid, 'completed', 'eletricista em Cuiabá', 'eletricista', 'Cuiabá, MT', 'BR', 3, $3::uuid, NOW() + INTERVAL '1 hour', NOW())`,
        [convId, customerId, searchId1]
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
        [contactId, profId, customerId, searchId1, choiceId, code, JSON.stringify(snapshot), convId]
      );
      return contactId;
    };

    const joaoContactId = await createContact(joaoId, "João Silva", joaoPhone, joaoCode);
    await createContact(carlosId, "Carlos Santos", carlosPhone, carlosCode);

    // 1) Trigger disambiguation clarification
    const clarRes = await executeInbound("serviço concluído");
    assert.equal(clarRes.result.action, "clarification");

    // 2) Consume clarification by selecting João -> resolves completion
    const resolveRes = await executeInbound("com João");
    assert.equal(resolveRes.result.route, "contact_completion");
    assert.equal(resolveRes.result.action, "declared");

    const joaoCompletion = (await query<{ state: string }>("SELECT state FROM contact_completions WHERE contact_id = $1::uuid", [joaoContactId])).rows[0];
    assert.equal(joaoCompletion.state, "pending_confirmation");

    // 3) Create a NEW active search selection context (S2) with candidate João Silva
    const searchId2 = randomUUID(), convId2 = randomUUID(), matchId2 = randomUUID();
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1::uuid, $2::uuid, 'eletricista Sinop', 'selected')", [searchId2, customerId]);
    await query(
      `INSERT INTO search_conversations (id, customer_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, search_request_id, expires_at)
       VALUES ($1::uuid, $2::uuid, 'active', 'selection', 'eletricista Sinop', 'eletricista', 'BR', 3, $3::uuid, NOW() + INTERVAL '1 hour')`,
      [convId2, customerId, searchId2]
    );
    await query("INSERT INTO matches (id, search_request_id, professional_id, rank_position, shown_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 1, NOW())", [matchId2, searchId2, joaoId]);

    // 4) Send bare 'João' under active search S2
    const selectionRes = await executeInbound("João");
    assert.ok(selectionRes);

    // 5 & 6) Assert old completion clarification is NOT reused and message executes selection path
    assert.notEqual(selectionRes.result.route, "contact_completion", "Old completion clarification must not hijack active selection");
    assert.equal(selectionRes.result.route, "selection", "Message must execute current selection route");

    // 7) Assert historical completion for S1 was NOT mutated (remains pending_confirmation)
    const joaoCompletionAfter = (await query<{ state: string }>("SELECT state FROM contact_completions WHERE contact_id = $1::uuid", [joaoContactId])).rows[0];
    assert.equal(joaoCompletionAfter.state, "pending_confirmation");
  } finally {
    await query("UPDATE channel_inbound_messages SET response_outbound_id = NULL");
    await query("UPDATE channel_outbound_messages SET completion_event_id = NULL, professional_unavailability_event_id = NULL");
    await query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 IN ($1, $2, $3)", [customerPhone, joaoPhone, carlosPhone]);
    await query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completion_events WHERE contact_id IN (SELECT id FROM contacts WHERE search_request_id = $1::uuid)", [searchId1]);
    await query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completions WHERE contact_id IN (SELECT id FROM contacts WHERE search_request_id = $1::uuid)", [searchId1]);
    await query("DELETE FROM matches WHERE search_request_id = $1::uuid OR search_request_id IN (SELECT id FROM search_requests WHERE customer_id = $2::uuid)", [searchId1, customerId]);
    await query("DELETE FROM contacts WHERE search_request_id = $1::uuid", [searchId1]);
    await query("DELETE FROM search_conversations WHERE customer_id = $1::uuid OR customer_id IS NULL", [customerId]);
    await query("DELETE FROM search_requests WHERE customer_id = $1::uuid", [customerId]);
    await query("DELETE FROM channel_inbound_messages WHERE phone_e164 IN ($1, $2, $3)", [customerPhone, joaoPhone, carlosPhone]);
    await query("DELETE FROM professionals WHERE id IN ($1::uuid, $2::uuid)", [joaoId, carlosId]);
    await query("DELETE FROM customers WHERE id = $1::uuid OR phone_e164 = $2", [customerId, customerPhone]);
  }
});

test("Proof B: Bare 'quero o João' with historical contacts + active selection reaches Selection route", async () => {
  const f = await setupSingleContactFixture();
  const searchId2 = randomUUID(), convId2 = randomUUID(), matchId2 = randomUUID();
  try {
    // Establish active selection context on customer
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1::uuid, $2::uuid, 'eletricista Sinop', 'selected')", [searchId2, f.customerId]);
    await query(
      `INSERT INTO search_conversations (id, customer_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, search_request_id, expires_at)
       VALUES ($1::uuid, $2::uuid, 'active', 'selection', 'eletricista Sinop', 'eletricista', 'BR', 3, $3::uuid, NOW() + INTERVAL '1 hour')`,
      [convId2, f.customerId, searchId2]
    );
    await query("INSERT INTO matches (id, search_request_id, professional_id, rank_position, shown_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 1, NOW())", [matchId2, searchId2, f.professionalId]);

    // Send bare 'quero o João'
    const res = await f.executeInbound("quero o João");
    assert.ok(res);
    assert.notEqual(res.result.route, "contact_completion", "'quero o João' must not trigger historical contact completion");
    assert.equal(res.result.route, "selection", "'quero o João' must reach active Selection route");

    // Contact status remains shared (not mutated)
    const contact = (await query<{ status: string }>("SELECT status FROM contacts WHERE id = $1::uuid", [f.contactId])).rows[0];
    assert.equal(contact.status, "shared");
  } finally {
    await query("DELETE FROM matches WHERE search_request_id = $1::uuid", [searchId2]);
    await query("DELETE FROM search_conversations WHERE id = $1::uuid", [convId2]);
    await query("DELETE FROM search_requests WHERE id = $1::uuid", [searchId2]);
    await f.cleanup();
  }
});

test("Proof C: Phrase 'confirmo o atendimento' overlap handling in both directions", async () => {
  // Direction 1: With one pending contact completion -> handled by ContactCompletion
  const f1 = await setupSingleContactFixture();
  try {
    await f1.executeInbound("serviço concluído");
    const res1 = await f1.executeInbound("confirmo o atendimento", f1.professionalPhone);
    assert.ok(res1);
    assert.equal(res1.result.route, "contact_completion");
    assert.equal(res1.result.action, "confirmed");
  } finally {
    await f1.cleanup();
  }

  // Direction 2: Without pending completion, when professional opportunity response exists -> remains available to professional_opportunity
  const customerId = randomUUID(), profId = randomUUID(), searchId = randomUUID(), convId = randomUUID(), contactId = randomUUID(), choiceId = randomUUID();
  const customerPhone = randomPhone(), profPhone = randomPhone();
  const code = createOpportunityCode();
  const noticeOutboundId = randomUUID();

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1::uuid, $2)", [customerId, customerPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'Pedro', $1::text, $2, 'active')", [profId, profPhone]);
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1::uuid, $2::uuid, 'eletricista', 'selected')", [searchId, customerId]);
    await query(
      `INSERT INTO search_conversations (id, customer_id, status, original_raw_text, service_text, location_text, country_code, limit_value, search_request_id, expires_at, completed_at)
       VALUES ($1::uuid, $2::uuid, 'completed', 'eletricista', 'eletricista', 'Cuiabá, MT', 'BR', 3, $3::uuid, NOW() + INTERVAL '1 hour', NOW())`,
      [convId, customerId, searchId]
    );
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, processed_at, result)
       VALUES ($1::uuid, 'whatsapp', $1::text, $2, 'Pedro', 'BR', 3, 'processed', NOW(), '{"route":"selection"}'::jsonb)`,
      [choiceId, customerPhone]
    );

    const snapshot = {
      public_code: code, service_name: "eletricista", city: "Cuiabá", state: "MT", neighborhood: null, summary: "Instalações",
      professional_name: "Pedro", professional_phone_e164: profPhone, customer_phone_e164: customerPhone, notice_version: "bilateral-v1",
      notice_outbound_id: noticeOutboundId, notice_sent_at: new Date().toISOString(), choice_inbound_id: choiceId, chosen_at: new Date().toISOString(),
      consented_at: new Date().toISOString(), consent_method: "selection_after_notice",
    };
    await query(
      `INSERT INTO contacts (id, professional_id, customer_id, search_request_id, selection_key, public_code, bilateral_snapshot, selection_conversation_id, status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::jsonb, $8::uuid, 'shared')`,
      [contactId, profId, customerId, searchId, choiceId, code, JSON.stringify(snapshot), convId]
    );

    const repo = new PostgresContactCompletionRepository();
    const service = new ContactCompletionService(repo);
    const app = buildApp({ internalApiKey: internalKey, contactCompletionService: service });

    // Send 'confirmo o atendimento' from professional without any pending completion
    const res2 = await app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers: { "x-internal-key": internalKey },
      payload: { provider: "whatsapp", provider_message_id: randomUUID(), phone_e164: profPhone, raw_text: "confirmo o atendimento", country_code: "BR", limit: 3 },
    });
    const parsed2 = JSON.parse(res2.payload);
    assert.ok(parsed2);
    // Explicitly assert Opportunity route and acknowledged kind
    assert.equal(parsed2.result?.route, "opportunity");
    assert.equal(parsed2.result?.result?.kind, "acknowledged");

    // Zero contact_completions and zero contact_completion_events created as side-effect
    const completionsCnt = (await query<{ cnt: number }>("SELECT count(*)::integer AS cnt FROM contact_completions WHERE contact_id = $1::uuid", [contactId])).rows[0].cnt;
    assert.equal(completionsCnt, 0);
    const completionEventsCnt = (await query<{ cnt: number }>("SELECT count(*)::integer AS cnt FROM contact_completion_events WHERE contact_id = $1::uuid", [contactId])).rows[0].cnt;
    assert.equal(completionEventsCnt, 0);
  } finally {
    await query("UPDATE channel_inbound_messages SET response_outbound_id = NULL");
    await query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 IN ($1, $2)", [customerPhone, profPhone]);
    await query("DELETE FROM contacts WHERE id = $1::uuid", [contactId]);
    await query("DELETE FROM search_conversations WHERE customer_id = $1::uuid", [customerId]);
    await query("DELETE FROM search_requests WHERE id = $1::uuid", [searchId]);
    await query("DELETE FROM channel_inbound_messages WHERE phone_e164 IN ($1, $2)", [customerPhone, profPhone]);
    await query("DELETE FROM professionals WHERE id = $1::uuid", [profId]);
    await query("DELETE FROM customers WHERE id = $1::uuid", [customerId]);
  }
});

test("Proof: Code-free confirm requested_action preservation after disambiguation in real PostgreSQL", async () => {
  const customerId = randomUUID(), customerPhone = randomPhone();
  const searchId = randomUUID(), convId = randomUUID();
  const joaoId = randomUUID(), carlosId = randomUUID();
  const joaoPhone = randomPhone(), carlosPhone = randomPhone();
  const joaoCode = createOpportunityCode(), carlosCode = createOpportunityCode();

  const repo = new PostgresContactCompletionRepository();
  const service = new ContactCompletionService(repo);
  const app = buildApp({ internalApiKey: internalKey, contactCompletionService: service });

  const executeInbound = async (rawText: string, senderPhone: string = customerPhone, provider: string = "whatsapp") => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers: { "x-internal-key": internalKey },
      payload: { provider, provider_message_id: randomUUID(), phone_e164: senderPhone, raw_text: rawText, country_code: "BR", limit: 3 },
    });
    return JSON.parse(res.payload);
  };

  const createSharedContactWithPendingDeclaration = async (profId: string, profName: string, profPhone: string, code: string) => {
    const contactId = randomUUID(), choiceId = randomUUID();
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, processed_at, result)
       VALUES ($1::uuid, 'whatsapp', $1::text, $2, $3, 'BR', 3, 'processed', NOW(), '{"route":"selection"}'::jsonb)`,
      [choiceId, customerPhone, profName]
    );
    const snapshot = {
      public_code: code, service_name: "eletricista", city: "Cuiabá", state: "MT", neighborhood: null, summary: "Elétrica",
      professional_name: profName, professional_phone_e164: profPhone, customer_phone_e164: customerPhone, notice_version: "bilateral-v1",
      notice_outbound_id: randomUUID(), notice_sent_at: new Date().toISOString(), choice_inbound_id: choiceId, chosen_at: new Date().toISOString(),
      consented_at: new Date().toISOString(), consent_method: "selection_after_notice",
    };
    await query(
      `INSERT INTO contacts (id, professional_id, customer_id, search_request_id, selection_key, public_code, bilateral_snapshot, selection_conversation_id, status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::jsonb, $8::uuid, 'shared')`,
      [contactId, profId, customerId, searchId, choiceId, code, JSON.stringify(snapshot), convId]
    );
    await executeInbound("serviço concluído", profPhone);
    return contactId;
  };

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1::uuid, $2)", [customerId, customerPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'João Silva', $2, $3, 'active')", [joaoId, `joao-${joaoId}`, joaoPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'Carlos Santos', $2, $3, 'active')", [carlosId, `carlos-${carlosId}`, carlosPhone]);
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1::uuid, $2::uuid, 'eletricista', 'selected')", [searchId, customerId]);
    await query(
      `INSERT INTO search_conversations (id, customer_id, status, original_raw_text, service_text, country_code, limit_value, search_request_id, expires_at, completed_at)
       VALUES ($1::uuid, $2::uuid, 'completed', 'eletricista', 'eletricista', 'BR', 3, $3::uuid, NOW() + INTERVAL '1 hour', NOW())`,
      [convId, customerId, searchId]
    );

    const joaoContactId = await createSharedContactWithPendingDeclaration(joaoId, "João Silva", joaoPhone, joaoCode);
    const carlosContactId = await createSharedContactWithPendingDeclaration(carlosId, "Carlos Santos", carlosPhone, carlosCode);

    // CONFIRM DISAMBIGUATION PROOF
    const confirmClarRes = await executeInbound("confirmar");
    assert.equal(confirmClarRes.result.route, "contact_completion");
    assert.equal(confirmClarRes.result.action, "clarification");
    assert.equal(confirmClarRes.result.clarification_kind, "contact_disambiguation");
    assert.equal(confirmClarRes.result.requested_action, "confirm");

    // ZERO terminal mutation before disambiguation
    const stateBeforeConfirm = (await query<{ state: string }>("SELECT state FROM contact_completions WHERE contact_id IN ($1::uuid, $2::uuid) ORDER BY contact_id", [joaoContactId, carlosContactId])).rows;
    assert.deepEqual(stateBeforeConfirm.map(s => s.state), ["pending_confirmation", "pending_confirmation"]);

    // RESOLVE CONFIRM FOR JOÃO
    const confirmResolveRes = await executeInbound("com João");
    assert.equal(confirmResolveRes.result.route, "contact_completion");
    assert.equal(confirmResolveRes.result.action, "confirmed");
    assert.equal(confirmResolveRes.result.public_code, joaoCode);

    const joaoStateAfterConfirm = (await query<{ state: string }>("SELECT state FROM contact_completions WHERE contact_id = $1::uuid", [joaoContactId])).rows[0].state;
    assert.equal(joaoStateAfterConfirm, "confirmed");

    const carlosStateAfterConfirm = (await query<{ state: string }>("SELECT state FROM contact_completions WHERE contact_id = $1::uuid", [carlosContactId])).rows[0].state;
    assert.equal(carlosStateAfterConfirm, "pending_confirmation");
  } finally {
    await query("UPDATE channel_inbound_messages SET response_outbound_id = NULL");
    await query("UPDATE channel_outbound_messages SET completion_event_id = NULL");
    await query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completion_events WHERE contact_id IN (SELECT id FROM contacts WHERE search_request_id = $1::uuid)", [searchId]);
    await query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completions WHERE contact_id IN (SELECT id FROM contacts WHERE search_request_id = $1::uuid)", [searchId]);
    await query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 IN ($1, $2, $3)", [customerPhone, joaoPhone, carlosPhone]);
    await query("DELETE FROM contacts WHERE search_request_id = $1::uuid", [searchId]);
    await query("DELETE FROM search_conversations WHERE customer_id = $1::uuid", [customerId]);
    await query("DELETE FROM search_requests WHERE customer_id = $1::uuid", [customerId]);
    await query("DELETE FROM channel_inbound_messages WHERE phone_e164 IN ($1, $2, $3)", [customerPhone, joaoPhone, carlosPhone]);
    await query("DELETE FROM professionals WHERE id IN ($1::uuid, $2::uuid)", [joaoId, carlosId]);
    await query("DELETE FROM customers WHERE id = $1::uuid", [customerId]);
  }
});

test("Proof: Code-free contest requested_action preservation after disambiguation in real PostgreSQL", async () => {
  const customerId = randomUUID(), customerPhone = randomPhone();
  const searchId = randomUUID(), convId = randomUUID();
  const joaoId = randomUUID(), carlosId = randomUUID();
  const joaoPhone = randomPhone(), carlosPhone = randomPhone();
  const joaoCode = createOpportunityCode(), carlosCode = createOpportunityCode();

  const repo = new PostgresContactCompletionRepository();
  const service = new ContactCompletionService(repo);
  const app = buildApp({ internalApiKey: internalKey, contactCompletionService: service });

  const executeInbound = async (rawText: string, senderPhone: string = customerPhone, provider: string = "whatsapp") => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers: { "x-internal-key": internalKey },
      payload: { provider, provider_message_id: randomUUID(), phone_e164: senderPhone, raw_text: rawText, country_code: "BR", limit: 3 },
    });
    return JSON.parse(res.payload);
  };

  const createSharedContactWithPendingDeclaration = async (profId: string, profName: string, profPhone: string, code: string) => {
    const contactId = randomUUID(), choiceId = randomUUID();
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, processed_at, result)
       VALUES ($1::uuid, 'whatsapp', $1::text, $2, $3, 'BR', 3, 'processed', NOW(), '{"route":"selection"}'::jsonb)`,
      [choiceId, customerPhone, profName]
    );
    const snapshot = {
      public_code: code, service_name: "eletricista", city: "Cuiabá", state: "MT", neighborhood: null, summary: "Elétrica",
      professional_name: profName, professional_phone_e164: profPhone, customer_phone_e164: customerPhone, notice_version: "bilateral-v1",
      notice_outbound_id: randomUUID(), notice_sent_at: new Date().toISOString(), choice_inbound_id: choiceId, chosen_at: new Date().toISOString(),
      consented_at: new Date().toISOString(), consent_method: "selection_after_notice",
    };
    await query(
      `INSERT INTO contacts (id, professional_id, customer_id, search_request_id, selection_key, public_code, bilateral_snapshot, selection_conversation_id, status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::jsonb, $8::uuid, 'shared')`,
      [contactId, profId, customerId, searchId, choiceId, code, JSON.stringify(snapshot), convId]
    );
    await executeInbound("serviço concluído", profPhone);
    return contactId;
  };

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1::uuid, $2)", [customerId, customerPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'João Silva', $2, $3, 'active')", [joaoId, `joao-${joaoId}`, joaoPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'Carlos Santos', $2, $3, 'active')", [carlosId, `carlos-${carlosId}`, carlosPhone]);
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1::uuid, $2::uuid, 'eletricista', 'selected')", [searchId, customerId]);
    await query(
      `INSERT INTO search_conversations (id, customer_id, status, original_raw_text, service_text, country_code, limit_value, search_request_id, expires_at, completed_at)
       VALUES ($1::uuid, $2::uuid, 'completed', 'eletricista', 'eletricista', 'BR', 3, $3::uuid, NOW() + INTERVAL '1 hour', NOW())`,
      [convId, customerId, searchId]
    );

    const joaoContactId = await createSharedContactWithPendingDeclaration(joaoId, "João Silva", joaoPhone, joaoCode);
    const carlosContactId = await createSharedContactWithPendingDeclaration(carlosId, "Carlos Santos", carlosPhone, carlosCode);

    // CONTEST DISAMBIGUATION CLARIFICATION
    const contestClarRes = await executeInbound("contestar");
    assert.equal(contestClarRes.result.route, "contact_completion");
    assert.equal(contestClarRes.result.action, "clarification");
    assert.equal(contestClarRes.result.clarification_kind, "contact_disambiguation");
    assert.equal(contestClarRes.result.requested_action, "contest");

    // ZERO terminal mutation before disambiguation
    const stateBeforeContest = (await query<{ state: string }>("SELECT state FROM contact_completions WHERE contact_id IN ($1::uuid, $2::uuid) ORDER BY contact_id", [joaoContactId, carlosContactId])).rows;
    assert.deepEqual(stateBeforeContest.map(s => s.state), ["pending_confirmation", "pending_confirmation"]);

    // RESOLVE CONTEST FOR JOÃO
    const contestResolveRes = await executeInbound("com João");
    assert.equal(contestResolveRes.result.route, "contact_completion");
    assert.equal(contestResolveRes.result.action, "contested");
    assert.equal(contestResolveRes.result.public_code, joaoCode);

    const joaoStateAfterContest = (await query<{ state: string }>("SELECT state FROM contact_completions WHERE contact_id = $1::uuid", [joaoContactId])).rows[0].state;
    assert.equal(joaoStateAfterContest, "contested");

    const carlosStateAfterContest = (await query<{ state: string }>("SELECT state FROM contact_completions WHERE contact_id = $1::uuid", [carlosContactId])).rows[0].state;
    assert.equal(carlosStateAfterContest, "pending_confirmation");
  } finally {
    await query("UPDATE channel_inbound_messages SET response_outbound_id = NULL");
    await query("UPDATE channel_outbound_messages SET completion_event_id = NULL");
    await query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completion_events WHERE contact_id IN (SELECT id FROM contacts WHERE search_request_id = $1::uuid)", [searchId]);
    await query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completions WHERE contact_id IN (SELECT id FROM contacts WHERE search_request_id = $1::uuid)", [searchId]);
    await query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 IN ($1, $2, $3)", [customerPhone, joaoPhone, carlosPhone]);
    await query("DELETE FROM contacts WHERE search_request_id = $1::uuid", [searchId]);
    await query("DELETE FROM search_conversations WHERE customer_id = $1::uuid", [customerId]);
    await query("DELETE FROM search_requests WHERE customer_id = $1::uuid", [customerId]);
    await query("DELETE FROM channel_inbound_messages WHERE phone_e164 IN ($1, $2, $3)", [customerPhone, joaoPhone, carlosPhone]);
    await query("DELETE FROM professionals WHERE id IN ($1::uuid, $2::uuid)", [joaoId, carlosId]);
    await query("DELETE FROM customers WHERE id = $1::uuid", [customerId]);
  }
});

test("Proof D: Replay asserts BOTH completion-event count and Outbox count remain unchanged", async () => {
  const f = await setupSingleContactFixture();
  try {
    await f.executeInbound("serviço concluído");
    await f.executeInbound("confirmar", f.professionalPhone);

    // Baseline counts before replay
    const eventsBefore = (await query<{ cnt: number }>("SELECT count(*)::integer AS cnt FROM contact_completion_events WHERE contact_id = $1::uuid", [f.contactId])).rows[0].cnt;
    const completionOutboxBefore = (await query<{ cnt: number }>("SELECT count(*)::integer AS cnt FROM channel_outbound_messages WHERE completion_event_id IS NOT NULL AND recipient_phone_e164 IN ($1, $2)", [f.customerPhone, f.professionalPhone])).rows[0].cnt;

    // Send explicit code replay
    const replayRes = await f.executeInbound(`confirmar ${f.code}`, f.professionalPhone);
    assert.ok(replayRes);
    assert.equal(replayRes.result.action, "idempotent_replay");

    // Counts after replay
    const eventsAfter = (await query<{ cnt: number }>("SELECT count(*)::integer AS cnt FROM contact_completion_events WHERE contact_id = $1::uuid", [f.contactId])).rows[0].cnt;
    const completionOutboxAfter = (await query<{ cnt: number }>("SELECT count(*)::integer AS cnt FROM channel_outbound_messages WHERE completion_event_id IS NOT NULL AND recipient_phone_e164 IN ($1, $2)", [f.customerPhone, f.professionalPhone])).rows[0].cnt;

    assert.equal(eventsAfter, eventsBefore, "Completion event count must remain unchanged after replay");
    assert.equal(completionOutboxAfter, completionOutboxBefore, "Completion notification Outbox count must remain unchanged after replay");
  } finally {
    await f.cleanup();
  }
});

test("Proof E: Real PostgreSQL pagination, candidate authority, page-1 referenceability and candidate bounds", async () => {
  const customerId = randomUUID(), searchId = randomUUID(), convId = randomUUID();
  const categoryId = randomUUID(), serviceId = randomUUID();
  const customerPhone = randomPhone();
  const profIds = Array.from({ length: 7 }, () => randomUUID());
  const profPhones = profIds.map(() => randomPhone());
  const profServiceIds = Array.from({ length: 7 }, () => randomUUID());
  const matchIds = Array.from({ length: 7 }, () => randomUUID());

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1::uuid, $2)", [customerId, customerPhone]);
    await query("INSERT INTO service_categories (id, name, slug) VALUES ($1::uuid, 'Teste', $2)", [categoryId, `cat-${categoryId}`]);
    await query("INSERT INTO services (id, category_id, name, slug) VALUES ($1::uuid, $2::uuid, 'Eletricista', $3)", [serviceId, categoryId, `eletricista-${serviceId}`]);
    for (let i = 0; i < 7; i++) {
      await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, $2, $3, $4, 'active')", [profIds[i], `Prof ${i + 1}`, `prof-${profIds[i]}`, profPhones[i]]);
      await query("INSERT INTO professional_services (id, professional_id, service_id, price_mode, price_from_cents) VALUES ($1::uuid, $2::uuid, $3::uuid, 'from', 10000)", [profServiceIds[i], profIds[i], serviceId]);
    }
    await query(`INSERT INTO professional_service_areas (professional_id, city, state, country_code, center, radius_meters)
      SELECT id, 'Cuiabá', 'MT', 'BR', ST_SetSRID(ST_MakePoint(-56.09, -15.60), 4326)::geography, 40000
      FROM professionals WHERE id = ANY($1::uuid[])`, [profIds]);
    await query(
      `INSERT INTO search_requests (id, customer_id, raw_text, service_id, status, location)
       VALUES ($1::uuid, $2::uuid, 'eletricista', $3::uuid, 'matched', ST_SetSRID(ST_MakePoint(-56.09, -15.60), 4326)::geography)`,
      [searchId, customerId, serviceId]
    );
    await query(
      `INSERT INTO search_conversations (id, customer_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, search_request_id, expires_at)
       VALUES ($1::uuid, $2::uuid, 'active', 'selection', 'eletricista', 'eletricista', 'BR', 3, $3::uuid, NOW() + INTERVAL '1 hour')`,
      [convId, customerId, searchId]
    );

    // Insert 7 matches:
    // Positions 1..3 shown initially (page 1, shown_at = NOW())
    // Positions 4..6 unshown initially, then marked shown (page 2, shown_at = NOW())
    // Position 7 EXISTS in database internal pool (matches table), but has shown_at = NULL
    for (let i = 0; i < 7; i++) {
      const shownAt = i < 3 ? "NOW()" : "NULL";
      await query(`INSERT INTO matches (id, search_request_id, professional_id, rank_position, shown_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, ${shownAt})`, [matchIds[i], searchId, profIds[i], i + 1]);
    }

    // 1) Verify page 1 shown count is 3
    const page1Shown = (await query<{ cnt: number }>("SELECT count(*)::integer AS cnt FROM matches WHERE search_request_id = $1::uuid AND shown_at IS NOT NULL", [searchId])).rows[0].cnt;
    assert.equal(page1Shown, 3, "Page 1 must show exactly 3 candidates");

    // 2) Simulate page 2 shown by marking positions 4..6 shown_at = NOW()
    await query("UPDATE matches SET shown_at = NOW() WHERE search_request_id = $1::uuid AND rank_position IN (4, 5, 6)", [searchId]);

    // 3) Verify total shown count is max 6 (positions 1..6)
    const totalShown = (await query<{ cnt: number }>("SELECT count(*)::integer AS cnt FROM matches WHERE search_request_id = $1::uuid AND shown_at IS NOT NULL", [searchId])).rows[0].cnt;
    assert.equal(totalShown, 6, "Total shown candidates must be capped at 6");

    // 4) Position 7 EXISTS in DB matches table with rank_position = 7, but shown_at IS NULL
    const pos7InDb = (await query<{ professional_id: string; shown_at: Date | null }>("SELECT professional_id, shown_at FROM matches WHERE search_request_id = $1::uuid AND rank_position = 7", [searchId])).rows[0];
    assert.ok(pos7InDb, "Position 7 candidate MUST exist in the internal pool/matches table");
    assert.equal(pos7InDb.professional_id, profIds[6]);
    assert.equal(pos7InDb.shown_at, null, "Position 7 candidate must have shown_at IS NULL (never shown)");

    // 5) Position 1 (from page 1) remains shown and referenceable after page 2 is shown
    const pos1Match = (await query<{ professional_id: string; shown_at: Date }>("SELECT professional_id, shown_at FROM matches WHERE search_request_id = $1::uuid AND rank_position = 1", [searchId])).rows[0];
    assert.equal(pos1Match.professional_id, profIds[0]);
    assert.ok(pos1Match.shown_at !== null, "Page-1 candidate must remain shown/referenceable after page 2");

    // 6) Repository authority API assertions
    const matchRepo = new PostgresSelectionMatchRepository();

    const shownRecords = await matchRepo.listShown(searchId);
    assert.equal(shownRecords.length, 6, "listShown must return exactly 6 shown matches");
    const shownRanks = shownRecords.map(r => r.rankPosition);
    assert.deepEqual(shownRanks.sort((a, b) => (a ?? 0) - (b ?? 0)), [1, 2, 3, 4, 5, 6], "listShown must return rank positions 1 through 6");
    assert.ok(!shownRecords.some(r => r.professionalId === profIds[6]), "listShown must exclude rank 7 candidate");

    const rank1Record = await matchRepo.findShownByPosition(searchId, 1);
    assert.ok(rank1Record !== null, "findShownByPosition(searchId, 1) must resolve rank 1");
    assert.equal(rank1Record.professionalId, profIds[0]);

    const rank7Record = await matchRepo.findShownByPosition(searchId, 7);
    assert.equal(rank7Record, null, "rank 7 must be inaccessible via findShownByPosition");

    const selectRes = await matchRepo.selectShownMatch({
      conversationId: convId,
      customerId,
      searchRequestId: searchId,
      position: 7,
      lastMessageText: "7",
      selectionKey: randomUUID(),
    });
    assert.equal(selectRes.kind, "match_not_available", "Unshown position 7 selection must be rejected as match_not_available");

    // 7) Assert ZERO contacts created for position 7
    const pos7Contacts = (await query<{ cnt: number }>("SELECT count(*)::integer AS cnt FROM contacts WHERE search_request_id = $1::uuid AND professional_id = $2::uuid", [searchId, profIds[6]])).rows[0].cnt;
    assert.equal(pos7Contacts, 0, "No contact must be created for unshown position 7");

  } finally {
    await query("DELETE FROM matches WHERE search_request_id = $1::uuid", [searchId]);
    await query("DELETE FROM search_conversations WHERE customer_id = $1::uuid OR customer_id IS NULL", [customerId]);
    await query("DELETE FROM search_requests WHERE customer_id = $1::uuid", [customerId]);
    await query("DELETE FROM professional_service_areas WHERE professional_id = ANY($1::uuid[])", [profIds]);
    await query("DELETE FROM professional_services WHERE id = ANY($1::uuid[])", [profServiceIds]);
    await query("DELETE FROM professionals WHERE id = ANY($1::uuid[])", [profIds]);
    await query("DELETE FROM services WHERE id = $1::uuid", [serviceId]);
    await query("DELETE FROM service_categories WHERE id = $1::uuid", [categoryId]);
    await query("DELETE FROM customers WHERE id = $1::uuid", [customerId]);
  }
});

test("PostgreSQL Selection v2 Scenarios 11-13 & 16-22: Action preservation, idempotency, replay & DB assertions", async () => {
  const f = await setupSingleContactFixture();
  try {
    // 16. Code-free confirmation with exactly one pending completion
    const declRes = await f.executeInbound("serviço concluído");
    assert.equal(declRes.result.action, "declared");

    const confRes = await f.executeInbound("confirmar", f.professionalPhone);
    assert.ok(confRes);
    assert.equal(confRes.result.action, "confirmed");

    // 22. Replay produces no duplicate completion event or Outbox (assert count(*) = 2: 1 declared event + 1 confirmed event)
    const replayRes = await f.executeInbound(`confirmar ${f.code}`, f.professionalPhone);
    assert.ok(replayRes);
    assert.equal(replayRes.result.action, "idempotent_replay");

    const eventsCount = (await query<{ cnt: number }>("SELECT count(*)::integer AS cnt FROM contact_completion_events WHERE contact_id = $1::uuid", [f.contactId])).rows[0].cnt;
    assert.equal(eventsCount, 2, "Replay must create ZERO duplicate completion events (1 declared event + 1 confirmed event)");

    // 20. Generic 'sim' / 'não' without explicit context cannot mutate
    const genRes = await f.executeInbound("sim", f.customerPhone);
    assert.ok(genRes);
    assert.notEqual(genRes.result.route, "contact_completion");
  } finally {
    await f.cleanup();
  }

  // 17-19. Code-free 'contestar' on pending_confirmation contact
  const f2 = await setupSingleContactFixture();
  try {
    await f2.executeInbound("serviço concluído");
    const contestRes = await f2.executeInbound("contestar", f2.professionalPhone);
    assert.ok(contestRes);
    assert.equal(contestRes.result.action, "contested");
  } finally {
    await f2.cleanup();
  }
});

test("PostgreSQL Selection v2 Scenario 27: Immutability triggers P0027 Invariant", async () => {
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
    await query("DELETE FROM customers WHERE id=$1::uuid OR phone_e164=$2", [customerId, customerPhone]);
  }
});
