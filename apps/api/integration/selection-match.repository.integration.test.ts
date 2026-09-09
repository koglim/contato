import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDatabaseConnection, query } from "../src/database/connection.js";
import { PostgresSelectionMatchRepository } from "../src/modules/match-selection/match-selection.repository.js";
import { PostgresCustomerRepository } from "../src/modules/customers/customer.repository.js";
import { PostgresSearchConversationRepository } from "../src/modules/search-conversations/search-conversation.repository.js";
import { DefaultSelectionCommandService } from "../src/modules/selection-command/selection-command.service.js";
import { PostgresGlobalConversationCommandRepository } from "../src/modules/global-conversation-commands/global-conversation-command.repository.js";
import { DefaultGlobalConversationCommandService } from "../src/modules/global-conversation-commands/global-conversation-command.service.js";
import { DefaultCustomerSearchRouter } from "../src/modules/customer-search/customer-search.service.js";
import { DefaultChannelInboxService } from "../src/modules/channel-inbox/channel-inbox.service.js";
import { PostgresChannelInboundMessageRepository } from "../src/modules/channel-inbox/channel-inbox.repository.js";
import { PostgresChannelOutboundMessageRepository } from "../src/modules/channel-outbox/channel-outbox.repository.js";
import { DefaultMessagePresenter } from "../src/modules/message-presentation/message-presentation.service.js";
import { BILATERAL_NOTICE, BILATERAL_NOTICE_VERSION } from "../src/modules/bilateral-contact/bilateral-contact.policy.js";

type Fixture = {
  customerId: string;
  customerPhone: string;
  firstProfessionalPhone: string;
  secondProfessionalPhone: string;
  conversationId: string;
  searchRequestId: string;
  matchIds: [string, string];
  shownAt: [Date, Date];
  inboundKey: (text: string) => Promise<string>;
  cleanup: () => Promise<void>;
};

function phoneFromId(id: string) {
  const digits = BigInt(`0x${id.replaceAll("-", "").slice(0, 12)}`).toString().padStart(12, "0");
  return `+55${digits[0] === "0" ? `1${digits.slice(1)}` : digits}`;
}

