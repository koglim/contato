import type { LocationResolutionCandidate, LocationResolutionInput, LocationResolutionResponse } from "@contatocerto/shared";
import type { LocationResolutionConfig } from "../../config/location-resolution.js";
import type { GeocodingProvider, LocationResolutionObserver, LocationResolutionService } from "./location-resolution.types.js";

const BR_STATES: Record<string, string> = {
  AC: "AC", ACRE: "AC", AL: "AL", "ALAGOAS": "AL", AP: "AP", AMAPA: "AP", AMAZONAS: "AM", AM: "AM",
  BA: "BA", BAHIA: "BA", CE: "CE", CEARA: "CE", DF: "DF", "DISTRITO FEDERAL": "DF", ES: "ES", "ESPIRITO SANTO": "ES",
  GO: "GO", GOIAS: "GO", MA: "MA", MARANHAO: "MA", MT: "MT", "MATO GROSSO": "MT", MS: "MS", "MATO GROSSO DO SUL": "MS",
  MG: "MG", "MINAS GERAIS": "MG", PA: "PA", PARA: "PA", PB: "PB", "PARAIBA": "PB", PR: "PR", PARANA: "PR",
  PE: "PE", PERNAMBUCO: "PE", PI: "PI", PIAUI: "PI", RJ: "RJ", "RIO DE JANEIRO": "RJ", RN: "RN", "RIO GRANDE DO NORTE": "RN",
  RS: "RS", "RIO GRANDE DO SUL": "RS", RO: "RO", RONDONIA: "RO", RR: "RR", RORAIMA: "RR", SC: "SC", "SANTA CATARINA": "SC",
  SP: "SP", "SAO PAULO": "SP", SE: "SE", SERGIPE: "SE", TO: "TO", TOCANTINS: "TO",
};
const CITY_LAYERS = new Set(["locality", "localadmin"]);
const EQUIVALENT_CENTROID_DISTANCE_KM = 10;

function normalize(value: string | null | undefined) {
  return value?.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").trim().replace(/\s+/gu, " ").toLocaleUpperCase("pt-BR") ?? "";
}

function explicitBrazilianState(query: string, countryCode: string) {
  if (countryCode.toUpperCase() !== "BR") return null;
  const suffix = query.trim().match(/(?:,|\s)\s*([\p{L} ]+)$/u)?.[1];
  return suffix ? BR_STATES[normalize(suffix)] ?? null : null;
}

function normalizedState(value: string | null) {
  return BR_STATES[normalize(value)] ?? normalize(value);
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

function response(input: LocationResolutionInput, provider: string, status: LocationResolutionResponse["status"], match: LocationResolutionCandidate | null, candidates: LocationResolutionCandidate[]): LocationResolutionResponse {
  return { status, query: input.query, country_code: input.country_code, match, candidates, provider };
}

export class DeterministicLocationResolutionService implements LocationResolutionService {
  constructor(
    private readonly provider: GeocodingProvider,
    private readonly config: LocationResolutionConfig,
    private readonly observe?: LocationResolutionObserver,
  ) {}

  private report(candidates: LocationResolutionCandidate[], collapsedCount: number, status: LocationResolutionResponse["status"], reason: "no_candidates" | "below_threshold" | "competing_places" | "equivalent_candidates_collapsed" | "resolved") {
    const top = candidates[0];
    const second = candidates[1];
    const confidenceGap = top?.confidence !== null && top?.confidence !== undefined && second?.confidence !== null && second?.confidence !== undefined
      ? Number((top.confidence - second.confidence).toFixed(4)) : null;
    if (status === "resolved" && collapsedCount === 0) return;
    try {
      this.observe?.({
        status,
        reason,
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
    const stateEvidence = explicitBrazilianState(input.query, input.country_code);
    const providerCandidates = await this.provider.geocode(input);
    const cityCandidates = providerCandidates.filter((candidate) => CITY_LAYERS.has(candidate.layer ?? ""));
    const stateFilteredCandidates = stateEvidence
      ? cityCandidates.filter((candidate) => normalizedState(candidate.state) === stateEvidence)
      : cityCandidates;
    const { candidates, collapsedCount } = collapseEquivalentCandidates(stateFilteredCandidates.slice(0, input.limit), this.config.confidenceThreshold);
    const top = candidates[0];
    const second = candidates[1];
    if (!top) {
      const status = "unresolved";
      this.report(candidates, collapsedCount, status, "no_candidates");
      return response(input, this.provider.name, status, null, candidates);
    }
    if (top.confidence === null || top.confidence < this.config.confidenceThreshold) {
      const status = "unresolved";
      this.report(candidates, collapsedCount, status, "below_threshold");
      return response(input, this.provider.name, status, null, candidates);
    }
    if (second && second.confidence !== null && top.confidence - second.confidence <= this.config.ambiguityGap) {
      const status = "ambiguous";
      this.report(candidates, collapsedCount, status, "competing_places");
      return response(input, this.provider.name, status, null, candidates);
    }
    this.report(candidates, collapsedCount, "resolved", collapsedCount ? "equivalent_candidates_collapsed" : "resolved");
    return response(input, this.provider.name, "resolved", top, []);
  }
}
