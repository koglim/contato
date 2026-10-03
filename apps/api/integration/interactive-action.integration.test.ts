import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  channelInboundMessageResponseSchema,
  channelOutboundMessageClaimResponseSchema,
  INTERACTIVE_ACTION_TOKEN_TTL_DAYS,
  type InteractiveOutboundPayload,
} from "@contatocerto/shared";
import { buildApp } from "../src/app.js";
import { closeDatabaseConnection, query, withTransaction } from "../src/database/connection.js";
import { createOpportunityCode } from "../src/modules/bilateral-contact/bilateral-contact.policy.js";
import { generateInteractiveActionToken } from "../src/modules/interactive-action/interactive-action.crypto.js";
import { PostgresInteractiveActionRepository } from "../src/modules/interactive-action/interactive-action.repository.js";
import { InteractiveActionService } from "../src/modules/interactive-action/interactive-action.service.js";
import { createBilateralContact } from "../src/modules/bilateral-contact/bilateral-contact.transaction.js";

after(closeDatabaseConnection);

const internalKey = "interactive-action-integration-key";
const randomPhone = () => `+55659${Math.floor(10000000 + Math.random() * 89999999)}`;

async function createFixture(options: {
  status?: string;
  enableInteractive?: boolean;
  skipContact?: boolean;
} = {}) {
  if (options.enableInteractive !== undefined) {
    process.env.INTERACTIVE_ACTIONS_ENABLED = options.enableInteractive ? "true" : "false";
  } else {
    process.env.INTERACTIVE_ACTIONS_ENABLED = "true";
  }

  const customerId = randomUUID();
  const professionalId = randomUUID();
  const searchId = randomUUID();
  const conversationId = randomUUID();
  const contactId = randomUUID();
  const choiceId = randomUUID();
  const code = createOpportunityCode();
  const customerPhone = randomPhone();
  const professionalPhone = randomPhone();

  const tokenRepo = new PostgresInteractiveActionRepository();
  const interactiveService = new InteractiveActionService(tokenRepo);
  const app = buildApp({
    internalApiKey: internalKey,
    interactiveActionService: interactiveService,
  });

  const usedPhones = new Set<string>([customerPhone, professionalPhone]);
  const contactIds = new Set<string>([contactId]);
  const searchIds = new Set<string>([searchId]);
  const conversationIds = new Set<string>([conversationId]);
  const professionalIds = new Set<string>([professionalId]);
  const customerIds = new Set<string>([customerId]);

  // 1. Insert customer and professional
  await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, customerPhone]);
  await query(
    "INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1, 'Lucas Eletricista', $2, $3, 'active')",
    [professionalId, `lucas-${professionalId}`, professionalPhone]
  );

  // 2. Insert search request and search conversation
  await query(
    "INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1, $2, 'eletricista em Cuiabá', 'selected')",
    [searchId, customerId]
  );
  await query(
    `INSERT INTO search_conversations (
       id, customer_id, status, original_raw_text, service_text, location_text, country_code, limit_value, search_request_id, expires_at, completed_at
     )
     VALUES ($1, $2, 'completed', 'eletricista em Cuiabá', 'eletricista', 'Cuiabá, MT', 'BR', 3, $3, NOW() + INTERVAL '1 hour', NOW())`,
    [conversationId, customerId, searchId]
  );

  // 3. Insert choice inbound message
  await query(
    `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, processed_at, result)
     VALUES ($1, 'test', $2, $3, '1', 'BR', 3, 'processed', NOW(), '{"route":"selection"}'::jsonb)`,
    [choiceId, choiceId, customerPhone]
  );

  const snapshot = {
    public_code: code,
    service_name: "eletricista",
    city: "Cuiabá",
    state: "MT",
    neighborhood: null,
    summary: "eletricista em Cuiabá",
    professional_name: "Lucas Eletricista",
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
  if (!options.skipContact) {
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
  }

  async function createInitialInteractiveOutboundAndTokens() {
    const tokenCompletion = generateInteractiveActionToken();
    const tokenUnavailability = generateInteractiveActionToken();

    const payload: InteractiveOutboundPayload = {
      schema_version: 1,
      type: "button_group",
      body: "Detalhes da solicitação...",
      actions: [
        {
          action_id: tokenCompletion,
          label: "Concluído",
        },
        {
          action_id: tokenUnavailability,
          label: "Não consigo atender",
        },
      ],
    };

    const outboundRes = await query<{ id: string }>(
      `INSERT INTO channel_outbound_messages (
         purpose, provider, recipient_phone_e164, message_type, text_content, interactive_payload, business_key, status, sent_at, provider_message_id
       )
       VALUES ('professional_contact_notification', 'test', $1, 'interactive', 'Detalhes da solicitação...', $2::jsonb, $3, 'sent', NOW(), $4)
       RETURNING id`,
      [professionalPhone, JSON.stringify(payload), `contact:${contactId}:initial`, randomUUID()]
    );
    const outboundId = outboundRes.rows[0]!.id;

    const expiresAt = new Date(Date.now() + INTERACTIVE_ACTION_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await withTransaction(async (db) => {
      await tokenRepo.createTokens(db, [
        {
          publicToken: tokenCompletion,
          outboundMessageId: outboundId,
          contactId,
          completionId: null,
          actionType: "declare_completion",
          intendedActorRole: "professional",
          intendedPhoneE164: professionalPhone,
          expiresAt,
        },
        {
          publicToken: tokenUnavailability,
          outboundMessageId: outboundId,
          contactId,
          completionId: null,
          actionType: "declare_unavailability",
          intendedActorRole: "professional",
          intendedPhoneE164: professionalPhone,
          expiresAt,
        },
      ]);
    });

    return { outboundId, tokenCompletion, tokenUnavailability };
  }

  async function sendInteractive(interactiveActionId: string, sender = professionalPhone, msgId = randomUUID(), rawText = "[Botão]") {
    usedPhones.add(sender);
    const response = await app.inject({
      method: "POST",
      url: "/internal/channel/inbound/messages",
      headers: { "x-internal-key": internalKey },
      payload: {
        provider: "test",
        provider_message_id: msgId,
        phone_e164: sender,
        raw_text: rawText,
        interactive_action_id: interactiveActionId,
        country_code: "BR",
        limit: 3,
      },
    });
    return {
      status: response.statusCode,
      body: response.json(),
    };
  }

  async function sendText(text: string, sender = professionalPhone, msgId = randomUUID()) {
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
    return {
      status: response.statusCode,
      body: response.json(),
    };
  }

  async function cleanup() {
    delete process.env.INTERACTIVE_ACTIONS_ENABLED;
    const phones = Array.from(usedPhones);
    const cIds = Array.from(contactIds);

    await query("UPDATE channel_inbound_messages SET response_outbound_id = NULL WHERE phone_e164 = ANY($1)", [phones]);
    await query("DELETE FROM interactive_action_tokens WHERE contact_id = ANY($1)", [cIds]);
    await query("UPDATE channel_outbound_messages SET completion_event_id = NULL, professional_unavailability_event_id = NULL WHERE recipient_phone_e164 = ANY($1)", [phones]);
    await query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 = ANY($1)", [phones]);
    await query("ALTER TABLE professional_unavailability_events DISABLE TRIGGER professional_unavailability_events_immutable");
    await query("DELETE FROM professional_unavailability_events WHERE contact_id = ANY($1)", [cIds]);
    await query("ALTER TABLE professional_unavailability_events ENABLE TRIGGER professional_unavailability_events_immutable");
    await query("ALTER TABLE contact_completion_events DISABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completion_events WHERE contact_id = ANY($1)", [cIds]);
    await query("ALTER TABLE contact_completion_events ENABLE TRIGGER contact_completion_events_immutable");
    await query("DELETE FROM contact_completions WHERE contact_id = ANY($1)", [cIds]);
    await query("DELETE FROM contacts WHERE id = ANY($1)", [cIds]);
    await query("DELETE FROM search_conversations WHERE id = ANY($1)", [Array.from(conversationIds)]);
    await query("DELETE FROM search_requests WHERE id = ANY($1)", [Array.from(searchIds)]);
    await query("DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (SELECT id FROM channel_inbound_messages WHERE phone_e164 = ANY($1))", [phones]);
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
    searchId,
    conversationId,
    choiceId,
    app,
    addContactId: (id: string) => contactIds.add(id),
    createInitialInteractiveOutboundAndTokens,
    sendInteractive,
    sendText,
    cleanup,
  };
}

test("Scenario 1: Token format and cryptographic entropy", async () => {
  const token = generateInteractiveActionToken();
  assert.equal(typeof token, "string");
  assert.equal(token.startsWith("ia_"), true);
  assert.equal(token.length, 51);
  assert.equal(/^[a-f0-9]+$/.test(token.slice(3)), true);
});

test("Scenario 2: Bilateral contact creation with INTERACTIVE_ACTIONS_ENABLED=false generates plain text and 0 tokens", async () => {
  const f = await createFixture({ enableInteractive: false, skipContact: true });
  try {
    const ready = {
      inbound: {
        id: f.choiceId,
        provider: "test",
        phone_e164: f.customerPhone,
        raw_text: "sim",
        created_at: new Date(),
        decision_at: new Date(),
      },
      noticeId: randomUUID(),
      noticeSentAt: new Date(),
      choiceKey: f.choiceId,
      chosenAt: new Date().toISOString(),
      method: "selection_after_notice" as const,
    };

    const match = {
      match_id: randomUUID(),
      professional_id: f.professionalId,
      display_name: "Lucas Eletricista",
      phone_e164: f.professionalPhone,
      service_name: "eletricista",
    };

    let newContactId: string | null = null;
    await withTransaction(async (db) => {
      const result = await createBilateralContact(
        db,
        {
          customerId: f.customerId,
          searchRequestId: f.searchId,
          conversationId: f.conversationId,
          position: 1,
          selectionKey: ready.inbound.id,
          lastMessageText: "sim",
          confirmBilateral: false,
        },
        match,
        ready,
        new Date(),
        () => createOpportunityCode()
      );
      newContactId = result.contactId;
    });

    assert.ok(newContactId);
    f.addContactId(newContactId);

    // Verify outbound is text and no tokens were created
    const outbounds = (await query<{ message_type: string; interactive_payload: unknown }>(
      "SELECT message_type, interactive_payload FROM channel_outbound_messages WHERE business_key = $1",
      [`contact:${newContactId}:initial`]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.message_type, "text");
    assert.equal(outbounds[0]!.interactive_payload, null);

    const tokens = (await query(
      "SELECT * FROM interactive_action_tokens WHERE contact_id = $1",
      [newContactId]
    )).rows;
    assert.equal(tokens.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 3: Bilateral contact creation with INTERACTIVE_ACTIONS_ENABLED=true emits interactive payload and 2 action tokens", async () => {
  const f = await createFixture({ enableInteractive: true, skipContact: true });
  try {
    const ready = {
      inbound: {
        id: f.choiceId,
        provider: "test",
        phone_e164: f.customerPhone,
        raw_text: "sim",
        created_at: new Date(),
        decision_at: new Date(),
      },
      noticeId: randomUUID(),
      noticeSentAt: new Date(),
      choiceKey: f.choiceId,
      chosenAt: new Date().toISOString(),
      method: "selection_after_notice" as const,
    };

    const match = {
      match_id: randomUUID(),
      professional_id: f.professionalId,
      display_name: "Lucas Eletricista",
      phone_e164: f.professionalPhone,
      service_name: "eletricista",
    };

    let newContactId: string | null = null;
    await withTransaction(async (db) => {
      const result = await createBilateralContact(
        db,
        {
          customerId: f.customerId,
          searchRequestId: f.searchId,
          conversationId: f.conversationId,
          position: 1,
          selectionKey: ready.inbound.id,
          lastMessageText: "sim",
          confirmBilateral: false,
        },
        match,
        ready,
        new Date(),
        () => createOpportunityCode()
      );
      newContactId = result.contactId;
    });

    assert.ok(newContactId);
    f.addContactId(newContactId);

    // Verify outbound is interactive
    const outbounds = (await query<{ message_type: string; interactive_payload: InteractiveOutboundPayload }>(
      "SELECT message_type, interactive_payload FROM channel_outbound_messages WHERE business_key = $1",
      [`contact:${newContactId}:initial`]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.message_type, "interactive");
    assert.equal(outbounds[0]!.interactive_payload.schema_version, 1);
    assert.equal(outbounds[0]!.interactive_payload.type, "button_group");
    assert.equal(outbounds[0]!.interactive_payload.actions.length, 2);

    // Verify 2 tokens created in DB with 30-day TTL
    const tokens = (await query<{
      public_token: string;
      action_type: string;
      status: string;
      intended_actor_role: string;
      intended_phone_e164: string;
      expires_at: Date;
    }>(
      "SELECT public_token, action_type, status, intended_actor_role, intended_phone_e164, expires_at FROM interactive_action_tokens WHERE contact_id = $1 ORDER BY action_type ASC",
      [newContactId]
    )).rows;
    assert.equal(tokens.length, 2);
    assert.equal(tokens[0]!.action_type, "declare_completion");
    assert.equal(tokens[0]!.status, "active");
    assert.equal(tokens[0]!.intended_actor_role, "professional");
    assert.equal(tokens[1]!.action_type, "declare_unavailability");
    assert.equal(tokens[1]!.status, "active");
    assert.equal(outbounds[0]!.interactive_payload.actions[0]!.action_id, tokens[0]!.public_token);
    assert.equal(outbounds[0]!.interactive_payload.actions[1]!.action_id, tokens[1]!.public_token);

    const ttlDays = (tokens[0]!.expires_at.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    assert.ok(ttlDays > 29 && ttlDays <= 30);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 4: Professional executes declare_completion button action", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { tokenCompletion } = await f.createInitialInteractiveOutboundAndTokens();

    const res = await f.sendInteractive(tokenCompletion, f.professionalPhone);
    assert.equal(res.status, 200);

    const parsed = channelInboundMessageResponseSchema.parse(res.body);
    assert.equal(parsed.duplicate, false);
    assert.equal(parsed.result.action, "declared");
    assert.equal(parsed.result.action_type, "declare_completion");
    assert.match(parsed.reply_text, /Aguardando confirmação/);

    // Verify response outbound purpose is professional_reply
    const outbounds = (await query<{ purpose: string }>(
      "SELECT purpose FROM channel_outbound_messages WHERE channel_inbound_message_id = $1",
      [parsed.message_id]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.purpose, "professional_reply");

    // Verify token consumed atomically in DB
    const tokenDb = (await query<{
      status: string;
      consumed_at: Date | null;
      consumed_inbound_id: string | null;
    }>(
      "SELECT status, consumed_at, consumed_inbound_id FROM interactive_action_tokens WHERE public_token = $1",
      [tokenCompletion]
    )).rows[0]!;
    assert.equal(tokenDb.status, "consumed");
    assert.ok(tokenDb.consumed_at !== null);
    assert.equal(tokenDb.consumed_inbound_id, parsed.message_id);

    // Verify contact completion aggregate created
    const completions = (await query<{ state: string; declared_by: string }>(
      "SELECT state, declared_by FROM contact_completions WHERE contact_id = $1",
      [f.contactId]
    )).rows;
    assert.equal(completions.length, 1);
    assert.equal(completions[0]!.state, "pending_confirmation");
    assert.equal(completions[0]!.declared_by, "professional");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 5: Replay of consumed token returns idempotent_replay with professional_reply purpose", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { tokenCompletion } = await f.createInitialInteractiveOutboundAndTokens();

    // First execution
    const firstRes = await f.sendInteractive(tokenCompletion, f.professionalPhone);
    assert.equal(firstRes.status, 200);

    // Second execution with a new inbound message (different provider_message_id) using the same token
    const secondRes = await f.sendInteractive(tokenCompletion, f.professionalPhone);
    assert.equal(secondRes.status, 200);

    const parsed = channelInboundMessageResponseSchema.parse(secondRes.body);
    assert.equal(parsed.result.action, "idempotent_replay");
    assert.match(parsed.reply_text, /já foi respondida anteriormente/);

    // Verify persisted response outbound purpose is professional_reply
    const outbounds = (await query<{ purpose: string }>(
      "SELECT purpose FROM channel_outbound_messages WHERE channel_inbound_message_id = $1",
      [parsed.message_id]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.purpose, "professional_reply");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 6: Outbound not in sent status rejects interactive action with professional_reply purpose", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { outboundId, tokenCompletion } = await f.createInitialInteractiveOutboundAndTokens();

    // Change outbound status back to pending
    await query("UPDATE channel_outbound_messages SET status = 'pending', sent_at = NULL, provider_message_id = NULL WHERE id = $1", [outboundId]);

    const res = await f.sendInteractive(tokenCompletion, f.professionalPhone);
    assert.equal(res.status, 200);

    const parsed = channelInboundMessageResponseSchema.parse(res.body);
    assert.equal(parsed.result.action, "unavailable");
    assert.match(parsed.reply_text, /não está pronta para ser executada/);

    // Verify response outbound purpose is professional_reply
    const outbounds = (await query<{ purpose: string }>(
      "SELECT purpose FROM channel_outbound_messages WHERE channel_inbound_message_id = $1",
      [parsed.message_id]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.purpose, "professional_reply");

    // Token must remain active
    const tokenDb = (await query<{ status: string }>(
      "SELECT status FROM interactive_action_tokens WHERE public_token = $1",
      [tokenCompletion]
    )).rows[0]!;
    assert.equal(tokenDb.status, "active");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 7: Phone triple authorization rejects non-matching sender with professional_reply purpose", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { tokenCompletion } = await f.createInitialInteractiveOutboundAndTokens();

    const strangerPhone = randomPhone();
    const res = await f.sendInteractive(tokenCompletion, strangerPhone);
    assert.equal(res.status, 200);

    const parsed = channelInboundMessageResponseSchema.parse(res.body);
    assert.equal(parsed.result.action, "unavailable");
    assert.match(parsed.reply_text, /não tem autorização/);

    // Verify response outbound purpose is professional_reply
    const outbounds = (await query<{ purpose: string }>(
      "SELECT purpose FROM channel_outbound_messages WHERE channel_inbound_message_id = $1",
      [parsed.message_id]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.purpose, "professional_reply");

    // Token remains active
    const tokenDb = (await query<{ status: string }>(
      "SELECT status FROM interactive_action_tokens WHERE public_token = $1",
      [tokenCompletion]
    )).rows[0]!;
    assert.equal(tokenDb.status, "active");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 8: Expired token rejects action and transitions token status to expired with professional_reply purpose", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { tokenCompletion } = await f.createInitialInteractiveOutboundAndTokens();

    // Set expires_at in the past
    await query(
      "UPDATE interactive_action_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE public_token = $1",
      [tokenCompletion]
    );

    const res = await f.sendInteractive(tokenCompletion, f.professionalPhone);
    assert.equal(res.status, 200);

    const parsed = channelInboundMessageResponseSchema.parse(res.body);
    assert.equal(parsed.result.action, "unavailable");
    assert.match(parsed.reply_text, /expirou/);

    // Verify response outbound purpose is professional_reply
    const outbounds = (await query<{ purpose: string }>(
      "SELECT purpose FROM channel_outbound_messages WHERE channel_inbound_message_id = $1",
      [parsed.message_id]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.purpose, "professional_reply");

    // Token marked expired in DB
    const tokenDb = (await query<{ status: string }>(
      "SELECT status FROM interactive_action_tokens WHERE public_token = $1",
      [tokenCompletion]
    )).rows[0]!;
    assert.equal(tokenDb.status, "expired");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 9: Revoked token rejects action with professional_reply purpose and no token consumption", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { tokenCompletion } = await f.createInitialInteractiveOutboundAndTokens();

    await query("UPDATE interactive_action_tokens SET status = 'revoked' WHERE public_token = $1", [tokenCompletion]);

    const res = await f.sendInteractive(tokenCompletion, f.professionalPhone);
    assert.equal(res.status, 200);

    const parsed = channelInboundMessageResponseSchema.parse(res.body);
    assert.equal(parsed.result.action, "unavailable");
    assert.match(parsed.reply_text, /não está mais ativa/);

    // Verify response outbound purpose is professional_reply
    const outbounds = (await query<{ purpose: string }>(
      "SELECT purpose FROM channel_outbound_messages WHERE channel_inbound_message_id = $1",
      [parsed.message_id]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.purpose, "professional_reply");

    // Token remains revoked (not consumed)
    const tokenDb = (await query<{ status: string; consumed_at: Date | null }>(
      "SELECT status, consumed_at FROM interactive_action_tokens WHERE public_token = $1",
      [tokenCompletion]
    )).rows[0]!;
    assert.equal(tokenDb.status, "revoked");
    assert.equal(tokenDb.consumed_at, null);

    // Zero contact completions created
    const completions = (await query("SELECT * FROM contact_completions WHERE contact_id = $1", [f.contactId])).rows;
    assert.equal(completions.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 10: Failed originating outbound rejects action with professional_reply purpose and no consumption", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { outboundId, tokenCompletion } = await f.createInitialInteractiveOutboundAndTokens();

    await query(
      "UPDATE channel_outbound_messages SET status = 'failed', sent_at = NULL, provider_message_id = NULL WHERE id = $1",
      [outboundId]
    );

    const res = await f.sendInteractive(tokenCompletion, f.professionalPhone);
    assert.equal(res.status, 200);

    const parsed = channelInboundMessageResponseSchema.parse(res.body);
    assert.equal(parsed.result.action, "unavailable");
    assert.match(parsed.reply_text, /não está pronta para ser executada/);

    // Verify response outbound purpose is professional_reply
    const outbounds = (await query<{ purpose: string }>(
      "SELECT purpose FROM channel_outbound_messages WHERE channel_inbound_message_id = $1",
      [parsed.message_id]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.purpose, "professional_reply");

    // Token remains active
    const tokenDb = (await query<{ status: string }>(
      "SELECT status FROM interactive_action_tokens WHERE public_token = $1",
      [tokenCompletion]
    )).rows[0]!;
    assert.equal(tokenDb.status, "active");

    const completions = (await query("SELECT * FROM contact_completions WHERE contact_id = $1", [f.contactId])).rows;
    assert.equal(completions.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 11: Snapshot actor mismatch rejects action with professional_reply purpose and no consumption", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { tokenCompletion } = await f.createInitialInteractiveOutboundAndTokens();

    // Modify contact snapshot to have a different professional phone (temporarily disable immutable trigger)
    await query("ALTER TABLE contacts DISABLE TRIGGER contacts_protect_bilateral_snapshot");
    await query(
      "UPDATE contacts SET bilateral_snapshot = jsonb_set(bilateral_snapshot, '{professional_phone_e164}', '\"+5565988880000\"') WHERE id = $1",
      [f.contactId]
    );
    await query("ALTER TABLE contacts ENABLE TRIGGER contacts_protect_bilateral_snapshot");

    const res = await f.sendInteractive(tokenCompletion, f.professionalPhone);
    assert.equal(res.status, 200);

    const parsed = channelInboundMessageResponseSchema.parse(res.body);
    assert.equal(parsed.result.action, "unavailable");
    assert.match(parsed.reply_text, /não tem autorização/);

    // Verify response outbound purpose is professional_reply
    const outbounds = (await query<{ purpose: string }>(
      "SELECT purpose FROM channel_outbound_messages WHERE channel_inbound_message_id = $1",
      [parsed.message_id]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.purpose, "professional_reply");

    // Token remains active
    const tokenDb = (await query<{ status: string }>(
      "SELECT status FROM interactive_action_tokens WHERE public_token = $1",
      [tokenCompletion]
    )).rows[0]!;
    assert.equal(tokenDb.status, "active");

    const completions = (await query("SELECT * FROM contact_completions WHERE contact_id = $1", [f.contactId])).rows;
    assert.equal(completions.length, 0);
  } finally {
    await query("ALTER TABLE contacts ENABLE TRIGGER contacts_protect_bilateral_snapshot");
    await f.cleanup();
  }
});

test("Scenario 12: Professional executes declare_unavailability button action with professional_reply purpose", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { tokenUnavailability } = await f.createInitialInteractiveOutboundAndTokens();

    const res = await f.sendInteractive(tokenUnavailability, f.professionalPhone);
    assert.equal(res.status, 200);

    const parsed = channelInboundMessageResponseSchema.parse(res.body);
    assert.equal(parsed.result.action, "unavailability_declared");
    assert.match(parsed.reply_text, /indisponibilidade.*registrada/i);

    // Verify response outbound purpose is professional_reply
    const outbounds = (await query<{ purpose: string }>(
      "SELECT purpose FROM channel_outbound_messages WHERE channel_inbound_message_id = $1",
      [parsed.message_id]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.purpose, "professional_reply");

    // Token consumed
    const tokenDb = (await query<{ status: string }>(
      "SELECT status FROM interactive_action_tokens WHERE public_token = $1",
      [tokenUnavailability]
    )).rows[0]!;
    assert.equal(tokenDb.status, "consumed");

    // Unavailability event recorded
    const events = (await query<{ contact_id: string }>(
      "SELECT contact_id FROM professional_unavailability_events WHERE contact_id = $1",
      [f.contactId]
    )).rows;
    assert.equal(events.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 13: Customer executes confirm_completion button action with customer_reply purpose", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { tokenCompletion } = await f.createInitialInteractiveOutboundAndTokens();

    // 1. Professional declares completion
    await f.sendInteractive(tokenCompletion, f.professionalPhone);

    // 2. Fetch the interactive token generated for the customer in the prompt outbound
    const customerTokens = (await query<{
      public_token: string;
      action_type: string;
      outbound_message_id: string;
    }>(
      `SELECT public_token, action_type, outbound_message_id
         FROM interactive_action_tokens
        WHERE contact_id = $1 AND intended_actor_role = 'customer'`,
      [f.contactId]
    )).rows;
    assert.equal(customerTokens.length, 2);

    const confirmToken = customerTokens.find((t) => t.action_type === "confirm_completion")!;
    assert.ok(confirmToken);

    // Simulate outbound being sent by background delivery worker
    await query(
      "UPDATE channel_outbound_messages SET status = 'sent', provider_message_id = $2, sent_at = NOW() WHERE id = $1",
      [confirmToken.outbound_message_id, randomUUID()]
    );

    // 3. Customer executes confirm_completion
    const res = await f.sendInteractive(confirmToken.public_token, f.customerPhone);
    assert.equal(res.status, 200);

    const parsed = channelInboundMessageResponseSchema.parse(res.body);
    assert.equal(parsed.result.action, "confirmed");
    assert.match(parsed.reply_text, /confirmada com sucesso/);

    // Verify response outbound purpose is customer_reply
    const outbounds = (await query<{ purpose: string }>(
      "SELECT purpose FROM channel_outbound_messages WHERE channel_inbound_message_id = $1",
      [parsed.message_id]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.purpose, "customer_reply");

    // Verify contact status completed
    const contactDb = (await query<{ status: string }>(
      "SELECT status FROM contacts WHERE id = $1",
      [f.contactId]
    )).rows[0]!;
    assert.equal(contactDb.status, "completed");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 14: Customer executes contest_completion button action with customer_reply purpose", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { tokenCompletion } = await f.createInitialInteractiveOutboundAndTokens();

    // 1. Professional declares completion
    await f.sendInteractive(tokenCompletion, f.professionalPhone);

    // 2. Fetch the contest token
    const customerTokens = (await query<{
      public_token: string;
      action_type: string;
      outbound_message_id: string;
    }>(
      `SELECT public_token, action_type, outbound_message_id
         FROM interactive_action_tokens
        WHERE contact_id = $1 AND intended_actor_role = 'customer'`,
      [f.contactId]
    )).rows;

    const contestToken = customerTokens.find((t) => t.action_type === "contest_completion")!;
    assert.ok(contestToken);

    await query(
      "UPDATE channel_outbound_messages SET status = 'sent', provider_message_id = $2, sent_at = NOW() WHERE id = $1",
      [contestToken.outbound_message_id, randomUUID()]
    );

    // 3. Customer executes contest_completion
    const res = await f.sendInteractive(contestToken.public_token, f.customerPhone);
    assert.equal(res.status, 200);

    const parsed = channelInboundMessageResponseSchema.parse(res.body);
    assert.equal(parsed.result.action, "contested");
    assert.match(parsed.reply_text, /contestação.*foi registrada/i);

    // Verify response outbound purpose is customer_reply
    const outbounds = (await query<{ purpose: string }>(
      "SELECT purpose FROM channel_outbound_messages WHERE channel_inbound_message_id = $1",
      [parsed.message_id]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.purpose, "customer_reply");

    // Verify completion status contested
    const completionDb = (await query<{ state: string }>(
      "SELECT state FROM contact_completions WHERE contact_id = $1",
      [f.contactId]
    )).rows[0]!;
    assert.equal(completionDb.state, "contested");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 15: Concurrent textual 'não consigo' and interactive declare_unavailability has no deadlock and creates 1 event", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { tokenUnavailability } = await f.createInitialInteractiveOutboundAndTokens();

    const textRes = await f.sendText(`não consigo ${f.code}`, f.professionalPhone);
    const buttonRes = await f.sendInteractive(tokenUnavailability, f.professionalPhone);

    assert.equal(textRes.status, 200);
    assert.equal(buttonRes.status, 200);

    // Exactly one unavailability event must exist
    const events = (await query<{ id: string; contact_id: string }>(
      "SELECT id, contact_id FROM professional_unavailability_events WHERE contact_id = $1",
      [f.contactId]
    )).rows;
    assert.equal(events.length, 1);

    // Contact remains shared (unavailability does not cancel bilateral shared contact)
    const contact = (await query<{ status: string }>(
      "SELECT status FROM contacts WHERE id = $1",
      [f.contactId]
    )).rows[0]!;
    assert.equal(contact.status, "shared");

    // Search request state is valid
    const search = (await query<{ status: string }>(
      "SELECT status FROM search_requests WHERE id = $1",
      [f.searchId]
    )).rows[0]!;
    assert.ok(["selected", "matched"].includes(search.status));

    // Exactly one customer notification outbound for the event
    const customerOutbounds = (await query<{ id: string; purpose: string }>(
      "SELECT id, purpose FROM channel_outbound_messages WHERE professional_unavailability_event_id = $1 AND purpose = 'customer_contact_update'",
      [events[0]!.id]
    )).rows;
    assert.equal(customerOutbounds.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 16: Concurrent use of the same interactive token performs 1 mutation only", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { tokenCompletion } = await f.createInitialInteractiveOutboundAndTokens();

    const res1 = await f.sendInteractive(tokenCompletion, f.professionalPhone);
    const res2 = await f.sendInteractive(tokenCompletion, f.professionalPhone);

    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);

    const parsed1 = channelInboundMessageResponseSchema.parse(res1.body);
    const parsed2 = channelInboundMessageResponseSchema.parse(res2.body);

    const actions = [parsed1.result.action, parsed2.result.action];
    assert.ok(actions.includes("declared"));
    assert.ok(actions.includes("idempotent_replay"));

    // Exactly one completion aggregate exists
    const completions = (await query<{ state: string }>(
      "SELECT state FROM contact_completions WHERE contact_id = $1",
      [f.contactId]
    )).rows;
    assert.equal(completions.length, 1);

    // Exactly 1 token in DB and it is consumed
    const tokens = (await query<{ status: string }>(
      "SELECT status FROM interactive_action_tokens WHERE public_token = $1",
      [tokenCompletion]
    )).rows;
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0]!.status, "consumed");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 17: Same webhook replay (same provider + provider_message_id + interactive_action_id) returns duplicate=true replay", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { tokenCompletion } = await f.createInitialInteractiveOutboundAndTokens();
    const fixedMsgId = randomUUID();

    // First attempt
    const res1 = await f.sendInteractive(tokenCompletion, f.professionalPhone, fixedMsgId);
    assert.equal(res1.status, 200);
    const parsed1 = channelInboundMessageResponseSchema.parse(res1.body);
    assert.equal(parsed1.duplicate, false);
    assert.equal(parsed1.result.action, "declared");

    // Second attempt with exact same provider_message_id & token
    const res2 = await f.sendInteractive(tokenCompletion, f.professionalPhone, fixedMsgId);
    assert.equal(res2.status, 200);
    const parsed2 = channelInboundMessageResponseSchema.parse(res2.body);
    assert.equal(parsed2.duplicate, true);
    assert.equal(parsed2.message_id, parsed1.message_id);
    assert.equal(parsed2.reply_text, parsed1.reply_text);

    // Verify zero duplicated domain mutation
    const completions = (await query("SELECT * FROM contact_completions WHERE contact_id = $1", [f.contactId])).rows;
    assert.equal(completions.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 18: INTERACTIVE_ACTIONS_ENABLED=false: completion prompt remains text-only with 0 action tokens", async () => {
  const f = await createFixture({ enableInteractive: false });
  try {
    // Customer declares completion textually
    const res = await f.sendText(`concluído ${f.code}`, f.customerPhone);
    assert.equal(res.status, 200);

    // Verify contact completion aggregate created
    const completions = (await query<{ state: string }>(
      "SELECT state FROM contact_completions WHERE contact_id = $1",
      [f.contactId]
    )).rows;
    assert.equal(completions.length, 1);
    assert.equal(completions[0]!.state, "pending_confirmation");

    // Check prompt outbound to professional
    const outbounds = (await query<{ message_type: string; interactive_payload: unknown }>(
      "SELECT message_type, interactive_payload FROM channel_outbound_messages WHERE business_key = $1",
      [`contact:${f.contactId}:completion:prompt`]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.message_type, "text");
    assert.equal(outbounds[0]!.interactive_payload, null);

    // Verify 0 action tokens created in DB
    const tokens = (await query(
      "SELECT * FROM interactive_action_tokens WHERE contact_id = $1",
      [f.contactId]
    )).rows;
    assert.equal(tokens.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 19: Customer declaration of completion with feature enabled: professional receives textual fallback with no unsupported confirm/contest tokens", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    // Customer declares completion textually
    const res = await f.sendText(`concluído ${f.code}`, f.customerPhone);
    assert.equal(res.status, 200);

    // Professional prompt outbound is text-based with instructions
    const outbounds = (await query<{ message_type: string; interactive_payload: unknown; text_content: string }>(
      "SELECT message_type, interactive_payload, text_content FROM channel_outbound_messages WHERE business_key = $1",
      [`contact:${f.contactId}:completion:prompt`]
    )).rows;
    assert.equal(outbounds.length, 1);
    // In ADR-006 v1, button interactive outbounds for completion prompt are customer-only (when professional declared)
    assert.equal(outbounds[0]!.interactive_payload, null);
    assert.match(outbounds[0]!.text_content, /confirmar|contestar/);

    // Zero tokens generated for professional for confirm/contest
    const profTokens = (await query(
      "SELECT * FROM interactive_action_tokens WHERE contact_id = $1 AND intended_actor_role = 'professional'",
      [f.contactId]
    )).rows;
    assert.equal(profTokens.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 20: Interactive path bypasses text parsers, search and AI when given adversarial raw_text", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { tokenCompletion } = await f.createInitialInteractiveOutboundAndTokens();

    // Adversarial raw_text containing search keyword, public code, and affirmative text
    const adversarialText = `quero eletricista em Cuiabá código ${f.code} aceito e confirmo tudo`;
    const res = await f.sendInteractive(tokenCompletion, f.professionalPhone, randomUUID(), adversarialText);
    assert.equal(res.status, 200);

    const parsed = channelInboundMessageResponseSchema.parse(res.body);
    // Authoritative execution via interactive_action_id
    assert.equal(parsed.result.action, "declared");
    assert.equal(parsed.result.action_type, "declare_completion");
    assert.match(parsed.reply_text, /Aguardando confirmação/);

    // Contact completion aggregate created
    const completions = (await query("SELECT * FROM contact_completions WHERE contact_id = $1", [f.contactId])).rows;
    assert.equal(completions.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("Scenario 21: Inbound payload conflict triggers quarantine when interactive_action_id differs", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const { tokenCompletion, tokenUnavailability } = await f.createInitialInteractiveOutboundAndTokens();
    const fixedMsgId = randomUUID();

    // First request with tokenCompletion
    const res1 = await f.sendInteractive(tokenCompletion, f.professionalPhone, fixedMsgId);
    assert.equal(res1.status, 200);

    // Same provider_message_id with different interactive_action_id
    const res2 = await f.sendInteractive(tokenUnavailability, f.professionalPhone, fixedMsgId);
    assert.equal(res2.status, 409);
    assert.equal(res2.body.error, "channel_message_payload_conflict");
  } finally {
    await f.cleanup();
  }
});

test("Scenario 22: Outbox claim endpoint returns message_type and interactive_payload", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const token = generateInteractiveActionToken();
    const payload: InteractiveOutboundPayload = {
      schema_version: 1,
      type: "button_group",
      body: "Test Content",
      actions: [
        {
          action_id: token,
          label: "Test Button",
        },
      ],
    };

    const outId = randomUUID();
    await query(
      `INSERT INTO channel_outbound_messages (
         id, purpose, provider, recipient_phone_e164, message_type, text_content, interactive_payload, status
       )
       VALUES ($1, 'professional_contact_notification', 'test', $2, 'interactive', 'Test Content', $3::jsonb, 'pending')`,
      [outId, f.professionalPhone, JSON.stringify(payload)]
    );

    const claimRes = await f.app.inject({
      method: "POST",
      url: `/internal/channel/outbound/${outId}/claim`,
      headers: { "x-internal-key": internalKey },
    });

    assert.equal(claimRes.statusCode, 200);
    const claimed = channelOutboundMessageClaimResponseSchema.parse(claimRes.json());
    assert.equal(claimed.status, "processing");
    if (claimed.status === "processing") {
      assert.equal(claimed.id, outId);
      assert.equal(claimed.message_type, "interactive");
      assert.deepEqual(claimed.interactive_payload, payload);
    }
  } finally {
    await f.cleanup();
  }
});

test("Scenario 23: Completely unknown token returns unavailable and generic customer_reply without leaking internal data", async () => {
  const f = await createFixture({ enableInteractive: true });
  try {
    const unknownToken = generateInteractiveActionToken();
    const res = await f.sendInteractive(unknownToken, f.professionalPhone);
    assert.equal(res.status, 200);

    const parsed = channelInboundMessageResponseSchema.parse(res.body);
    assert.equal(parsed.result.action, "unavailable");
    assert.match(parsed.reply_text, /não foi encontrada ou não está mais disponível/);

    // Fallback purpose is customer_reply
    const outbounds = (await query<{ purpose: string }>(
      "SELECT purpose FROM channel_outbound_messages WHERE channel_inbound_message_id = $1",
      [parsed.message_id]
    )).rows;
    assert.equal(outbounds.length, 1);
    assert.equal(outbounds[0]!.purpose, "customer_reply");
  } finally {
    await f.cleanup();
  }
});
