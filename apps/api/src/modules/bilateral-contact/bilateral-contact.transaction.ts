import { z } from "zod";
import {
  selectionMessageContractSchema,
  arePhoneIdentitiesEquivalent,
  getPhoneIdentityAliases,
  normalizeBrazilianMobilePhone,
  INTERACTIVE_ACTION_TOKEN_TTL_DAYS,
  type InteractiveOutboundPayload,
} from "@contatocerto/shared";
import type { DatabaseClient } from "../../database/connection.js";
import type { ConsentOutcome, SelectShownMatchInput } from "../match-selection/match-selection.types.js";
import { createIndependentOutbound } from "../channel-outbox/channel-outbox.repository.js";
import { presentSelectionMessage } from "../selection-message/selection-message.presenter.js";
import { mapSelectionCommandOutcome } from "../selection-message/selection-message.mapper.js";
import { readInteractiveActionConfig, isInteractiveActionContactEligible } from "../../config/interactive-action.js";
import { generateInteractiveActionToken } from "../interactive-action/interactive-action.crypto.js";
import { PostgresInteractiveActionRepository } from "../interactive-action/interactive-action.repository.js";
import { BILATERAL_NOTICE, BILATERAL_NOTICE_VERSION, bilateralSnapshotSchema, safeOpportunityText,
  parseBilateralConfirmation, presentProfessionalOpportunity, type BilateralSnapshot } from "./bilateral-contact.policy.js";

export const pendingConsentSchema = z.object({
  matchId: z.string().uuid(), position: z.number().int().positive(),
  professionalDisplayName: z.string().min(1).max(120),
  choiceKey: z.string().uuid(), chosenAt: z.string().datetime(),
  noticeOutboundId: z.string().uuid(), noticeVersion: z.literal(BILATERAL_NOTICE_VERSION),
}).strict();

type Inbound = { id: string; provider: string; phone_e164: string; raw_text: string; created_at: Date; decision_at: Date };
export async function selectionInbound(client: DatabaseClient, input: SelectShownMatchInput) {
  const result = await client.query<Inbound & { customer_phone_e164?: string }>(`SELECT inbound.id, inbound.provider, inbound.phone_e164,
      inbound.raw_text, inbound.created_at, NOW() AS decision_at, customers.phone_e164 AS customer_phone_e164
    FROM channel_inbound_messages inbound JOIN customers ON customers.id = $2
    WHERE inbound.id = $1`, [input.selectionKey, input.customerId]);
  const inbound = result.rows[0];
  if (!inbound) return null;
  if (inbound.customer_phone_e164 && !arePhoneIdentitiesEquivalent(inbound.phone_e164, inbound.customer_phone_e164)) return null;
  return inbound.raw_text === input.lastMessageText ? inbound : null;
}

export async function persistConsentResponse(client: DatabaseClient, input: SelectShownMatchInput, inbound: Inbound, outcome: ConsentOutcome) {
  const contract = selectionMessageContractSchema.parse(mapSelectionCommandOutcome(outcome));
  const text = presentSelectionMessage(contract)!;
  const outbound = await client.query<{ id: string }>(`INSERT INTO channel_outbound_messages
    (channel_inbound_message_id, provider, recipient_phone_e164, text_content, bilateral_notice_version)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (channel_inbound_message_id) WHERE channel_inbound_message_id IS NOT NULL DO NOTHING RETURNING id`,
  [inbound.id, inbound.provider, inbound.phone_e164, text, outcome.kind === "consent_required" ? BILATERAL_NOTICE_VERSION : null]);
  if (!outbound.rows[0]) throw new Error("Consent response idempotency conflict");
  await client.query(`UPDATE channel_inbound_messages SET bilateral_response = $2::jsonb,
    customer_id = $3, conversation_id = $4, search_request_id = $5 WHERE id = $1`,
  [inbound.id, JSON.stringify(contract), input.customerId, input.conversationId, input.searchRequestId]);
  return outbound.rows[0].id;
}