async function createFixture(legacy = false): Promise<Fixture> {
  const customerId = randomUUID();
  const categoryId = randomUUID();
  const serviceId = randomUUID();
  const searchRequestId = randomUUID();
  const conversationId = randomUUID();
  const firstProfessionalId = randomUUID();
  const secondProfessionalId = randomUUID();
  const firstMatchId = randomUUID();
  const secondMatchId = randomUUID();
  const firstProfessionalServiceId = randomUUID();
  const secondProfessionalServiceId = randomUUID();
  const customerPhone = phoneFromId(customerId);
  const firstProfessionalPhone = phoneFromId(firstProfessionalId);
  const secondProfessionalPhone = phoneFromId(secondProfessionalId);

  await query(`INSERT INTO customers (id, phone_e164) VALUES ($1, $2)`, [customerId, customerPhone]);
  await query(`INSERT INTO service_categories (id, name, slug) VALUES ($1, $2, $3)`, [categoryId, "Teste", `teste-${categoryId}`]);
  await query(`INSERT INTO services (id, category_id, name, slug) VALUES ($1, $2, $3, $4)`, [serviceId, categoryId, "Eletricista", `eletricista-${serviceId}`]);
  await query(
    `INSERT INTO professionals (id, display_name, slug, phone_e164)
     VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
    [
      firstProfessionalId, "Ana Eletricista", `ana-${firstProfessionalId}`, firstProfessionalPhone,
      secondProfessionalId, "Bia Eletricista", `bia-${secondProfessionalId}`, secondProfessionalPhone,
    ],
  );
  await query(
    `INSERT INTO professional_services (id, professional_id, service_id, price_mode, price_from_cents)
     VALUES ($1, $2, $3, 'from', 10000), ($4, $5, $3, 'from', 12000)`,
    [firstProfessionalServiceId, firstProfessionalId, serviceId, secondProfessionalServiceId, secondProfessionalId],
  );
  await query(
    `INSERT INTO search_requests (id, customer_id, raw_text, service_id, status)
     VALUES ($1, $2, $3, $4, 'matched')`,
    [searchRequestId, customerId, "preciso de eletricista", serviceId],
  );
  await query(
    `INSERT INTO search_conversations (
       id, customer_id, status, pending_slot, original_raw_text, service_text,
       country_code, limit_value, search_request_id, expires_at
     ) VALUES ($1, $2, 'active', 'selection', $3, $4, 'BR', 2, $5, NOW() + INTERVAL '1 hour')`,
    [conversationId, customerId, "preciso de eletricista", "eletricista", searchRequestId],
  );
  const matches = await query<{ id: string; shown_at: Date }>(
    `INSERT INTO matches (id, search_request_id, professional_id, rank_position, shown_at)
     VALUES ($1, $2, $3, 1, NOW()), ($4, $2, $5, 2, NOW())
     RETURNING id, shown_at`,
    [firstMatchId, searchRequestId, firstProfessionalId, secondMatchId, secondProfessionalId],
  );
  const presentationInbound = await new PostgresChannelInboundMessageRepository().createOrFind({
    provider: "bilateral-fixture", provider_message_id: randomUUID(), phone_e164: customerPhone,
    raw_text: "preciso de eletricista", country_code: "BR", limit: 2,
  });
  await query("UPDATE channel_inbound_messages SET customer_id = $2, conversation_id = $3, search_request_id = $4 WHERE id = $1",
    [presentationInbound.record.id, customerId, conversationId, searchRequestId]);
  const presentation = await query<{ id: string }>(`INSERT INTO channel_outbound_messages
    (channel_inbound_message_id, provider, recipient_phone_e164, text_content, status, sent_at, bilateral_notice_version, provider_message_id)
    VALUES ($1, 'bilateral-fixture', $4, $2, 'sent', NOW(), $3, 'fixture-sent') RETURNING id`,
  [presentationInbound.record.id, legacy ? "1. Ana 2. Bia" : `1. Ana 2. Bia\n${BILATERAL_NOTICE}`, legacy ? null : BILATERAL_NOTICE_VERSION, customerPhone]);
  await query(`INSERT INTO channel_outbound_message_matches (channel_outbound_message_id, match_id)
    VALUES ($1, $2), ($1, $3)`, [presentation.rows[0].id, firstMatchId, secondMatchId]);

  return {
    customerId,
    customerPhone,
    firstProfessionalPhone,
    secondProfessionalPhone,
    conversationId,
    searchRequestId,
    matchIds: [firstMatchId, secondMatchId],
    shownAt: [matches.rows[0]!.shown_at, matches.rows[1]!.shown_at],
    inboundKey: async (text) => (await new PostgresChannelInboundMessageRepository().createOrFind({ provider: "bilateral-fixture",
      provider_message_id: randomUUID(), phone_e164: customerPhone, raw_text: text, country_code: "BR", limit: 2 })).record.id,
    cleanup: async () => {
      await query(`DELETE FROM channel_outbound_messages WHERE business_key IN
        (SELECT 'contact:' || id || ':initial' FROM contacts WHERE search_request_id = $1)`, [searchRequestId]);
      await query("DELETE FROM channel_inbound_messages WHERE phone_e164 = $1", [customerPhone]);
      await query(`DELETE FROM contacts WHERE search_request_id = $1`, [searchRequestId]);
      await query(`DELETE FROM matches WHERE search_request_id = $1`, [searchRequestId]);
      await query(`DELETE FROM search_conversations WHERE id = $1`, [conversationId]);
      await query(`DELETE FROM search_requests WHERE id = $1`, [searchRequestId]);
      await query(`DELETE FROM professional_services WHERE id = $1 OR id = $2`, [firstProfessionalServiceId, secondProfessionalServiceId]);
      await query(`DELETE FROM professionals WHERE id = $1 OR id = $2`, [firstProfessionalId, secondProfessionalId]);
      await query(`DELETE FROM services WHERE id = $1`, [serviceId]);
      await query(`DELETE FROM service_categories WHERE id = $1`, [categoryId]);
      await query(`DELETE FROM customers WHERE id = $1`, [customerId]);
    },
  };
}

test("selectShownMatch serializes concurrent selections in PostgreSQL", { concurrency: false }, async () => {
  const fixture = await createFixture();
  const repository = new PostgresSelectionMatchRepository();
  try {
    const firstKey = await fixture.inboundKey("quero o primeiro");
    const secondKey = await fixture.inboundKey("quero o segundo");
    const outcomes = await Promise.all([
      repository.selectShownMatch({ ...fixture, position: 1, lastMessageText: "quero o primeiro", selectionKey: firstKey }),
      repository.selectShownMatch({ ...fixture, position: 2, lastMessageText: "quero o segundo", selectionKey: secondKey }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.kind === "selected").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.kind === "conversation_not_active").length, 1);

    const state = await query<{
      contact_count: number | string;
      selected_count: number | string;
      unselected_count: number | string;
      search_status: string;
      conversation_status: string;
      pending_slot: string | null;
      conversation_search_request_id: string | null;
      first_shown_at: Date;
      second_shown_at: Date;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM contacts WHERE search_request_id = $1) AS contact_count,
         (SELECT COUNT(*) FROM matches WHERE search_request_id = $1 AND selected_at IS NOT NULL) AS selected_count,
         (SELECT COUNT(*) FROM matches WHERE search_request_id = $1 AND selected_at IS NULL) AS unselected_count,
         search_requests.status AS search_status,
         search_conversations.status AS conversation_status,
         search_conversations.pending_slot,
         search_conversations.search_request_id AS conversation_search_request_id,
         (SELECT shown_at FROM matches WHERE id = $3) AS first_shown_at,
         (SELECT shown_at FROM matches WHERE id = $4) AS second_shown_at
       FROM search_requests
       JOIN search_conversations ON search_conversations.id = $2
      WHERE search_requests.id = $1`,
      [fixture.searchRequestId, fixture.conversationId, fixture.matchIds[0], fixture.matchIds[1]],
    );
    const row = state.rows[0]!;
    assert.equal(Number(row.contact_count), 1);
    assert.equal(Number(row.selected_count), 1);
    assert.equal(Number(row.unselected_count), 1);
    assert.equal(row.search_status, "selected");
    assert.equal(row.conversation_status, "completed");
    assert.equal(row.pending_slot, null);
    assert.equal(row.conversation_search_request_id, fixture.searchRequestId);
    assert.equal(row.first_shown_at.getTime(), fixture.shownAt[0].getTime());
    assert.equal(row.second_shown_at.getTime(), fixture.shownAt[1].getTime());
  } finally {
    await fixture.cleanup();
  }
});

