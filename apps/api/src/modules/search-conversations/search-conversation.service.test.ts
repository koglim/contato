import assert from "node:assert/strict";
import test from "node:test";
import type {
  LocationResolutionResponse,
  MatchingSearchResponse,
  MessageSearchResponse,
  SearchOrchestrationInput,
  SearchOrchestrationResponse,
  ServiceResolutionResponse,
  StartSearchConversationInput,
} from "@contatocerto/shared";
import type { MessageSearchOutcome, MessageSearchService } from "../message-search/message-search.types.js";
import type { SearchOrchestrationOutcome, SearchOrchestrationService } from "../search-orchestration/search-orchestration.types.js";
import { DefaultSearchConversationService } from "./search-conversation.service.js";
import type {
  CompleteSearchConversation,
  CreatePendingConversation,
  SearchConversationRecord,
  SearchConversationRepository,
  UpdatePendingConversation,
} from "./search-conversation.types.js";

const conversationId = "11111111-1111-4111-8111-111111111111";
const searchRequestId = "22222222-2222-4222-8222-222222222222";
const originalRawText = "preciso de eletricista perto daqui";
const startInput: StartSearchConversationInput = { raw_text: originalRawText, country_code: "BR", limit: 3 };

const serviceResolved: ServiceResolutionResponse = {
  status: "resolved",
  normalized_text: "eletricista",
  match: {
    service: { id: "33333333-3333-4333-8333-333333333333", name: "Eletricista", slug: "eletricista" },
    method: "phrase",
    matched_term: "eletricista",
    confidence: 1,
  },
  candidates: [],
};

