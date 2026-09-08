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

type Fixture = {
  customerId: string;
  conversationId: string;
  searchRequestId: string;
  matchIds: [string, string];
  shownAt: [Date, Date];
  cleanup: () => Promise<void>;
};

async function createFixture(): Promise<Fixture> {
  const customerId = randomUUID();
  const categoryId = randomUUID();
  const serviceId = randomUUID();
  const searchRequestId = randomUUID();
  const conversationId = randomUUID();
  const firstProfessionalId = randomUUID();
  const secondProfessionalId = randomUUID();
  const firstMatchId = randomUUID();
  const secondMatchId = randomUUID();

  await query(`INSERT INTO customers (id, phone_e164) VALUES ($1, $2)`, [customerId, "+5566999999999"]);
  await query(`INSERT INTO service_categories (id, name, slug) VALUES ($1, $2, $3)`, [categoryId, "Teste", `teste-${categoryId}`]);
  await query(`INSERT INTO services (id, category_id, name, slug) VALUES ($1, $2, $3, $4)`, [serviceId, categoryId, "Eletricista", `eletricista-${serviceId}`]);
  await query(
    `INSERT INTO professionals (id, display_name, slug, phone_e164)
     VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
    [
      firstProfessionalId, "Ana Eletricista", `ana-${firstProfessionalId}`, "+5566988888888",
      secondProfessionalId, "Bia Eletricista", `bia-${secondProfessionalId}`, "+5566977777777",
    ],
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

  return {
    customerId,
    conversationId,
    searchRequestId,
    matchIds: [firstMatchId, secondMatchId],
    shownAt: [matches.rows[0]!.shown_at, matches.rows[1]!.shown_at],
    cleanup: async () => {
      await query(`DELETE FROM contacts WHERE search_request_id = $1`, [searchRequestId]);
      await query(`DELETE FROM matches WHERE search_request_id = $1`, [searchRequestId]);
      await query(`DELETE FROM search_conversations WHERE id = $1`, [conversationId]);
      await query(`DELETE FROM search_requests WHERE id = $1`, [searchRequestId]);
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
    const outcomes = await Promise.all([
      repository.selectShownMatch({ ...fixture, position: 1, lastMessageText: "quero o primeiro", selectionKey: randomUUID() }),
      repository.selectShownMatch({ ...fixture, position: 2, lastMessageText: "quero o segundo", selectionKey: randomUUID() }),
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
      repository.selectShownMatch({ ...fixture, position: 1, lastMessageText: "quero o primeiro", selectionKey: randomUUID() }),
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
  const selectionKey = randomUUID();
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

test("channel inbox selects once and replays the same inbound safely", { concurrency: false }, async () => {
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
  const input = { provider: "test", provider_message_id: providerMessageId, phone_e164: "+5566999999999", raw_text: "1", country_code: "BR", limit: 2 };
  try {
    const first = await inbox.receive(input);
    assert.equal(first.kind, "response");
    if (first.kind !== "response") return;
    assert.match(first.response.reply_text, /\+5566988888888/u);
    assert.equal(first.response.reply_text.includes(input.phone_e164), false);
    assert.equal(first.response.reply_text.includes(fixture.matchIds[0]), false);
    const duplicate = await inbox.receive(input);
    assert.equal(duplicate.kind, "response");
    if (duplicate.kind !== "response") return;
    assert.equal(duplicate.response.duplicate, true);
    assert.equal(duplicate.response.outbound.id, first.response.outbound.id);
    assert.equal(duplicate.response.reply_text, first.response.reply_text);
    assert.equal(routerCalls, 1);
    const state = await query<{ contacts: string; outbounds: string; status: string }>(
      `SELECT (SELECT COUNT(*) FROM contacts WHERE search_request_id = $1) AS contacts,
              (SELECT COUNT(*) FROM channel_outbound_messages WHERE channel_inbound_message_id = $2) AS outbounds,
              (SELECT status FROM channel_inbound_messages WHERE provider = 'test' AND provider_message_id = $3) AS status`,
      [fixture.searchRequestId, first.response.message_id, providerMessageId],
    );
    assert.equal(Number(state.rows[0]!.contacts), 1);
    assert.equal(Number(state.rows[0]!.outbounds), 1);
    assert.equal(state.rows[0]!.status, "processed");
  } finally {
    await query(`DELETE FROM channel_outbound_messages WHERE channel_inbound_message_id IN (SELECT id FROM channel_inbound_messages WHERE provider = 'test' AND provider_message_id = $1)`, [providerMessageId]);
    await query(`DELETE FROM channel_inbound_messages WHERE provider = 'test' AND provider_message_id = $1`, [providerMessageId]);
    await fixture.cleanup();
  }
});

test("channel inbox recovers a completed selection after a crash before inbound processing", { concurrency: false }, async () => {
  const fixture = await createFixture();
  const selectionRepository = new PostgresSelectionMatchRepository();
  const inboundRepository = new PostgresChannelInboundMessageRepository();
  const providerMessageId = `crash-selection-${randomUUID()}`;
  const input = { provider: "test", provider_message_id: providerMessageId, phone_e164: "+5566999999999", raw_text: "1", country_code: "BR", limit: 2 };
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
    assert.equal(Number(stateBefore.rows[0]!.outbounds), 0);
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
  } finally {
    await query(`DELETE FROM channel_outbound_messages WHERE channel_inbound_message_id = $1`, [registered.record.id]);
    await query(`DELETE FROM channel_inbound_messages WHERE id = $1`, [registered.record.id]);
    await fixture.cleanup();
  }
});

after(async () => {
  await closeDatabaseConnection();
});