test("selectShownMatch rolls back every prior write when contact insertion fails", { concurrency: false }, async () => {
  const fixture = await createFixture();
  const repository = new PostgresSelectionMatchRepository();
  try {
    await query(`
      CREATE FUNCTION fail_selection_contact_insert() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'intentional selection contact failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_selection_contact_insert
        BEFORE INSERT ON contacts
        FOR EACH ROW EXECUTE FUNCTION fail_selection_contact_insert();
    `);
    await assert.rejects(
      repository.selectShownMatch({ ...fixture, position: 1, lastMessageText: "quero o primeiro", selectionKey: await fixture.inboundKey("quero o primeiro") }),
      /intentional selection contact failure/u,
    );
    const state = await query<{
      contact_count: number | string;
      selected_count: number | string;
      search_status: string;
      conversation_status: string;
      pending_slot: string | null;
      completed_at: Date | null;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM contacts WHERE search_request_id = $1) AS contact_count,
         (SELECT COUNT(*) FROM matches WHERE search_request_id = $1 AND selected_at IS NOT NULL) AS selected_count,
         search_requests.status AS search_status,
         search_conversations.status AS conversation_status,
         search_conversations.pending_slot,
         search_conversations.completed_at
       FROM search_requests
       JOIN search_conversations ON search_conversations.id = $2
      WHERE search_requests.id = $1`,
      [fixture.searchRequestId, fixture.conversationId],
    );
    const row = state.rows[0]!;
    assert.equal(Number(row.contact_count), 0);
    assert.equal(Number(row.selected_count), 0);
    assert.equal(row.search_status, "matched");
    assert.equal(row.conversation_status, "active");
    assert.equal(row.pending_slot, "selection");
    assert.equal(row.completed_at, null);
  } finally {
    await query(`DROP TRIGGER IF EXISTS fail_selection_contact_insert ON contacts`);
    await query(`DROP FUNCTION IF EXISTS fail_selection_contact_insert()`);
    await fixture.cleanup();
  }
});

test("selectShownMatch replays a completed selection key without changing persisted state", { concurrency: false }, async () => {
  const fixture = await createFixture();
  const repository = new PostgresSelectionMatchRepository();
  const selectionKey = await fixture.inboundKey("quero o primeiro");
  try {
    const original = await repository.selectShownMatch({ ...fixture, position: 1, lastMessageText: "quero o primeiro", selectionKey });
    assert.equal(original.kind, "selected");
    if (original.kind !== "selected") return;
    const replay = await repository.selectShownMatch({ ...fixture, position: 1, lastMessageText: "quero o primeiro", selectionKey });
    assert.equal(replay.kind, "selected");
    if (replay.kind !== "selected") return;
    assert.equal(replay.replayed, true);
    assert.equal(replay.contactId, original.contactId);
    assert.equal(replay.matchId, original.matchId);
    assert.equal(replay.selectedAt.getTime(), original.selectedAt.getTime());
    const recovered = await repository.findSelectedByCustomerAndSelectionKey(fixture.customerId, selectionKey);
    assert.equal(recovered?.contactId, original.contactId);
    assert.equal(recovered?.matchId, original.matchId);
    assert.equal(recovered?.replayed, true);

    const state = await query<{
      contact_count: number | string;
      selected_count: number | string;
      selected_at: Date;
      conversation_status: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM contacts WHERE search_request_id = $1) AS contact_count,
         (SELECT COUNT(*) FROM matches WHERE search_request_id = $1 AND selected_at IS NOT NULL) AS selected_count,
         (SELECT selected_at FROM matches WHERE id = $2) AS selected_at,
         (SELECT status FROM search_conversations WHERE id = $3) AS conversation_status`,
      [fixture.searchRequestId, original.matchId, fixture.conversationId],
    );
    assert.equal(Number(state.rows[0]!.contact_count), 1);
    assert.equal(Number(state.rows[0]!.selected_count), 1);
    assert.equal(state.rows[0]!.selected_at.getTime(), original.selectedAt.getTime());
    assert.equal(state.rows[0]!.conversation_status, "completed");

    assert.deepEqual(
      await repository.selectShownMatch({ ...fixture, customerId: randomUUID(), position: 1, lastMessageText: "quero o primeiro", selectionKey }),
      { kind: "idempotency_conflict" },
    );
    assert.equal(Number((await query<{ count: number | string }>(`SELECT COUNT(*) AS count FROM contacts WHERE search_request_id = $1`, [fixture.searchRequestId])).rows[0]!.count), 1);
  } finally {
    await fixture.cleanup();
  }
});

