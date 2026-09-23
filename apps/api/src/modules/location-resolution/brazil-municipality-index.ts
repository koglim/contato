import municipalitySnapshot from "./data/brazil-municipalities.json" with { type: "json" };
import type { LocationResolutionCandidate } from "@contatocerto/shared";

type Municipality = (typeof municipalitySnapshot.municipalities)[number];
type BrazilianPlaceQuery = { state: string | null; normalizedName: string };

const STATE_ALIASES: Record<string, string[]> = {
  AC: ["AC", "Acre"], AL: ["AL", "Alagoas"], AP: ["AP", "Amapá"], AM: ["AM", "Amazonas"],
  BA: ["BA", "Bahia"], CE: ["CE", "Ceará"], DF: ["DF", "Distrito Federal"], ES: ["ES", "Espírito Santo"],
  GO: ["GO", "Goiás"], MA: ["MA", "Maranhão"], MT: ["MT", "Mato Grosso"], MS: ["MS", "Mato Grosso do Sul"],
  MG: ["MG", "Minas Gerais"], PA: ["PA", "Pará"], PB: ["PB", "Paraíba"], PR: ["PR", "Paraná"],
  PE: ["PE", "Pernambuco"], PI: ["PI", "Piauí"], RJ: ["RJ", "Rio de Janeiro"], RN: ["RN", "Rio Grande do Norte"],
  RS: ["RS", "Rio Grande do Sul"], RO: ["RO", "Rondônia"], RR: ["RR", "Roraima"], SC: ["SC", "Santa Catarina"],
  SP: ["SP", "São Paulo"], SE: ["SE", "Sergipe"], TO: ["TO", "Tocantins"],
};

const stateByAlias = new Map<string, string>();
for (const [state, aliases] of Object.entries(STATE_ALIASES)) {
  for (const alias of aliases) stateByAlias.set(normalizeMunicipalityName(alias), state);
}
const sortedStateAliases = [...stateByAlias.keys()].sort((left, right) => right.length - left.length);

const municipalitiesByName = new Map<string, Municipality[]>();
for (const municipality of municipalitySnapshot.municipalities) {
  const group = municipalitiesByName.get(municipality.normalizedName) ?? [];
  group.push(municipality);
  municipalitiesByName.set(municipality.normalizedName, group);
}

export function normalizeMunicipalityName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleUpperCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}

export function normalizeBrazilianState(value: string | null) {
  if (!value) return "";
  const normalized = normalizeMunicipalityName(value);
  return stateByAlias.get(normalized) ?? normalized;
}

export function parseBrazilianPlaceQuery(query: string, countryCode: string): BrazilianPlaceQuery {
  const normalizedQuery = normalizeMunicipalityName(query);
  if (countryCode.toUpperCase() !== "BR") return { state: null, normalizedName: normalizedQuery };

  for (const alias of sortedStateAliases) {
    const suffix = ` ${alias}`;
    if (!normalizedQuery.endsWith(suffix)) continue;
    const normalizedName = normalizedQuery.slice(0, -suffix.length).trim();
    const state = stateByAlias.get(alias)!;
    if (normalizedName) return { state, normalizedName };
  }
  return { state: null, normalizedName: normalizedQuery };
}

function toCandidate(municipality: Municipality): LocationResolutionCandidate {
  return {
    label: `${municipality.name}, ${municipality.state}, Brasil`,
    latitude: municipality.latitude,
    longitude: municipality.longitude,
    city: municipality.name,
    state: municipality.state,
    country_code: "BR",
    neighborhood: null,
    confidence: 1,
    layer: "locality",
    municipality_code: municipality.code,
  };
}

export type BrazilianMunicipalityResolution = {
  status: "resolved" | "ambiguous";
  match: LocationResolutionCandidate | null;
  candidates: LocationResolutionCandidate[];
  ambiguityCount?: number;
} | null;

export function resolveBrazilianMunicipality(query: string, countryCode: string, limit: number): BrazilianMunicipalityResolution {
  if (countryCode.toUpperCase() !== "BR") return null;
  const parsed = parseBrazilianPlaceQuery(query, countryCode);
  if (!parsed.normalizedName) return null;
  const namedMunicipalities = municipalitiesByName.get(parsed.normalizedName);
  if (!namedMunicipalities) return null;

  const exactStateMatches = parsed.state
    ? namedMunicipalities.filter((municipality) => municipality.state === parsed.state)
    : namedMunicipalities;
  if (parsed.state && exactStateMatches.length === 0) return null;

  if (exactStateMatches.length === 1) {
    return { status: "resolved", match: toCandidate(exactStateMatches[0]!), candidates: [] };
  }

  return {
    status: "ambiguous",
    match: null,
    candidates: exactStateMatches.slice(0, limit).map(toCandidate),
    ambiguityCount: exactStateMatches.length,
  };
}
