import { normalizeBrazilianMobilePhone, phoneE164Schema } from "@contatocerto/shared";

export type InteractiveActionRolloutMode = "allowlist" | "all";
export type ProfessionalOpportunityTransport = "buttons" | "template";

export interface InteractiveActionConfig {
  enabled: boolean;
  rolloutMode: InteractiveActionRolloutMode;
  allowedPhones: ReadonlySet<string>;
  professionalOpportunityTransport: ProfessionalOpportunityTransport;
  professionalOpportunityTemplateName?: string;
  professionalOpportunityTemplateLanguage?: string;
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

  const transportRaw = env.PROFESSIONAL_OPPORTUNITY_TRANSPORT ?? "buttons";
  const transportTrimmed = transportRaw.trim();
  const professionalOpportunityTransport = (transportTrimmed === "" ? "buttons" : transportTrimmed) as ProfessionalOpportunityTransport;
  if (professionalOpportunityTransport !== "buttons" && professionalOpportunityTransport !== "template") {
    throw new Error("PROFESSIONAL_OPPORTUNITY_TRANSPORT must be 'buttons' or 'template'");
  }

  let professionalOpportunityTemplateName: string | undefined;
  let professionalOpportunityTemplateLanguage: string | undefined;

  if (professionalOpportunityTransport === "template") {
    const tplNameRaw = env.WHATSAPP_PROFESSIONAL_OPPORTUNITY_TEMPLATE_NAME?.trim();
    if (!tplNameRaw) {
      throw new Error(
        "WHATSAPP_PROFESSIONAL_OPPORTUNITY_TEMPLATE_NAME is required when PROFESSIONAL_OPPORTUNITY_TRANSPORT is 'template'"
      );
    }
    if (!/^[a-z0-9_]+$/.test(tplNameRaw)) {
      throw new Error(
        "WHATSAPP_PROFESSIONAL_OPPORTUNITY_TEMPLATE_NAME must be a lower-case Meta-safe identifier"
      );
    }
    professionalOpportunityTemplateName = tplNameRaw;

    const tplLangRaw = env.WHATSAPP_PROFESSIONAL_OPPORTUNITY_TEMPLATE_LANGUAGE?.trim();
    if (!tplLangRaw) {
      throw new Error(
        "WHATSAPP_PROFESSIONAL_OPPORTUNITY_TEMPLATE_LANGUAGE is required when PROFESSIONAL_OPPORTUNITY_TRANSPORT is 'template'"
      );
    }
    if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(tplLangRaw)) {
      throw new Error(
        "WHATSAPP_PROFESSIONAL_OPPORTUNITY_TEMPLATE_LANGUAGE must be in standard format (e.g. pt_BR)"
      );
    }
    professionalOpportunityTemplateLanguage = tplLangRaw;
  }

  return {
    enabled,
    rolloutMode,
    allowedPhones,
    professionalOpportunityTransport,
    professionalOpportunityTemplateName,
    professionalOpportunityTemplateLanguage,
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
