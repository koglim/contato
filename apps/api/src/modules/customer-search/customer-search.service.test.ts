import assert from "node:assert/strict";
import test from "node:test";
import type {
  LocationResolutionResponse,
  SearchOrchestrationInput,
  SearchOrchestrationOutcome,
  SearchOrchestrationResponse,
  StartSearchConversationInput,
} from "@contatocerto/shared";
import type { CustomerRepository } from "../customers/customer.repository.js";
import type { CustomerLastLocationRecord, CustomerLastLocationRepository } from "../customers/customer-last-location.repository.js";
import type { LocationResolutionService } from "../location-resolution/location-resolution.types.js";
import type { ServiceResolutionOutcome, ServiceResolutionRepository } from "../service-resolution/service-resolution.types.js";
import type { SearchOrchestrationService } from "../search-orchestration/search-orchestration.types.js";
import type {
  CreatePendingConversation,
  MoveToAwaitingSelectionConversation,
  SearchConversationRecord,
  SearchConversationRepository,
  SearchConversationService,
  UpdatePendingConversation,
} from "../search-conversations/search-conversation.types.js";
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
  createdPending: CreatePendingConversation | null = null;
  updatedPending: UpdatePendingConversation | null = null;
  movedToSelection: MoveToAwaitingSelectionConversation | null = null;
  completed: unknown = null;

  async createPending(input: CreatePendingConversation): Promise<SearchConversationRecord> {
    this.createdPending = input;
    const now = new Date();
    const conv: SearchConversationRecord = {
      id: conversationId,
      customerId,
      status: "active",
      pendingSlot: input.pendingSlot,
      originalRawText: input.originalRawText,
      serviceText: input.serviceText,
      locationText: input.locationText,
      countryCode: input.countryCode,
      limitValue: input.limitValue,
      lastMessageText: input.originalRawText,
      searchRequestId: null,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      isExpired: false,
      pinLatitude: input.pinLatitude,
      pinLongitude: input.pinLongitude,
      pinName: input.pinName,
      locationSource: input.locationSource,
    };
    this.active = conv;
    return conv;
  }
  async findById(id: string): Promise<SearchConversationRecord | null> {
    return this.active?.id === id ? this.active : null;
  }
  async expireStaleForCustomer(id: string) { this.expiredFor = id; return 0; }
  async findActiveByCustomerId() { return this.active; }
  async claim(id: string): Promise<SearchConversationRecord | null> {
    return this.active?.id === id ? this.active : null;
  }
  async updatePending(input: UpdatePendingConversation) {
    this.updatedPending = input;
    if (this.active) {
      this.active.pendingSlot = input.pendingSlot;
      this.active.serviceText = input.serviceText;
      this.active.locationText = input.locationText;
      this.active.pinLatitude = input.pinLatitude;
      this.active.pinLongitude = input.pinLongitude;
      this.active.locationSource = input.locationSource;
    }
    return true;
  }
  async moveToAwaitingSelection(input: MoveToAwaitingSelectionConversation) {
    this.movedToSelection = input;
    if (this.active) {
      this.active.pendingSlot = "selection";
      this.active.serviceText = input.serviceText;
      this.active.locationText = input.locationText;
      this.active.searchRequestId = input.searchRequestId;
      this.active.pinLatitude = input.pinLatitude;
      this.active.pinLongitude = input.pinLongitude;
      this.active.locationSource = input.locationSource;
    }
    return true;
  }
  async complete(input: unknown) {
    this.completed = input;
    if (this.active) {
      this.active.status = "completed";
      this.active.pendingSlot = null;
    }
    return true;
  }
  async releaseClaim() {}
  async createAwaitingSelection(): Promise<SearchConversationRecord> { throw new Error("not used"); }
  async findRecentExpiredWithShownMatches() { return null; }
  async listHistoricallyShownForExpiredSearch() { return []; }
}

