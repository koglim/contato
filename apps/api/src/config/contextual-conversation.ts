export function readContextualConfig(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.CONTEXTUAL_CONVERSATION_ENABLED ?? "false";
  if (enabled !== "true" && enabled !== "false") throw new Error("CONTEXTUAL_CONVERSATION_ENABLED must be true or false");
  if (enabled === "true" && (!env.CONTEXTUAL_CONVERSATION_MODEL?.trim() || !env.OPENAI_API_KEY?.trim())) {
    throw new Error("Contextual conversation requires CONTEXTUAL_CONVERSATION_MODEL and OPENAI_API_KEY");
  }
  return { enabled: enabled === "true", model: env.CONTEXTUAL_CONVERSATION_MODEL?.trim() ?? "", apiKey: env.OPENAI_API_KEY ?? "" };
}
