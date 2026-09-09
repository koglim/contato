import { channelInboundMessageResponseSchema, opportunityMessageSchema, type ChannelInboundMessageResponse } from "@contatocerto/shared";
import { withTransaction, type DatabaseClient } from "../../database/connection.js";
import { bilateralSnapshotSchema, createOpportunityCode, safeOpportunityText } from "../bilateral-contact/bilateral-contact.policy.js";
import { parseGlobalConversationCommand } from "../conversation-commands/conversation-command.parser.js";
import type { ChannelInboundMessageRecord } from "../channel-inbox/channel-inbox.types.js";
import { normalizeOpportunityCommand, parseOpportunityMessage } from "./professional-opportunity.parser.js";
import { resolveResumeTarget } from "./resume-target.js";
import { resumedMatchEligibilitySql } from "./resumed-match-eligibility.js";

type Contact = { id: string; professional_id: string; customer_id: string; search_request_id: string;
  selection_conversation_id: string; public_code: string; status: string; bilateral_snapshot: unknown };
type Conversation = { id: string; customer_id: string; status: string; pending_slot: string | null;
  resume_slot: string | null; search_request_id: string | null; service_text: string; location_text: string | null;
  valid: boolean; processing_token: string | null; resume_code?: string | null };
type Result = ReturnType<typeof opportunityMessageSchema.parse>;
type Transaction = <T>(callback: (client: DatabaseClient) => Promise<T>) => Promise<T>;

export class ProfessionalOpportunityService {
  constructor(private readonly transaction: Transaction = withTransaction) {}

  async handle(record: ChannelInboundMessageRecord): Promise<ChannelInboundMessageResponse | null> {
    return this.transaction(async (db) => {
      const inbound = (await db.query<{ status: string; processing_token: string | null; result: unknown; response_outbound_id: string | null }>(
        "SELECT status, processing_token, result, response_outbound_id FROM channel_inbound_messages WHERE id = $1 FOR UPDATE", [record.id])).rows[0];
      if (!inbound) return null;
      if (inbound.status === "processed" && inbound.response_outbound_id) {
        return this.response(db, record.id, inbound.response_outbound_id, opportunityMessageSchema.parse(inbound.result), true);
      }
      if (inbound.status !== "processing" || inbound.processing_token !== record.processingToken) return null;
      if (parseGlobalConversationCommand(record.rawText)) return null;
      const parsed = parseOpportunityMessage(record.rawText);
      const customer = (await db.query<{ id: string }>("SELECT id FROM customers WHERE phone_e164 = $1", [record.phoneE164])).rows[0];
      const active = customer ? (await db.query<Conversation>(`SELECT *, expires_at > NOW() AS valid FROM search_conversations
        WHERE customer_id = $1 AND status = 'active' AND expires_at > NOW()`, [customer.id])).rows[0] : undefined;
      const owned = (await db.query<Contact>(`SELECT contacts.* FROM contacts JOIN professionals ON professionals.id = contacts.professional_id
        WHERE professionals.phone_e164 = $1 AND contacts.bilateral_snapshot ->> 'professional_phone_e164' = $1
          AND contacts.bilateral_snapshot IS NOT NULL
          AND (contacts.status IN ('requested', 'accepted', 'declined') OR lower(contacts.public_code) = ANY($2::text[]))
        ORDER BY (contacts.status = 'requested') DESC, contacts.created_at DESC, contacts.id LIMIT 21`, [record.phoneE164, parsed.codes.map((code) => code.toLowerCase())])).rows;
      const byCode = owned.filter((contact) => parsed.codes.includes(contact.public_code));
      if (parsed.codes.length === 1 && byCode.length === 1 && parsed.resume === null) {
        return this.decide(db, record, byCode[0], parsed.decision);
      }
      if (parsed.resume !== null || parsed.keep) {
        if (!customer) return this.finish(db, record, "unavailable", "Não encontrei uma busca sua para retomar.");
        return this.resume(db, record, customer.id, parsed);
      }
      if (parsed.codes.length) return this.finish(db, record, "unavailable", "Não consegui identificar essa oportunidade para você. Confira o código recebido.");
      const pending = owned.filter((contact) => contact.status === "requested");
      if (customer && parsed.resume === null && /\b(?:retomar|voltar)\b/u.test(normalizeOpportunityCommand(record.rawText)) && record.rawText.includes("?")) {
        return this.finish(db, record, "clarification", "Quer retomar uma busca anterior? Envie ‘retomar’ com o serviço ou o código. Sua busca atual permanece como está.");
      }
      if (active && pending.length && /^(?:talvez|nao sei|onde fica|quanto e|e se eu aceitar|posso responder depois)\??$/u.test(normalizeOpportunityCommand(record.rawText))) {
        return this.finish(db, record, "clarification", "Você quer falar da oportunidade recebida ou continuar sua busca atual? Para responder à oportunidade, envie a decisão com o código.");
      }
      // A short repeat is safe only when there is one owned opportunity and no
      // competing customer context. Otherwise ask for its public code.
      if (parsed.decision && pending.length === 0 && owned.length === 1 && !active) {
        return this.decide(db, record, owned[0], parsed.decision);
      }
      if (parsed.decision && pending.length === 1) {
        if (active && ["sim consigo"].includes(normalizeOpportunityCommand(record.rawText))) {
          return this.finish(db, record, "clarification", `Você quer responder à oportunidade ${pending[0].public_code} ou continuar sua busca? Para a oportunidade, envie sua decisão com o código.`);
        }
        return this.decide(db, record, pending[0], parsed.decision);
      }
      if (pending.length && (parsed.decision || !active)) {
        const options = pending.slice(0, 5).map((contact) => {
          const snapshot = bilateralSnapshotSchema.parse(contact.bilateral_snapshot);
          return `${contact.public_code} — ${safeOpportunityText(snapshot.service_name, 120)} — ${safeOpportunityText([snapshot.city, snapshot.state].filter(Boolean).join(" / "), 120)}`;
        });
        return this.finish(db, record, "clarification", `Responda com uma decisão clara e o código da oportunidade:\n${options.join("\n")}\nExemplo: “aceito ${pending[0].public_code}”.`);
      }
      if (parsed.decision && owned.length > 1) return this.finish(db, record, "clarification", "Informe o código da oportunidade junto com sua decisão para eu identificar a solicitação correta.");
      return null;
    });
  }

