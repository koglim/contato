import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { channelInboundMessageResponseSchema } from "@contatocerto/shared";
import { buildApp } from "../src/app.js";
import { closeDatabaseConnection, query, withTransaction, type DatabaseClient } from "../src/database/connection.js";
import { createOpportunityCode } from "../src/modules/bilateral-contact/bilateral-contact.policy.js";
import { ContactCompletionService } from "../src/modules/contact-completion/contact-completion.service.js";
import { PostgresContactCompletionRepository } from "../src/modules/contact-completion/contact-completion.repository.js";
import type { ContactRow } from "../src/modules/contact-completion/contact-completion.types.js";
import { rollbackThrough } from "./rollback-helper.js";

after(closeDatabaseConnection);

const internalKey = "contact-completion-integration-key";
const randomPhone = () => `+5565${Math.floor(100000000 + Math.random() * 899999999)}`;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForBlockedPid(blockedPid: number, blockerPid: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const res = await query<{ blockers: number[] }>(
      "SELECT pg_blocking_pids($1) as blockers",
      [blockedPid]
    );
    const blockers = res.rows[0]?.blockers;
    if (blockers && blockers.includes(blockerPid)) {
      return;
    }
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`PID ${blockedPid} was not blocked by ${blockerPid} within timeout`);
}

class HookableContactCompletionRepository extends PostgresContactCompletionRepository {
  public onBeforeLockContact?: (db: DatabaseClient, contactId: string) => Promise<void>;
  public onAfterLockContact?: (db: DatabaseClient, contactId: string) => Promise<void>;

  override async lockContact(db: DatabaseClient, contactId: string): Promise<ContactRow | null> {
    if (this.onBeforeLockContact) {
      await this.onBeforeLockContact(db, contactId);
    }
    const result = await super.lockContact(db, contactId);
    if (this.onAfterLockContact) {
      await this.onAfterLockContact(db, contactId);
    }
    return result;
  }
}

type FixtureOptions = {
  status?: string;
  hasActiveSearch?: boolean;
  subscriptionRevoked?: boolean;
  professionalPhone?: string;
  customerPhone?: string;
};

