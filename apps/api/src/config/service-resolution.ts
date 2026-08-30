import { z } from "zod";

export const DEFAULT_SERVICE_RESOLUTION_FUZZY_THRESHOLD = 0.53;
export const DEFAULT_SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP = 0.1;

export type ServiceResolutionConfig = {
  fuzzyThreshold: number;
  fuzzyAmbiguityGap: number;
};

const environmentSchema = z.object({
  SERVICE_RESOLUTION_FUZZY_THRESHOLD: z.string().trim().min(1).transform(Number).pipe(z.number().finite().min(0).max(1)),
  SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP: z.string().trim().min(1).transform(Number).pipe(z.number().finite().min(0).max(1)),
});

export function readServiceResolutionConfig(environment: NodeJS.ProcessEnv = process.env): ServiceResolutionConfig {
  const parsed = environmentSchema.safeParse({
    SERVICE_RESOLUTION_FUZZY_THRESHOLD: environment.SERVICE_RESOLUTION_FUZZY_THRESHOLD ?? String(DEFAULT_SERVICE_RESOLUTION_FUZZY_THRESHOLD),
    SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP: environment.SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP ?? String(DEFAULT_SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP),
  });

  if (!parsed.success) {
    const variables = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid service resolution configuration: ${variables} must be a number between 0 and 1`);
  }

  return {
    fuzzyThreshold: parsed.data.SERVICE_RESOLUTION_FUZZY_THRESHOLD,
    fuzzyAmbiguityGap: parsed.data.SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP,
  };
}