  private async decide(db: DatabaseClient, record: ChannelInboundMessageRecord, found: Contact, decision: "accepted" | "declined" | null) {
    // Conversation then search then contact: the same order used by selection.
    await db.query("SELECT id FROM customers WHERE id = $1 FOR NO KEY UPDATE", [found.customer_id]);
    await db.query(`UPDATE search_conversations SET status = 'expired', pending_slot = NULL,
      processing_token = NULL, processing_started_at = NULL WHERE customer_id = $1 AND status = 'active' AND expires_at <= NOW()`, [found.customer_id]);
    const conversation = (await db.query<Conversation>(`SELECT *, expires_at > NOW() AS valid FROM search_conversations WHERE id = $1 FOR NO KEY UPDATE`, [found.selection_conversation_id])).rows[0];
    if (!conversation) return this.finish(db, record, "unavailable", "Essa oportunidade não está disponível para resposta.");
    await db.query("SELECT id FROM search_requests WHERE id = $1 FOR NO KEY UPDATE", [found.search_request_id]);
    const contact = (await db.query<Contact>(`SELECT contacts.* FROM contacts JOIN professionals ON professionals.id = contacts.professional_id
      WHERE contacts.id = $1 AND professionals.phone_e164 = $2 AND bilateral_snapshot ->> 'professional_phone_e164' = $2
      FOR NO KEY UPDATE OF contacts`, [found.id, record.phoneE164])).rows[0];
    if (!contact) return this.finish(db, record, "unavailable", "Não consegui identificar essa oportunidade para você.");
    const snapshot = bilateralSnapshotSchema.parse(contact.bilateral_snapshot);
    if (contact.status === "accepted" || contact.status === "declined") {
      const old = (await db.query<{ id: string; text_content: string }>(`SELECT outbound.id, outbound.text_content FROM opportunity_response_events event
        JOIN channel_outbound_messages outbound ON outbound.opportunity_event_id = event.id AND outbound.purpose = 'professional_reply'
        WHERE event.contact_id = $1`, [contact.id])).rows[0];
      if (!old) throw new Error("Opportunity response is unavailable");
      return this.finish(db, record, contact.status, old.text_content, contact.public_code, old.id);
    }
    if (contact.status !== "requested") return this.finish(db, record, "unavailable", "Essa oportunidade não está aguardando resposta.");
    if (!decision) return this.finish(db, record, "clarification", `Para ${contact.public_code}, responda “aceito ${contact.public_code}” ou “recuso ${contact.public_code}”.`, contact.public_code);
    const event = (await db.query<{ id: string }>(`INSERT INTO opportunity_response_events
      (contact_id, professional_id, inbound_id, previous_state, next_state, origin, rule_version)
      VALUES ($1, $2, $3, 'requested', $4, 'channel_inbox', 'opportunity-response-v1') RETURNING id`,
    [contact.id, contact.professional_id, record.id, decision])).rows[0];
    await db.query("UPDATE contacts SET status = $2 WHERE id = $1 AND status = 'requested'", [contact.id, decision]);
    let customerText = `${safeOpportunityText(snapshot.professional_name, 120)} confirmou interesse na solicitação de ${safeOpportunityText(snapshot.service_name, 120)}, código ${contact.public_code}. Vocês já podem combinar o atendimento diretamente.`;
    if (decision === "declined") {
      const other = (await db.query<Conversation>(`SELECT *, expires_at > NOW() AS valid FROM search_conversations
        WHERE customer_id = $1 AND id <> $2 AND status = 'active' AND expires_at > NOW() FOR NO KEY UPDATE`, [contact.customer_id, conversation.id])).rows[0];
      customerText = `O profissional da solicitação de ${safeOpportunityText(snapshot.service_name, 120)}, código ${contact.public_code}, não poderá atender.`;
      await db.query("UPDATE search_conversations SET resume_slot = 'selection', resume_code = $2 WHERE id = $1 AND status <> 'active'", [conversation.id, contact.public_code]);
      if (conversation.valid) {
        await db.query("UPDATE search_requests SET status = 'matched' WHERE id = $1 AND status = 'selected'", [contact.search_request_id]);
        if (!other && conversation.status === "completed") {
          await db.query(`UPDATE search_conversations SET status = 'active', pending_slot = 'selection', resume_slot = NULL, completed_at = NULL WHERE id = $1`, [conversation.id]);
          const remaining = (await db.query<{ shown: number; unshown: number }>(`SELECT
            count(*) FILTER (WHERE shown_at IS NOT NULL)::integer AS shown,
            count(*) FILTER (WHERE shown_at IS NULL)::integer AS unshown
            FROM matches WHERE search_request_id = $1 AND rank_position <= 6 AND ${resumedMatchEligibilitySql}`, [contact.search_request_id])).rows[0];
          customerText += remaining.shown ? " Você pode escolher outra opção já apresentada."
            : remaining.unshown ? " Para ver outras opções, envie ‘mostrar mais’."
              : " Não restaram opções válidas nesta busca. Envie ‘nova busca’ para procurar novamente.";
        } else {
          customerText += other ? ` Sua busca atual por ${safeOpportunityText(other.service_text, 100)} continua normalmente.` : " Sua busca atual permanece como está.";
          customerText += ` Para voltar à solicitação anterior, envie “retomar ${contact.public_code}”.`;
        }
      } else customerText += ` A busca anterior expirou. Você pode iniciar uma nova busca de ${safeOpportunityText(snapshot.service_name, 120)} em ${safeOpportunityText([snapshot.city, snapshot.state].filter(Boolean).join(" / "), 120)}.`;
    }
    const provider = (await db.query<{ provider: string }>("SELECT provider FROM channel_inbound_messages WHERE id = (SELECT selection_key FROM contacts WHERE id = $1)", [contact.id])).rows[0]?.provider;
    if (!provider) throw new Error("Opportunity delivery context is unavailable");
    await db.query(`INSERT INTO channel_outbound_messages (purpose, provider, recipient_phone_e164, text_content, business_key, opportunity_event_id)
      VALUES ('customer_contact_update', $1, $2, $3, $4, $5)`, [provider, snapshot.customer_phone_e164, customerText, `opportunity:${event.id}:customer`, event.id]);
    const text = decision === "accepted" ? `Oportunidade ${contact.public_code} aceita. Combine o atendimento diretamente com o cliente.` : `Recusa registrada para ${contact.public_code}. O cliente será avisado.`;
    return this.finish(db, record, decision, text, contact.public_code, undefined, event.id);
  }

