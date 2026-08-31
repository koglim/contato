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
export class GeocodingProviderError extends Error {
  constructor(readonly kind: "unavailable" | "rate_limited" | "provider_error") {
    super(kind);
  }
}
