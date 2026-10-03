export interface InteractiveActionConfig {
  enabled: boolean;
}

export function readInteractiveActionConfig(env: NodeJS.ProcessEnv = process.env): InteractiveActionConfig {
  const enabled = env.INTERACTIVE_ACTIONS_ENABLED ?? "false";
  if (enabled !== "true" && enabled !== "false") {
    throw new Error("INTERACTIVE_ACTIONS_ENABLED must be true or false");
  }
  return {
    enabled: enabled === "true",
  };
}