  private async resume(db: DatabaseClient, record: ChannelInboundMessageRecord, customerId: string,
    parsed: ReturnType<typeof parseOpportunityMessage>) {
    await db.query("SELECT id FROM customers WHERE id = $1 FOR NO KEY UPDATE", [customerId]);
    if (parsed.keep) return this.finish(db, record, "kept", "Tudo certo. Continue sua busca atual normalmente.");
    const targets = (await db.query<Conversation & { public_code: string | null }>(`SELECT conversation.*, conversation.expires_at > NOW() AS valid,
      COALESCE(conversation.resume_code, (SELECT public_code FROM contacts WHERE selection_conversation_id = conversation.id AND status = 'declined' ORDER BY created_at DESC LIMIT 1)) AS public_code
      FROM search_conversations conversation WHERE conversation.customer_id = $1 AND conversation.resume_slot IS NOT NULL
      ORDER BY conversation.created_at DESC LIMIT 30 FOR NO KEY UPDATE OF conversation`, [customerId])).rows;
    const target = resolveResumeTarget(targets, parsed.codes, parsed.resume ?? "");
    if (!target) return this.finish(db, record, "clarification", `Qual busca você quer retomar? ${targets.slice(0, 8).map((target) => `${safeOpportunityText(target.service_text, 100)}${target.public_code ? ` (${target.public_code})` : ""}`).join("; ") || "Informe o serviço da busca anterior."}`);
    if (!target.valid) return this.finish(db, record, "expired", `A busca de ${safeOpportunityText(target.service_text, 120)} expirou. Inicie uma nova busca desse serviço em ${safeOpportunityText(target.location_text, 120) || "sua localização"}.`);
    const current = (await db.query<Conversation>(`SELECT *, expires_at > NOW() AS valid FROM search_conversations WHERE customer_id = $1 AND status = 'active' FOR NO KEY UPDATE`, [customerId])).rows[0];
    if (current?.processing_token) return this.finish(db, record, "clarification", "Sua busca está sendo atualizada. Tente retomar novamente em instantes.");
    let savedCode: string | undefined;
    if (current && current.id !== target.id) {
      savedCode = current.resume_code ?? createOpportunityCode();
      await db.query(`UPDATE search_conversations SET resume_slot = pending_slot::text, resume_code = $2,
        status = 'completed', pending_slot = NULL, completed_at = NOW() WHERE id = $1`, [current.id, savedCode]);
    }
    await db.query(`UPDATE search_conversations SET pending_slot = resume_slot::search_conversation_pending_slot, resume_slot = NULL,
      status = 'active', completed_at = NULL WHERE id = $1`, [target.id]);
    return this.finish(db, record, "resumed", `Retomamos sua busca de ${safeOpportunityText(target.service_text, 120)}. ${target.resume_slot === "selection" ? "Escolha outra opção apresentada ou peça ‘mostrar mais’." : "Continue de onde parou."}${savedCode ? ` A outra busca ficou salva. Para voltar a ela, envie “retomar ${savedCode}”.` : ""}`);
  }

