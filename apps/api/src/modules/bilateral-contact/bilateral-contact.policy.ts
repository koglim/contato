import { randomInt } from "node:crypto";
import { z } from "zod";

export const BILATERAL_NOTICE_VERSION = "bilateral-v1";
export const BILATERAL_NOTICE = "Ao escolher, vocês receberão o telefone um do outro somente para combinar o atendimento solicitado.";
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function createOpportunityCode() {
  return `CC-${Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("")}`;
}

/** Single plain-text line. No markup, control characters, links or identifiers. */
export function safeOpportunityText(value: string | null | undefined, max = 160) {
  return (value ?? "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, " ")
    .replace(/(?:https?:\/\/|www\.)\S+|\S+@\S+/giu, " ")
    .replace(/\+?\d[\d\s().-]{6,}\d/gu, " ")
    .replace(/[^\p{L}\p{N} ,.!?/:;()-]/gu, " ")
    .replace(/\s+/gu, " ").trim().slice(0, max).trim();
}

export function parseBilateralConfirmation(raw: string): "confirm" | "decline" | null {
  // A question mark must never be removed into an affirmative command.
  if (raw.includes("?")) return null;
  const text = raw.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .trim().replace(/[.!]+$/u, "").replace(/\s+/gu, " ").trim();
  if (["sim", "pode", "quero", "confirmo", "pode sim", "sim pode", "pode compartilhar", "pode passar meu telefone", "autorizo", "sim confirmo"].includes(text)) return "confirm";
  if (["nao", "nao quero", "nao autorizo", "nao compartilhe", "prefiro nao", "desisto"].includes(text)) return "decline";
  return null;
}

const phone = z.string().regex(/^\+[1-9]\d{7,14}$/u);
export const bilateralSnapshotSchema = z.object({
  public_code: z.string().regex(/^CC-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/u),
  service_name: z.string().min(1).max(120),
  city: z.string().max(120).nullable(),
  state: z.string().max(120).nullable(),
  neighborhood: z.string().max(120).nullable(),
  summary: z.string().min(1).max(160),
  professional_name: z.string().min(1).max(120),
  professional_phone_e164: phone,
  customer_phone_e164: phone,
  notice_version: z.literal(BILATERAL_NOTICE_VERSION),
  notice_outbound_id: z.string().uuid(),
  notice_sent_at: z.string().datetime(),
  choice_inbound_id: z.string().uuid(),
  chosen_at: z.string().datetime(),
  consented_at: z.string().datetime(),
  consent_method: z.enum(["selection_after_notice", "legacy_confirmation"]),
}).strict();
export type BilateralSnapshot = z.infer<typeof bilateralSnapshotSchema>;

export function presentProfessionalOpportunity(snapshot: BilateralSnapshot) {
  return [
    `Um cliente escolheu você — ${snapshot.public_code}`,
    `Serviço: ${snapshot.service_name}`,
    `Local: ${[snapshot.city, snapshot.state].filter(Boolean).join(" / ") || "não informado"}`,
    ...(snapshot.neighborhood ? [`Bairro: ${snapshot.neighborhood}`] : []),
    `Solicitação: ${snapshot.summary}`,
    `Telefone do cliente: ${snapshot.customer_phone_e164}`,
    "Entre em contato para combinar o atendimento solicitado.",
  ].join("\n");
}
