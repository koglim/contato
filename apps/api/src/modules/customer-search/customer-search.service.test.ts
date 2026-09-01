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

test("router starts with a customer context after expiring stale state", async () => {
  const customers = new FakeCustomers(); const conversations = new FakeConversations(); const service = new FakeSearchConversationService();
  const router = new DefaultCustomerSearchRouter(customers, conversations, service);
  const outcome = await router.route(input);
  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") assert.equal(outcome.response.route, "started");
  assert.deepEqual(customers.calls, [input.phone_e164]);
  assert.equal(conversations.expiredFor, customerId);
  assert.deepEqual(service.startContext, { customerId });
});

test("router continues only the active conversation owned by the resolved customer", async () => {
  const customers = new FakeCustomers(); const conversations = new FakeConversations(); conversations.active = activeConversation(); const service = new FakeSearchConversationService();
  const router = new DefaultCustomerSearchRouter(customers, conversations, service);
  const outcome = await router.route({ ...input, raw_text: "Sinop" });
  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") assert.equal(outcome.response.route, "continued");
  assert.deepEqual(service.continued, { id: conversationId, rawText: "Sinop" });
  assert.equal(service.startContext, undefined);
});
