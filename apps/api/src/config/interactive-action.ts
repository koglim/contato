import { normalizeBrazilianMobilePhone, phoneE164Schema } from "@contatocerto/shared";

export type InteractiveActionRolloutMode = "allowlist" | "all";

export interface InteractiveActionConfig {
  enabled: boolean;
  rolloutMode: InteractiveActionRolloutMode;
  allowedPhones: ReadonlySet<string>;
}

export function readInteractiveActionConfig(
  env: NodeJS.ProcessEnv = process.env
): InteractiveActionConfig {
  const enabledRaw = env.INTERACTIVE_ACTIONS_ENABLED ?? "false";
  if (enabledRaw !== "true" && enabledRaw !== "false") {
    throw new Error("INTERACTIVE_ACTIONS_ENABLED must be true or false");
  }
  const enabled = enabledRaw === "true";

  const rolloutModeRaw = env.INTERACTIVE_ACTIONS_ROLLOUT_MODE ?? "allowlist";
  const rolloutModeTrimmed = rolloutModeRaw.trim();
  const rolloutMode = rolloutModeTrimmed === "" ? "allowlist" : rolloutModeTrimmed;
  if (rolloutMode !== "allowlist" && rolloutMode !== "all") {
    throw new Error("INTERACTIVE_ACTIONS_ROLLOUT_MODE must be 'allowlist' or 'all'");
  }

  const rawPhones = env.INTERACTIVE_ACTIONS_ALLOWED_PHONES;
  const allowedPhones = new Set<string>();

  if (rawPhones !== undefined && rawPhones.trim() !== "") {
    const parts = rawPhones.split(",");
    for (const part of parts) {
      const trimmed = part.trim();
      const parseResult = phoneE164Schema.safeParse(trimmed);
      if (!parseResult.success) {
        throw new Error(`Invalid E.164 phone number in INTERACTIVE_ACTIONS_ALLOWED_PHONES: "${trimmed}"`);
      }
      allowedPhones.add(normalizeBrazilianMobilePhone(parseResult.data));
    }
  }

  return {
    enabled,
    rolloutMode,
    allowedPhones,
  };
}

export function isInteractiveActionContactEligible(
  customerPhoneE164: string,
  professionalPhoneE164: string,
  config: InteractiveActionConfig = readInteractiveActionConfig()
): boolean {
  if (!config.enabled) {
    return false;
  }

  if (config.rolloutMode === "all") {
    return true;
  }

  if (config.rolloutMode === "allowlist") {
    if (config.allowedPhones.size === 0) {
      return false;
    }
    if (!customerPhoneE164 || !professionalPhoneE164) {
      return false;
    }

    const normalizedCustomer = normalizeBrazilianMobilePhone(customerPhoneE164);
    const normalizedProfessional = normalizeBrazilianMobilePhone(professionalPhoneE164);

    return config.allowedPhones.has(normalizedCustomer) && config.allowedPhones.has(normalizedProfessional);
  }

  return false;
}
