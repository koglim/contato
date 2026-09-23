import type { LocationResolutionCandidate, LocationResolutionInput, LocationResolutionResponse } from "@contatocerto/shared";

export const GEOCODING_TIMEOUT_MS = 5_000;
export type GeocodingProviderInput = Pick<LocationResolutionInput, "query" | "country_code" | "limit">;
export type GeocodingProvider = {
  readonly name: string;
  geocode(input: GeocodingProviderInput): Promise<LocationResolutionCandidate[]>;
};
export type LocationResolutionService = {
  resolve(input: LocationResolutionInput): Promise<LocationResolutionResponse>;
};
export type LocationResolutionDiagnostic = {
  status: LocationResolutionResponse["status"];
  resolution_source: "ibge_municipality" | "pelias";
  municipality_code?: string;
  state?: string;
  ambiguity_count?: number;
  reason: "no_candidates" | "below_threshold" | "competing_places" | "equivalent_candidates_collapsed" | "resolved";
  relevantCandidateCount: number;
  collapsedCandidateCount: number;
  confidenceGap: number | null;
  top: Pick<LocationResolutionCandidate, "city" | "state" | "confidence" | "layer"> | null;
  second: Pick<LocationResolutionCandidate, "city" | "state" | "confidence" | "layer"> | null;
};
export type LocationResolutionObserver = (diagnostic: LocationResolutionDiagnostic) => void;
export class GeocodingProviderError extends Error {
  constructor(readonly kind: "unavailable" | "rate_limited" | "provider_error") {
    super(kind);
  }
}