class FakeSearchConversationService implements SearchConversationService {
  startContext: { customerId?: string } | undefined;
  continued: { id: string; rawText: string } | undefined;
  startResponse: unknown = null;
  async start(_input: StartSearchConversationInput, context?: { customerId?: string }) {
    this.startContext = context;
    if (this.startResponse) {
      return { kind: "response", response: this.startResponse } as never;
    }
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

class FakeCustomerLastLocations implements CustomerLastLocationRepository {
  lastLocation: CustomerLastLocationRecord | null = null;
  upserted: CustomerLastLocationRecord | null = null;
  async findByCustomerId() { return this.lastLocation; }
  async upsert(record: {
    customerId: string;
    latitude: number;
    longitude: number;
    city?: string | null;
    state?: string | null;
    countryCode: string;
    label: string;
    source: string;
  }) {
    this.upserted = {
      id: "loc-1",
      customerId: record.customerId,
      latitude: record.latitude,
      longitude: record.longitude,
      city: record.city ?? null,
      state: record.state ?? null,
      countryCode: record.countryCode,
      label: record.label,
      source: record.source,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.lastLocation = this.upserted;
    return this.upserted;
  }
}

class FakeLocationResolutionService implements LocationResolutionService {
  resolvedLocation: LocationResolutionResponse = {
    status: "resolved",
    query: "Sinop",
    country_code: "BR",
    match: {
      label: "Sinop - MT",
      latitude: -11.86,
      longitude: -55.5,
      city: "Sinop",
      state: "MT",
      neighborhood: null,
      country_code: "BR",
      confidence: 1,
      layer: "locality",
    },
    candidates: [],
    provider: "fake",
  };
  reverseResult: { city: string | null; state: string | null; countryCode?: string } = {
    city: "Sinop",
    state: "MT",
  };
  async resolve() { return this.resolvedLocation; }
  async reverseGeocode() { return this.reverseResult; }
}

class FakeServiceResolutionRepository implements ServiceResolutionRepository {
  resolvedService: ServiceResolutionOutcome = {
    status: "resolved",
    normalized_text: "eletricista",
    match: {
      service: { id: "srv-1", name: "Eletricista", slug: "eletricista" },
      method: "exact",
      matched_term: "eletricista",
      confidence: 1,
    },
    candidates: [],
  };
  async resolve() { return this.resolvedService; }
}

class FakeSearchOrchestrator implements SearchOrchestrationService {
  lastInput: SearchOrchestrationInput | null = null;
  response: SearchOrchestrationResponse = {
    status: "matched",
    service_resolution: {
      status: "resolved",
      normalized_text: "eletricista",
      match: { service: { id: "srv-1", name: "Eletricista", slug: "eletricista" }, method: "exact", matched_term: "eletricista", confidence: 1 },
      candidates: [],
    },
    location_resolution: {
      status: "resolved",
      query: "Sinop - MT",
      country_code: "BR",
      match: {
        label: "Sinop - MT",
        latitude: -11.86,
        longitude: -55.5,
        city: "Sinop",
        state: "MT",
        neighborhood: null,
        country_code: "BR",
        confidence: 1,
        layer: "locality",
      },
      candidates: [],
      provider: "fake",
    },
    matching: {
      search_request_id: "req-123",
      status: "ready",
      service: { id: "srv-1", name: "Eletricista", slug: "eletricista" },
      location: { latitude: -11.86, longitude: -55.5, city: "Sinop", state: "MT", neighborhood: null },
      matches: [{ match_id: "m-1" } as never],
      meta: { count: 1, limit: 3, availability_freshness_minutes: 240 },
    },
  };
  async orchestrate(input: SearchOrchestrationInput): Promise<SearchOrchestrationOutcome> {
    this.lastInput = input;
    return { kind: "response", response: this.response };
  }
}

test("Case A: Active in location sends pin -> reverse geocodes label, runs search with pin coords, upserts memory, moves to selection", async () => {
  const customers = new FakeCustomers();
  const conversations = new FakeConversations();
  conversations.active = { ...activeConversation(), pendingSlot: "location", serviceText: "Eletricista" };
  const search = new FakeSearchConversationService();
  const lastLocations = new FakeCustomerLastLocations();
  const locationResolution = new FakeLocationResolutionService();
  const serviceResolution = new FakeServiceResolutionRepository();
  const orchestrator = new FakeSearchOrchestrator();

  const router = new DefaultCustomerSearchRouter(
    customers, conversations, search, selectionService() as never, globalService() as never,
    lastLocations, locationResolution, serviceResolution, orchestrator,
  );

  const outcome = await router.route({
    phone_e164: input.phone_e164,
    country_code: "BR",
    limit: 3,
    location: { latitude: -11.8642, longitude: -55.5089 },
  });

  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") {
    assert.equal(outcome.response.route, "continued");
    assert.equal(outcome.response.conversation.conversation_status, "active");
    assert.equal(outcome.response.conversation.pending_slot, "selection");
  }
  assert.equal(conversations.movedToSelection?.locationSource, "whatsapp_native");
  assert.equal(lastLocations.upserted?.source, "whatsapp_native");
  assert.equal(lastLocations.upserted?.latitude, -11.8642);
  assert.equal(lastLocations.upserted?.longitude, -55.5089);
  assert.equal(orchestrator.lastInput?.coordinates?.latitude, -11.8642);
  assert.equal(orchestrator.lastInput?.coordinates?.longitude, -55.5089);
});

test("Case B: No active conversation sends pin -> creates pending conversation in service slot with pin coords", async () => {
  const customers = new FakeCustomers();
  const conversations = new FakeConversations();
  conversations.active = null;
  const search = new FakeSearchConversationService();
  const lastLocations = new FakeCustomerLastLocations();
  const locationResolution = new FakeLocationResolutionService();
  const serviceResolution = new FakeServiceResolutionRepository();
  const orchestrator = new FakeSearchOrchestrator();

  const router = new DefaultCustomerSearchRouter(
    customers, conversations, search, selectionService() as never, globalService() as never,
    lastLocations, locationResolution, serviceResolution, orchestrator,
  );

  const outcome = await router.route({
    phone_e164: input.phone_e164,
    country_code: "BR",
    limit: 3,
    location: { latitude: -11.8642, longitude: -55.5089 },
  });

  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") {
    assert.equal(outcome.response.route, "started");
    assert.equal(outcome.response.conversation.conversation_status, "active");
    assert.equal(outcome.response.conversation.pending_slot, "service");
    assert.equal(outcome.response.conversation.result.status, "needs_service");
  }
  assert.equal(conversations.createdPending?.pendingSlot, "service");
  assert.equal(conversations.createdPending?.pinLatitude, -11.8642);
  assert.equal(conversations.createdPending?.pinLongitude, -55.5089);
  assert.equal(conversations.createdPending?.locationSource, "whatsapp_native");
  assert.equal(lastLocations.upserted?.source, "whatsapp_native");
  assert.equal(lastLocations.upserted?.latitude, -11.8642);
  assert.equal(lastLocations.upserted?.longitude, -55.5089);
});

test("Case C: Customer with remembered location sends service without location -> creates conversation in location_confirmation slot", async () => {
  const customers = new FakeCustomers();
  const conversations = new FakeConversations();
  conversations.active = null;
  const search = new FakeSearchConversationService();
  const lastLocations = new FakeCustomerLastLocations();
  lastLocations.lastLocation = {
    id: "loc-prev",
    customerId,
    latitude: -11.8642,
    longitude: -55.5089,
    city: "Sinop",
    state: "MT",
    countryCode: "BR",
    label: "Sinop - MT",
    source: "whatsapp_native",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const locationResolution = new FakeLocationResolutionService();
  const serviceResolution = new FakeServiceResolutionRepository();
  const orchestrator = new FakeSearchOrchestrator();

  const router = new DefaultCustomerSearchRouter(
    customers, conversations, search, selectionService() as never, globalService() as never,
    lastLocations, locationResolution, serviceResolution, orchestrator,
  );

  const outcome = await router.route({
    phone_e164: input.phone_e164,
    raw_text: "preciso de eletricista",
    country_code: "BR",
    limit: 3,
  });

  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") {
    assert.equal(outcome.response.route, "started");
    assert.equal(outcome.response.conversation.conversation_status, "active");
    assert.equal(outcome.response.conversation.pending_slot, "location_confirmation");
    assert.equal(outcome.response.conversation.result.status, "needs_location_confirmation");
    assert.ok(outcome.response.conversation.result.prompt.includes("Sinop - MT"));
  }
  assert.equal(conversations.createdPending?.pendingSlot, "location_confirmation");
  assert.equal(conversations.createdPending?.pinLatitude, -11.8642);
  assert.equal(conversations.createdPending?.pinLongitude, -55.5089);
});

test("Case C (Confirmation YES): Customer replies 'sim' -> executes search with saved coordinates, updates memory, moves to selection", async () => {
  const customers = new FakeCustomers();
  const conversations = new FakeConversations();
  conversations.active = {
    ...activeConversation(),
    pendingSlot: "location_confirmation",
    serviceText: "Eletricista",
    locationText: "Sinop - MT",
    pinLatitude: -11.8642,
    pinLongitude: -55.5089,
    locationSource: "whatsapp_native",
  };
  const search = new FakeSearchConversationService();
  const lastLocations = new FakeCustomerLastLocations();
  const locationResolution = new FakeLocationResolutionService();
  const serviceResolution = new FakeServiceResolutionRepository();
  const orchestrator = new FakeSearchOrchestrator();

  const router = new DefaultCustomerSearchRouter(
    customers, conversations, search, selectionService() as never, globalService() as never,
    lastLocations, locationResolution, serviceResolution, orchestrator,
  );

  const outcome = await router.route({
    phone_e164: input.phone_e164,
    raw_text: "sim",
    country_code: "BR",
    limit: 3,
  });

  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") {
    assert.equal(outcome.response.route, "continued");
    assert.equal(outcome.response.conversation.conversation_status, "active");
    assert.equal(outcome.response.conversation.pending_slot, "selection");
  }
  assert.equal(orchestrator.lastInput?.coordinates?.latitude, -11.8642);
  assert.equal(orchestrator.lastInput?.coordinates?.longitude, -55.5089);
  assert.equal(lastLocations.upserted?.source, "memory_reuse");
  assert.equal(lastLocations.upserted?.label, "Sinop - MT");
});

