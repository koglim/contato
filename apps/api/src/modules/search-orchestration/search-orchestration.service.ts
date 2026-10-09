import type { LocationResolutionResponse, MatchingSearchInput, SearchOrchestrationInput } from "@contatocerto/shared";
import type { LocationResolutionService } from "../location-resolution/location-resolution.types.js";
import type { MatchingRepository, SearchExecutionContext } from "../matching/matching.types.js";
import type { ServiceResolutionRepository } from "../service-resolution/service-resolution.types.js";
import type { SearchOrchestrationOutcome, SearchOrchestrationService } from "./search-orchestration.types.js";

export class DeterministicSearchOrchestrator implements SearchOrchestrationService {
  constructor(
    private readonly serviceResolutionRepository: ServiceResolutionRepository,
    private readonly locationResolutionService: LocationResolutionService,
    private readonly matchingRepository: MatchingRepository,
  ) {}

  async orchestrate(input: SearchOrchestrationInput, context: SearchExecutionContext = {}): Promise<SearchOrchestrationOutcome> {
    const serviceResolution = await this.serviceResolutionRepository.resolve({ text: input.service_text });
    if (serviceResolution.status !== "resolved" || !serviceResolution.match) {
      return {
        kind: "response",
        response: {
          status: "needs_service",
          reason: serviceResolution.status === "ambiguous" ? "ambiguous" : "unresolved",
          service_resolution: serviceResolution,
          location_resolution: null,
          matching: null,
        },
      };
    }

    let locationResolution: LocationResolutionResponse;
    if (input.coordinates) {
      const candidate = {
        label: input.location_text || (input.coordinates.city ? `${input.coordinates.city}${input.coordinates.state ? ` - ${input.coordinates.state}` : ""}` : "localização enviada"),
        latitude: input.coordinates.latitude,
        longitude: input.coordinates.longitude,
        city: input.coordinates.city ?? null,
        state: input.coordinates.state ?? null,
        country_code: (input.country_code ?? "BR").toUpperCase(),
        neighborhood: input.coordinates.neighborhood ?? null,
        confidence: 1.0,
        layer: input.coordinates.source ?? "native_pin",
      };
      locationResolution = {
        status: "resolved",
        query: input.location_text,
        country_code: (input.country_code ?? "BR").toUpperCase(),
        match: candidate,
        candidates: [candidate],
        provider: input.coordinates.source ?? "native_pin",
      };
    } else {
      locationResolution = await this.locationResolutionService.resolve({
        query: input.location_text,
        country_code: input.country_code,
        limit: 5,
      });
    }

    if (locationResolution.status !== "resolved" || !locationResolution.match) {
      return {
        kind: "response",
        response: {
          status: "needs_location",
          reason: locationResolution.status === "ambiguous" ? "ambiguous" : "unresolved",
          service_resolution: serviceResolution,
          location_resolution: locationResolution,
          matching: null,
        },
      };
    }

    const matchingInput: MatchingSearchInput = {
      raw_text: input.raw_text,
      service_id: serviceResolution.match.service.id,
      latitude: locationResolution.match.latitude,
      longitude: locationResolution.match.longitude,
      ...(locationResolution.match.city ? { city: locationResolution.match.city } : {}),
      ...(locationResolution.match.state ? { state: locationResolution.match.state } : {}),
      neighborhood: locationResolution.match.neighborhood,
      limit: input.limit,
    };
    const matching = await this.matchingRepository.search(matchingInput, context);
    if (matching.kind !== "success") return { kind: "service_unavailable" };

    return {
      kind: "response",
      response: matching.response.matches.length > 0
        ? { status: "matched", reason: null, service_resolution: serviceResolution, location_resolution: locationResolution, matching: matching.response }
        : { status: "no_matches", reason: null, service_resolution: serviceResolution, location_resolution: locationResolution, matching: matching.response },
    };
  }
}