async function createFixture(options: FixtureOptions = {}) {
  const customerId = randomUUID();
  const professionalId = randomUUID();
  const searchId = randomUUID();
  const conversationId = randomUUID();
  const contactId = randomUUID();
  const choiceId = randomUUID();
  const code = createOpportunityCode();
  const customerPhone = options.customerPhone ?? randomPhone();
  const professionalPhone = options.professionalPhone ?? randomPhone();
  const activeSearchId = randomUUID();
  const activeConversationId = randomUUID();

  const repo = new HookableContactCompletionRepository();
  const service = new ContactCompletionService(repo);
  const app = buildApp({ internalApiKey: internalKey, contactCompletionService: service });

  const contactIds = new Set<string>([contactId]);
  const searchIds = new Set<string>([searchId]);
  const conversationIds = new Set<string>([conversationId]);
  const professionalIds = new Set<string>([professionalId]);
  const customerIds = new Set<string>([customerId]);
  const usedPhones = new Set<string>([customerPhone, professionalPhone]);

  // 1. Insert customer and professional
  await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, customerPhone]);
  await query(
    "INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1, 'Carlos Pro', $2, $3, 'active')",
    [professionalId, `carlos-${professionalId}`, professionalPhone]
  );

  // 2. Insert search request and search conversation for the contact
  await query(
    "INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1, $2, 'pintor em Cuiabá', 'selected')",
    [searchId, customerId]
  );
  await query(
    `INSERT INTO search_conversations (
       id, customer_id, status, original_raw_text, service_text, location_text, country_code, limit_value, search_request_id, expires_at, completed_at
     )
     VALUES ($1, $2, 'completed', 'pintor em Cuiabá', 'pintor', 'Cuiabá, MT', 'BR', 3, $3, NOW() + INTERVAL '1 hour', NOW())`,
    [conversationId, customerId, searchId]
  );

  // 3. Selection message in inbound
  await query(
    `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, processed_at, result)
     VALUES ($1, 'test', $2, $3, 'Carlos', 'BR', 3, 'processed', NOW(), '{"route":"selection"}'::jsonb)`,
    [choiceId, choiceId, customerPhone]
  );

  // 4. Contact snapshot and record
  const snapshot = {
    public_code: code,
    service_name: "pintor",
    city: "Cuiabá",
    state: "MT",
    neighborhood: "Centro",
    summary: "Pintura residencial",
    professional_name: "Carlos Pro",
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

  const contactStatus = options.status ?? "shared";
  await query(
    `INSERT INTO contacts (
       id, professional_id, customer_id, search_request_id, selection_key, public_code, bilateral_snapshot, selection_conversation_id, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [
      contactId,
      professionalId,
      customerId,
      searchId,
      choiceId,
      code,
      JSON.stringify(snapshot),
      conversationId,
      contactStatus,
    ]
  );

  // If active search requested: customer has another search active right now!
  if (options.hasActiveSearch) {
    await query(
      "INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1, $2, 'eletricista', 'matched')",
      [activeSearchId, customerId]
    );
    await query(
      `INSERT INTO search_conversations (
         id, customer_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, expires_at
       )
       VALUES ($1, $2, 'active', 'location', 'eletricista', 'eletricista', 'BR', 3, NOW() + INTERVAL '1 hour')`,
      [activeConversationId, customerId]
    );
  }

  // If subscription test: professional had subscription granted, then revoked
  let subId: string | null = null;
  if (options.subscriptionRevoked) {
    const plan = (await query<{ id: string }>(
      "SELECT id FROM subscription_plans WHERE code = 'marketplace_standard_v1'"
    )).rows[0];
    if (plan) {
      subId = randomUUID();
      await query(
        `INSERT INTO professional_subscriptions (id, professional_id, plan_id, starts_at, ends_at, revoked_at)
         VALUES ($1, $2, $3, NOW() - INTERVAL '10 days', NOW() + INTERVAL '20 days', NOW() - INTERVAL '1 day')`,
        [subId, professionalId, plan.id]
      );
    }
  }

  async function addContact(serviceName = "encanador", proSlugPrefix = "outro-pro") {
    const pId = randomUUID();
    const pPhone = randomPhone();
    const sId = randomUUID();
    const convId = randomUUID();
    const chId = randomUUID();
    const cId = randomUUID();
    const cCode = createOpportunityCode();

    usedPhones.add(pPhone);
    professionalIds.add(pId);
    searchIds.add(sId);
    conversationIds.add(convId);
    contactIds.add(cId);

    await query(
      "INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1, 'Outro Pro', $2, $3, 'active')",
      [pId, `${proSlugPrefix}-${pId}`, pPhone]
    );
    await query(
      "INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1, $2, $3, 'selected')",
      [sId, customerId, `${serviceName} em Cuiabá`]
    );
    await query(
      `INSERT INTO search_conversations (
         id, customer_id, status, original_raw_text, service_text, location_text, country_code, limit_value, search_request_id, expires_at, completed_at
       )
       VALUES ($1, $2, 'completed', $3, $4, 'Cuiabá, MT', 'BR', 3, $5, NOW() + INTERVAL '1 hour', NOW())`,
      [convId, customerId, `${serviceName} em Cuiabá`, serviceName, sId]
    );
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, processed_at, result)
       VALUES ($1, 'test', $2, $3, 'Outro', 'BR', 3, 'processed', NOW(), '{"route":"selection"}'::jsonb)`,
      [chId, chId, customerPhone]
    );
    const snap = {
      public_code: cCode,
      service_name: serviceName,
      city: "Cuiabá",
      state: "MT",
      neighborhood: "Centro",
      summary: `Serviço de ${serviceName}`,
      professional_name: "Outro Pro",
      professional_phone_e164: pPhone,
      customer_phone_e164: customerPhone,
      notice_version: "bilateral-v1",
      notice_outbound_id: randomUUID(),
      notice_sent_at: new Date().toISOString(),
      choice_inbound_id: chId,
      chosen_at: new Date().toISOString(),
      consented_at: new Date().toISOString(),
      consent_method: "selection_after_notice",
    };
    await query(
      `INSERT INTO contacts (
         id, professional_id, customer_id, search_request_id, selection_key, public_code, bilateral_snapshot, selection_conversation_id, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'shared')`,
      [cId, pId, customerId, sId, chId, cCode, JSON.stringify(snap), convId]
    );
    return { id: cId, code: cCode, professionalPhone: pPhone };
  }

  async function addOpportunityForPro(serviceName = "marceneiro") {
    const cId2 = randomUUID();
    const cPhone2 = randomPhone();
    const sId = randomUUID();
    const convId = randomUUID();
    const chId = randomUUID();
    const contId = randomUUID();
    const cCode = createOpportunityCode();

    usedPhones.add(cPhone2);
    customerIds.add(cId2);
    searchIds.add(sId);
    conversationIds.add(convId);
    contactIds.add(contId);

    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [cId2, cPhone2]);
    await query(
      "INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1, $2, $3, 'selected')",
      [sId, cId2, `${serviceName} em Cuiabá`]
    );
    await query(
      `INSERT INTO search_conversations (
         id, customer_id, status, original_raw_text, service_text, location_text, country_code, limit_value, search_request_id, expires_at, completed_at
       )
       VALUES ($1, $2, 'completed', $3, $4, 'Cuiabá, MT', 'BR', 3, $5, NOW() + INTERVAL '1 hour', NOW())`,
      [convId, cId2, `${serviceName} em Cuiabá`, serviceName, sId]
    );
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, processed_at, result)
       VALUES ($1, 'test', $2, $3, 'Carlos', 'BR', 3, 'processed', NOW(), '{"route":"selection"}'::jsonb)`,
      [chId, chId, cPhone2]
    );
    const snap = {
      public_code: cCode,
      service_name: serviceName,
      city: "Cuiabá",
      state: "MT",
      neighborhood: "Centro",
      summary: `Serviço de ${serviceName}`,
      professional_name: "Carlos Pro",
      professional_phone_e164: professionalPhone,
      customer_phone_e164: cPhone2,
      notice_version: "bilateral-v1",
      notice_outbound_id: randomUUID(),
      notice_sent_at: new Date().toISOString(),
      choice_inbound_id: chId,
      chosen_at: new Date().toISOString(),
      consented_at: new Date().toISOString(),
      consent_method: "selection_after_notice",
    };
    await query(
      `INSERT INTO contacts (
         id, professional_id, customer_id, search_request_id, selection_key, public_code, bilateral_snapshot, selection_conversation_id, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'shared')`,
      [contId, professionalId, cId2, sId, chId, cCode, JSON.stringify(snap), convId]
    );
    return { id: contId, code: cCode, customerPhone: cPhone2 };
  }

  async function send(text: string, sender = customerPhone, msgId = randomUUID()) {
    usedPhones.add(sender);
    const response = await app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers: { "x-internal-key": internalKey },
      payload: {
        provider: "test",
        provider_message_id: msgId,
        phone_e164: sender,
        raw_text: text,
        country_code: "BR",
        limit: 3,
      },
    });
    assert.equal(response.statusCode, 200, `Inbox failed with ${response.statusCode}: ${response.body}`);
    return channelInboundMessageResponseSchema.parse(response.json());
  }

  async function getContact() {
    const res = await query<{ status: string; public_code: string }>(
      "SELECT status, public_code FROM contacts WHERE id = $1",
      [contactId]
    );
    return res.rows[0];
  }

  async function getCompletion() {
    const res = await query<{
      id: string;
      contact_id: string;
      state: string;
      declared_by: string;
      confirmed_at: Date | null;
      contested_at: Date | null;
    }>("SELECT * FROM contact_completions WHERE contact_id = $1", [contactId]);
    return res.rows[0] ?? null;
  }

  async function getEvents() {
    const res = await query<{
      id: string;
      actor_role: string;
      action: string;
      inbound_message_id: string;
    }>("SELECT * FROM contact_completion_events WHERE contact_id = $1 ORDER BY created_at ASC", [contactId]);
    return res.rows;
  }

  async function getOutbounds() {
    const res = await query<{
      id: string;
      purpose: string;
      recipient_phone_e164: string;
      text_content: string;
      business_key: string | null;
    }>(
      `SELECT id, purpose, recipient_phone_e164, text_content, business_key
       FROM channel_outbound_messages
       WHERE recipient_phone_e164 = ANY($1)
       ORDER BY created_at ASC`,
      [Array.from(usedPhones)]
    );
    return res.rows;
  }

  async function cleanup() {
    const phones = Array.from(usedPhones);
    const cIds = Array.from(contactIds);
    await query(
      "UPDATE channel_inbound_messages SET response_outbound_id = NULL WHERE phone_e164 = ANY($1)",
      [phones]
    );
    await query(
      "UPDATE channel_outbound_messages SET completion_event_id = NULL WHERE completion_event_id IN (SELECT id FROM contact_completion_events WHERE contact_id = ANY($1))",
      [cIds]
    );
    await query(
      "DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 = ANY($1)",
      [phones]
    );
    await query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completion_events WHERE contact_id = ANY($1)", [cIds]);
    await query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completions WHERE contact_id = ANY($1)", [cIds]);
    await query("DELETE FROM contacts WHERE id = ANY($1)", [cIds]);
    if (subId) {
      await query("DELETE FROM professional_subscriptions WHERE id = $1", [subId]);
    }
    if (options.hasActiveSearch) {
      await query("DELETE FROM search_conversations WHERE id = $1", [activeConversationId]);
      await query("DELETE FROM search_requests WHERE id = $1", [activeSearchId]);
    }
    await query("DELETE FROM search_conversations WHERE id = ANY($1)", [Array.from(conversationIds)]);
    await query("DELETE FROM search_requests WHERE id = ANY($1)", [Array.from(searchIds)]);
    await query(
      `DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (
        SELECT id FROM channel_inbound_messages WHERE phone_e164 = ANY($1)
      )`,
      [phones]
    );
    await query("DELETE FROM channel_inbound_messages WHERE phone_e164 = ANY($1)", [phones]);
    await query("DELETE FROM professionals WHERE id = ANY($1)", [Array.from(professionalIds)]);
    await query("DELETE FROM customers WHERE id = ANY($1)", [Array.from(customerIds)]);
  }

  return {
    contactId,
    code,
    customerId,
    professionalId,
    customerPhone,
    professionalPhone,
    activeConversationId,
    repo,
    service,
    app,
    send,
    addContact,
    addOpportunityForPro,
    getContact,
    getCompletion,
    getEvents,
    getOutbounds,
    cleanup,
  };
}

test("Scenario 1: Customer declares completion, professional confirms -> contacts.status becomes completed", async () => {
  const f = await createFixture();
  try {
    // 1. Customer declares completion
    const declRes = await f.send(`concluído ${f.code}`, f.customerPhone);
    assert.equal(declRes.duplicate, false);
    assert.equal(declRes.result.action, "declared");
    assert.match(declRes.reply_text, /Aguardando confirmação do profissional/);

    const completion1 = await f.getCompletion();
    assert.ok(completion1);
    assert.equal(completion1.state, "pending_confirmation");
    assert.equal(completion1.declared_by, "customer");
    assert.equal(completion1.confirmed_at, null);

    const contact1 = await f.getContact();
    assert.equal(contact1.status, "shared"); // Still shared until counterpart confirms!

    const events1 = await f.getEvents();
    assert.equal(events1.length, 1);
    assert.equal(events1[0].actor_role, "customer");
    assert.equal(events1[0].action, "declared");

    const outbounds1 = await f.getOutbounds();
    const promptNotif = outbounds1.find((o) => o.purpose === "professional_contact_notification");
    assert.ok(promptNotif);
    assert.equal(promptNotif.recipient_phone_e164, f.professionalPhone);
    assert.match(promptNotif.text_content, /O cliente declarou a conclusão do serviço/);
    assert.equal(promptNotif.business_key, `contact:${f.contactId}:completion:prompt`);

    // 2. Professional confirms
    const confRes = await f.send(`confirmar ${f.code}`, f.professionalPhone);
    assert.equal(confRes.duplicate, false);
    assert.equal(confRes.result.action, "confirmed");
    assert.match(confRes.reply_text, /confirmada com sucesso/);

    const completion2 = await f.getCompletion();
    assert.equal(completion2.state, "confirmed");
    assert.ok(completion2.confirmed_at);

    const contact2 = await f.getContact();
    assert.equal(contact2.status, "completed"); // Atomically transitioned to completed!

    const events2 = await f.getEvents();
    assert.equal(events2.length, 2);
    assert.equal(events2[1].actor_role, "professional");
    assert.equal(events2[1].action, "confirmed");

    const outbounds2 = await f.getOutbounds();
    const confirmedNotif = outbounds2.find(
      (o) => o.business_key === `contact:${f.contactId}:completion:confirmed`
    );
    assert.ok(confirmedNotif);
    assert.equal(confirmedNotif.recipient_phone_e164, f.customerPhone);
    assert.match(confirmedNotif.text_content, /O profissional confirmou a conclusão/);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 2: Professional declares completion, customer confirms -> contacts.status becomes completed", async () => {
  const f = await createFixture();
  try {
    // 1. Professional declares completion
    const declRes = await f.send(`servico concluido ${f.code}`, f.professionalPhone);
    assert.equal(declRes.result.action, "declared");
    assert.match(declRes.reply_text, /Aguardando confirmação do cliente/);

    const completion1 = await f.getCompletion();
    assert.equal(completion1.state, "pending_confirmation");
    assert.equal(completion1.declared_by, "professional");

    // 2. Customer confirms
    const confRes = await f.send(`confirmar ${f.code}`, f.customerPhone);
    assert.equal(confRes.result.action, "confirmed");

    const contact2 = await f.getContact();
    assert.equal(contact2.status, "completed");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 3: Counterpart contests completion -> contacts.status remains shared and auditable dispute is recorded", async () => {
  const f = await createFixture();
  try {
    // 1. Customer declares completion
    await f.send(`concluído ${f.code}`, f.customerPhone);

    // 2. Professional contests
    const contestRes = await f.send(`contestar ${f.code}`, f.professionalPhone);
    assert.equal(contestRes.result.action, "contested");
    assert.match(contestRes.reply_text, /A contestação da conclusão do serviço .* foi registrada/);

    const completion = await f.getCompletion();
    assert.equal(completion.state, "contested");
    assert.ok(completion.contested_at);

    // Contact status MUST REMAIN shared
    const contact = await f.getContact();
    assert.equal(contact.status, "shared");

    const events = await f.getEvents();
    assert.equal(events.length, 2);
    assert.equal(events[1].actor_role, "professional");
    assert.equal(events[1].action, "contested");

    const outbounds = await f.getOutbounds();
    const contestNotif = outbounds.find(
      (o) => o.business_key === `contact:${f.contactId}:completion:contested`
    );
    assert.ok(contestNotif);
    assert.equal(contestNotif.recipient_phone_e164, f.customerPhone);
    assert.match(contestNotif.text_content, /O profissional contestou a declaração/);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 4: Simultaneous two-party declaration acts as confirmation", async () => {
  const f = await createFixture();
  try {
    // Customer declares
    await f.send(`concluido ${f.code}`, f.customerPhone);

    // Professional independently declares before explicit confirmation
    const profDeclRes = await f.send(`concluido ${f.code}`, f.professionalPhone);
    assert.equal(profDeclRes.result.action, "confirmed");
    assert.match(profDeclRes.reply_text, /Conclusão do serviço .* confirmada com sucesso/);

    const completion = await f.getCompletion();
    assert.equal(completion.state, "confirmed");

    const contact = await f.getContact();
    assert.equal(contact.status, "completed");

    const events = await f.getEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0].actor_role, "customer");
    assert.equal(events[0].action, "declared");
    assert.equal(events[1].actor_role, "professional");
    assert.equal(events[1].action, "confirmed");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 5: Same-side repeated declaration and confirmations are idempotent", async () => {
  const f = await createFixture();
  try {
    // Customer declares
    await f.send(`concluido ${f.code}`, f.customerPhone);

    // Customer repeats declaration
    const repeatDecl = await f.send(`concluido ${f.code}`, f.customerPhone);
    assert.equal(repeatDecl.result.action, "idempotent_replay");
    assert.match(repeatDecl.reply_text, /Você já registrou a declaração/);

    const events1 = await f.getEvents();
    assert.equal(events1.length, 1); // No duplicate events!

    // Professional confirms
    await f.send(`confirmar ${f.code}`, f.professionalPhone);

    // Professional confirms again
    const repeatConf = await f.send(`confirmar ${f.code}`, f.professionalPhone);
    assert.equal(repeatConf.result.action, "idempotent_replay");
    assert.match(repeatConf.reply_text, /já foi concluída anteriormente/);

    const events2 = await f.getEvents();
    assert.equal(events2.length, 2); // No duplicate events!
  } finally {
    await f.cleanup();
  }
});

test("Scenario 6: Inbound replay returns cached response with duplicate = true", async () => {
  const f = await createFixture();
  try {
    const msgId = randomUUID();
    const res1 = await f.send(`concluido ${f.code}`, f.customerPhone, msgId);
    assert.equal(res1.duplicate, false);

    const res2 = await f.send(`concluido ${f.code}`, f.customerPhone, msgId);
    assert.equal(res2.duplicate, true);
    assert.equal(res2.reply_text, res1.reply_text);
    assert.equal(res2.outbound.id, res1.outbound.id);

    const events = await f.getEvents();
    assert.equal(events.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 7: Unauthorized phone using valid code is rejected", async () => {
  const f = await createFixture();
  try {
    const unauthorizedPhone = randomPhone();
    const res = await f.send(`concluido ${f.code}`, unauthorizedPhone);
    assert.equal(res.result.action, "unavailable");
    assert.match(res.reply_text, /Não identifiquei uma solicitação ativa/);

    const completion = await f.getCompletion();
    assert.equal(completion, null);

    const events = await f.getEvents();
    assert.equal(events.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 8: Declaring or confirming on requested or declined contact is rejected", async () => {
  const fReq = await createFixture({ status: "requested" });
  try {
    const res = await fReq.send(`concluido ${fReq.code}`, fReq.customerPhone);
    assert.equal(res.result.action, "unavailable");
    assert.match(res.reply_text, /aguardando resposta e não pode ser concluída/);
    assert.equal(await fReq.getCompletion(), null);
  } finally {
    await fReq.cleanup();
  }

  const fDec = await createFixture({ status: "declined" });
  try {
    const res = await fDec.send(`concluido ${fDec.code}`, fDec.customerPhone);
    assert.equal(res.result.action, "unavailable");
    assert.match(res.reply_text, /foi recusada e não pode ser concluída/);
    assert.equal(await fDec.getCompletion(), null);
  } finally {
    await fDec.cleanup();
  }
});

test("Scenario 9: Confirmer cannot be the same actor who declared", async () => {
  const f = await createFixture();
  try {
    await f.send(`concluido ${f.code}`, f.customerPhone);

    const res = await f.send(`confirmar ${f.code}`, f.customerPhone);
    assert.equal(res.result.action, "clarification");
    assert.match(res.reply_text, /Você é quem declarou a conclusão/);

    const completion = await f.getCompletion();
    assert.equal(completion.state, "pending_confirmation");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 10: Confirmation or contestation without pending declaration is rejected", async () => {
  const f = await createFixture();
  try {
    const confRes = await f.send(`confirmar ${f.code}`, f.professionalPhone);
    assert.equal(confRes.result.action, "clarification");
    assert.match(confRes.reply_text, /Não há declaração de conclusão pendente/);

    const contRes = await f.send(`contestar ${f.code}`, f.professionalPhone);
    assert.equal(contRes.result.action, "clarification");
    assert.match(contRes.reply_text, /Não há declaração de conclusão pendente para contestar/);

    assert.equal(await f.getCompletion(), null);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 11: Active customer search conversation is NOT hijacked by contact completion command", async () => {
  const f = await createFixture({ hasActiveSearch: true });
  try {
    // Customer has active search conversation in search_conversations
    const activeConvBefore = (
      await query<{ status: string; pending_slot: string }>(
        "SELECT status, pending_slot FROM search_conversations WHERE id = $1",
        [f.activeConversationId]
      )
    ).rows[0];
    assert.equal(activeConvBefore.status, "active");
    assert.equal(activeConvBefore.pending_slot, "location");

    // Customer completes older contact
    const res = await f.send(`concluido ${f.code}`, f.customerPhone);
    assert.equal(res.result.action, "declared");

    // Active search conversation must REMAIN active and untouched!
    const activeConvAfter = (
      await query<{ status: string; pending_slot: string }>(
        "SELECT status, pending_slot FROM search_conversations WHERE id = $1",
        [f.activeConversationId]
      )
    ).rows[0];
    assert.equal(activeConvAfter.status, "active");
    assert.equal(activeConvAfter.pending_slot, "location");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 12: Professional subscription revoked after acceptance does NOT block completion", async () => {
  const f = await createFixture({ subscriptionRevoked: true });
  try {
    // Customer declares
    await f.send(`concluido ${f.code}`, f.customerPhone);

    // Professional with revoked subscription confirms
    const confRes = await f.send(`confirmar ${f.code}`, f.professionalPhone);
    assert.equal(confRes.result.action, "confirmed");

    const contact = await f.getContact();
    assert.equal(contact.status, "completed");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 13A: Deterministic concurrency Scenario A — declaration vs declaration: proves contacts.id FOR UPDATE blocking via pg_blocking_pids", async () => {
  const f = await createFixture();
  try {
    let partyAPid: number | null = null;
    let partyBPid: number | null = null;
    const partyALocked = createDeferred<void>();
    const allowPartyACommit = createDeferred<void>();
    const partyBAttempting = createDeferred<void>();

    f.repo.onAfterLockContact = async (db, contactId) => {
      if (contactId === f.contactId && !partyAPid) {
        const pidRes = await (db as unknown as { query: (sql: string) => Promise<{ rows: Array<{ pid: number }> }> }).query(
          "SELECT pg_backend_pid() as pid"
        );
        partyAPid = pidRes.rows[0].pid;
        partyALocked.resolve();
        await allowPartyACommit.promise;
      }
    };

    f.repo.onBeforeLockContact = async (db, contactId) => {
      if (contactId === f.contactId && partyAPid) {
        const pidRes = await (db as unknown as { query: (sql: string) => Promise<{ rows: Array<{ pid: number }> }> }).query(
          "SELECT pg_backend_pid() as pid"
        );
        partyBPid = pidRes.rows[0].pid;
        partyBAttempting.resolve();
      }
    };

    // 1. Party A (Customer) attempts declaration
    const partyAPromise = f.send(`concluído ${f.code}`, f.customerPhone);

    // 2. Wait until Party A has acquired contacts.id FOR UPDATE
    await partyALocked.promise;
    assert.ok(partyAPid);

    // 3. Party B (Professional) attempts declaration against the same contact
    const partyBPromise = f.send(`concluído ${f.code}`, f.professionalPhone);

    // 4. Wait until Party B reaches lockContact query
    await partyBAttempting.promise;
    assert.ok(partyBPid);

    // 5. Prove via PostgreSQL pg_blocking_pids that Party B is blocked by Party A
    await waitForBlockedPid(partyBPid, partyAPid);

    // 6. Release Party A to commit its transaction
    allowPartyACommit.resolve();

    // 7. Both complete
    const [resA, resB] = await Promise.all([partyAPromise, partyBPromise]);
    assert.equal(resA.result.action, "declared");
    assert.equal(resB.result.action, "confirmed");

    // 8. Assertions:
    // - exactly one contact_completions row
    const completions = (await query("SELECT * FROM contact_completions WHERE contact_id = $1", [f.contactId])).rows;
    assert.equal(completions.length, 1);
    // - state = confirmed
    assert.equal(completions[0].state, "confirmed");
    assert.ok(completions[0].confirmed_at);
    // - contact = completed
    const contact = await f.getContact();
    assert.equal(contact.status, "completed");
    // - exactly two logical completion events
    const events = await f.getEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0].actor_role, "customer");
    assert.equal(events[0].action, "declared");
    assert.equal(events[1].actor_role, "professional");
    assert.equal(events[1].action, "confirmed");
    // - no duplicated logical notifications
    const outbounds = await f.getOutbounds();
    const promptNotifs = outbounds.filter((o) => o.business_key === `contact:${f.contactId}:completion:prompt`);
    const confirmedNotifs = outbounds.filter((o) => o.business_key === `contact:${f.contactId}:completion:confirmed`);
    assert.equal(promptNotifs.length, 1);
    assert.equal(confirmedNotifs.length, 1);
  } finally {
    f.repo.onBeforeLockContact = undefined;
    f.repo.onAfterLockContact = undefined;
    await f.cleanup();
  }
});

test("Scenario 13B: Deterministic concurrency Scenario B — declaration vs confirmation: locks serialize, no lost update, exactly one terminal transition", async () => {
  const f = await createFixture();
  try {
    // Start from a valid pending confirmation: Customer declared
    await f.send(`concluído ${f.code}`, f.customerPhone);
    const completionBefore = await f.getCompletion();
    assert.equal(completionBefore?.state, "pending_confirmation");

    let partyAPid: number | null = null;
    let partyBPid: number | null = null;
    const partyALocked = createDeferred<void>();
    const allowPartyACommit = createDeferred<void>();
    const partyBAttempting = createDeferred<void>();

    f.repo.onAfterLockContact = async (db, contactId) => {
      if (contactId === f.contactId && !partyAPid) {
        const pidRes = await (db as unknown as { query: (sql: string) => Promise<{ rows: Array<{ pid: number }> }> }).query(
          "SELECT pg_backend_pid() as pid"
        );
        partyAPid = pidRes.rows[0].pid;
        partyALocked.resolve();
        await allowPartyACommit.promise;
      }
    };

    f.repo.onBeforeLockContact = async (db, contactId) => {
      if (contactId === f.contactId && partyAPid) {
        const pidRes = await (db as unknown as { query: (sql: string) => Promise<{ rows: Array<{ pid: number }> }> }).query(
          "SELECT pg_backend_pid() as pid"
        );
        partyBPid = pidRes.rows[0].pid;
        partyBAttempting.resolve();
      }
    };

    // Operation 1 (Customer repeats declaration) holds the contact lock
    const partyAPromise = f.send(`concluído ${f.code}`, f.customerPhone);
    await partyALocked.promise;

    // Operation 2 (Professional confirms) attempts confirmation concurrently
    const partyBPromise = f.send(`confirmar ${f.code}`, f.professionalPhone);
    await partyBAttempting.promise;

    // Prove B is blocked on A via pg_blocking_pids
    await waitForBlockedPid(partyBPid!, partyAPid!);

    // Release A to commit
    allowPartyACommit.resolve();

    const [resA, resB] = await Promise.all([partyAPromise, partyBPromise]);
    assert.equal(resA.result.action, "idempotent_replay");
    assert.equal(resB.result.action, "confirmed");

    // After serialization:
    // - no lost update;
    // - exactly one terminal transition to completed
    const contact = await f.getContact();
    assert.equal(contact.status, "completed");

    const completion = await f.getCompletion();
    assert.equal(completion?.state, "confirmed");
    assert.ok(completion?.confirmed_at);
  } finally {
    f.repo.onBeforeLockContact = undefined;
    f.repo.onAfterLockContact = undefined;
    await f.cleanup();
  }
});

test("Scenario 13C: Deterministic concurrency Scenario C — declaration vs contestation: deterministic serialization, no mixed state, no duplicate terminal notifications", async () => {
  const f = await createFixture();
  try {
    // Start from valid pending confirmation
    await f.send(`concluído ${f.code}`, f.customerPhone);

    let partyAPid: number | null = null;
    let partyBPid: number | null = null;
    const partyALocked = createDeferred<void>();
    const allowPartyACommit = createDeferred<void>();
    const partyBAttempting = createDeferred<void>();

    f.repo.onAfterLockContact = async (db, contactId) => {
      if (contactId === f.contactId && !partyAPid) {
        const pidRes = await (db as unknown as { query: (sql: string) => Promise<{ rows: Array<{ pid: number }> }> }).query(
          "SELECT pg_backend_pid() as pid"
        );
        partyAPid = pidRes.rows[0].pid;
        partyALocked.resolve();
        await allowPartyACommit.promise;
      }
    };

    f.repo.onBeforeLockContact = async (db, contactId) => {
      if (contactId === f.contactId && partyAPid) {
        const pidRes = await (db as unknown as { query: (sql: string) => Promise<{ rows: Array<{ pid: number }> }> }).query(
          "SELECT pg_backend_pid() as pid"
        );
        partyBPid = pidRes.rows[0].pid;
        partyBAttempting.resolve();
      }
    };

    // Operation 1 (Customer mutation) holds lock
    const partyAPromise = f.send(`concluído ${f.code}`, f.customerPhone);
    await partyALocked.promise;

    // Operation 2 (Professional contestation) attempts contestation concurrently
    const partyBPromise = f.send(`contestar ${f.code}`, f.professionalPhone);
    await partyBAttempting.promise;

    // Prove B is blocked on A via pg_blocking_pids
    await waitForBlockedPid(partyBPid!, partyAPid!);

    allowPartyACommit.resolve();

    const [resA, resB] = await Promise.all([partyAPromise, partyBPromise]);
    assert.equal(resA.result.action, "idempotent_replay");
    assert.equal(resB.result.action, "contested");

    // Final state must be one valid domain state only:
    // - completion state is contested
    const completion = await f.getCompletion();
    assert.equal(completion?.state, "contested");
    assert.ok(completion?.contested_at);
    assert.equal(completion?.confirmed_at, null); // NOT mixed confirmed + contested!

    // - contact status remains shared (never completed with contested aggregate)
    const contact = await f.getContact();
    assert.equal(contact.status, "shared");

    // - no duplicate terminal notifications
    const outbounds = await f.getOutbounds();
    const contestNotifs = outbounds.filter((o) => o.business_key === `contact:${f.contactId}:completion:contested`);
    assert.equal(contestNotifs.length, 1);
  } finally {
    f.repo.onBeforeLockContact = undefined;
    f.repo.onAfterLockContact = undefined;
    await f.cleanup();
  }
});

test("Scenario 13D: Deterministic concurrency Scenario D — conflicting commands from same actor serialize into valid terminal state", async () => {
  const f = await createFixture();
  try {
    // Customer declared completion
    await f.send(`concluído ${f.code}`, f.customerPhone);

    const cmd1InboundId = randomUUID();
    const cmd1Tok = randomUUID();
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, processing_token, processing_started_at)
       VALUES ($1, 'test', $2, $3, $4, 'BR', 3, 'processing', $5, NOW())`,
      [cmd1InboundId, cmd1InboundId, f.professionalPhone, `confirmar ${f.code}`, cmd1Tok]
    );

    const cmd2InboundId = randomUUID();
    const cmd2Tok = randomUUID();
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, processing_token, processing_started_at)
       VALUES ($1, 'test', $2, $3, $4, 'BR', 3, 'processing', $5, NOW())`,
      [cmd2InboundId, cmd2InboundId, f.professionalPhone, `contestar ${f.code}`, cmd2Tok]
    );

    const baseRecord = {
      provider: "test",
      countryCode: "BR",
      limitValue: 3,
      status: "processing" as const,
      processingStartedAt: new Date(),
      processedAt: null,
      failureReason: null,
      result: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      responseOutboundId: null,
      recoveryState: "none" as const,
      recoveryAction: "none" as const,
      quarantineReason: null,
      recoveryNextAttemptAt: null,
      recoveryAttemptCount: 0,
      recoveryStartedAt: null,
      contextualQueue: false,
    };

    const cmd1Record = {
      ...baseRecord,
      id: cmd1InboundId,
      providerMessageId: cmd1InboundId,
      phoneE164: f.professionalPhone,
      rawText: `confirmar ${f.code}`,
      processingToken: cmd1Tok,
    };

    const cmd2Record = {
      ...baseRecord,
      id: cmd2InboundId,
      providerMessageId: cmd2InboundId,
      phoneE164: f.professionalPhone,
      rawText: `contestar ${f.code}`,
      processingToken: cmd2Tok,
    };

    let cmd1Pid: number | null = null;
    let cmd2Pid: number | null = null;
    const cmd1Locked = createDeferred<void>();
    const allowCmd1Commit = createDeferred<void>();
    const cmd2Attempting = createDeferred<void>();

    f.repo.onAfterLockContact = async (db, contactId) => {
      if (contactId === f.contactId && !cmd1Pid) {
        const pidRes = await (db as unknown as { query: (sql: string) => Promise<{ rows: Array<{ pid: number }> }> }).query(
          "SELECT pg_backend_pid() as pid"
        );
        cmd1Pid = pidRes.rows[0].pid;
        cmd1Locked.resolve();
        await allowCmd1Commit.promise;
      }
    };

    f.repo.onBeforeLockContact = async (db, contactId) => {
      if (contactId === f.contactId && cmd1Pid) {
        const pidRes = await (db as unknown as { query: (sql: string) => Promise<{ rows: Array<{ pid: number }> }> }).query(
          "SELECT pg_backend_pid() as pid"
        );
        cmd2Pid = pidRes.rows[0].pid;
        cmd2Attempting.resolve();
      }
    };

    // Command 1 from professional: confirmar
    const cmd1Promise = f.service.handle(cmd1Record);
    await cmd1Locked.promise;

    // Command 2 from same professional: contestar (conflicting command)
    const cmd2Promise = f.service.handle(cmd2Record);
    await cmd2Attempting.promise;

    // Prove Command 2 blocks on Command 1 via pg_blocking_pids
    await waitForBlockedPid(cmd2Pid!, cmd1Pid!);

    allowCmd1Commit.resolve();

    const [res1, res2] = await Promise.all([cmd1Promise, cmd2Promise]);
    assert.ok(res1);
    assert.ok(res2);
    assert.equal(res1.result.action, "confirmed");
    assert.equal(res2.result.action, "idempotent_replay");
    assert.match(res2.reply_text, /já foi concluída e não pode ser contestada/);

    // Final state is strictly confirmed, contact is completed
    const contact = await f.getContact();
    assert.equal(contact.status, "completed");

    const completion = await f.getCompletion();
    assert.equal(completion?.state, "confirmed");
    assert.equal(completion?.contested_at, null);

    // Exactly 2 events (customer declared, professional confirmed); zero contestation event!
    const events = await f.getEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0].action, "declared");
    assert.equal(events[1].action, "confirmed");
  } finally {
    f.repo.onBeforeLockContact = undefined;
    f.repo.onAfterLockContact = undefined;
    await f.cleanup();
  }
});

test("Scenario 13E: Deterministic concurrency Scenario E — same inbound replay concurrency produces exactly one logical effect", async () => {
  const f = await createFixture();
  try {
    const eInboundId = randomUUID();
    const eTok = randomUUID();
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, processing_token, processing_started_at)
       VALUES ($1, 'test', $2, $3, $4, 'BR', 3, 'processing', $5, NOW())`,
      [eInboundId, eInboundId, f.customerPhone, `concluído ${f.code}`, eTok]
    );

    const eRecord = {
      id: eInboundId,
      provider: "test",
      providerMessageId: eInboundId,
      phoneE164: f.customerPhone,
      rawText: `concluído ${f.code}`,
      countryCode: "BR",
      limitValue: 3,
      status: "processing" as const,
      processingToken: eTok,
      processingStartedAt: new Date(),
      processedAt: null,
      failureReason: null,
      result: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      responseOutboundId: null,
      recoveryState: "none" as const,
      recoveryAction: "none" as const,
      quarantineReason: null,
      recoveryNextAttemptAt: null,
      recoveryAttemptCount: 0,
      recoveryStartedAt: null,
      contextualQueue: false,
    };

    // Two concurrent executions of the identical claimed inbound record
    const [res1, res2] = await Promise.all([
      f.service.handle(eRecord),
      f.service.handle(eRecord),
    ]);

    assert.ok(res1);
    assert.ok(res2);

    // One must be the original execution (duplicate = false), the other must be the replay (duplicate = true)
    const duplicateFlags = [res1.duplicate, res2.duplicate].sort();
    assert.deepEqual(duplicateFlags, [false, true]);

    // Both return identical reply text and outbound id
    assert.equal(res1.reply_text, res2.reply_text);
    assert.equal(res1.outbound.id, res2.outbound.id);

    // Exactly one completion row created
    const completions = (await query("SELECT * FROM contact_completions WHERE contact_id = $1", [f.contactId])).rows;
    assert.equal(completions.length, 1);

    // Exactly one event created
    const events = await f.getEvents();
    assert.equal(events.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 13F: Multi-contact: Customer with multiple historical contacts targets exact public code without mutating other contacts", async () => {
  const f = await createFixture();
  const contact2 = await f.addContact("encanador", "pro-encanador");
  try {
    // Customer has contact 1 (f.code) and contact 2 (contact2.code)
    // Customer declares completion for contact 1 only
    const res = await f.send(`concluído ${f.code}`, f.customerPhone);
    assert.equal(res.result.action, "declared");

    // Contact 1 must be pending_confirmation
    const completion1 = await f.getCompletion();
    assert.equal(completion1?.state, "pending_confirmation");

    // Contact 2 must remain strictly shared with NO completion record
    const contact2Record = (await query<{ status: string }>("SELECT status FROM contacts WHERE id = $1", [contact2.id])).rows[0];
    assert.equal(contact2Record.status, "shared");
    const completion2 = (await query("SELECT * FROM contact_completions WHERE contact_id = $1", [contact2.id])).rows;
    assert.equal(completion2.length, 0);

    // Code resolution is exact: declaring for contact 2 targets contact 2 specifically
    const res2 = await f.send(`concluído ${contact2.code}`, f.customerPhone);
    assert.equal(res2.result.action, "declared");

    const completion2After = (await query<{ state: string }>("SELECT state FROM contact_completions WHERE contact_id = $1", [contact2.id])).rows[0];
    assert.equal(completion2After?.state, "pending_confirmation");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 13G: Multi-contact: Professional with multiple shared opportunities targets exact public code without affecting others", async () => {
  const f = await createFixture();
  // Professional Carlos has opportunity 1 (f.code) and opportunity 2 (contactB.code)
  const contactB = await f.addOpportunityForPro("marceneiro");
  try {
    // Customer 1 declares completion on opportunity 1
    await f.send(`concluído ${f.code}`, f.customerPhone);

    // Professional confirms opportunity 1
    const res = await f.send(`confirmar ${f.code}`, f.professionalPhone);
    assert.equal(res.result.action, "confirmed");

    // Opportunity 1 is completed
    const contact1 = await f.getContact();
    assert.equal(contact1.status, "completed");

    // Opportunity 2 must remain shared with no completion
    const contactBRecord = (await query<{ status: string }>("SELECT status FROM contacts WHERE id = $1", [contactB.id])).rows[0];
    assert.equal(contactBRecord.status, "shared");
    const completionB = (await query("SELECT * FROM contact_completions WHERE contact_id = $1", [contactB.id])).rows;
    assert.equal(completionB.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 13H: Decoupled context: Active search conversation changing after inbound claim does NOT fail completion with InboxContextChangedError", async () => {
  const f = await createFixture({ hasActiveSearch: true });
  try {
    // 1. Customer has shared contact A and active search conversation B
    const activeConv = (await query<{ status: string; pending_slot: string }>(
      "SELECT status, pending_slot FROM search_conversations WHERE id = $1",
      [f.activeConversationId]
    )).rows[0];
    assert.equal(activeConv.status, "active");

    // 2. Insert inbound completion message for contact A in 'processing' state with a stale context fingerprint
    const inboundId = randomUUID();
    const processingToken = randomUUID();
    await query(
      `INSERT INTO channel_inbound_messages (
         id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value,
         status, processing_token, processing_started_at, context_fingerprint
       )
       VALUES ($1, 'test', $2, $3, $4, 'BR', 3, 'processing', $5, NOW(), 'stale-search-fingerprint-before-change')`,
      [inboundId, inboundId, f.customerPhone, `concluído ${f.code}`, processingToken]
    );

    // 3. Search B changes concurrently after that claim (simulating user or system updating the active search)
    await query(
      "UPDATE search_conversations SET pending_slot = 'service', original_raw_text = 'alteração pós-claim' WHERE id = $1",
      [f.activeConversationId]
    );

    // 4. Contact completion service processes the claimed message
    const record = {
      id: inboundId,
      provider: "test",
      providerMessageId: inboundId,
      phoneE164: f.customerPhone,
      rawText: `concluído ${f.code}`,
      countryCode: "BR",
      limitValue: 3,
      status: "processing" as const,
      processingToken,
      processingStartedAt: new Date(),
      processedAt: null,
      failureReason: null,
      result: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      responseOutboundId: null,
      recoveryState: "none" as const,
      recoveryAction: "none" as const,
      quarantineReason: null,
      recoveryNextAttemptAt: null,
      recoveryAttemptCount: 0,
      recoveryStartedAt: null,
      contextualQueue: false,
      contextFingerprint: "stale-search-fingerprint-before-change",
    };

    const res = await f.service.handle(record);
    assert.ok(res);
    assert.equal(res.duplicate, false);
    assert.equal(res.result.action, "declared");

    // 5. Contact A successfully updated to pending_confirmation
    const completion = await f.getCompletion();
    assert.equal(completion?.state, "pending_confirmation");

    // 6. Search B remains untouched by the completion operation
    const activeConvAfter = (await query<{ status: string; pending_slot: string; original_raw_text: string }>(
      "SELECT status, pending_slot, original_raw_text FROM search_conversations WHERE id = $1",
      [f.activeConversationId]
    )).rows[0];
    assert.equal(activeConvAfter.status, "active");
    assert.equal(activeConvAfter.pending_slot, "service");
    assert.equal(activeConvAfter.original_raw_text, "alteração pós-claim");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 14: Contact completion events are immutable (P0026)", async () => {
  const f = await createFixture();
  try {
    await f.send(`concluido ${f.code}`, f.customerPhone);
    const events = await f.getEvents();
    assert.equal(events.length, 1);
    const eventId = events[0].id;

    // Attempt UPDATE on event must fail with P0026
    await assert.rejects(
      () => query("UPDATE contact_completion_events SET action = 'confirmed' WHERE id = $1", [eventId]),
      (err: unknown) => {
        const e = err as { code?: string; message?: string };
        return e.code === "P0026" && (e.message?.includes("CONTACT_COMPLETION_EVENT_IMMUTABLE") ?? false);
      }
    );

    // Attempt DELETE on event must fail with P0026
    await assert.rejects(
      () => query("DELETE FROM contact_completion_events WHERE id = $1", [eventId]),
      (err: unknown) => {
        const e = err as { code?: string; message?: string };
        return e.code === "P0026" && (e.message?.includes("CONTACT_COMPLETION_EVENT_IMMUTABLE") ?? false);
      }
    );
  } finally {
    await f.cleanup();
  }
});

test("Scenario 15: Migration 026 rollback is blocked with P0026 when completion data exists", async () => {
  const f = await createFixture();
  try {
    await f.send(`concluido ${f.code}`, f.customerPhone);

    await assert.rejects(
      () => rollbackThrough("026_add_contact_completions"),
      (err: unknown) => {
        const e = err as { stderr?: string; message?: string };
        const msg = String(e.stderr || e.message);
        return /CONTACT_COMPLETION_ROLLBACK_BLOCKED|P0026/u.test(msg);
      }
    );
  } finally {
    await f.cleanup();
  }
});
test("Scenario 16: Professional unavailability does NOT block completion; shared contact remains completion-eligible", async () => {
  const f = await createFixture();
  try {
    // Insert a professional_unavailability_events record for the contact
    const unavailInboundId = randomUUID();
    await query(
      `INSERT INTO channel_inbound_messages (id,provider,provider_message_id,phone_e164,raw_text,country_code,limit_value,status,processed_at,result)
       VALUES ($1::uuid,'test',$1::text,$2,'não consigo','BR',3,'processed',NOW(),'{}'::jsonb)`,
      [unavailInboundId, f.professionalPhone]
    );
    // Disable immutability trigger for fixture insertion
    await query("ALTER TABLE professional_unavailability_events DISABLE TRIGGER professional_unavailability_events_immutable");
    await query(
      `INSERT INTO professional_unavailability_events (contact_id,professional_id,inbound_id,origin,rule_version)
       VALUES ($1,$2,$3,'channel_inbox','connection-v2')`,
      [f.contactId, f.professionalId, unavailInboundId]
    );
    await query("ALTER TABLE professional_unavailability_events ENABLE TRIGGER professional_unavailability_events_immutable");

    // Contact still has status='shared' with an unavailability event
    const contactBefore = await f.getContact();
    assert.equal(contactBefore.status, "shared");
    const unavailCount = (await query<{ cnt: number }>("SELECT count(*)::integer AS cnt FROM professional_unavailability_events WHERE contact_id=$1", [f.contactId])).rows[0].cnt;
    assert.equal(unavailCount, 1);

    // Customer declares completion — must succeed despite unavailability event
    const declRes = await f.send(`concluído ${f.code}`, f.customerPhone);
    assert.equal(declRes.result.action, "declared", `Expected 'declared' but got '${declRes.result.action}': ${declRes.reply_text}`);
    assert.match(declRes.reply_text, /Aguardando confirmação/);

    const completion = await f.getCompletion();
    assert.ok(completion, "Completion aggregate must be created");
    assert.equal(completion.state, "pending_confirmation");

    // Professional confirms — must also succeed
    const confRes = await f.send(`confirmar ${f.code}`, f.professionalPhone);
    assert.equal(confRes.result.action, "confirmed");

    const contactAfter = await f.getContact();
    assert.equal(contactAfter.status, "completed");

    // Unavailability event still exists (immutable, not deleted)
    const unavailCountAfter = (await query<{ cnt: number }>("SELECT count(*)::integer AS cnt FROM professional_unavailability_events WHERE contact_id=$1", [f.contactId])).rows[0].cnt;
    assert.equal(unavailCountAfter, 1, "Unavailability event must remain after completion");
  } finally {
    // Clean up completion events and unavailability events before f.cleanup (which deletes inbound messages)
    await withTransaction(async (db) => {
      await db.query("UPDATE channel_outbound_messages SET completion_event_id = NULL WHERE completion_event_id IN (SELECT id FROM contact_completion_events WHERE contact_id = $1)", [f.contactId]);
      await db.query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
      await db.query("DELETE FROM contact_completion_events WHERE contact_id = $1", [f.contactId]);
      await db.query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
      await db.query("DELETE FROM contact_completions WHERE contact_id = $1", [f.contactId]);
      await db.query("ALTER TABLE professional_unavailability_events DISABLE TRIGGER professional_unavailability_events_immutable");
      await db.query("DELETE FROM professional_unavailability_events WHERE contact_id = $1", [f.contactId]);
      await db.query("ALTER TABLE professional_unavailability_events ENABLE TRIGGER professional_unavailability_events_immutable");
    });
    await f.cleanup();
  }
});

test("Scenario 17: Brazilian 8-digit degraded mobile sender recognizes professional and creates completion aggregate", async () => {
  // Real regression case: professional registered with canonical +5566999029086,
  // but Evolution API delivers inbound with degraded +556699029086.
  const canonicalProfPhone = "+5566999029086";
  const degradedProfPhone = "+556699029086";
  const f = await createFixture({ professionalPhone: canonicalProfPhone });
  try {
    const contact = await f.getContact();

    // Professional sends completion command using DEGRADED 8-digit phone (+556699029086)
    const result = await f.send(`Concluído ${contact.public_code}`, degradedProfPhone);

    // Assert: professional actor is recognized and completion aggregate is created
    assert.equal(result.result.action, "declared");
    assert.match(result.reply_text, /Aguardando confirmação do cliente/);

    const completion = await f.getCompletion();
    assert.ok(completion, "Completion aggregate must be created");
    assert.equal(completion.state, "pending_confirmation");
    assert.equal(completion.declared_by, "professional");

    const events = await f.getEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].actor_role, "professional");

    // Verify inbound message in DB was normalized to canonical +5566999029086
    const inbound = (await query<{ phone_e164: string }>(
      "SELECT phone_e164 FROM channel_inbound_messages WHERE id = $1",
      [result.message_id]
    )).rows[0];
    assert.equal(inbound.phone_e164, canonicalProfPhone);
  } finally {
    await withTransaction(async (db) => {
      await db.query("UPDATE channel_outbound_messages SET completion_event_id = NULL WHERE completion_event_id IN (SELECT id FROM contact_completion_events WHERE contact_id = $1)", [f.contactId]);
      await db.query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
      await db.query("DELETE FROM contact_completion_events WHERE contact_id = $1", [f.contactId]);
      await db.query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
      await db.query("DELETE FROM contact_completions WHERE contact_id = $1", [f.contactId]);
    });
    await f.cleanup();
  }
});

test("Scenario 18: Historical degraded customer phone in snapshot matches canonical customer confirmation", async () => {
  // Real bug reproduction:
  // Historical snapshot has customer_phone_e164 (degraded 8-digit)
  // Professional has canonical phone
  const sub = "9" + Math.floor(1000000 + Math.random() * 9000000).toString();
  const degradedCustomerPhone = `+5599${sub}`;
  const canonicalCustomerPhone = `+55999${sub}`;
  const canonicalProfPhone = `+556699${Math.floor(1000000 + Math.random() * 9000000)}`;

  const f = await createFixture({
    customerPhone: degradedCustomerPhone,
    professionalPhone: canonicalProfPhone,
  });

  try {
    const contact = await f.getContact();

    // 1. Professional declares completion: "Concluído CC-W98ZLLUP"
    const declRes = await f.send(`Concluído ${contact.public_code}`, canonicalProfPhone);
    assert.equal(declRes.result.action, "declared");
    assert.match(declRes.reply_text, /Aguardando confirmação do cliente/);

    const completionBefore = await f.getCompletion();
    assert.equal(completionBefore?.state, "pending_confirmation");
    assert.equal(completionBefore?.declared_by, "professional");

    // 2. Customer confirms completion using canonical phone: "confirmar CC-W98ZLLUP"
    const confRes = await f.send(`confirmar ${contact.public_code}`, canonicalCustomerPhone);
    assert.equal(confRes.result.action, "confirmed");
    assert.match(confRes.reply_text, /confirmada com sucesso/);

    // 3. Contact is now 'completed' and completion state is 'confirmed'
    const contactAfter = await f.getContact();
    assert.equal(contactAfter.status, "completed");

    const completionAfter = await f.getCompletion();
    assert.equal(completionAfter?.state, "confirmed");
    assert.ok(completionAfter?.confirmed_at !== null);

    const events = await f.getEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0].actor_role, "professional");
    assert.equal(events[0].action, "declared");
    assert.equal(events[1].actor_role, "customer");
    assert.equal(events[1].action, "confirmed");

    // Verify Regression F: counterpart outbound notification to customer was sent to canonical recipient
    const promptOutbound = (await query<{ recipient_phone_e164: string }>(
      "SELECT recipient_phone_e164 FROM channel_outbound_messages WHERE business_key = $1",
      [`contact:${f.contactId}:completion:prompt`]
    )).rows[0];
    assert.equal(promptOutbound?.recipient_phone_e164, canonicalCustomerPhone);

    const confirmedOutbound = (await query<{ recipient_phone_e164: string }>(
      "SELECT recipient_phone_e164 FROM channel_outbound_messages WHERE business_key = $1",
      [`contact:${f.contactId}:completion:confirmed`]
    )).rows[0];
    assert.equal(confirmedOutbound?.recipient_phone_e164, canonicalProfPhone);

    // Verify Regression G: historical snapshot itself is NOT rewritten
    const rawSnapshot = (await query<{ bilateral_snapshot: { customer_phone_e164: string } }>(
      "SELECT bilateral_snapshot FROM contacts WHERE id = $1",
      [f.contactId]
    )).rows[0];
    assert.equal(rawSnapshot.bilateral_snapshot.customer_phone_e164, degradedCustomerPhone);
  } finally {
    await withTransaction(async (db) => {
      await db.query("UPDATE channel_outbound_messages SET completion_event_id = NULL WHERE completion_event_id IN (SELECT id FROM contact_completion_events WHERE contact_id = $1)", [f.contactId]);
      await db.query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
      await db.query("DELETE FROM contact_completion_events WHERE contact_id = $1", [f.contactId]);
      await db.query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
      await db.query("DELETE FROM contact_completions WHERE contact_id = $1", [f.contactId]);
    });
    await f.cleanup();
  }
});