test("Case C (Confirmation NO): Customer replies 'não' -> clears coordinates, updates conversation to location slot", async () => {
  const customers = new FakeCustomers();
  const conversations = new FakeConversations();
  conversations.active = {
    ...activeConversation(),
    pendingSlot: "location_confirmation",
    serviceText: "Eletricista",
    locationText: "Sinop - MT",
    pinLatitude: -11.8642,
    pinLongitude: -55.5089,
    locationSource: "whatsapp_native",
  };
  const search = new FakeSearchConversationService();
  const lastLocations = new FakeCustomerLastLocations();
  const locationResolution = new FakeLocationResolutionService();
  const serviceResolution = new FakeServiceResolutionRepository();
  const orchestrator = new FakeSearchOrchestrator();

  const router = new DefaultCustomerSearchRouter(
    customers, conversations, search, selectionService() as never, globalService() as never,
    lastLocations, locationResolution, serviceResolution, orchestrator,
  );

  const outcome = await router.route({
    phone_e164: input.phone_e164,
    raw_text: "não",
    country_code: "BR",
    limit: 3,
  });

  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") {
    assert.equal(outcome.response.route, "continued");
    assert.equal(outcome.response.conversation.conversation_status, "active");
    assert.equal(outcome.response.conversation.pending_slot, "location");
    assert.equal(outcome.response.conversation.result.status, "needs_location");
  }
  assert.equal(conversations.updatedPending?.pinLatitude, null);
  assert.equal(conversations.updatedPending?.pinLongitude, null);
  assert.equal(conversations.updatedPending?.pendingSlot, "location");
});