export type BilateralMatch = { match_id: string; display_name: string; phone_e164: string; service_name: string };
export type BilateralReady = { inbound: Inbound; noticeId: string; noticeSentAt: Date; choiceKey: string; chosenAt: string; method: BilateralSnapshot["consent_method"] };

export async function prepareBilateralSelection(client: DatabaseClient, input: SelectShownMatchInput, match: BilateralMatch, pendingValue: unknown): Promise<
  | { kind: "ready"; context: BilateralReady }
  | ConsentOutcome | { kind: "idempotency_conflict" }
> {
  const inbound = await selectionInbound(client, input);
  if (!inbound) return { kind: "idempotency_conflict" };
  const pending = pendingValue ? pendingConsentSchema.parse(pendingValue) : null;
  if (input.confirmBilateral) {
    if (!pending || pending.matchId !== match.match_id || parseBilateralConfirmation(inbound.raw_text) !== "confirm") return { kind: "idempotency_conflict" };
    // Repeated prompts for this same pending choice are valid too. The original
    // may have failed while a subsequent clarification was actually delivered.
    // Compare database timestamps directly (JS Date truncates microseconds).
    const notice = await client.query<{ id: string; sent_at: Date }>(`SELECT outbound.id, outbound.sent_at
      FROM channel_outbound_messages outbound
      JOIN channel_inbound_messages prompt ON prompt.id = outbound.channel_inbound_message_id
      WHERE outbound.status = 'sent' AND outbound.recipient_phone_e164 = ANY($2)
        AND outbound.bilateral_notice_version = $3
        AND outbound.sent_at <= (SELECT created_at FROM channel_inbound_messages WHERE id = $4)
        AND strpos(outbound.text_content, $5) > 0
        AND prompt.customer_id = $6 AND prompt.conversation_id = $7 AND prompt.search_request_id = $8
        AND prompt.created_at >= (SELECT created_at FROM channel_inbound_messages WHERE id = $9)
        AND (outbound.id = $1 OR (
          prompt.result ->> 'route' = 'selection'
          AND prompt.result -> 'result' ->> 'kind' = 'consent_required'
          AND prompt.result -> 'result' ->> 'professional_name' = $10))
      ORDER BY outbound.sent_at DESC, outbound.id LIMIT 1`,
    [pending.noticeOutboundId, getPhoneIdentityAliases(inbound.phone_e164), BILATERAL_NOTICE_VERSION, inbound.id, BILATERAL_NOTICE,
      input.customerId, input.conversationId, input.searchRequestId, pending.choiceKey, pending.professionalDisplayName]);
    if (!notice.rows[0]) return { kind: "consent_required", professionalDisplayName: pending.professionalDisplayName };
    return { kind: "ready", context: { inbound, noticeId: notice.rows[0].id, noticeSentAt: notice.rows[0].sent_at,
      choiceKey: pending.choiceKey, chosenAt: pending.chosenAt, method: "legacy_confirmation" } };
  }
  if (pending) return { kind: "consent_required", professionalDisplayName: pending.professionalDisplayName };
  const notice = await client.query<{ id: string; sent_at: Date }>(`SELECT outbound.id, outbound.sent_at
    FROM channel_outbound_message_matches presentation
    JOIN channel_outbound_messages outbound ON outbound.id = presentation.channel_outbound_message_id
    JOIN channel_inbound_messages original ON original.id = outbound.channel_inbound_message_id
    WHERE presentation.match_id = $1 AND original.customer_id = $2 AND original.search_request_id = $3
      AND original.conversation_id = $8
      AND outbound.recipient_phone_e164 = ANY($4) AND outbound.status = 'sent'
      AND outbound.bilateral_notice_version = $5
      AND outbound.sent_at <= (SELECT created_at FROM channel_inbound_messages WHERE id = $6)
      AND strpos(outbound.text_content, $7) > 0`,
  [match.match_id, input.customerId, input.searchRequestId, getPhoneIdentityAliases(inbound.phone_e164), BILATERAL_NOTICE_VERSION, inbound.id, BILATERAL_NOTICE, input.conversationId]);
  if (notice.rows[0]) return { kind: "ready", context: { inbound, noticeId: notice.rows[0].id,
    noticeSentAt: notice.rows[0].sent_at, choiceKey: inbound.id, chosenAt: inbound.decision_at.toISOString(), method: "selection_after_notice" } };
  const outcome: ConsentOutcome = { kind: "consent_required", professionalDisplayName: safeOpportunityText(match.display_name, 120) || "profissional escolhido" };
  const noticeOutboundId = await persistConsentResponse(client, input, inbound, outcome);
  const state = pendingConsentSchema.parse({ matchId: match.match_id, position: input.position,
    professionalDisplayName: outcome.professionalDisplayName, choiceKey: inbound.id,
    chosenAt: inbound.decision_at.toISOString(), noticeOutboundId, noticeVersion: BILATERAL_NOTICE_VERSION });
  await client.query("UPDATE search_conversations SET bilateral_pending = $2::jsonb WHERE id = $1", [input.conversationId, JSON.stringify(state)]);
  return outcome;
}

