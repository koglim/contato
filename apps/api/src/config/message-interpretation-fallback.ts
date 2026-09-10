import { z } from "zod";

export const DEFAULT_MESSAGE_INTERPRETATION_FALLBACK_MODEL = "gpt-5.6-luna";
export const DEFAULT_MESSAGE_INTERPRETATION_FALLBACK_TIMEOUT_MS = 5_000;

export type MessageInterpretationFallbackConfig = {
  enabled: boolean;
  apiKey?: string;
  model: string;
  timeoutMs: number;
};

const booleanEnvironmentValue = z.enum(["true", "false"]).transform((value) => value === "true");
const positiveIntegerEnvironmentValue = z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().positive());

const environmentSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  MESSAGE_INTERPRETATION_FALLBACK_ENABLED: booleanEnvironmentValue,
  MESSAGE_INTERPRETATION_FALLBACK_MODEL: z.string().trim().min(1),
  MESSAGE_INTERPRETATION_FALLBACK_TIMEOUT_MS: positiveIntegerEnvironmentValue,
});

export function readMessageInterpretationFallbackConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MessageInterpretationFallbackConfig {
  const parsed = environmentSchema.safeParse({
    OPENAI_API_KEY: environment.OPENAI_API_KEY?.trim() || undefined,
    MESSAGE_INTERPRETATION_FALLBACK_ENABLED:
      environment.MESSAGE_INTERPRETATION_FALLBACK_ENABLED?.trim().toLowerCase() ?? "false",
    MESSAGE_INTERPRETATION_FALLBACK_MODEL:
      environment.MESSAGE_INTERPRETATION_FALLBACK_MODEL ?? DEFAULT_MESSAGE_INTERPRETATION_FALLBACK_MODEL,
    MESSAGE_INTERPRETATION_FALLBACK_TIMEOUT_MS:
      environment.MESSAGE_INTERPRETATION_FALLBACK_TIMEOUT_MS ?? String(DEFAULT_MESSAGE_INTERPRETATION_FALLBACK_TIMEOUT_MS),
  });

  if (!parsed.success) {
    const variables = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid message interpretation fallback configuration: ${variables}`);
  }

  return {
    enabled: parsed.data.MESSAGE_INTERPRETATION_FALLBACK_ENABLED,
    apiKey: parsed.data.OPENAI_API_KEY,
    model: parsed.data.MESSAGE_INTERPRETATION_FALLBACK_MODEL,
    timeoutMs: parsed.data.MESSAGE_INTERPRETATION_FALLBACK_TIMEOUT_MS,
  };
}