test("Case C (Confirmation Override): Customer replies with new city -> resolves new city, runs search, updates memory", async () => {
  const customers = new FakeCustomers();
  const conversations = new FakeConversations();
  conversations.active = {
    ...activeConversation(),
    pendingSlot: "location_confirmation",
    serviceText: "Eletricista",
    locationText: "Sinop - MT",
    pinLatitude: -11.8642,
    pinLongitude: -55.5089,
    locationSource: "whatsapp_native",
  };
  const search = new FakeSearchConversationService();
  const lastLocations = new FakeCustomerLastLocations();
  const locationResolution = new FakeLocationResolutionService();
  locationResolution.resolvedLocation = {
    status: "resolved",
    query: "Sorriso",
    country_code: "BR",
    match: {
      label: "Sorriso - MT",
      latitude: -12.54,
      longitude: -55.72,
      city: "Sorriso",
      state: "MT",
      neighborhood: null,
      country_code: "BR",
      confidence: 1,
      layer: "locality",
    },
    candidates: [],
    provider: "fake",
  };
  const serviceResolution = new FakeServiceResolutionRepository();
  const orchestrator = new FakeSearchOrchestrator();

  const router = new DefaultCustomerSearchRouter(
    customers, conversations, search, selectionService() as never, globalService() as never,
    lastLocations, locationResolution, serviceResolution, orchestrator,
  );

  const outcome = await router.route({
    phone_e164: input.phone_e164,
    raw_text: "Sorriso",
    country_code: "BR",
    limit: 3,
  });

  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") {
    assert.equal(outcome.response.route, "continued");
    assert.equal(outcome.response.conversation.conversation_status, "active");
    assert.equal(outcome.response.conversation.pending_slot, "selection");
  }
  assert.equal(lastLocations.upserted?.source, "text_resolved");
  assert.equal(lastLocations.upserted?.city, "Sorriso");
});

