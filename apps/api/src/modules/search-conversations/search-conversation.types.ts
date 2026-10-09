import type {
  ContinueSearchConversationInput,
  ContinueSearchConversationResponse,
  StartSearchConversationInput,
  StartSearchConversationResponse,
} from "@contatocerto/shared";

export type SearchConversationStatus = "active" | "completed" | "cancelled" | "expired";
export type SearchConversationPendingSlot = "location" | "service" | "selection" | "location_confirmation";

export type SearchConversationRecord = {
  id: string;
  customerId: string | null;
  status: SearchConversationStatus;
  pendingSlot: SearchConversationPendingSlot | null;
  originalRawText: string;
  serviceText: string;
  locationText: string | null;
  countryCode: string;
  limitValue: number;
  lastMessageText: string | null;
  searchRequestId: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  isExpired: boolean;
  pinLatitude?: number | null;
  pinLongitude?: number | null;
  pinName?: string | null;
  locationSource?: string | null;
};

export type CreatePendingConversation = {
  customerId?: string;
  pendingSlot: SearchConversationPendingSlot;
  originalRawText: string;
  serviceText: string;
  locationText: string | null;
  countryCode: string;
  limitValue: number;
  ttlMinutes: number;
  pinLatitude?: number | null;
  pinLongitude?: number | null;
  pinName?: string | null;
  locationSource?: string | null;
};

export type CreateAwaitingSelectionConversation = {
  customerId?: string;
  originalRawText: string;
  serviceText: string;
  locationText: string;
  countryCode: string;
  limitValue: number;
  searchRequestId: string;
  ttlMinutes: number;
  pinLatitude?: number | null;
  pinLongitude?: number | null;
  pinName?: string | null;
  locationSource?: string | null;
};

export type UpdatePendingConversation = {
  id: string;
  processingToken: string;
  pendingSlot: SearchConversationPendingSlot;
  serviceText: string;
  locationText: string | null;
  lastMessageText: string;
  ttlMinutes: number;
  pinLatitude?: number | null;
  pinLongitude?: number | null;
  pinName?: string | null;
  locationSource?: string | null;
};

export type MoveToAwaitingSelectionConversation = {
  id: string;
  processingToken: string;
  serviceText: string;
  locationText: string;
  lastMessageText: string;
  searchRequestId: string;
  ttlMinutes: number;
  pinLatitude?: number | null;
  pinLongitude?: number | null;
  pinName?: string | null;
  locationSource?: string | null;
};

export type CompleteSearchConversation = {
  id: string;
  processingToken: string;
  serviceText: string;
  locationText: string;
  lastMessageText: string;
  searchRequestId: string;
};

export type HistoricallyShownCandidate = {
  matchId: string;
  professionalId: string;
  rankPosition: number;
  displayName: string;
};

export interface SearchConversationRepository {
  createPending(input: CreatePendingConversation): Promise<SearchConversationRecord>;
  createAwaitingSelection(input: CreateAwaitingSelectionConversation): Promise<SearchConversationRecord>;
  findById(id: string): Promise<SearchConversationRecord | null>;
  expireStaleForCustomer(customerId: string): Promise<void>;
  findActiveByCustomerId(customerId: string): Promise<SearchConversationRecord | null>;
  findRecentExpiredWithShownMatches(
    customerId: string,
  ): Promise<{ id: string; searchRequestId: string } | null>;
  listHistoricallyShownForExpiredSearch(
    searchRequestId: string,
  ): Promise<HistoricallyShownCandidate[]>;
  claim(
    id: string,
    processingToken: string,
    processingLeaseSeconds: number,
  ): Promise<SearchConversationRecord | null>;
  updatePending(input: UpdatePendingConversation): Promise<boolean>;
  moveToAwaitingSelection(input: MoveToAwaitingSelectionConversation): Promise<boolean>;
  complete(input: CompleteSearchConversation): Promise<boolean>;
  releaseClaim(id: string, processingToken: string): Promise<void>;
}

export type StartSearchConversationOutcome =
  | { kind: "response"; response: StartSearchConversationResponse }
  | { kind: "service_unavailable" };

export type ContinueSearchConversationOutcome =
  | { kind: "response"; response: ContinueSearchConversationResponse }
  | { kind: "service_unavailable" }
  | { kind: "conversation_not_found" }
  | { kind: "conversation_expired" }
  | { kind: "conversation_not_active" }
  | { kind: "conversation_processing" };

export interface SearchConversationService {
  start(input: StartSearchConversationInput, context?: { customerId?: string }): Promise<StartSearchConversationOutcome>;
  continueConversation(conversationId: string, input: ContinueSearchConversationInput): Promise<ContinueSearchConversationOutcome>;
}
