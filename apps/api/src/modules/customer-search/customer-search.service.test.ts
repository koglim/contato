import assert from "node:assert/strict";
import test from "node:test";
import type { StartSearchConversationInput } from "@contatocerto/shared";
import type { CustomerRepository } from "../customers/customer.repository.js";
import type { SearchConversationRecord, SearchConversationRepository, SearchConversationService } from "../search-conversations/search-conversation.types.js";
import { DefaultCustomerSearchRouter } from "./customer-search.service.js";

const customerId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const input = { phone_e164: "+5566999999999", raw_text: "preciso de eletricista perto daqui", country_code: "BR", limit: 3 } as const;

class FakeCustomers implements CustomerRepository {
  calls: string[] = [];
  async findOrCreateByPhoneE164(phone: string) { this.calls.push(phone); return { id: customerId }; }
}

class FakeConversations implements SearchConversationRepository {
  active: SearchConversationRecord | null = null;
  expiredFor: string | undefined;
  async createPending(): Promise<SearchConversationRecord> { throw new Error("not used"); }
  async findById(): Promise<SearchConversationRecord | null> { return null; }
  async expireStaleForCustomer(id: string) { this.expiredFor = id; }
  async findActiveByCustomerId() { return this.active; }
  async claim(): Promise<SearchConversationRecord | null> { return null; }
  async updatePending() { return false; }
  async complete() { return false; }
  async releaseClaim() {}
}

class FakeSearchConversationService implements SearchConversationService {
  startContext: { customerId?: string } | undefined;
  continued: { id: string; rawText: string } | undefined;
  async start(_input: StartSearchConversationInput, context?: { customerId?: string }) {
    this.startContext = context;
    return { kind: "response", response: {
      conversation_id: conversationId, conversation_status: "active", pending_slot: "location",
      result: { status: "needs_location", stage: "interpretation", reason: "location_not_understood", interpretation: { status: "needs_location", raw_text: input.raw_text, service_text: input.raw_text, location_text: null, country_code: "BR", interpretation: { service_strategy: "full_message", location_strategy: "none" } }, orchestration: null },
    } } as never;
  }
  async continueConversation(id: string, value: { raw_text: string }) {
    this.continued = { id, rawText: value.raw_text };
    return { kind: "response", response: {
      conversation_id: id, conversation_status: "completed", pending_slot: null,
      result: { status: "no_matches", reason: null, service_resolution: { status: "resolved", normalized_text: "eletricista", match: { service: { id: customerId, name: "Eletricista", slug: "eletricista" }, method: "exact", matched_term: "eletricista", confidence: 1 }, candidates: [] }, location_resolution: { status: "resolved", query: "Sinop", country_code: "BR", match: { label: "Sinop", latitude: -11.86, longitude: -55.5, city: "Sinop", state: "MT", neighborhood: null, country_code: "BR", confidence: 1, layer: "locality" }, candidates: [], provider: "fake" }, matching: { search_request_id: conversationId, status: "ready", service: { id: customerId, name: "Eletricista", slug: "eletricista" }, location: { latitude: -11.86, longitude: -55.5, city: "Sinop", state: "MT", neighborhood: null }, matches: [], meta: { count: 0, limit: 3, availability_freshness_minutes: 240 } } },
    } } as never;
  }
}

function activeConversation(): SearchConversationRecord {
  const now = new Date();
  return { id: conversationId, customerId, status: "active", pendingSlot: "location", originalRawText: input.raw_text, serviceText: input.raw_text, locationText: null, countryCode: "BR", limitValue: 3, lastMessageText: input.raw_text, searchRequestId: null, expiresAt: new Date(now.getTime() + 60_000), createdAt: now, updatedAt: now, completedAt: null, isExpired: false };
}

function selectionConversation(): SearchConversationRecord {
  return { ...activeConversation(), pendingSlot: "selection", searchRequestId: "33333333-3333-4333-8333-333333333333" };
}

function selectionService(outcome: Record<string, unknown> = { kind: "not_command" }) {
  return {
    recovered: null as Record<string, unknown> | null,
    calls: 0,
    async recoverSelection() { return this.recovered; },
    async process() { this.calls += 1; return outcome; },
  };
}

function globalService() {
  return { async execute() { return { kind: "help", pendingSlot: "selection" as const }; } };
}

test("router starts with a customer context after expiring stale state", async () => {
  const customers = new FakeCustomers(); const conversations = new FakeConversations(); const service = new FakeSearchConversationService();
  const router = new DefaultCustomerSearchRouter(customers, conversations, service, selectionService() as never, globalService() as never);
  const outcome = await router.route(input);
  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") assert.equal(outcome.response.route, "started");
  assert.deepEqual(customers.calls, [input.phone_e164]);
  assert.equal(conversations.expiredFor, customerId);
  assert.deepEqual(service.startContext, { customerId });
});