test("Case C (Confirmation Ambiguous): Customer replies with ambiguous text -> safe re-prompt without changing slot", async () => {
  const customers = new FakeCustomers();
  const conversations = new FakeConversations();
  conversations.active = {
    ...activeConversation(),
    pendingSlot: "location_confirmation",
    serviceText: "Eletricista",
    locationText: "Sinop - MT",
    pinLatitude: -11.8642,
    pinLongitude: -55.5089,
    locationSource: "whatsapp_native",
  };
  const search = new FakeSearchConversationService();
  const lastLocations = new FakeCustomerLastLocations();
  const locationResolution = new FakeLocationResolutionService();
  locationResolution.resolvedLocation = {
    status: "needs_location",
    query: "talvez depois",
    country_code: "BR",
    match: null,
    candidates: [],
    provider: "fake",
  } as never;
  const serviceResolution = new FakeServiceResolutionRepository();
  const orchestrator = new FakeSearchOrchestrator();

  const router = new DefaultCustomerSearchRouter(
    customers, conversations, search, selectionService() as never, globalService() as never,
    lastLocations, locationResolution, serviceResolution, orchestrator,
  );

  const outcome = await router.route({
    phone_e164: input.phone_e164,
    raw_text: "talvez depois",
    country_code: "BR",
    limit: 3,
  });

  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") {
    assert.equal(outcome.response.route, "continued");
    assert.equal(outcome.response.conversation.conversation_status, "active");
    assert.equal(outcome.response.conversation.pending_slot, "location_confirmation");
  }
  assert.equal(conversations.updatedPending, null);
});

test("Case D: Service + location in text -> resolves both, runs search, upserts memory", async () => {
  const customers = new FakeCustomers();
  const conversations = new FakeConversations();
  conversations.active = null;
  const search = new FakeSearchConversationService();
  search.startResponse = {
    conversation_id: conversationId,
    conversation_status: "active",
    pending_slot: "selection",
    result: {
      status: "matched",
      stage: "matching",
      reason: null,
      interpretation: {
        raw_text: "eletricista em Sinop",
        service_text: "eletricista",
        location_text: "Sinop",
        country_code: "BR",
        status: "interpreted",
        interpretation: { service_strategy: "full_message", location_strategy: "locative_phrase" },
      },
      orchestration: {
        matching: {
          search_request_id: "req-d",
          location: { latitude: -11.86, longitude: -55.5, city: "Sinop", state: "MT" },
          matches: [{ match_id: "m-1" }],
        },
      },
    },
  };
  const lastLocations = new FakeCustomerLastLocations();
  const locationResolution = new FakeLocationResolutionService();
  const serviceResolution = new FakeServiceResolutionRepository();
  const orchestrator = new FakeSearchOrchestrator();

  const router = new DefaultCustomerSearchRouter(
    customers, conversations, search, selectionService() as never, globalService() as never,
    lastLocations, locationResolution, serviceResolution, orchestrator,
  );

  const outcome = await router.route({
    phone_e164: input.phone_e164,
    raw_text: "eletricista em Sinop",
    country_code: "BR",
    limit: 3,
  });

  assert.equal(outcome.kind, "response");
  assert.equal(lastLocations.upserted?.source, "text_resolved");
  assert.equal(lastLocations.upserted?.latitude, -11.86);
  assert.equal(lastLocations.upserted?.longitude, -55.5);
  assert.equal(lastLocations.upserted?.city, "Sinop");
});

test("Case E: Exact coordinates authoritative -> pin coordinates passed directly to matching, never overridden by municipality centroid", async () => {
  const customers = new FakeCustomers();
  const conversations = new FakeConversations();
  conversations.active = { ...activeConversation(), pendingSlot: "location", serviceText: "Eletricista" };
  const search = new FakeSearchConversationService();
  const lastLocations = new FakeCustomerLastLocations();
  const locationResolution = new FakeLocationResolutionService();
  // Reverse geocode returns Sinop centroid (-11.86, -55.5), but the pin was at exact coordinates (-11.851234, -55.512345)
  locationResolution.reverseResult = { city: "Sinop", state: "MT" };
  const serviceResolution = new FakeServiceResolutionRepository();
  const orchestrator = new FakeSearchOrchestrator();

  const router = new DefaultCustomerSearchRouter(
    customers, conversations, search, selectionService() as never, globalService() as never,
    lastLocations, locationResolution, serviceResolution, orchestrator,
  );

  const exactLat = -11.851234;
  const exactLon = -55.512345;
  await router.route({
    phone_e164: input.phone_e164,
    country_code: "BR",
    limit: 3,
    location: { latitude: exactLat, longitude: exactLon },
  });

  assert.equal(orchestrator.lastInput?.coordinates?.latitude, exactLat);
  assert.equal(orchestrator.lastInput?.coordinates?.longitude, exactLon);
});

