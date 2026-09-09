export type PriceMode = "quote" | "fixed" | "from" | "range";

export type SelectionMatchState = {
  totalMatchCount: number;
  shownMatchCount: number;
  hasMore: boolean;
  hasPendingReservations?: boolean;
};

export type SelectionMatchRecord = {
  matchId: string;
  searchRequestId: string;
  professionalId: string;
  rankPosition: number | null;
  shownAt: Date | null;
  selectedAt: Date | null;
  displayName: string;
  phoneE164: string;
  slug: string;
  profileImageUrl: string | null;
  isVerified: boolean;
  serviceName: string;
  serviceDescription: string | null;
  priceMode: PriceMode;
  priceFromCents: number | null;
  priceToCents: number | null;
  distanceMeters: number | null;
  effectiveAvailableNow: boolean | null;
};

export type SelectShownMatchInput = {
  conversationId: string;
  customerId: string;
  searchRequestId: string;
  position: number;
  lastMessageText: string;
  selectionKey: string;
  confirmBilateral?: boolean;
};

export type SelectShownMatchOutcome =
  | {
    kind: "selected";
    contactId: string;
    matchId: string;
    professionalId: string;
    professionalDisplayName: string;
    professionalPhoneE164: string;
    serviceName: string;
    selectedAt: Date;
    replayed: boolean;
    publicCode?: string;
  }
  | { kind: "consent_required"; professionalDisplayName: string }
  | { kind: "consent_declined" }
  | { kind: "conversation_not_found" }
  | { kind: "conversation_not_active" }
  | { kind: "conversation_expired" }
  | { kind: "conversation_customer_mismatch" }
  | { kind: "search_request_not_selectable" }
  | { kind: "match_not_available" }
  | { kind: "idempotency_conflict" };

export type SelectedMatchOutcome = Extract<SelectShownMatchOutcome, { kind: "selected" }>;
export type ConsentOutcome = Extract<SelectShownMatchOutcome, { kind: "consent_required" | "consent_declined" }>;
export type PendingBilateralConfirmation = { position: number; professionalDisplayName: string };

export interface SelectionMatchRepository {
  getPendingConfirmation(customerId: string, conversationId: string): Promise<PendingBilateralConfirmation | null>;
  declinePendingConfirmation(input: SelectShownMatchInput): Promise<SelectShownMatchOutcome>;
  recoverConsentResponse(customerId: string, selectionKey: string): Promise<ConsentOutcome | null>;
  getState(searchRequestId: string): Promise<SelectionMatchState>;
  findShownByPosition(searchRequestId: string, position: number): Promise<SelectionMatchRecord | null>;
  listShown(searchRequestId: string): Promise<SelectionMatchRecord[]>;
  listNextUnshown(searchRequestId: string, limit: number): Promise<SelectionMatchRecord[]>;
  findSelectedByCustomerAndSelectionKey(customerId: string, selectionKey: string): Promise<SelectedMatchOutcome | null>;
  selectShownMatch(input: SelectShownMatchInput): Promise<SelectShownMatchOutcome>;
}
