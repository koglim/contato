import { z } from "zod";

export const DEFAULT_OPENROUTESERVICE_BASE_URL = "https://api.heigit.org";
export const DEFAULT_LOCATION_RESOLUTION_CONFIDENCE_THRESHOLD = 0.85;
export const DEFAULT_LOCATION_RESOLUTION_AMBIGUITY_GAP = 0.1;

export type LocationResolutionConfig = {
  apiKey?: string;
  baseUrl: string;
  confidenceThreshold: number;
  ambiguityGap: number;
};

const finiteUnitNumber = z.string().trim().min(1).transform(Number).pipe(z.number().finite().min(0).max(1));
const environmentSchema = z.object({
  OPENROUTESERVICE_API_KEY: z.string().trim().min(1).optional(),
  OPENROUTESERVICE_BASE_URL: z.string().url(),
  LOCATION_RESOLUTION_CONFIDENCE_THRESHOLD: finiteUnitNumber,
  LOCATION_RESOLUTION_AMBIGUITY_GAP: finiteUnitNumber,
});

export function readLocationResolutionConfig(environment: NodeJS.ProcessEnv = process.env): LocationResolutionConfig {
  const parsed = environmentSchema.safeParse({
    OPENROUTESERVICE_API_KEY: environment.OPENROUTESERVICE_API_KEY,
    OPENROUTESERVICE_BASE_URL: environment.OPENROUTESERVICE_BASE_URL ?? DEFAULT_OPENROUTESERVICE_BASE_URL,
    LOCATION_RESOLUTION_CONFIDENCE_THRESHOLD: environment.LOCATION_RESOLUTION_CONFIDENCE_THRESHOLD ?? String(DEFAULT_LOCATION_RESOLUTION_CONFIDENCE_THRESHOLD),
    LOCATION_RESOLUTION_AMBIGUITY_GAP: environment.LOCATION_RESOLUTION_AMBIGUITY_GAP ?? String(DEFAULT_LOCATION_RESOLUTION_AMBIGUITY_GAP),
  });
  if (!parsed.success) {
    const variables = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid location resolution configuration: ${variables}`);
  }
  return {
    apiKey: parsed.data.OPENROUTESERVICE_API_KEY,
    baseUrl: parsed.data.OPENROUTESERVICE_BASE_URL,
    confidenceThreshold: parsed.data.LOCATION_RESOLUTION_CONFIDENCE_THRESHOLD,
    ambiguityGap: parsed.data.LOCATION_RESOLUTION_AMBIGUITY_GAP,
  };
}