test("Scenario 19: Historical degraded customer phone in snapshot matches canonical customer contestation", async () => {
  const sub = "9" + Math.floor(1000000 + Math.random() * 9000000).toString();
  const degradedCustomerPhone = `+5599${sub}`;
  const canonicalCustomerPhone = `+55999${sub}`;
  const canonicalProfPhone = `+556699${Math.floor(1000000 + Math.random() * 9000000)}`;

  const f = await createFixture({
    customerPhone: degradedCustomerPhone,
    professionalPhone: canonicalProfPhone,
  });

  try {
    const contact = await f.getContact();

    // 1. Professional declares completion: "Concluído CC-..."
    const declRes = await f.send(`Concluído ${contact.public_code}`, canonicalProfPhone);
    assert.equal(declRes.result.action, "declared");

    // 2. Customer contests completion using canonical phone: "contestar CC-..."
    const contestRes = await f.send(`contestar ${contact.public_code}`, canonicalCustomerPhone);
    assert.equal(contestRes.result.action, "contested");
    assert.match(contestRes.reply_text, /A contestação da conclusão do serviço .* foi registrada/);

    // 3. Contact remains 'shared' and completion state is 'contested'
    const contactAfter = await f.getContact();
    assert.equal(contactAfter.status, "shared");

    const completionAfter = await f.getCompletion();
    assert.equal(completionAfter?.state, "contested");
    assert.ok(completionAfter?.contested_at !== null);

    const events = await f.getEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0].actor_role, "professional");
    assert.equal(events[0].action, "declared");
    assert.equal(events[1].actor_role, "customer");
    assert.equal(events[1].action, "contested");
  } finally {
    await withTransaction(async (db) => {
      await db.query("UPDATE channel_outbound_messages SET completion_event_id = NULL WHERE completion_event_id IN (SELECT id FROM contact_completion_events WHERE contact_id = $1)", [f.contactId]);
      await db.query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
      await db.query("DELETE FROM contact_completion_events WHERE contact_id = $1", [f.contactId]);
      await db.query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
      await db.query("DELETE FROM contact_completions WHERE contact_id = $1", [f.contactId]);
    });
    await f.cleanup();
  }
});

