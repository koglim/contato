import type { LocationResolutionCandidate, LocationResolutionInput, LocationResolutionResponse } from "@contatocerto/shared";
import type { LocationResolutionConfig } from "../../config/location-resolution.js";
import type { GeocodingProvider, LocationResolutionService } from "./location-resolution.types.js";

function response(input: LocationResolutionInput, status: LocationResolutionResponse["status"], match: LocationResolutionCandidate | null, candidates: LocationResolutionCandidate[]): LocationResolutionResponse {
  return { status, query: input.query, country_code: input.country_code, match, candidates, provider: "openrouteservice" };
}

export class DeterministicLocationResolutionService implements LocationResolutionService {
  constructor(private readonly provider: GeocodingProvider, private readonly config: LocationResolutionConfig) {}

  async resolve(input: LocationResolutionInput): Promise<LocationResolutionResponse> {
    const candidates = (await this.provider.geocode(input)).slice(0, input.limit);
    const top = candidates[0];
    if (!top || top.confidence === null || top.confidence < this.config.confidenceThreshold) {
      return response(input, "unresolved", null, candidates);
    }
    const second = candidates[1];
    if (second && second.confidence !== null && top.confidence - second.confidence <= this.config.ambiguityGap) {
      return response(input, "ambiguous", null, candidates);
    }
    return response(input, "resolved", top, []);
  }
}