test("channel inbox selects by professional name and replays the same inbound safely", { concurrency: false }, async () => {
  const fixture = await createFixture();
  const selectionRepository = new PostgresSelectionMatchRepository();
  let routerCalls = 0;
  const router = new DefaultCustomerSearchRouter(
    new PostgresCustomerRepository(),
    new PostgresSearchConversationRepository(),
    { async start() { throw new Error("search must not start during selection"); }, async continueConversation() { throw new Error("search must not continue during selection"); } } as never,
    new DefaultSelectionCommandService({ selectionMatchRepository: selectionRepository }),
    new DefaultGlobalConversationCommandService(new PostgresGlobalConversationCommandRepository()),
  );
  const countedRouter = { async route(input: Parameters<typeof router.route>[0]) { routerCalls += 1; return router.route(input); } };
  const inbox = new DefaultChannelInboxService(
    new PostgresChannelInboundMessageRepository(), countedRouter, { processingLeaseSeconds: 60 },
    new DefaultMessagePresenter(), new PostgresChannelOutboundMessageRepository(),
  );
  const providerMessageId = `selection-${randomUUID()}`;
  const input = { provider: "test", provider_message_id: providerMessageId, phone_e164: fixture.customerPhone, raw_text: "Ana Eletricista", country_code: "BR", limit: 2 };
  try {
    const first = await inbox.receive(input);
    assert.equal(first.kind, "response");
    if (first.kind !== "response") return;
    assert.match(first.response.reply_text, new RegExp(fixture.firstProfessionalPhone.replace("+", "\\+"), "u"));
    assert.equal(first.response.reply_text.includes(input.phone_e164), false);
    assert.equal(first.response.reply_text.includes(fixture.matchIds[0]), false);
    const duplicate = await inbox.receive(input);
    assert.equal(duplicate.kind, "response");
    if (duplicate.kind !== "response") return;
    assert.equal(duplicate.response.duplicate, true);
    assert.equal(duplicate.response.outbound.id, first.response.outbound.id);
    assert.equal(duplicate.response.reply_text, first.response.reply_text);
    assert.equal(routerCalls, 1);
    const state = await query<{ contacts: string; outbounds: string; status: string; purpose: string }>(
      `SELECT (SELECT COUNT(*) FROM contacts WHERE search_request_id = $1) AS contacts,
              (SELECT COUNT(*) FROM channel_outbound_messages WHERE channel_inbound_message_id = $2) AS outbounds,
              (SELECT status FROM channel_inbound_messages WHERE provider = 'test' AND provider_message_id = $3) AS status,
              (SELECT purpose::text FROM channel_outbound_messages WHERE channel_inbound_message_id = $2) AS purpose`,
      [fixture.searchRequestId, first.response.message_id, providerMessageId],
    );
    assert.equal(Number(state.rows[0]!.contacts), 1);
    assert.equal(Number(state.rows[0]!.outbounds), 1);
    assert.equal((await bilateralCounts(fixture)).notifications, 1);
    const recoveredAgain = await selectionRepository.findSelectedByCustomerAndSelectionKey(fixture.customerId, first.response.message_id);
    assert.equal(recoveredAgain?.replayed, true);
    assert.equal(state.rows[0]!.status, "processed");
    assert.equal(state.rows[0]!.purpose, "customer_reply");
  } finally {
    await query(`DELETE FROM channel_outbound_messages WHERE channel_inbound_message_id IN (SELECT id FROM channel_inbound_messages WHERE provider = 'test' AND provider_message_id = $1)`, [providerMessageId]);
    await query(`DELETE FROM channel_inbound_messages WHERE provider = 'test' AND provider_message_id = $1`, [providerMessageId]);
    await fixture.cleanup();
  }
});

test("channel inbox keeps questions active, then selects by name idempotently", { concurrency: false }, async () => {
  const fixture = await createFixture();
  const selectionRepository = new PostgresSelectionMatchRepository();
  const router = new DefaultCustomerSearchRouter(
    new PostgresCustomerRepository(),
    new PostgresSearchConversationRepository(),
    { async start() { throw new Error("search must not start during selection"); }, async continueConversation() { throw new Error("search must not continue during selection"); } } as never,
    new DefaultSelectionCommandService({ selectionMatchRepository: selectionRepository }),
    new DefaultGlobalConversationCommandService(new PostgresGlobalConversationCommandRepository()),
  );
  const inbox = new DefaultChannelInboxService(
    new PostgresChannelInboundMessageRepository(), router, { processingLeaseSeconds: 60 },
    new DefaultMessagePresenter(), new PostgresChannelOutboundMessageRepository(),
  );
  const questionProviderMessageId = `selection-question-${randomUUID()}`;
  const selectionProviderMessageId = `selection-affirmative-${randomUUID()}`;
  const question = { provider: "test", provider_message_id: questionProviderMessageId, phone_e164: fixture.customerPhone, raw_text: "A Ana atende domingo?", country_code: "BR", limit: 2 };
  const selection = { ...question, provider_message_id: selectionProviderMessageId, raw_text: "Ana" };
  try {
    const questionResult = await inbox.receive(question);
    assert.equal(questionResult.kind, "response");
    if (questionResult.kind !== "response") return;
    assert.match(questionResult.response.reply_text, /Não consegui identificar/u);
    assert.equal(Number((await query<{ count: string }>(`SELECT COUNT(*) AS count FROM contacts WHERE search_request_id = $1`, [fixture.searchRequestId])).rows[0]!.count), 0);
    assert.equal((await query<{ status: string; pending_slot: string }>(`SELECT status, pending_slot FROM search_conversations WHERE id = $1`, [fixture.conversationId])).rows[0]!.status, "active");

    const selected = await inbox.receive(selection);
    assert.equal(selected.kind, "response");
    if (selected.kind !== "response") return;
    assert.match(selected.response.reply_text, /Ana Eletricista/u);
    assert.equal(selected.response.duplicate, false);
    assert.equal(Number((await query<{ count: string }>(`SELECT COUNT(*) AS count FROM contacts WHERE search_request_id = $1`, [fixture.searchRequestId])).rows[0]!.count), 1);

    const replay = await inbox.receive(selection);
    assert.equal(replay.kind, "response");
    if (replay.kind !== "response") return;
    assert.equal(replay.response.duplicate, true);
    assert.equal(Number((await query<{ count: string }>(`SELECT COUNT(*) AS count FROM channel_outbound_messages WHERE channel_inbound_message_id = $1`, [replay.response.message_id])).rows[0]!.count), 1);
  } finally {
    await query(`DELETE FROM channel_outbound_messages WHERE channel_inbound_message_id IN (SELECT id FROM channel_inbound_messages WHERE provider_message_id IN ($1, $2))`, [questionProviderMessageId, selectionProviderMessageId]);
    await query(`DELETE FROM channel_inbound_messages WHERE provider_message_id IN ($1, $2)`, [questionProviderMessageId, selectionProviderMessageId]);
    await fixture.cleanup();
  }
});