  private async finish(db: DatabaseClient, record: ChannelInboundMessageRecord, kind: Result["result"]["kind"], text: string,
    code?: string, reuseId?: string, eventId?: string) {
    const result = opportunityMessageSchema.parse({ route: "opportunity", result: { kind, text, ...(code ? { public_code: code } : {}) } });
    const command = parseOpportunityMessage(record.rawText);
    const purpose = command.resume !== null || command.keep ? "customer_reply" : "professional_reply";
    const outboundId = reuseId ?? (await db.query<{ id: string }>(`INSERT INTO channel_outbound_messages
      (channel_inbound_message_id, purpose, provider, recipient_phone_e164, text_content, opportunity_event_id, business_key)
      VALUES ($1, $7, $2, $3, $4, $5, $6) RETURNING id`,
    [record.id, record.provider, record.phoneE164, text, eventId ?? null, eventId ? `opportunity:${eventId}:professional` : `context:${record.id}`, purpose])).rows[0].id;
    await db.query(`UPDATE channel_inbound_messages SET status = 'processed', result = $2::jsonb, response_outbound_id = $3,
      processing_token = NULL, processing_started_at = NULL, error_code = NULL, processed_at = NOW() WHERE id = $1`, [record.id, JSON.stringify(result), outboundId]);
    return this.response(db, record.id, outboundId, result, false);
  }

  private async response(db: DatabaseClient, inboundId: string, outboundId: string, result: Result, duplicate: boolean): Promise<ChannelInboundMessageResponse> {
    const outbound = (await db.query<{ id: string; status: "pending" | "processing" | "failed" | "sent"; text_content: string }>(
      "SELECT id, status, text_content FROM channel_outbound_messages WHERE id = $1", [outboundId])).rows[0];
    if (!outbound) throw new Error("Opportunity response is unavailable");
    return channelInboundMessageResponseSchema.parse({ message_id: inboundId, duplicate, reply_text: outbound.text_content, outbound: { id: outbound.id, status: outbound.status }, result });
  }
}
