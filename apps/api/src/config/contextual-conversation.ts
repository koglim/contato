export function readContextualConfig(env: NodeJS.ProcessEnv = process.env) {
  // The former B2 names remain accepted so a staged rollout is not broken by
  // this rename. Explicit values under the public names always win.
  const enabled = env.CONVERSATION_AI_ENABLED ?? env.CONTEXTUAL_CONVERSATION_ENABLED ?? "false";
  const model = (env.OPENAI_CONVERSATION_MODEL ?? env.CONTEXTUAL_CONVERSATION_MODEL)?.trim() ?? "";
  if (enabled !== "true" && enabled !== "false") throw new Error("CONVERSATION_AI_ENABLED must be true or false");
  if (enabled === "true" && (!model || !env.OPENAI_API_KEY?.trim())) {
    throw new Error("Conversation AI requires OPENAI_CONVERSATION_MODEL and OPENAI_API_KEY");
  }
  return { enabled: enabled === "true", model, apiKey: env.OPENAI_API_KEY ?? "" };
}