test("channel inbox keeps an inconsistent name and position from creating a contact", { concurrency: false }, async () => {
  const fixture = await createFixture();
  const selectionRepository = new PostgresSelectionMatchRepository();
  const router = new DefaultCustomerSearchRouter(
    new PostgresCustomerRepository(), new PostgresSearchConversationRepository(),
    { async start() { throw new Error("search must not start during selection"); }, async continueConversation() { throw new Error("search must not continue during selection"); } } as never,
    new DefaultSelectionCommandService({ selectionMatchRepository: selectionRepository }),
    new DefaultGlobalConversationCommandService(new PostgresGlobalConversationCommandRepository()),
  );
  const inbox = new DefaultChannelInboxService(
    new PostgresChannelInboundMessageRepository(), router, { processingLeaseSeconds: 60 },
    new DefaultMessagePresenter(), new PostgresChannelOutboundMessageRepository(),
  );
  const inconsistentId = `selection-inconsistent-${randomUUID()}`;
  const validId = `selection-consistent-${randomUUID()}`;
  const inconsistent = { provider: "test", provider_message_id: inconsistentId, phone_e164: fixture.customerPhone, raw_text: "Ana opção 2", country_code: "BR", limit: 2 };
  const valid = { ...inconsistent, provider_message_id: validId, raw_text: "Ana opção 1" };
  try {
    const rejected = await inbox.receive(inconsistent);
    assert.equal(rejected.kind, "response");
    if (rejected.kind !== "response") return;
    assert.match(rejected.response.reply_text, /Não consegui identificar/u);
    assert.equal(rejected.response.duplicate, false);
    assert.equal(Number((await query<{ count: string }>(`SELECT COUNT(*) AS count FROM contacts WHERE search_request_id = $1`, [fixture.searchRequestId])).rows[0]!.count), 0);

    const selected = await inbox.receive(valid);
    assert.equal(selected.kind, "response");
    if (selected.kind !== "response") return;
    assert.equal(selected.response.duplicate, false);
    assert.match(selected.response.reply_text, /Ana Eletricista/u);

    const replay = await inbox.receive(valid);
    assert.equal(replay.kind, "response");
    if (replay.kind !== "response") return;
    assert.equal(replay.response.duplicate, true);
    assert.equal(Number((await query<{ count: string }>(`SELECT COUNT(*) AS count FROM contacts WHERE search_request_id = $1`, [fixture.searchRequestId])).rows[0]!.count), 1);
  } finally {
    await query(`DELETE FROM channel_outbound_messages WHERE channel_inbound_message_id IN (SELECT id FROM channel_inbound_messages WHERE provider_message_id IN ($1, $2))`, [inconsistentId, validId]);
    await query(`DELETE FROM channel_inbound_messages WHERE provider_message_id IN ($1, $2)`, [inconsistentId, validId]);
    await fixture.cleanup();
  }
});

test("channel inbox recovers a completed selection after a crash before inbound processing", { concurrency: false }, async () => {
  const fixture = await createFixture();
  const selectionRepository = new PostgresSelectionMatchRepository();
  const inboundRepository = new PostgresChannelInboundMessageRepository();
  const providerMessageId = `crash-selection-${randomUUID()}`;
  const input = { provider: "test", provider_message_id: providerMessageId, phone_e164: fixture.customerPhone, raw_text: "1", country_code: "BR", limit: 2 };
  const registered = await inboundRepository.createOrFind(input);
  const selected = await selectionRepository.selectShownMatch({ ...fixture, position: 1, lastMessageText: "1", selectionKey: registered.record.id });
  assert.equal(selected.kind, "selected");
  let searchCalls = 0;
  const router = new DefaultCustomerSearchRouter(
    new PostgresCustomerRepository(), new PostgresSearchConversationRepository(),
    { async start() { searchCalls += 1; throw new Error("search must not start"); }, async continueConversation() { searchCalls += 1; throw new Error("search must not continue"); } } as never,
    new DefaultSelectionCommandService({ selectionMatchRepository: selectionRepository }),
    new DefaultGlobalConversationCommandService(new PostgresGlobalConversationCommandRepository()),
  );
  const inbox = new DefaultChannelInboxService(inboundRepository, router, { processingLeaseSeconds: 60 }, new DefaultMessagePresenter(), new PostgresChannelOutboundMessageRepository());
  try {
    const stateBefore = await query<{ status: string; contacts: string; outbounds: string }>(
      `SELECT (SELECT status FROM channel_inbound_messages WHERE id = $1) AS status,
              (SELECT COUNT(*) FROM contacts WHERE search_request_id = $2) AS contacts,
              (SELECT COUNT(*) FROM channel_outbound_messages WHERE channel_inbound_message_id = $1) AS outbounds`,
      [registered.record.id, fixture.searchRequestId],
    );
    assert.equal(stateBefore.rows[0]!.status, "received");
    assert.equal(Number(stateBefore.rows[0]!.contacts), 1);
    assert.equal(Number(stateBefore.rows[0]!.outbounds), 1, "customer response is now committed atomically with selection");
    const replayed = await inbox.receive(input);
    assert.equal(replayed.kind, "response");
    if (replayed.kind !== "response") return;
    assert.match(replayed.response.reply_text, /Ana Eletricista/u);
    assert.equal(searchCalls, 0);
    const state = await query<{ status: string; contacts: string; outbounds: string }>(
      `SELECT (SELECT status FROM channel_inbound_messages WHERE id = $1) AS status,
              (SELECT COUNT(*) FROM contacts WHERE search_request_id = $2) AS contacts,
              (SELECT COUNT(*) FROM channel_outbound_messages WHERE channel_inbound_message_id = $1) AS outbounds`,
      [registered.record.id, fixture.searchRequestId],
    );
    assert.equal(state.rows[0]!.status, "processed");
    assert.equal(Number(state.rows[0]!.contacts), 1);
    assert.equal(Number(state.rows[0]!.outbounds), 1);
    const linkage = (await query<{ conversation_id: string; search_request_id: string }>(
      "SELECT conversation_id, search_request_id FROM channel_inbound_messages WHERE id = $1", [registered.record.id])).rows[0];
    assert.deepEqual(linkage, { conversation_id: fixture.conversationId, search_request_id: fixture.searchRequestId });
    assert.equal((await bilateralCounts(fixture)).notifications, 1);
  } finally {
    await query(`DELETE FROM channel_outbound_messages WHERE channel_inbound_message_id = $1`, [registered.record.id]);
    await query(`DELETE FROM channel_inbound_messages WHERE id = $1`, [registered.record.id]);
    await fixture.cleanup();
  }
});