const locationResolved: LocationResolutionResponse = {
  status: "resolved",
  query: "Sinop",
  country_code: "BR",
  match: {
    label: "Sinop, MT, Brazil",
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
  provider: "fake-geocoder",
};

function matching(matches: MatchingSearchResponse["matches"] = []): MatchingSearchResponse {
  return {
    search_request_id: searchRequestId,
    status: matches.length ? "matched" : "ready",
    service: serviceResolved.match!.service,
    location: { latitude: -11.86, longitude: -55.5, city: "Sinop", state: "MT", neighborhood: null },
    matches,
    meta: { count: matches.length, limit: 3, availability_freshness_minutes: 240 },
  };
}

const professionalMatch: MatchingSearchResponse["matches"][number] = {
  match_id: "44444444-4444-4444-8444-444444444444",
  rank_position: 1,
  distance_meters: 100,
  effective_available_now: true,
  professional: {
    id: "55555555-5555-4555-8555-555555555555",
    display_name: "Ricardo",
    slug: "ricardo",
    bio: null,
    profile_image_url: null,
    is_verified: false,
  },
  service: {
    professional_service_id: "66666666-6666-4666-8666-666666666666",
    description: null,
    price_mode: "quote",
    price_from_cents: null,
    price_to_cents: null,
  },
  service_area: {
    id: "77777777-7777-4777-8777-777777777777",
    label: "Sinop",
    city: "Sinop",
    state: "MT",
    radius_meters: 40_000,
  },
};

const matched: SearchOrchestrationResponse = {
  status: "matched",
  reason: null,
  service_resolution: serviceResolved,
  location_resolution: locationResolved,
  matching: matching([professionalMatch]),
};

const noMatches: SearchOrchestrationResponse = {
  status: "no_matches",
  reason: null,
  service_resolution: serviceResolved,
  location_resolution: locationResolved,
  matching: matching(),
};

function needsLocation(reason: "unresolved" | "ambiguous"): SearchOrchestrationResponse {
  return {
    status: "needs_location",
    reason,
    service_resolution: serviceResolved,
    location_resolution: {
      ...locationResolved,
      status: reason === "ambiguous" ? "ambiguous" : "unresolved",
      match: null,
      candidates: reason === "ambiguous" ? [locationResolved.match!] : [],
    },
    matching: null,
  };
}

function needsService(reason: "unresolved" | "ambiguous" = "unresolved"): SearchOrchestrationResponse {
  return {
    status: "needs_service",
    reason,
    service_resolution: { status: reason, normalized_text: "alguem", match: null, candidates: [] },
    location_resolution: null,
    matching: null,
  };
}

const needsLocationAtInterpretation: MessageSearchResponse = {
  status: "needs_location",
  stage: "interpretation",
  reason: "location_not_understood",
  interpretation: {
    status: "needs_location",
    raw_text: originalRawText,
    service_text: originalRawText,
    location_text: null,
    country_code: "BR",
    interpretation: { service_strategy: "full_message", location_strategy: "none" },
  },
  orchestration: null,
};

function messageNeedsService(locationText = "Sinop"): MessageSearchResponse {
  const rawText = "preciso de alguém aqui em Sinop";
  return {
    status: "needs_service",
    stage: "service_resolution",
    reason: "unresolved",
    interpretation: {
      status: "interpreted",
      raw_text: rawText,
      service_text: rawText,
      location_text: locationText,
      country_code: "BR",
      interpretation: { service_strategy: "full_message", location_strategy: "locative_phrase" },
    },
    orchestration: needsService("unresolved"),
  };
}

function completedMessageSearch(orchestration: typeof matched | typeof noMatches): MessageSearchResponse {
  return {
    status: orchestration.status,
    stage: "matching",
    reason: null,
    interpretation: {
      status: "interpreted",
      raw_text: originalRawText,
      service_text: originalRawText,
      location_text: "Sinop",
      country_code: "BR",
      interpretation: { service_strategy: "full_message", location_strategy: "llm_fallback" },
    },
    orchestration,
  };
}

function conversation(overrides: Partial<SearchConversationRecord> = {}): SearchConversationRecord {
  const now = new Date("2026-08-31T12:00:00.000Z");
  return {
    id: conversationId,
    customerId: null,
    status: "active",
    pendingSlot: "location",
    originalRawText,
    serviceText: originalRawText,
    locationText: null,
    countryCode: "BR",
    limitValue: 3,
    lastMessageText: originalRawText,
    searchRequestId: null,
    expiresAt: new Date("2026-08-31T12:30:00.000Z"),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    isExpired: false,
    ...overrides,
  };
}

class FakeMessageSearchService implements MessageSearchService {
  calls = 0;
  received: StartSearchConversationInput | undefined;
  outcome: MessageSearchOutcome = { kind: "response", response: needsLocationAtInterpretation };

  async search(input: StartSearchConversationInput) {
    this.calls += 1;
    this.received = input;
    return this.outcome;
  }
}

class FakeSearchOrchestrator implements SearchOrchestrationService {
  calls = 0;
  received: SearchOrchestrationInput | undefined;
  outcome: SearchOrchestrationOutcome = { kind: "response", response: matched };
  error: Error | undefined;

  async orchestrate(input: SearchOrchestrationInput) {
    this.calls += 1;
    this.received = input;
    if (this.error) throw this.error;
    return this.outcome;
  }
}

class FakeSearchConversationRepository implements SearchConversationRepository {
  created: CreatePendingConversation | undefined;
  record: SearchConversationRecord | null = conversation();
  claimResult: SearchConversationRecord | null = conversation();
  updated: UpdatePendingConversation | undefined;
  completed: CompleteSearchConversation | undefined;
  claimArguments: unknown[] | undefined;
  releases = 0;

  async createPending(input: CreatePendingConversation) {
    this.created = input;
    return conversation({ pendingSlot: input.pendingSlot, serviceText: input.serviceText, locationText: input.locationText });
  }

  async findById() {
    return this.record;
  }

  async claim(id: string, processingToken: string, processingLeaseSeconds: number) {
    this.claimArguments = [id, processingToken, processingLeaseSeconds];
    return this.claimResult;
  }

  async updatePending(input: UpdatePendingConversation) {
    this.updated = input;
    return true;
  }

  async complete(input: CompleteSearchConversation) {
    this.completed = input;
    return true;
  }

  async releaseClaim() {
    this.releases += 1;
  }
}

function context() {
  const repository = new FakeSearchConversationRepository();
  const messageSearch = new FakeMessageSearchService();
  const orchestrator = new FakeSearchOrchestrator();
  const service = new DefaultSearchConversationService(repository, messageSearch, orchestrator, {
    ttlMinutes: 30,
    processingLeaseSeconds: 60,
  });
  return { repository, messageSearch, orchestrator, service };
}

test("start creates pending location and preserves the 3.6A state", async () => {
  const current = context();
  const outcome = await current.service.start(startInput);
  assert.equal(current.messageSearch.calls, 1);
  assert.deepEqual(current.messageSearch.received, startInput);
  assert.deepEqual(current.repository.created, {
    pendingSlot: "location",
    originalRawText,
    serviceText: originalRawText,
    locationText: null,
    countryCode: "BR",
    limitValue: 3,
    ttlMinutes: 30,
  });
  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") assert.equal("pending_slot" in outcome.response && outcome.response.pending_slot, "location");
});

test("start creates pending service only when a reusable location is present", async () => {
  const current = context();
  current.messageSearch.outcome = { kind: "response", response: messageNeedsService() };
  const outcome = await current.service.start({ raw_text: "preciso de alguém aqui em Sinop", country_code: "BR", limit: 4 });
  assert.deepEqual(current.repository.created, {
    pendingSlot: "service",
    originalRawText: "preciso de alguém aqui em Sinop",
    serviceText: "preciso de alguém aqui em Sinop",
    locationText: "Sinop",
    countryCode: "BR",
    limitValue: 4,
    ttlMinutes: 30,
  });
  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") assert.equal("pending_slot" in outcome.response && outcome.response.pending_slot, "service");

  const withoutLocation = context();
  withoutLocation.messageSearch.outcome = { kind: "response", response: messageNeedsService(" ") };
  const safeOutcome = await withoutLocation.service.start(startInput);
  assert.equal(withoutLocation.repository.created, undefined);
  assert.equal(safeOutcome.kind, "response");
  if (safeOutcome.kind === "response") assert.equal(safeOutcome.response.conversation_id, null);
});

test("start does not persist matched, no_matches or location-resolution states", async () => {
  const responses: MessageSearchResponse[] = [
    completedMessageSearch(matched),
    completedMessageSearch(noMatches),
    {
      ...completedMessageSearch(noMatches),
      status: "needs_location",
      stage: "location_resolution",
      reason: "unresolved",
      orchestration: needsLocation("unresolved"),
    },
  ];
  for (const response of responses) {
    const current = context();
    current.messageSearch.outcome = { kind: "response", response };
    const outcome = await current.service.start(startInput);
    assert.equal(current.repository.created, undefined);
    assert.equal(outcome.kind, "response");
    if (outcome.kind === "response") assert.equal(outcome.response.conversation_id, null);
  }
});

test("continuation returns controlled missing, expired and inactive states", async () => {
  const missing = context();
  missing.repository.record = null;
  assert.deepEqual(await missing.service.continueConversation(conversationId, { raw_text: "Sinop" }), { kind: "conversation_not_found" });

  const expired = context();
  expired.repository.record = conversation({ isExpired: true });
  assert.deepEqual(await expired.service.continueConversation(conversationId, { raw_text: "Sinop" }), { kind: "conversation_expired" });

  for (const status of ["completed", "cancelled"] as const) {
    const inactive = context();
    inactive.repository.record = conversation({ status, pendingSlot: null });
    assert.deepEqual(await inactive.service.continueConversation(conversationId, { raw_text: "Sinop" }), { kind: "conversation_not_active" });
  }
});

test("recent claims are rejected while reclaimed stale claims keep the lease", async () => {
  const recent = context();
  recent.repository.claimResult = null;
  assert.deepEqual(await recent.service.continueConversation(conversationId, { raw_text: "Sinop" }), { kind: "conversation_processing" });
  assert.equal(recent.orchestrator.calls, 0);

  const stale = context();
  const outcome = await stale.service.continueConversation(conversationId, { raw_text: "Sinop" });
  assert.equal(stale.repository.claimArguments?.[0], conversationId);
  assert.equal(typeof stale.repository.claimArguments?.[1], "string");
  assert.equal(stale.repository.claimArguments?.[2], 60);
  assert.equal(stale.orchestrator.calls, 1);
  assert.equal(outcome.kind, "response");
});

test("pending location sends the reply as location and completes matched or no_matches", async () => {
  for (const response of [matched, noMatches] as const) {
    const current = context();
    current.orchestrator.outcome = { kind: "response", response };
    const outcome = await current.service.continueConversation(conversationId, { raw_text: "Sinop" });
    assert.equal(current.messageSearch.calls, 0);
    assert.deepEqual(current.orchestrator.received, {
      raw_text: originalRawText,
      service_text: originalRawText,
      location_text: "Sinop",
      country_code: "BR",
      limit: 3,
    });
    assert.equal(current.repository.completed?.serviceText, originalRawText);
    assert.equal(current.repository.completed?.locationText, "Sinop");
    assert.equal(current.repository.completed?.searchRequestId, searchRequestId);
    assert.equal(outcome.kind, "response");
    if (outcome.kind === "response") assert.equal(outcome.response.conversation_status, "completed");
  }
});

test("pending location keeps location or transitions to service and renews TTL", async () => {
  for (const response of [needsLocation("unresolved"), needsLocation("ambiguous"), needsService()] as const) {
    const current = context();
    current.orchestrator.outcome = { kind: "response", response };
    const outcome = await current.service.continueConversation(conversationId, { raw_text: "Sinop" });
    const expectedSlot = response.status === "needs_service" ? "service" : "location";
    assert.equal(current.repository.updated?.pendingSlot, expectedSlot);
    assert.equal(current.repository.updated?.serviceText, originalRawText);
    assert.equal(current.repository.updated?.locationText, "Sinop");
    assert.equal(current.repository.updated?.ttlMinutes, 30);
    assert.equal(outcome.kind, "response");
    if (outcome.kind === "response") assert.equal(outcome.response.pending_slot, expectedSlot);
  }
});

test("pending service sends the reply as service and reuses the stored location", async () => {
  for (const response of [matched, noMatches] as const) {
    const current = context();
    const serviceConversation = conversation({ pendingSlot: "service", locationText: "Sinop" });
    current.repository.record = serviceConversation;
    current.repository.claimResult = serviceConversation;
    current.orchestrator.outcome = { kind: "response", response };
    const outcome = await current.service.continueConversation(conversationId, { raw_text: "eletricista" });
    assert.equal(current.messageSearch.calls, 0);
    assert.deepEqual(current.orchestrator.received, {
      raw_text: originalRawText,
      service_text: "eletricista",
      location_text: "Sinop",
      country_code: "BR",
      limit: 3,
    });
    assert.equal(current.repository.completed?.serviceText, "eletricista");
    assert.equal(current.repository.completed?.locationText, "Sinop");
    assert.equal(current.repository.completed?.searchRequestId, searchRequestId);
    assert.equal(outcome.kind, "response");
    if (outcome.kind === "response") assert.equal(outcome.response.conversation_status, "completed");
  }
});

test("pending service keeps service or transitions to location and preserves useful slots", async () => {
  for (const response of [needsService("unresolved"), needsService("ambiguous"), needsLocation("unresolved")] as const) {
    const current = context();
    const serviceConversation = conversation({ pendingSlot: "service", locationText: "Sinop" });
    current.repository.record = serviceConversation;
    current.repository.claimResult = serviceConversation;
    current.orchestrator.outcome = { kind: "response", response };
    const outcome = await current.service.continueConversation(conversationId, { raw_text: "eletricista" });
    const expectedSlot = response.status === "needs_location" ? "location" : "service";
    assert.equal(current.repository.updated?.pendingSlot, expectedSlot);
    assert.equal(current.repository.updated?.serviceText, "eletricista");
    assert.equal(current.repository.updated?.locationText, "Sinop");
    assert.equal(current.repository.updated?.ttlMinutes, 30);
    assert.equal(outcome.kind, "response");
    if (outcome.kind === "response") assert.equal(outcome.response.pending_slot, expectedSlot);
  }
});

test("continuation rejects inconsistent service state and releases provider failures", async () => {
  const inconsistent = context();
  const invalidConversation = conversation({ pendingSlot: "service", locationText: null });
  inconsistent.repository.record = invalidConversation;
  inconsistent.repository.claimResult = invalidConversation;
  assert.deepEqual(
    await inconsistent.service.continueConversation(conversationId, { raw_text: "eletricista" }),
    { kind: "conversation_not_active" },
  );
  assert.equal(inconsistent.repository.releases, 1);

  const unavailable = context();
  unavailable.orchestrator.outcome = { kind: "service_unavailable" };
  assert.deepEqual(await unavailable.service.continueConversation(conversationId, { raw_text: "Sinop" }), { kind: "service_unavailable" });
  assert.equal(unavailable.repository.releases, 1);

  const broken = context();
  broken.orchestrator.error = new Error("geocoder failed");
  await assert.rejects(() => broken.service.continueConversation(conversationId, { raw_text: "Sinop" }), /geocoder failed/u);
  assert.equal(broken.repository.releases, 1);
});
