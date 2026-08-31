import type {
  ContinueSearchConversationInput,
  ContinueSearchConversationResponse,
  StartSearchConversationInput,
  StartSearchConversationResponse,
} from "@contatocerto/shared";

export type SearchConversationStatus = "active" | "completed" | "cancelled" | "expired";

export type SearchConversationRecord = {
  id: string;
  customerId: string | null;
  status: SearchConversationStatus;
  pendingSlot: "location" | null;
  originalRawText: string;
  serviceText: string;
  countryCode: string;
  limitValue: number;
  lastMessageText: string | null;
  searchRequestId: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  isExpired: boolean;
};

export type CreatePendingLocationConversation = {
  originalRawText: string;
  serviceText: string;
  countryCode: string;
  limitValue: number;
  ttlMinutes: number;
};

export interface SearchConversationRepository {
  createPendingLocation(input: CreatePendingLocationConversation): Promise<SearchConversationRecord>;
  findById(id: string): Promise<SearchConversationRecord | null>;
  claimPendingLocation(id: string, processingToken: string): Promise<SearchConversationRecord | null>;
  touchPendingLocation(id: string, processingToken: string, lastMessageText: string, ttlMinutes: number): Promise<boolean>;
  complete(id: string, processingToken: string, lastMessageText: string, searchRequestId: string | null): Promise<boolean>;
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
  start(input: StartSearchConversationInput): Promise<StartSearchConversationOutcome>;
  continueWithLocation(conversationId: string, input: ContinueSearchConversationInput): Promise<ContinueSearchConversationOutcome>;
}