after(async () => {
  await closeDatabaseConnection();
});

function bilateralChannel(fixture: Pick<Fixture, "customerPhone">, repository = new PostgresSelectionMatchRepository()) {
  let searchCalls = 0;
  const router = new DefaultCustomerSearchRouter(new PostgresCustomerRepository(), new PostgresSearchConversationRepository(),
    { async start() { searchCalls += 1; throw new Error("unexpected search start"); },
      async continueConversation() { searchCalls += 1; throw new Error("unexpected search continuation"); } },
    new DefaultSelectionCommandService({ selectionMatchRepository: repository }),
    new DefaultGlobalConversationCommandService(new PostgresGlobalConversationCommandRepository()));
  const inbox = new DefaultChannelInboxService(new PostgresChannelInboundMessageRepository(), router,
    { processingLeaseSeconds: 60 }, new DefaultMessagePresenter(), new PostgresChannelOutboundMessageRepository());
  const receive = (rawText: string, providerMessageId = randomUUID()) => inbox.receive({ provider: "bilateral-test",
    provider_message_id: providerMessageId, phone_e164: fixture.customerPhone, raw_text: rawText, country_code: "BR", limit: 2 });
  return { receive, searchCalls: () => searchCalls };
}

async function markFixtureMessageSent(id: string) {
  const repository = new PostgresChannelOutboundMessageRepository();
  const token = randomUUID();
  assert.ok(await repository.claim(id, token, 60));
  assert.equal(await repository.markSent(id, { processing_token: token, provider_message_id: randomUUID() }), true);
}

async function bilateralCounts(fixture: Fixture) {
  const result = await query<{ contacts: number; notifications: number; selected: number; status: string; pending_slot: string | null }>(`SELECT
    (SELECT COUNT(*)::int FROM contacts WHERE search_request_id = $1) contacts,
    (SELECT COUNT(*)::int FROM channel_outbound_messages WHERE business_key IN
      (SELECT 'contact:' || id || ':initial' FROM contacts WHERE search_request_id = $1)) notifications,
    (SELECT COUNT(*)::int FROM matches WHERE search_request_id = $1 AND selected_at IS NOT NULL) selected,
    status, pending_slot FROM search_conversations WHERE id = $2`, [fixture.searchRequestId, fixture.conversationId]);
  return result.rows[0];
}

test("bilateral same inbound concurrent selection creates one contact and two immutable intentions", async () => {
  const fixture = await createFixture();
  try {
    const repository = new PostgresSelectionMatchRepository();
    const input = { ...fixture, position: 1, lastMessageText: "1", selectionKey: await fixture.inboundKey("1") };
    const outcomes = await Promise.all([repository.selectShownMatch(input), repository.selectShownMatch(input)]);
    assert.equal(outcomes.filter((outcome) => outcome.kind === "selected").length, 2);
    assert.equal(outcomes.filter((outcome) => outcome.kind === "selected" && outcome.replayed).length, 1);
    assert.deepEqual(await bilateralCounts(fixture), { contacts: 1, notifications: 1, selected: 1, status: "completed", pending_slot: null });
    assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE channel_inbound_message_id = $1", [input.selectionKey])).rows.length, 1);
  } finally { await fixture.cleanup(); }
});

test("bilateral distinct deliveries competing for the same option cannot duplicate the opportunity", async () => {
  const fixture = await createFixture();
  try {
    const repository = new PostgresSelectionMatchRepository();
    const keys = await Promise.all([fixture.inboundKey("1"), fixture.inboundKey("1")]);
    const outcomes = await Promise.all(keys.map((selectionKey) => repository.selectShownMatch({ ...fixture, position: 1, lastMessageText: "1", selectionKey })));
    assert.equal(outcomes.filter((outcome) => outcome.kind === "selected").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.kind === "conversation_not_active").length, 1);
    assert.equal((await bilateralCounts(fixture)).notifications, 1);
  } finally { await fixture.cleanup(); }
});

test("bilateral professional notification insert failure rolls back consent, contact, selection and customer response", async () => {
  const fixture = await createFixture();
  const selectionKey = await fixture.inboundKey("1");
  try {
    await query(`CREATE FUNCTION fail_bilateral_notification() RETURNS trigger AS $$ BEGIN
      IF NEW.purpose = 'professional_contact_notification' THEN RAISE EXCEPTION 'bilateral-test-notification-failure'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_bilateral_notification BEFORE INSERT ON channel_outbound_messages FOR EACH ROW EXECUTE FUNCTION fail_bilateral_notification();`);
    await assert.rejects(new PostgresSelectionMatchRepository().selectShownMatch({ ...fixture, position: 1, lastMessageText: "1", selectionKey }), /bilateral-test-notification-failure/u);
    assert.deepEqual(await bilateralCounts(fixture), { contacts: 0, notifications: 0, selected: 0, status: "active", pending_slot: "selection" });
    assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE channel_inbound_message_id = $1", [selectionKey])).rows.length, 0);
    assert.equal((await query<{ status: string }>("SELECT status FROM search_requests WHERE id = $1", [fixture.searchRequestId])).rows[0].status, "matched");
    assert.equal((await query<{ completed_at: Date | null }>("SELECT completed_at FROM search_conversations WHERE id = $1", [fixture.conversationId])).rows[0].completed_at, null);
  } finally {
    await query("DROP TRIGGER IF EXISTS fail_bilateral_notification ON channel_outbound_messages; DROP FUNCTION IF EXISTS fail_bilateral_notification()");
    await fixture.cleanup();
  }
});