test("Case F: Customer active in selection sends pin -> returns not_command without mutating selection or creating contact", async () => {
  const customers = new FakeCustomers();
  const conversations = new FakeConversations();
  conversations.active = selectionConversation();
  const search = new FakeSearchConversationService();
  const selection = selectionService({ kind: "not_command" });
  const lastLocations = new FakeCustomerLastLocations();
  const locationResolution = new FakeLocationResolutionService();
  const serviceResolution = new FakeServiceResolutionRepository();
  const orchestrator = new FakeSearchOrchestrator();

  const router = new DefaultCustomerSearchRouter(
    customers, conversations, search, selection as never, globalService() as never,
    lastLocations, locationResolution, serviceResolution, orchestrator,
  );

  const outcome = await router.route({
    phone_e164: input.phone_e164,
    country_code: "BR",
    limit: 3,
    location: { latitude: -11.86, longitude: -55.5 },
    selectionKey: "77777777-7777-4777-8777-777777777777",
  });

  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") {
    assert.equal(outcome.response.route, "selection");
    assert.equal(outcome.response.result.kind, "not_command");
  }
  assert.equal(selection.calls, 0);
  assert.equal(conversations.movedToSelection, null);
});

test("Text search with no_matches still updates customer last location memory", async () => {
  const customers = new FakeCustomers();
  const conversations = new FakeConversations();
  conversations.active = null;
  const search = new FakeSearchConversationService();
  search.startResponse = {
    conversation_id: null,
    conversation_status: "completed",
    result: {
        status: "no_matches",
        stage: "matching",
        reason: null,
        interpretation: {} as never,
        orchestration: {
          status: "no_matches",
          reason: null,
          service_resolution: {} as never,
          location_resolution: {} as never,
          matching: {
            search_request_id: "sr-no-match",
            matches: [],
            location: {
              latitude: -11.86,
              longitude: -55.50,
              city: "Sinop",
              state: "MT",
              country: "BR",
            },
          } as never,
        },
      },
    };
  const lastLocations = new FakeCustomerLastLocations();
  const locationResolution = new FakeLocationResolutionService();
  const serviceResolution = new FakeServiceResolutionRepository();
  const orchestrator = new FakeSearchOrchestrator();

  const router = new DefaultCustomerSearchRouter(
    customers, conversations, search, selectionService() as never, globalService() as never,
    lastLocations, locationResolution, serviceResolution, orchestrator,
  );

  const outcome = await router.route({
    phone_e164: input.phone_e164,
    raw_text: "Eletricista em Sinop",
    country_code: "BR",
    limit: 3,
  });

  assert.equal(outcome.kind, "response");
  assert.equal(lastLocations.upserted?.source, "text_resolved");
  assert.equal(lastLocations.upserted?.latitude, -11.86);
  assert.equal(lastLocations.upserted?.longitude, -55.50);
  assert.equal(lastLocations.upserted?.city, "Sinop");
});

test("Zero coordinates (latitude = 0) are valid and preserved in memory", async () => {
  const customers = new FakeCustomers();
  const conversations = new FakeConversations();
  conversations.active = null;
  const search = new FakeSearchConversationService();
  const lastLocations = new FakeCustomerLastLocations();
  const locationResolution = new FakeLocationResolutionService();
  const serviceResolution = new FakeServiceResolutionRepository();
  const orchestrator = new FakeSearchOrchestrator();

  const router = new DefaultCustomerSearchRouter(
    customers, conversations, search, selectionService() as never, globalService() as never,
    lastLocations, locationResolution, serviceResolution, orchestrator,
  );

  // Pin on equator (Macapá area / 0 lat)
  const outcome = await router.route({
    phone_e164: input.phone_e164,
    country_code: "BR",
    limit: 3,
    location: { latitude: 0, longitude: -51.05 },
  });

  assert.equal(outcome.kind, "response");
  assert.equal(lastLocations.upserted?.source, "whatsapp_native");
  assert.equal(lastLocations.upserted?.latitude, 0);
  assert.equal(lastLocations.upserted?.longitude, -51.05);
  assert.equal(conversations.createdPending?.pinLatitude, 0);
  assert.equal(conversations.createdPending?.pinLongitude, -51.05);
});
