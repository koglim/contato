import { z } from "zod";
import { readLocationResolutionConfig, type LocationResolutionConfig } from "../../../config/location-resolution.js";
import type { LocationResolutionCandidate } from "@contatocerto/shared";
import {
  GEOCODING_TIMEOUT_MS,
  GeocodingProviderError,
  type GeocodingProvider,
  type GeocodingProviderInput,
} from "../location-resolution.types.js";

type FetchImplementation = typeof fetch;

const featureCollectionSchema = z.object({
  features: z.array(z.object({
    geometry: z.object({ coordinates: z.array(z.number()).min(2) }),
    properties: z.object({
      gid: z.string().optional(), id: z.string().optional(), label: z.string().optional(), name: z.string().optional(),
      locality: z.string().optional(), city: z.string().optional(), localadmin: z.string().optional(),
      region_a: z.string().optional(), region: z.string().optional(), country_a: z.string().optional(),
      neighbourhood: z.string().optional(), neighborhood: z.string().optional(), layer: z.string().optional(), confidence: z.number().optional(),
    }).passthrough(),
  }).passthrough()),
});

function alpha2(value: string | undefined, fallback: string) {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : fallback;
}

function mapFeature(feature: z.infer<typeof featureCollectionSchema>["features"][number], fallbackCountryCode: string): LocationResolutionCandidate | null {
  const [longitude, latitude] = feature.geometry.coordinates;
  const properties = feature.properties;
  const label = properties.label ?? properties.name;
  const confidence = properties.confidence;
  if (!label || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
  return {
    label, latitude, longitude,
    city: properties.locality ?? properties.city ?? properties.localadmin ?? null,
    state: properties.region_a ?? properties.region ?? null,
    country_code: alpha2(properties.country_a, fallbackCountryCode),
    neighborhood: properties.neighbourhood ?? properties.neighborhood ?? null,
    confidence: confidence !== undefined && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null,
    layer: properties.layer ?? null,
  };
}

function deduplicate(candidates: LocationResolutionCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.longitude}:${candidate.latitude}:${candidate.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class OpenRouteServiceGeocodingProvider implements GeocodingProvider {
  readonly name = "openrouteservice" as const;
  private readonly config: LocationResolutionConfig;

  constructor(config: LocationResolutionConfig = readLocationResolutionConfig(), private readonly fetchImplementation: FetchImplementation = fetch) {
    if (!config.apiKey) throw new Error("OPENROUTESERVICE_API_KEY is required to initialize the geocoding provider");
    this.config = config;
  }

  async geocode(input: GeocodingProviderInput): Promise<LocationResolutionCandidate[]> {
    const url = new URL("search", `${this.config.baseUrl.replace(/\/$/u, "")}/`);
    url.search = new URLSearchParams({ text: input.query, "boundary.country": input.country_code, size: String(input.limit) }).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEOCODING_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await this.fetchImplementation(url, { headers: { Authorization: this.config.apiKey! }, signal: controller.signal });
    } catch {
      throw new GeocodingProviderError("unavailable");
    } finally {
      clearTimeout(timeout);
    }
    if (upstream.status === 429) throw new GeocodingProviderError("rate_limited");
    if (!upstream.ok) throw new GeocodingProviderError("provider_error");
    let payload: unknown;
    try {
      payload = await upstream.json();
    } catch {
      throw new GeocodingProviderError("provider_error");
    }
    const parsed = featureCollectionSchema.safeParse(payload);
    if (!parsed.success) throw new GeocodingProviderError("provider_error");
    return deduplicate(parsed.data.features.map((feature) => mapFeature(feature, input.country_code)).filter((candidate): candidate is LocationResolutionCandidate => candidate !== null));
  }
}
