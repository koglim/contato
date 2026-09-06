export type PriceMode = "quote" | "fixed" | "from" | "range";

export type SelectionMatchState = {
  totalMatchCount: number;
  shownMatchCount: number;
  hasMore: boolean;
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

export interface SelectionMatchRepository {
  getState(searchRequestId: string): Promise<SelectionMatchState>;
  findShownByPosition(searchRequestId: string, position: number): Promise<SelectionMatchRecord | null>;
  listNextUnshown(searchRequestId: string, limit: number): Promise<SelectionMatchRecord[]>;
}