test("Scenario 20: Code-free completion declaration and confirmation with historical degraded snapshot phone", async () => {
  const sub = "9" + Math.floor(1000000 + Math.random() * 9000000).toString();
  const degradedCustomerPhone = `+5599${sub}`;
  const canonicalCustomerPhone = `+55999${sub}`;
  const canonicalProfPhone = `+556699${Math.floor(1000000 + Math.random() * 9000000)}`;

  const f = await createFixture({
    customerPhone: degradedCustomerPhone,
    professionalPhone: canonicalProfPhone,
  });

  try {
    // 1. Professional declares without code: "concluído" (single active contact)
    const declRes = await f.send("concluído", canonicalProfPhone);
    assert.equal(declRes.result.action, "declared");

    // 2. Customer confirms without code: "confirmar" (single pending completion)
    const confRes = await f.send("confirmar", canonicalCustomerPhone);
    assert.equal(confRes.result.action, "confirmed");

    const contactAfter = await f.getContact();
    assert.equal(contactAfter.status, "completed");
  } finally {
    await withTransaction(async (db) => {
      await db.query("UPDATE channel_outbound_messages SET completion_event_id = NULL WHERE completion_event_id IN (SELECT id FROM contact_completion_events WHERE contact_id = $1)", [f.contactId]);
      await db.query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
      await db.query("DELETE FROM contact_completion_events WHERE contact_id = $1", [f.contactId]);
      await db.query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
      await db.query("DELETE FROM contact_completions WHERE contact_id = $1", [f.contactId]);
    });
    await f.cleanup();
  }
});

