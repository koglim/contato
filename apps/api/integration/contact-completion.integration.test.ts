import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { channelInboundMessageResponseSchema } from "@contatocerto/shared";
import { buildApp } from "../src/app.js";
import { closeDatabaseConnection, query } from "../src/database/connection.js";
import { createOpportunityCode } from "../src/modules/bilateral-contact/bilateral-contact.policy.js";
import { rollbackThrough } from "./rollback-helper.js";

after(closeDatabaseConnection);

const internalKey = "contact-completion-integration-key";
const randomPhone = () => `+5565${Math.floor(100000000 + Math.random() * 899999999)}`;

type FixtureOptions = {
  status?: string;
  hasActiveSearch?: boolean;
  subscriptionRevoked?: boolean;
};

async function createFixture(options: FixtureOptions = {}) {
  const customerId = randomUUID();
  const professionalId = randomUUID();
  const searchId = randomUUID();
  const conversationId = randomUUID();
  const contactId = randomUUID();
  const choiceId = randomUUID();
  const code = createOpportunityCode();
  const customerPhone = randomPhone();
  const professionalPhone = randomPhone();
  const activeSearchId = randomUUID();
  const activeConversationId = randomUUID();

  const app = buildApp({ internalApiKey: internalKey });

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

  const contactStatus = options.status ?? "accepted";
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

  const usedPhones = new Set<string>([customerPhone, professionalPhone]);

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
       WHERE recipient_phone_e164 IN ($1, $2)
       ORDER BY created_at ASC`,
      [customerPhone, professionalPhone]
    );
    return res.rows;
  }

  async function cleanup() {
    const phones = Array.from(usedPhones);
    await query(
      "UPDATE channel_inbound_messages SET response_outbound_id = NULL WHERE phone_e164 = ANY($1)",
      [phones]
    );
    await query(
      "UPDATE channel_outbound_messages SET completion_event_id = NULL WHERE completion_event_id IN (SELECT id FROM contact_completion_events WHERE contact_id = $1)",
      [contactId]
    );
    await query(
      "DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 = ANY($1)",
      [phones]
    );
    await query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completion_events WHERE contact_id = $1", [contactId]);
    await query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completions WHERE contact_id = $1", [contactId]);
    await query("DELETE FROM contacts WHERE id = $1", [contactId]);
    if (subId) {
      await query("DELETE FROM professional_subscriptions WHERE id = $1", [subId]);
    }
    if (options.hasActiveSearch) {
      await query("DELETE FROM search_conversations WHERE id = $1", [activeConversationId]);
      await query("DELETE FROM search_requests WHERE id = $1", [activeSearchId]);
    }
    await query("DELETE FROM search_conversations WHERE id = $1", [conversationId]);
    await query("DELETE FROM search_requests WHERE id = $1", [searchId]);
    await query(
      `DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (
        SELECT id FROM channel_inbound_messages WHERE phone_e164 = ANY($1)
      )`,
      [phones]
    );
    await query("DELETE FROM channel_inbound_messages WHERE phone_e164 = ANY($1)", [phones]);
    await query("DELETE FROM professionals WHERE id = $1", [professionalId]);
    await query("DELETE FROM customers WHERE id = $1", [customerId]);
  }

  return {
    contactId,
    code,
    customerId,
    professionalId,
    customerPhone,
    professionalPhone,
    activeConversationId,
    send,
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
    assert.equal(contact1.status, "accepted"); // Still accepted until counterpart confirms!

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

test("Scenario 3: Counterpart contests completion -> contacts.status remains accepted and auditable dispute is recorded", async () => {
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

    // Contact status MUST REMAIN accepted
    const contact = await f.getContact();
    assert.equal(contact.status, "accepted");

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

test("Scenario 13: Deterministic concurrency - parallel customer and professional declarations serialize safely", async () => {
  const f = await createFixture();
  try {
    // Both customer and professional declare concurrently
    const [resCustomer, resProfessional] = await Promise.all([
      f.send(`concluido ${f.code}`, f.customerPhone),
      f.send(`concluido ${f.code}`, f.professionalPhone),
    ]);

    // One must be declared, the other confirmed! Or both result in confirmed!
    assert.ok(
      (resCustomer.result.action === "declared" && resProfessional.result.action === "confirmed") ||
      (resCustomer.result.action === "confirmed" && resProfessional.result.action === "declared")
    );

    const contact = await f.getContact();
    assert.equal(contact.status, "completed");

    const completion = await f.getCompletion();
    assert.equal(completion.state, "confirmed");

    const events = await f.getEvents();
    assert.equal(events.length, 2);
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
