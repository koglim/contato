import { z } from "zod";

export const DEFAULT_CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS = 60;

export interface ChannelOutboundConfig {
  processingLeaseSeconds: number;
  authTemplateName?: string;
  authTemplateLanguage?: string;
}

const positiveInteger = z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().positive());

export function readChannelOutboundConfig(environment: NodeJS.ProcessEnv = process.env): ChannelOutboundConfig {
  const parsed = positiveInteger.safeParse(
    environment.CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS
      ?? String(DEFAULT_CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS),
  );
  if (!parsed.success) throw new Error("Invalid channel outbound configuration: CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS");

  const authEnabled = environment.PROFESSIONAL_AUTH_ENABLED === "true";
  const rawTplName = environment.WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_NAME?.trim();
  const rawTplLang = environment.WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_LANGUAGE?.trim();

  if (authEnabled) {
    if (!rawTplName) {
      throw new Error("WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_NAME is required when PROFESSIONAL_AUTH_ENABLED is 'true'");
    }
    if (!/^[a-z0-9_]+$/.test(rawTplName)) {
      throw new Error("WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_NAME must be a lower-case Meta-safe identifier");
    }
    if (!rawTplLang) {
      throw new Error("WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_LANGUAGE is required when PROFESSIONAL_AUTH_ENABLED is 'true'");
    }
    if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(rawTplLang)) {
      throw new Error("WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_LANGUAGE must be standard format like pt_BR or en_US");
    }
  } else {
    if (rawTplName !== undefined && rawTplName !== "" && !/^[a-z0-9_]+$/.test(rawTplName)) {
      throw new Error("WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_NAME must be a lower-case Meta-safe identifier");
    }
    if (rawTplLang !== undefined && rawTplLang !== "" && !/^[a-z]{2}(_[A-Z]{2})?$/.test(rawTplLang)) {
      throw new Error("WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_LANGUAGE must be standard format like pt_BR or en_US");
    }
  }

  return {
    processingLeaseSeconds: parsed.data,
    ...(rawTplName ? { authTemplateName: rawTplName } : {}),
    ...(rawTplLang ? { authTemplateLanguage: rawTplLang } : {}),
  };
}