test("bilateral replay survives profile changes and sent messages never return to pending", async () => {
  const fixture = await createFixture();
  try {
    const channel = bilateralChannel(fixture);
    const messageId = randomUUID();
    const first = await channel.receive("1", messageId);
    assert.equal(first.kind, "response");
    if (first.kind !== "response") throw new Error("expected response");
    const contact = (await query<{ id: string; professional_id: string; bilateral_snapshot: Record<string, unknown> }>("SELECT id, professional_id, bilateral_snapshot FROM contacts WHERE search_request_id = $1", [fixture.searchRequestId])).rows[0];
    const notification = (await query<{ id: string; text_content: string }>("SELECT id, text_content FROM channel_outbound_messages WHERE business_key = $1", [`contact:${contact.id}:initial`])).rows[0];
    assert.match(notification.text_content, new RegExp(fixture.customerPhone.replace("+", "\\+"), "u"));
    assert.doesNotMatch(notification.text_content, new RegExp(`${fixture.firstProfessionalPhone.replace("+", "\\+")}|[0-9a-f]{8}-[0-9a-f-]{27}|score|ranking`, "iu"));
    await markFixtureMessageSent(first.response.outbound.id);
    await markFixtureMessageSent(notification.id);
    await query("UPDATE professionals SET display_name = 'Nome alterado', phone_e164 = $2 WHERE id = $1", [contact.professional_id, phoneFromId(randomUUID())]);
    const recovered = await new PostgresSelectionMatchRepository().findSelectedByCustomerAndSelectionKey(fixture.customerId, first.response.message_id);
    assert.equal(recovered?.professionalDisplayName, "Ana Eletricista");
    assert.equal(recovered?.professionalPhoneE164, fixture.firstProfessionalPhone);
    const replay = await channel.receive("1", messageId);
    if (replay.kind !== "response") throw new Error("expected replay");
    assert.equal(replay.response.reply_text, first.response.reply_text);
    assert.equal(replay.response.outbound.id, first.response.outbound.id);
    assert.equal(replay.response.outbound.status, "sent");
    const sent = (await query<{ status: string; text_content: string }>("SELECT status, text_content FROM channel_outbound_messages WHERE id = $1", [notification.id])).rows[0];
    assert.deepEqual(sent, { status: "sent", text_content: notification.text_content });
    assert.equal(channel.searchCalls(), 0);
    await assert.rejects(query("UPDATE contacts SET bilateral_snapshot = '{}'::jsonb WHERE id = $1", [contact.id]), /immutable/u);
    assert.equal((await bilateralCounts(fixture)).contacts, 1);
  } finally { await fixture.cleanup(); }
});

test("legacy selection requires delivered consent prompt, survives restart and confirms exactly once", async () => {
  const fixture = await createFixture(true);
  try {
    const first = await bilateralChannel(fixture).receive("Ana");
    if (first.kind !== "response") throw new Error("expected consent prompt");
    assert.equal(first.response.result.route, "selection");
    assert.ok(first.response.reply_text.includes(BILATERAL_NOTICE));
    assert.doesNotMatch(first.response.reply_text, /\+5566/u);
    assert.equal((await bilateralCounts(fixture)).contacts, 0);
    const premature = await bilateralChannel(fixture).receive("sim");
    if (premature.kind !== "response") throw new Error("expected pending consent");
    assert.doesNotMatch(premature.response.reply_text, /\+5566/u);
    assert.equal((await bilateralCounts(fixture)).contacts, 0);
    // Original prompt stays unsent; a delivered retry for the same choice must work.
    await markFixtureMessageSent(premature.response.outbound.id);
    const ambiguous = await bilateralChannel(fixture).receive("sim?");
    if (ambiguous.kind !== "response") throw new Error("expected clarification");
    assert.equal((await bilateralCounts(fixture)).contacts, 0);
    const confirmationId = randomUUID();
    const confirmed = await bilateralChannel(fixture).receive("pode compartilhar", confirmationId);
    if (confirmed.kind !== "response") throw new Error("expected selection");
    assert.match(confirmed.response.reply_text, new RegExp(fixture.firstProfessionalPhone.replace("+", "\\+"), "u"));
    const replay = await bilateralChannel(fixture).receive("pode compartilhar", confirmationId);
    if (replay.kind !== "response") throw new Error("expected replay");
    assert.equal(replay.response.outbound.id, confirmed.response.outbound.id);
    assert.equal(replay.response.reply_text, confirmed.response.reply_text);
    assert.deepEqual(await bilateralCounts(fixture), { contacts: 1, notifications: 1, selected: 1, status: "completed", pending_slot: null });
    const snapshot = (await query<{ bilateral_snapshot: { consent_method: string; choice_inbound_id: string } }>("SELECT bilateral_snapshot FROM contacts WHERE search_request_id = $1", [fixture.searchRequestId])).rows[0].bilateral_snapshot;
    assert.equal(snapshot.consent_method, "legacy_confirmation");
    assert.equal(snapshot.choice_inbound_id, first.response.message_id);
  } finally { await fixture.cleanup(); }
});

