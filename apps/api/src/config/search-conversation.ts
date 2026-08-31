import { z } from "zod";

export const DEFAULT_SEARCH_CONVERSATION_TTL_MINUTES = 30;

export type SearchConversationConfig = {
  ttlMinutes: number;
};

const positiveIntegerEnvironmentValue = z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().positive());

const environmentSchema = z.object({
  SEARCH_CONVERSATION_TTL_MINUTES: positiveIntegerEnvironmentValue,
});

export function readSearchConversationConfig(environment: NodeJS.ProcessEnv = process.env): SearchConversationConfig {
  const parsed = environmentSchema.safeParse({
    SEARCH_CONVERSATION_TTL_MINUTES:
      environment.SEARCH_CONVERSATION_TTL_MINUTES ?? String(DEFAULT_SEARCH_CONVERSATION_TTL_MINUTES),
  });

  if (!parsed.success) {
    const variables = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid search conversation configuration: ${variables}`);
  }

  return { ttlMinutes: parsed.data.SEARCH_CONVERSATION_TTL_MINUTES };
}