export async function createBilateralContact(client: DatabaseClient, input: SelectShownMatchInput,
  match: BilateralMatch & { professional_id: string }, context: BilateralReady, selectedAt: Date, generateCode: () => string) {
  const request = await client.query<{ city: string | null; state: string | null; neighborhood: string | null; raw_text: string; location_text: string | null }>(
    `SELECT city, state, neighborhood, raw_text, conversation.location_text FROM search_requests
      JOIN search_conversations conversation ON conversation.id = $2 AND conversation.search_request_id = search_requests.id
      WHERE search_requests.id = $1`, [input.searchRequestId, input.conversationId]);
  const location = request.rows[0];
  if (!location) throw new Error("Bilateral search context unavailable");
  const textOrNull = (text: string | null) => safeOpportunityText(text, 120) || null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const snapshot = bilateralSnapshotSchema.parse({
      public_code: generateCode(), service_name: safeOpportunityText(match.service_name, 120) || "Serviço solicitado",
      professional_name: safeOpportunityText(match.display_name, 120) || "Profissional escolhido",
      professional_phone_e164: normalizeBrazilianMobilePhone(match.phone_e164),
      customer_phone_e164: normalizeBrazilianMobilePhone(context.inbound.phone_e164),
      city: textOrNull(location.city), state: textOrNull(location.state),
      // Only retain a neighborhood actually present in the customer's request.
      neighborhood: location.neighborhood && `${location.raw_text} ${location.location_text ?? ""}`.toLocaleLowerCase("pt-BR").includes(location.neighborhood.toLocaleLowerCase("pt-BR")) ? textOrNull(location.neighborhood) : null,
      summary: safeOpportunityText(location.raw_text) || safeOpportunityText(match.service_name, 120),
      notice_version: BILATERAL_NOTICE_VERSION, notice_outbound_id: context.noticeId,
      notice_sent_at: context.noticeSentAt.toISOString(), choice_inbound_id: context.choiceKey,
      chosen_at: context.chosenAt, consented_at: selectedAt.toISOString(), consent_method: context.method,
      connection_rule_version: "connection-v2",
    });
    const inserted = await client.query<{ id: string }>(`INSERT INTO contacts
      (search_request_id, customer_id, professional_id, status, selection_key, public_code, bilateral_snapshot, selection_conversation_id)
      VALUES ($1, $2, $3, 'shared', $4, $5, $6::jsonb, $7)
      ON CONFLICT (lower(public_code)) WHERE public_code IS NOT NULL DO NOTHING RETURNING id`,
    [input.searchRequestId, input.customerId, match.professional_id, input.selectionKey,
      snapshot.public_code, JSON.stringify(snapshot), input.conversationId]);
    if (!inserted.rows[0]) continue;
    const contactId = inserted.rows[0].id;
    const contract = selectionMessageContractSchema.parse({ kind: "selected", public_code: snapshot.public_code,
      professional_name: snapshot.professional_name, professional_phone_e164: snapshot.professional_phone_e164, service_name: snapshot.service_name });
    await client.query(`INSERT INTO channel_outbound_messages
      (channel_inbound_message_id, provider, recipient_phone_e164, text_content)
      VALUES ($1, $2, $3, $4)`, [input.selectionKey, context.inbound.provider, normalizeBrazilianMobilePhone(snapshot.customer_phone_e164), presentSelectionMessage(contract)]);
    const interactiveConfig = readInteractiveActionConfig();
    const isEligible = isInteractiveActionContactEligible(
      snapshot.customer_phone_e164,
      snapshot.professional_phone_e164,
      interactiveConfig
    );

    if (isEligible) {
      const tokenCompletion = generateInteractiveActionToken();
      const tokenUnavailability = generateInteractiveActionToken();
      let payload: InteractiveOutboundPayload;

      if (interactiveConfig.professionalOpportunityTransport === "template") {
        const locationStr =
          snapshot.city && snapshot.state
            ? `${snapshot.city} / ${snapshot.state}`
            : snapshot.city || snapshot.state || "Local não informado";

        payload = {
          schema_version: 1,
          type: "template_quick_reply",
          template_name: interactiveConfig.professionalOpportunityTemplateName!,
          language_code: interactiveConfig.professionalOpportunityTemplateLanguage!,
          body_parameters: [
            snapshot.service_name,
            locationStr,
            snapshot.summary,
            snapshot.customer_phone_e164,
            snapshot.public_code,
          ],
          actions: [
            {
              action_id: tokenCompletion,
              label: "Concluído",
            },
            {
              action_id: tokenUnavailability,
              label: "Não consigo atender",
            },
          ],
        };
      } else {
        payload = {
          schema_version: 1,
          type: "button_group",
          body: presentProfessionalOpportunity(snapshot),
          actions: [
            {
              action_id: tokenCompletion,
              label: "Concluído",
            },
            {
              action_id: tokenUnavailability,
              label: "Não consigo atender",
            },
          ],
        };
      }

      const outbound = await createIndependentOutbound(client, {
        businessKey: `contact:${contactId}:initial`,
        purpose: "professional_contact_notification",
        provider: context.inbound.provider,
        recipientPhoneE164: normalizeBrazilianMobilePhone(snapshot.professional_phone_e164),
        messageType: "interactive",
        textContent: presentProfessionalOpportunity(snapshot),
        interactivePayload: payload,
      });

      const tokenRepo = new PostgresInteractiveActionRepository();
      const ttlMs = INTERACTIVE_ACTION_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
      const expiresAt = new Date(Date.now() + ttlMs);

      await tokenRepo.createTokens(client, [
        {
          publicToken: tokenCompletion,
          outboundMessageId: outbound.id,
          contactId,
          completionId: null,
          actionType: "declare_completion",
          intendedActorRole: "professional",
          intendedPhoneE164: snapshot.professional_phone_e164,
          expiresAt,
        },
        {
          publicToken: tokenUnavailability,
          outboundMessageId: outbound.id,
          contactId,
          completionId: null,
          actionType: "declare_unavailability",
          intendedActorRole: "professional",
          intendedPhoneE164: snapshot.professional_phone_e164,
          expiresAt,
        },
      ]);
    } else {
      await createIndependentOutbound(client, {
        businessKey: `contact:${contactId}:initial`,
        purpose: "professional_contact_notification",
        provider: context.inbound.provider,
        recipientPhoneE164: normalizeBrazilianMobilePhone(snapshot.professional_phone_e164),
        textContent: presentProfessionalOpportunity(snapshot),
      });
    }
    return { contactId, snapshot };
  }
  throw new Error("Opportunity code allocation exhausted");
}