test("legacy refusal and wrong-customer confirmation never share phones or create a contact", async () => {
  const fixture = await createFixture(true);
  try {
    const channel = bilateralChannel(fixture);
    const prompt = await channel.receive("1");
    if (prompt.kind !== "response") throw new Error("expected prompt");
    await markFixtureMessageSent(prompt.response.outbound.id);
    const repo = new PostgresSelectionMatchRepository();
    const wrong = await repo.selectShownMatch({ ...fixture, customerId: randomUUID(), position: 1, lastMessageText: "sim", selectionKey: await fixture.inboundKey("sim"), confirmBilateral: true });
    assert.equal(wrong.kind, "conversation_customer_mismatch");
    const refusalId = randomUUID();
    const refused = await channel.receive("não quero", refusalId);
    if (refused.kind !== "response") throw new Error("expected refusal");
    assert.match(refused.response.reply_text, /não foram compartilhados/u);
    assert.equal(await repo.getPendingConfirmation(fixture.customerId, fixture.conversationId), null);
    const replay = await bilateralChannel(fixture).receive("não quero", refusalId);
    if (replay.kind !== "response") throw new Error("expected refusal replay");
    assert.equal(replay.response.outbound.id, refused.response.outbound.id);
    assert.deepEqual(await bilateralCounts(fixture), { contacts: 0, notifications: 0, selected: 0, status: "active", pending_slot: "selection" });
    assert.equal(channel.searchCalls(), 0);
  } finally { await fixture.cleanup(); }
});

test("bilateral selection racing cancellation has one consistent terminal state", async () => {
  const fixture = await createFixture();
  try {
    const selectionKey = await fixture.inboundKey("1");
    const [choice] = await Promise.all([
      new PostgresSelectionMatchRepository().selectShownMatch({ ...fixture, position: 1, lastMessageText: "1", selectionKey }),
      new PostgresGlobalConversationCommandRepository().cancelActiveByCustomerId(fixture.customerId),
    ]);
    const counts = await bilateralCounts(fixture);
    if (choice.kind === "selected") assert.deepEqual(counts, { contacts: 1, notifications: 1, selected: 1, status: "completed", pending_slot: null });
    else {
      assert.equal(choice.kind, "conversation_not_active");
      assert.deepEqual(counts, { contacts: 0, notifications: 0, selected: 0, status: "cancelled", pending_slot: null });
    }
  } finally { await fixture.cleanup(); }
});

test("public code collision retries the real unique index without losing the transaction", async () => {
  const fixture = await createFixture();
  const occupiedSearchId = randomUUID();
  const occupiedContactId = randomUUID();
  try {
    await query("INSERT INTO search_requests (id, raw_text) VALUES ($1, 'collision fixture')", [occupiedSearchId]);
    await query(`INSERT INTO contacts (id, search_request_id, professional_id, customer_id, selection_key,
      public_code, bilateral_snapshot, selection_conversation_id)
      SELECT $1, $2, professional_id, $3, $4, 'CC-23456789', '{}'::jsonb, $5 FROM matches WHERE id = $6`,
    [occupiedContactId, occupiedSearchId, fixture.customerId, randomUUID(), fixture.conversationId, fixture.matchIds[1]]);
    let attempts = 0;
    const repository = new PostgresSelectionMatchRepository(undefined, undefined, () => ++attempts === 1 ? "CC-23456789" : "CC-ABCDEFGH");
    const selected = await repository.selectShownMatch({ ...fixture, position: 1, lastMessageText: "1", selectionKey: await fixture.inboundKey("1") });
    assert.equal(selected.kind, "selected");
    assert.equal(attempts, 2);
    assert.equal((await bilateralCounts(fixture)).notifications, 1);
    assert.equal((await query("SELECT id FROM contacts WHERE lower(public_code) = lower($1)", ["cc-abcdefgh"])).rows.length, 1);
  } finally {
    await query("DELETE FROM contacts WHERE id = $1", [occupiedContactId]);
    await query("DELETE FROM search_requests WHERE id = $1", [occupiedSearchId]);
    await fixture.cleanup();
  }
});

test("legacy consent prompt recovers after crash before inbound completion without losing its context", async () => {
  const fixture = await createFixture(true);
  try {
    const messageId = randomUUID();
    const inbound = await new PostgresChannelInboundMessageRepository().createOrFind({ provider: "bilateral-test",
      provider_message_id: messageId, phone_e164: fixture.customerPhone, raw_text: "1", country_code: "BR", limit: 2 });
    const repository = new PostgresSelectionMatchRepository();
    assert.equal((await repository.selectShownMatch({ ...fixture, position: 1, lastMessageText: "1", selectionKey: inbound.record.id })).kind, "consent_required");
    const before = await new PostgresChannelOutboundMessageRepository().findByInboundMessageId(inbound.record.id);
    assert.ok(before);
    assert.equal((await new PostgresChannelInboundMessageRepository().findById(inbound.record.id))?.status, "received");
    const channel = bilateralChannel(fixture);
    const recovered = await channel.receive("1", messageId);
    if (recovered.kind !== "response") throw new Error("expected recovered prompt");
    assert.equal(recovered.response.outbound.id, before.id);
    assert.equal(recovered.response.reply_text, before.textContent);
    assert.equal(channel.searchCalls(), 0);
    const state = await new PostgresChannelInboundMessageRepository().findById(inbound.record.id);
    assert.equal(state?.status, "processed");
    assert.equal(state?.conversationId, fixture.conversationId);
    assert.equal(state?.searchRequestId, fixture.searchRequestId);
    assert.equal((await bilateralCounts(fixture)).contacts, 0);
    assert.equal(await repository.recoverConsentResponse(randomUUID(), inbound.record.id), null);
  } finally { await fixture.cleanup(); }
});
