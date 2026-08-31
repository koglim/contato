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
  CreatePendingLocationConversation,
  SearchConversationRecord,
  SearchConversationRepository,
} from "./search-conversation.types.js";

const conversationId = "11111111-1111-4111-8111-111111111111";
const searchRequestId = "22222222-2222-4222-8222-222222222222";
const originalRawText = "preciso de eletricista perto daqui";
const startInput: StartSearchConversationInput = { raw_text: originalRawText, country_code: "BR", limit: 3 };

const serviceResolved: ServiceResolutionResponse = {
  status: "resolved",
  normalized_text: "preciso de eletricista perto daqui",
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

const needsService: SearchOrchestrationResponse = {
  status: "needs_service",
  reason: "unresolved",
  service_resolution: { status: "unresolved", normalized_text: originalRawText, match: null, candidates: [] },
  location_resolution: null,
  matching: null,
};

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
  created: CreatePendingLocationConversation | undefined;
  record: SearchConversationRecord | null = conversation();
  claim: SearchConversationRecord | null = conversation();
  touched: unknown[] | undefined;
  completed: unknown[] | undefined;
  claimArguments: unknown[] | undefined;
  releases = 0;

  async createPendingLocation(input: CreatePendingLocationConversation) {
    this.created = input;
    return conversation();
  }

  async findById() {
    return this.record;
  }

  async claimPendingLocation(id: string, processingToken: string, processingLeaseSeconds: number) {
    this.claimArguments = [id, processingToken, processingLeaseSeconds];
    return this.claim;
  }

  async touchPendingLocation(id: string, token: string, text: string, ttl: number) {
    this.touched = [id, token, text, ttl];
    return true;
  }

  async complete(id: string, token: string, text: string, requestId: string | null) {
    this.completed = [id, token, text, requestId];
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

test("conversation start creates state only for interpretation-stage missing location", async () => {
  const active = context();
  const outcome = await active.service.start(startInput);
  assert.equal(active.messageSearch.calls, 1);
  assert.deepEqual(active.messageSearch.received, startInput);
  assert.deepEqual(active.repository.created, {
    originalRawText,
    serviceText: originalRawText,
    countryCode: "BR",
    limitValue: 3,
    ttlMinutes: 30,
  });
  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") {
    assert.equal(outcome.response.conversation_id, conversationId);
    assert.equal(outcome.response.conversation_status, "active");
    assert.equal("pending_slot" in outcome.response && outcome.response.pending_slot, "location");
  }

  for (const orchestration of [matched, noMatches] as const) {
    const completed = context();
    completed.messageSearch.outcome = { kind: "response", response: completedMessageSearch(orchestration) };
    const completedOutcome = await completed.service.start(startInput);
    assert.equal(completed.repository.created, undefined);
    assert.equal(completedOutcome.kind, "response");
    if (completedOutcome.kind === "response") {
      assert.equal(completedOutcome.response.conversation_id, null);
      assert.equal(completedOutcome.response.conversation_status, "completed");
    }
  }
});

test("conversation start does not open unsupported service or geocoding continuations", async () => {
  for (const response of [
    { ...completedMessageSearch(noMatches), status: "needs_service", stage: "service_resolution", reason: "unresolved", orchestration: needsService },
    { ...completedMessageSearch(noMatches), status: "needs_location", stage: "location_resolution", reason: "unresolved", orchestration: needsLocation("unresolved") },
  ] as MessageSearchResponse[]) {
    const current = context();
    current.messageSearch.outcome = { kind: "response", response };
    const outcome = await current.service.start(startInput);
    assert.equal(current.repository.created, undefined);
    assert.equal(outcome.kind, "response");
    if (outcome.kind === "response") assert.equal(outcome.response.conversation_id, null);
  }
});

test("conversation continuation returns controlled missing, expired and inactive states", async () => {
  const missing = context();
  missing.repository.record = null;
  assert.deepEqual(await missing.service.continueWithLocation(conversationId, { raw_text: "Sinop" }), { kind: "conversation_not_found" });

  const expired = context();
  expired.repository.record = conversation({ isExpired: true });
  assert.deepEqual(await expired.service.continueWithLocation(conversationId, { raw_text: "Sinop" }), { kind: "conversation_expired" });

  for (const status of ["completed", "cancelled"] as const) {
    const inactive = context();
    inactive.repository.record = conversation({ status, pendingSlot: null });
    assert.deepEqual(await inactive.service.continueWithLocation(conversationId, { raw_text: "Sinop" }), { kind: "conversation_not_active" });
  }
});

test("conversation continuation atomically rejects a simultaneous processor", async () => {
  const current = context();
  current.repository.claim = null;
  assert.deepEqual(await current.service.continueWithLocation(conversationId, { raw_text: "Sinop" }), { kind: "conversation_processing" });
  assert.equal(current.orchestrator.calls, 0);
});

test("conversation continuation passes the lease and processes a repository-reclaimed stale claim", async () => {
  const current = context();
  const outcome = await current.service.continueWithLocation(conversationId, { raw_text: "Sinop" });
  assert.equal(current.repository.claimArguments?.[0], conversationId);
  assert.equal(typeof current.repository.claimArguments?.[1], "string");
  assert.equal(current.repository.claimArguments?.[2], 60);
  assert.equal(current.orchestrator.calls, 1);
  assert.equal(outcome.kind, "response");
});

test("pending location goes directly to orchestration and completes matched or no_matches", async () => {
  for (const response of [matched, noMatches] as const) {
    const current = context();
    current.orchestrator.outcome = { kind: "response", response };
    const outcome = await current.service.continueWithLocation(conversationId, { raw_text: "Sinop" });
    assert.equal(current.messageSearch.calls, 0);
    assert.equal(current.orchestrator.calls, 1);
    assert.deepEqual(current.orchestrator.received, {
      raw_text: originalRawText,
      service_text: originalRawText,
      location_text: "Sinop",
      country_code: "BR",
      limit: 3,
    });
    assert.equal(current.repository.completed?.[0], conversationId);
    assert.equal(current.repository.completed?.[2], "Sinop");
    assert.equal(current.repository.completed?.[3], searchRequestId);
    assert.equal(outcome.kind, "response");
    if (outcome.kind === "response") {
      assert.equal(outcome.response.conversation_status, "completed");
      assert.equal(outcome.response.pending_slot, null);
    }
  }
});

test("unresolved or ambiguous location keeps the conversation active and renews TTL", async () => {
  for (const reason of ["unresolved", "ambiguous"] as const) {
    const current = context();
    current.orchestrator.outcome = { kind: "response", response: needsLocation(reason) };
    const outcome = await current.service.continueWithLocation(conversationId, { raw_text: "Centro" });
    assert.equal(current.repository.completed, undefined);
    assert.equal(current.repository.touched?.[0], conversationId);
    assert.equal(current.repository.touched?.[2], "Centro");
    assert.equal(current.repository.touched?.[3], 30);
    assert.equal(outcome.kind, "response");
    if (outcome.kind === "response") {
      assert.equal(outcome.response.conversation_status, "active");
      assert.equal(outcome.response.pending_slot, "location");
      assert.equal(outcome.response.result.reason, reason);
    }
  }
});

test("unsupported needs_service completes safely and provider failures release the claim", async () => {
  const unsupported = context();
  unsupported.orchestrator.outcome = { kind: "response", response: needsService };
  const outcome = await unsupported.service.continueWithLocation(conversationId, { raw_text: "Sinop" });
  assert.equal(unsupported.repository.completed?.[3], null);
  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") assert.equal(outcome.response.conversation_status, "completed");

  const unavailable = context();
  unavailable.orchestrator.outcome = { kind: "service_unavailable" };
  assert.deepEqual(await unavailable.service.continueWithLocation(conversationId, { raw_text: "Sinop" }), { kind: "service_unavailable" });
  assert.equal(unavailable.repository.releases, 1);

  const broken = context();
  broken.orchestrator.error = new Error("geocoder failed");
  await assert.rejects(() => broken.service.continueWithLocation(conversationId, { raw_text: "Sinop" }), /geocoder failed/u);
  assert.equal(broken.repository.releases, 1);
});
