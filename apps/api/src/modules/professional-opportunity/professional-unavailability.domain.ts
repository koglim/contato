import {
  normalizeBrazilianMobilePhone,
} from "@contatocerto/shared";
import type { DatabaseClient } from "../../database/connection.js";
import {
  bilateralSnapshotSchema,
  safeOpportunityText,
} from "../bilateral-contact/bilateral-contact.policy.js";
import { resumedMatchEligibilitySql } from "./resumed-match-eligibility.js";

export type UnavailabilityDomainOutcome = {
  action: "unavailability_declared" | "unavailable";
  replyText: string;
  publicCode: string;
  eventId?: string;
  responseOutboundId?: string;
};

export type UnavailabilityContactInput = {
  id: string;
  customer_id: string;
  professional_id: string;
  search_request_id: string;
  selection_conversation_id: string;
  public_code: string;
  status: string;
  bilateral_snapshot: unknown;
};

type Conversation = {
  id: string;
  customer_id: string;
  status: string;
  pending_slot: string | null;
  resume_slot: string | null;
  search_request_id: string | null;
  service_text: string;
  location_text: string | null;
  valid: boolean;
  processing_token: string | null;
  resume_code?: string | null;
};

export interface UnavailabilityDomainOptions {
  provider?: string;
}

export async function executeUnavailabilityDeclaration(
  db: DatabaseClient,
  contact: UnavailabilityContactInput,
  professionalId: string,
  inboundId: string,
  options?: UnavailabilityDomainOptions
): Promise<UnavailabilityDomainOutcome> {
  const snapshot = bilateralSnapshotSchema.parse(contact.bilateral_snapshot);

  if (contact.status === "completed") {
    return {
      action: "unavailable",
      replyText: `Esta solicitação de ${safeOpportunityText(snapshot.service_name, 120)}, código ${contact.public_code}, já foi concluída.`,
      publicCode: contact.public_code,
    };
  }

  const existingUnavailability = (await db.query<{ id: string }>(
    "SELECT id FROM professional_unavailability_events WHERE contact_id = $1",
    [contact.id]
  )).rows[0];

  if (existingUnavailability) {
    const old = (await db.query<{ id: string; text_content: string }>(
      `SELECT outbound.id, outbound.text_content FROM channel_outbound_messages outbound
       WHERE outbound.professional_unavailability_event_id = $1 AND outbound.purpose = 'professional_reply'`,
      [existingUnavailability.id]
    )).rows[0];
    const replyText = old?.text_content ?? `Indisponibilidade registrada para ${contact.public_code}. O cliente foi avisado.`;
    return {
      action: "unavailability_declared",
      replyText,
      publicCode: contact.public_code,
      eventId: existingUnavailability.id,
      responseOutboundId: old?.id,
    };
  }

  if (contact.status === "shared") {
    const event = (await db.query<{ id: string }>(
      `INSERT INTO professional_unavailability_events
        (contact_id, professional_id, inbound_id, origin, rule_version)
       VALUES ($1, $2, $3, 'channel_inbox', 'connection-v2')
       ON CONFLICT (contact_id) DO NOTHING RETURNING id`,
      [contact.id, professionalId, inboundId]
    )).rows[0];

    if (!event) {
      const existing = (await db.query<{ id: string }>(
        "SELECT id FROM professional_unavailability_events WHERE contact_id = $1",
        [contact.id]
      )).rows[0];
      const old = existing ? (await db.query<{ id: string; text_content: string }>(
        `SELECT outbound.id, outbound.text_content FROM channel_outbound_messages outbound
         WHERE outbound.professional_unavailability_event_id = $1 AND outbound.purpose = 'professional_reply'`,
        [existing.id]
      )).rows[0] : null;
      return {
        action: "unavailability_declared",
        replyText: old?.text_content ?? `Indisponibilidade registrada para ${contact.public_code}. O cliente foi avisado.`,
        publicCode: contact.public_code,
        eventId: existing?.id,
        responseOutboundId: old?.id,
      };
    }

    await db.query("UPDATE search_requests SET status = 'matched' WHERE id = $1 AND status = 'selected'", [contact.search_request_id]);

    const conversation = (await db.query<Conversation>(
      `SELECT *, expires_at > NOW() AS valid FROM search_conversations WHERE id = $1 FOR NO KEY UPDATE`,
      [contact.selection_conversation_id]
    )).rows[0];

    let customerText = `O profissional informou que não poderá atender a solicitação de ${safeOpportunityText(snapshot.service_name, 120)}, código ${contact.public_code}.`;

    if (conversation) {
      const other = (await db.query<Conversation>(
        `SELECT *, expires_at > NOW() AS valid FROM search_conversations
         WHERE customer_id = $1 AND id <> $2 AND status = 'active' AND expires_at > NOW() FOR NO KEY UPDATE`,
        [contact.customer_id, conversation.id]
      )).rows[0];

      await db.query(
        "UPDATE search_conversations SET resume_slot = 'selection', resume_code = $2 WHERE id = $1 AND status <> 'active'",
        [conversation.id, contact.public_code]
      );

      if (conversation.valid) {
        if (!other && conversation.status === "completed") {
          await db.query(
            `UPDATE search_conversations SET status = 'active', pending_slot = 'selection', resume_slot = NULL, completed_at = NULL WHERE id = $1`,
            [conversation.id]
          );
          const remaining = (await db.query<{ shown: number; unshown: number }>(
            `SELECT
               count(*) FILTER (WHERE shown_at IS NOT NULL)::integer AS shown,
               count(*) FILTER (WHERE shown_at IS NULL)::integer AS unshown
             FROM matches WHERE search_request_id = $1 AND rank_position <= 6 AND ${resumedMatchEligibilitySql}`,
            [contact.search_request_id]
          )).rows[0];
          customerText += remaining.shown
            ? " Você pode escolher outra opção já apresentada."
            : remaining.unshown
              ? " Para ver outras opções, envie ‘mostrar mais’."
              : " Não restaram opções válidas nesta busca. Envie ‘nova busca’ para procurar novamente.";
        } else {
          customerText += other
            ? ` Sua busca atual por ${safeOpportunityText(other.service_text, 100)} continua normalmente.`
            : " Sua busca atual permanece como está.";
          customerText += ` Para voltar à solicitação anterior, envie “retomar ${contact.public_code}”.`;
        }
      } else {
        customerText += ` A busca anterior expirou. Você pode iniciar uma nova busca de ${safeOpportunityText(snapshot.service_name, 120)} em ${safeOpportunityText([snapshot.city, snapshot.state].filter(Boolean).join(" / "), 120)}.`;
      }
    }

    let provider = options?.provider;
    if (!provider) {
      const providerRow = (await db.query<{ provider: string }>(
        "SELECT provider FROM channel_inbound_messages WHERE id = (SELECT selection_key FROM contacts WHERE id = $1)",
        [contact.id]
      )).rows[0];
      provider = providerRow?.provider;
    }
    if (!provider) throw new Error("Opportunity delivery context is unavailable");

    await db.query(
      `INSERT INTO channel_outbound_messages (purpose, provider, recipient_phone_e164, text_content, business_key, professional_unavailability_event_id)
       VALUES ('customer_contact_update', $1, $2, $3, $4, $5)`,
      [provider, normalizeBrazilianMobilePhone(snapshot.customer_phone_e164), customerText, `unavailability:${event.id}:customer`, event.id]
    );

    const profReplyText = `Indisponibilidade registrada para ${contact.public_code}. O cliente foi avisado.`;
    return {
      action: "unavailability_declared",
      replyText: profReplyText,
      publicCode: contact.public_code,
      eventId: event.id,
    };
  }

  return {
    action: "unavailable",
    replyText: "Essa oportunidade não está disponível para resposta.",
    publicCode: contact.public_code,
  };
}
