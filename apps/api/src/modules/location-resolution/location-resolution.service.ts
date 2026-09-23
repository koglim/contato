import type { LocationResolutionCandidate, LocationResolutionInput, LocationResolutionResponse } from "@contatocerto/shared";
import type { LocationResolutionConfig } from "../../config/location-resolution.js";
import type { GeocodingProvider, LocationResolutionObserver, LocationResolutionService } from "./location-resolution.types.js";
import { normalizeBrazilianState, parseBrazilianPlaceQuery, resolveBrazilianMunicipality } from "./brazil-municipality-index.js";

const CITY_LAYERS = new Set(["locality", "localadmin"]);
const EQUIVALENT_CENTROID_DISTANCE_KM = 10;

function normalize(value: string | null | undefined) {
  return value?.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").trim().replace(/\s+/gu, " ").toLocaleUpperCase("pt-BR") ?? "";
}

function normalizedState(value: string | null) {
  return normalizeBrazilianState(value);
}

function distanceKm(left: LocationResolutionCandidate, right: LocationResolutionCandidate) {
  const radians = Math.PI / 180;
  const latitudeDelta = (right.latitude - left.latitude) * radians;
  const longitudeDelta = (right.longitude - left.longitude) * radians;
  const rawValue = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(left.latitude * radians) * Math.cos(right.latitude * radians) * Math.sin(longitudeDelta / 2) ** 2;
  const value = Math.min(1, Math.max(0, rawValue));
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function sameCityIdentity(left: LocationResolutionCandidate, right: LocationResolutionCandidate) {
  if (!left.city || !right.city || !left.state || !right.state) return false;
  if (!CITY_LAYERS.has(left.layer ?? "") || !CITY_LAYERS.has(right.layer ?? "")) return false;
  if (left.layer === right.layer) return false;
  return normalize(left.city) === normalize(right.city)
    && normalizedState(left.state) === normalizedState(right.state)
    && normalize(left.country_code) === normalize(right.country_code)
    && distanceKm(left, right) <= EQUIVALENT_CENTROID_DISTANCE_KM;
}

function preferredRepresentative(left: LocationResolutionCandidate, right: LocationResolutionCandidate, confidenceThreshold: number) {
  const locality = left.layer === "locality" ? left : right.layer === "locality" ? right : null;
  const other = locality === left ? right : left;
  if (locality?.confidence !== null && locality?.confidence !== undefined && locality.confidence >= confidenceThreshold) return locality;

  const leftIsReliable = left.confidence !== null && left.confidence >= confidenceThreshold;
  const rightIsReliable = right.confidence !== null && right.confidence >= confidenceThreshold;
  if (leftIsReliable && rightIsReliable) return left.confidence! >= right.confidence! ? left : right;
  if (leftIsReliable) return left;
  if (rightIsReliable) return right;

  if (left.confidence === null) return right;
  if (right.confidence === null) return left;
  if (left.confidence !== right.confidence) return left.confidence > right.confidence ? left : right;
  return locality ?? other;
}

function collapseEquivalentCandidates(candidates: LocationResolutionCandidate[], confidenceThreshold: number) {
  const collapsed: LocationResolutionCandidate[] = [];
  let collapsedCount = 0;
  for (const candidate of candidates) {
    const equivalentIndex = collapsed.findIndex((existing) => sameCityIdentity(existing, candidate));
    if (equivalentIndex < 0) {
      collapsed.push(candidate);
      continue;
    }
    collapsedCount += 1;
    collapsed[equivalentIndex] = preferredRepresentative(collapsed[equivalentIndex]!, candidate, confidenceThreshold);
  }
  return { candidates: collapsed, collapsedCount };
}

function response(input: LocationResolutionInput, provider: string, status: LocationResolutionResponse["status"], match: LocationResolutionCandidate | null, candidates: LocationResolutionCandidate[], resolutionSource: "ibge_municipality" | "pelias", ambiguityCount?: number): LocationResolutionResponse {
  return { status, query: input.query, country_code: input.country_code, match, candidates, provider, resolution_source: resolutionSource, ...(ambiguityCount === undefined ? {} : { ambiguity_count: ambiguityCount }) };
}

export class DeterministicLocationResolutionService implements LocationResolutionService {
  private provider: GeocodingProvider | undefined;
  private readonly providerFactory: () => GeocodingProvider;

  constructor(
    provider: GeocodingProvider | (() => GeocodingProvider),
    private readonly config: LocationResolutionConfig,
    private readonly observe?: LocationResolutionObserver,
  ) {
    if (typeof provider === "function") {
      this.providerFactory = provider;
    } else {
      this.provider = provider;
      this.providerFactory = () => provider;
    }
  }

  private getGeocodingProvider() {
    this.provider ??= this.providerFactory();
    return this.provider;
  }

  private report(candidates: LocationResolutionCandidate[], collapsedCount: number, status: LocationResolutionResponse["status"], reason: "no_candidates" | "below_threshold" | "competing_places" | "equivalent_candidates_collapsed" | "resolved", resolutionSource: "ibge_municipality" | "pelias", ambiguityCount?: number) {
    const top = candidates[0];
    const second = candidates[1];
    const confidenceGap = top?.confidence !== null && top?.confidence !== undefined && second?.confidence !== null && second?.confidence !== undefined
      ? Number((top.confidence - second.confidence).toFixed(4)) : null;
    try {
      this.observe?.({
        status,
        reason,
        resolution_source: resolutionSource,
        ...(status === "resolved" && top?.municipality_code ? { municipality_code: top.municipality_code } : {}),
        ...(status === "resolved" && top?.state ? { state: top.state } : {}),
        ...(ambiguityCount === undefined ? {} : { ambiguity_count: ambiguityCount }),
        relevantCandidateCount: candidates.length,
        collapsedCandidateCount: collapsedCount,
        confidenceGap,
        top: top ? { city: top.city, state: top.state, confidence: top.confidence, layer: top.layer } : null,
        second: second ? { city: second.city, state: second.state, confidence: second.confidence, layer: second.layer } : null,
      });
    } catch {
      // Diagnostics must not affect deterministic geocoding decisions.
    }
  }

  async resolve(input: LocationResolutionInput): Promise<LocationResolutionResponse> {
    const municipality = resolveBrazilianMunicipality(input.query, input.country_code, input.limit);
    if (municipality) {
      if (municipality.status === "ambiguous") {
        this.report(municipality.candidates, 0, "ambiguous", "competing_places", "ibge_municipality", municipality.ambiguityCount);
        return response(input, "ibge", "ambiguous", null, municipality.candidates, "ibge_municipality", municipality.ambiguityCount);
      }
      this.report([municipality.match!], 0, "resolved", "resolved", "ibge_municipality");
      return response(input, "ibge", "resolved", municipality.match, [], "ibge_municipality");
    }

    const stateEvidence = parseBrazilianPlaceQuery(input.query, input.country_code).state;
    const provider = this.getGeocodingProvider();
    const providerCandidates = await provider.geocode(input);
    const cityCandidates = providerCandidates.filter((candidate) => CITY_LAYERS.has(candidate.layer ?? ""));
    const stateFilteredCandidates = stateEvidence
      ? cityCandidates.filter((candidate) => normalizedState(candidate.state) === stateEvidence)
      : cityCandidates;
    const { candidates, collapsedCount } = collapseEquivalentCandidates(stateFilteredCandidates.slice(0, input.limit), this.config.confidenceThreshold);
    const top = candidates[0];
    const second = candidates[1];
    if (!top) {
      const status = "unresolved";
      this.report(candidates, collapsedCount, status, "no_candidates", "pelias");
      return response(input, provider.name, status, null, candidates, "pelias");
    }
    if (top.confidence === null || top.confidence < this.config.confidenceThreshold) {
      const status = "unresolved";
      this.report(candidates, collapsedCount, status, "below_threshold", "pelias");
      return response(input, provider.name, status, null, candidates, "pelias");
    }
    if (second && second.confidence !== null && top.confidence - second.confidence <= this.config.ambiguityGap) {
      const status = "ambiguous";
      this.report(candidates, collapsedCount, status, "competing_places", "pelias");
      return response(input, provider.name, status, null, candidates, "pelias");
    }
    this.report(candidates, collapsedCount, "resolved", collapsedCount ? "equivalent_candidates_collapsed" : "resolved", "pelias");
    return response(input, provider.name, "resolved", top, [], "pelias");
  }
}