test("router continues only the active conversation owned by the resolved customer", async () => {
  const customers = new FakeCustomers(); const conversations = new FakeConversations(); conversations.active = activeConversation(); const service = new FakeSearchConversationService();
  const router = new DefaultCustomerSearchRouter(customers, conversations, service, selectionService() as never, globalService() as never);
  const outcome = await router.route({ ...input, raw_text: "Sinop" });
  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") assert.equal(outcome.response.route, "continued");
  assert.deepEqual(service.continued, { id: conversationId, rawText: "Sinop" });
  assert.equal(service.startContext, undefined);
});

test("router handles active selection before any search service and requires an idempotency key", async () => {
  const customers = new FakeCustomers(); const conversations = new FakeConversations(); conversations.active = selectionConversation(); const search = new FakeSearchConversationService();
  const selection = selectionService({ kind: "selected", contactId: customerId, matchId: conversationId, professionalId: customerId, professionalDisplayName: "Ana", professionalPhoneE164: "+5566999999999", serviceName: "Eletricista", selectedAt: new Date(), replayed: false });
  const router = new DefaultCustomerSearchRouter(customers, conversations, search, selection as never, globalService() as never);
  assert.deepEqual(await router.route(input), { kind: "selection_idempotency_key_required" });
  const outcome = await router.route({ ...input, raw_text: "2", selectionKey: "77777777-7777-4777-8777-777777777777" });
  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") {
    assert.equal(outcome.response.route, "selection");
    assert.equal(JSON.stringify(outcome.response).includes("contactId"), false);
  }
  assert.equal(selection.calls, 1);
  assert.equal(search.startContext, undefined);
  assert.equal(search.continued, undefined);
});

test("router keeps a show-more request pending when no page was reserved", async () => {
  const customers = new FakeCustomers(); const conversations = new FakeConversations(); conversations.active = selectionConversation(); const search = new FakeSearchConversationService();
  const selection = selectionService({ kind: "show_more_requested", hasMore: true, shownMatchCount: 3 });
  const router = new DefaultCustomerSearchRouter(customers, conversations, search, selection as never, globalService() as never);
  assert.deepEqual(await router.route({ ...input, raw_text: "mostrar mais", selectionKey: "77777777-7777-4777-8777-777777777777" }), { kind: "selection_show_more_pending" });
  assert.equal(search.startContext, undefined);
  assert.equal(search.continued, undefined);
});

test("global command has priority over selection recovery, active selection and search", async () => {
  const customers = new FakeCustomers();
  const conversations = new FakeConversations();
  conversations.active = selectionConversation();
  const search = new FakeSearchConversationService();
  const selection = selectionService();
  let recoveryCalls = 0;
  selection.recoverSelection = async () => { recoveryCalls += 1; return null; };
  let globalCalls = 0;
  const global = { async execute() { globalCalls += 1; return { kind: "cancelled" as const }; } };
  const router = new DefaultCustomerSearchRouter(customers, conversations, search, selection as never, global as never);

  const outcome = await router.route({ ...input, raw_text: "cancelar", selectionKey: "77777777-7777-4777-8777-777777777777" });

  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") assert.equal(outcome.response.route, "global_command");
  assert.equal(globalCalls, 1);
  assert.equal(recoveryCalls, 0);
  assert.equal(selection.calls, 0);
  assert.equal(search.startContext, undefined);
  assert.equal(search.continued, undefined);
  assert.equal(conversations.expiredFor, undefined);
});

test("selectionKey recovery has priority over an active conversation and search", async () => {
  const customers = new FakeCustomers();
  const conversations = new FakeConversations();
  conversations.active = activeConversation();
  const search = new FakeSearchConversationService();
  const selection = selectionService({
    kind: "selected",
    contactId: customerId,
    matchId: conversationId,
    professionalId: customerId,
    professionalDisplayName: "Ana",
    professionalPhoneE164: "+5566999999999",
    serviceName: "Eletricista",
    selectedAt: new Date(),
    replayed: true,
  });
  selection.recovered = {
    kind: "selected",
    contactId: customerId,
    matchId: conversationId,
    professionalId: customerId,
    professionalDisplayName: "Ana",
    professionalPhoneE164: "+5566999999999",
    serviceName: "Eletricista",
    selectedAt: new Date(),
    replayed: true,
  };
  const recoveryCalls: string[] = [];
  selection.recoverSelection = async (_customerId: string, selectionKey: string) => {
    recoveryCalls.push(selectionKey);
    return selection.recovered;
  };
  let globalCalls = 0;
  const global = { async execute() { globalCalls += 1; return { kind: "cancelled" as const }; } };
  const router = new DefaultCustomerSearchRouter(customers, conversations, search, selection as never, global as never);

  const outcome = await router.route({ ...input, raw_text: "2", selectionKey: "77777777-7777-4777-8777-777777777777" });

  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") assert.equal(outcome.response.route, "selection");
  assert.deepEqual(recoveryCalls, ["77777777-7777-4777-8777-777777777777"]);
  assert.equal(globalCalls, 0);
  assert.equal(selection.calls, 0);
  assert.equal(search.startContext, undefined);
  assert.equal(search.continued, undefined);
  assert.equal(conversations.expiredFor, undefined);
});
