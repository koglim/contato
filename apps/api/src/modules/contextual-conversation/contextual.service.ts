import { channelInboundMessageResponseSchema, contextualMessageSchema, type ChannelInboundMessageResponse, type CustomerSearchMessageResponse } from "@contatocerto/shared";
import { query, type DatabaseClient } from "../../database/connection.js";
import { readSearchConversationConfig } from "../../config/search-conversation.js";
import { PostgresCatalogRepository } from "../catalog/catalog.repository.js";
import { PostgresServiceResolutionRepository } from "../service-resolution/service-resolution.repository.js";
import type { ServiceResolutionRepository } from "../service-resolution/service-resolution.types.js";
import type { LocationResolutionService } from "../location-resolution/location-resolution.types.js";
import type { ChannelInboundMessageRecord, ChannelInboxOutcome } from "../channel-inbox/channel-inbox.types.js";
import { PostgresChannelInboundMessageRepository } from "../channel-inbox/channel-inbox.repository.js";
import { PostgresSearchConversationRepository } from "../search-conversations/search-conversation.repository.js";
import { PostgresMatchingRepository } from "../matching/matching.repository.js";
import { DefaultCustomerSearchRouter } from "../customer-search/customer-search.service.js";
import { DefaultSelectionCommandService } from "../selection-command/selection-command.service.js";
import { PostgresSelectionMatchRepository } from "../match-selection/match-selection.repository.js";
import { DefaultGlobalConversationCommandService } from "../global-conversation-commands/global-conversation-command.service.js";
import { PostgresGlobalConversationCommandRepository } from "../global-conversation-commands/global-conversation-command.repository.js";
import { parseGlobalConversationCommand, parseSelectionConversationCommand } from "../conversation-commands/conversation-command.parser.js";
import { presentSelectionMessage } from "../selection-message/selection-message.presenter.js";
import { presentGlobalConversationMessage } from "../global-conversation-commands/global-conversation-message.presenter.js";
import { presentMatches } from "../message-presentation/message-presentation.service.js";
import { safeOpportunityText, parseBilateralConfirmation } from "../bilateral-contact/bilateral-contact.policy.js";
import { resolveProfessionalSelection } from "../selection-command/professional-selection.resolver.js";
import { CONTEXTUAL_POLICY, contextualProposalSchema, controlContextualProposal, emptyMemory, normalizeContextualText, validateContextualQuestion, type ContextualDecision, type ContextualProvider, type ContextualReplyContext } from "./contextual.contract.js";
import { ContextualBusyError, PostgresContextualRepository, type ContextualSnapshot } from "./contextual.repository.js";

export interface ContextualInboxHandler { handle(record: ChannelInboundMessageRecord): Promise<ChannelInboxOutcome> }
export const CONTEXTUAL_COST_POLICY = "Usar o ContatoCerto é gratuito para o cliente. O valor do serviço é combinado e pago diretamente ao profissional. Sua busca continua de onde parou.";
const FALLBACK = "Não consegui entender sua mensagem com segurança agora. Sua busca foi preservada. Pode me dizer o que precisa ou o que quer corrigir?";
const stripPrivate = (text: string) => text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, "[email omitido]").replace(/\+?\d[\d\s().-]{7,}\d/gu, "[número omitido]").replace(/https?:\/\/\S+/gu, "[link omitido]");

export class ContextualConversationService implements ContextualInboxHandler {
  private failures = 0;
  private circuitUntil = 0;
  constructor(
    private readonly provider: ContextualProvider,
    private readonly location: LocationResolutionService,
    private readonly repository = new PostgresContextualRepository(),
    private readonly catalog = new PostgresCatalogRepository(),
    private readonly services: ServiceResolutionRepository = new PostgresServiceResolutionRepository(),
  ) {}

  async handle(record: ChannelInboundMessageRecord): Promise<ChannelInboxOutcome> {
    let snapshot: ContextualSnapshot | undefined;
    try {
      snapshot = await this.repository.acquire(record, this.provider.model);
      const global = parseGlobalConversationCommand(record.rawText);
      const recoveredSelection = !global && await new DefaultSelectionCommandService({ selectionMatchRepository: new PostgresSelectionMatchRepository() })
        .recoverSelection(snapshot.customerId, record.id);
      const command = parseSelectionConversationCommand(record.rawText);
      const confirmation = normalizeContextualText(record.rawText);
      let namedSelection = false;
      if (!global && !recoveredSelection && snapshot.pendingSlot === "selection" && snapshot.conversationId) {
        const current = await new PostgresSearchConversationRepository().findById(snapshot.conversationId);
        if (current?.searchRequestId) {
          const shown = await new PostgresSelectionMatchRepository().listShown(current.searchRequestId);
          namedSelection = resolveProfessionalSelection(record.rawText, shown).kind !== "unresolved";
        }
      }
      let decision: ContextualDecision = { kind: "clarify", memory: snapshot.memory, correction: false };
      let fallback = false;
      if (global || recoveredSelection || (snapshot.pendingSlot === "selection" && (command !== null || namedSelection || parseBilateralConfirmation(record.rawText) !== null))) {
        decision = { kind: "delegate", memory: snapshot.memory, correction: false };
      } else if (snapshot.memory.hypotheses.length === 1 && /^(sim|isso|isso mesmo|confirmo)$/.test(confirmation)) {
        const hypothesis = snapshot.memory.hypotheses[0];
        decision = { kind: "search", correction: false, memory: { ...snapshot.memory, service: { value: hypothesis.name, source: "user_confirmation", inboundId: record.id }, hypotheses: [] } };
      } else {
        let providerAttempted = false;
        try {
          const catalog = (await this.catalog.listServices({})).slice(0, CONTEXTUAL_POLICY.maxCatalog)
            .map(item => ({ key: item.slug, name: item.name.slice(0, 200), description: item.description?.slice(0, 200) ?? null }));
          let proposal = snapshot.proposal;
          if (!proposal) {
            if (this.circuitUntil > Date.now()) throw new Error("contextual_circuit_open");
            await this.repository.reserveBudget(snapshot.customerId);
            providerAttempted = true;
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              proposal = await Promise.race([
                this.provider.interpret({ message: stripPrivate(record.rawText), service: snapshot.memory.service ? stripPrivate(snapshot.memory.service.value) : null,
                  location: snapshot.memory.location ? stripPrivate(snapshot.memory.location.value) : null, pending: snapshot.pendingSlot,
                  hypotheses: snapshot.memory.hypotheses.map(item => item.name), catalog }),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("contextual_timeout")), CONTEXTUAL_POLICY.timeoutMs); }),
              ]);
            } finally { clearTimeout(timer); }
            proposal = contextualProposalSchema.parse(proposal);
            await this.repository.saveProposal(record, snapshot, proposal);
          }
          const explicit = await this.services.resolve({ text: record.rawText });
          // Semantic/fuzzy guesses alone do not become confirmed facts.
          const explicitService = explicit.status === "resolved" && explicit.match && explicit.match.method !== "fuzzy"
            && (` ${normalizeContextualText(record.rawText)} `).includes(` ${normalizeContextualText(explicit.match.service.name)} `)
            ? explicit.match.service.name : null;
          decision = controlContextualProposal(record.rawText, record.id, proposal, snapshot.memory, catalog, explicitService);
          this.failures = 0;
        } catch (error) {
          if (error instanceof ContextualBusyError) throw error;
          fallback = true;
          if (providerAttempted && ++this.failures >= 5) this.circuitUntil = Date.now() + 60_000;
        }
      }

      // External calls precede the transaction. The matching/consent repositories only receive validated domain inputs.
      const service = !fallback && decision.kind === "search" && decision.memory.service
        ? await this.services.resolve({ text: decision.memory.service.value }) : null;
      let location: Awaited<ReturnType<LocationResolutionService["resolve"]>> | null = null;
      if (service?.status === "resolved" && decision.memory.location) {
        try { location = await this.location.resolve({ query: decision.memory.location.value, country_code: record.countryCode, limit: 5 }); }
        catch { fallback = true; decision = { kind: "clarify", memory: snapshot.memory, correction: false }; }
      }
      const captured = snapshot;
      let question = snapshot.draft;
      const target: ContextualReplyContext["target"] | null = fallback ? null : decision.memory.hypotheses.length ? "service_confirmation"
        : decision.kind === "search" && service?.status !== "resolved" ? "service"
        : decision.kind === "search" && location?.status !== "resolved" ? "location" : null;
      if (target && !question && this.provider.composeQuestion) {
        try {
          await this.repository.reserveBudget(snapshot.customerId);
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            question = validateContextualQuestion(await Promise.race([
              this.provider.composeQuestion({ target, services: decision.memory.hypotheses.length ? decision.memory.hypotheses.map(item => item.name) : decision.memory.service ? [decision.memory.service.value] : [], location: decision.memory.location?.value ?? null }),
              new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("contextual_question_timeout")), CONTEXTUAL_POLICY.timeoutMs); }),
            ]));
          } finally { clearTimeout(timer); }
          await this.repository.saveDraft(record, snapshot, question);
        } catch (error) { if (error instanceof ContextualBusyError) throw error; question = null; }
      }
      return await this.repository.commit(record, captured, async client => {
        const execute = client.query.bind(client);
        const transaction = <T>(callback: (connection: DatabaseClient) => Promise<T>) => callback(client);
        const conversations = new PostgresSearchConversationRepository(execute);
        await conversations.expireStaleForCustomer(captured.customerId);
        let memory = structuredClone(decision.memory);
        let conversationId = captured.conversationId;
        let searchRequestId: string | null = null;
        let matchIds: string[] = [];
        let status: Extract<ChannelInboundMessageResponse["result"], { route: "contextual" }>["status"] = "clarification";
        let result: CustomerSearchMessageResponse | ReturnType<typeof contextualMessageSchema.parse> | undefined;
        let text = fallback ? FALLBACK : "Pode esclarecer o que você quer mudar ou qual opção quer escolher?";

        if (!fallback && decision.kind === "delegate") {
          const router = new DefaultCustomerSearchRouter({ findOrCreateByPhoneE164: async () => ({ id: captured.customerId }) }, conversations,
            { start: async () => { throw new Error("Contextual delegation cannot start a search"); }, continueConversation: async () => { throw new Error("Contextual delegation cannot continue a search"); } },
            new DefaultSelectionCommandService({ selectionMatchRepository: new PostgresSelectionMatchRepository(execute, transaction) }),
            new DefaultGlobalConversationCommandService(new PostgresGlobalConversationCommandRepository(execute)));
          if (global || recoveredSelection || captured.pendingSlot === "selection") {
            const routed = await router.route({ phone_e164: record.phoneE164, raw_text: record.rawText, country_code: record.countryCode, limit: record.limitValue, selectionKey: record.id });
            if (routed.kind !== "response") throw new ContextualBusyError();
            if (routed.response.route !== "selection" && routed.response.route !== "global_command") throw new Error("Unexpected contextual delegation");
            result = routed.response;
            text = result.route === "selection" ? presentSelectionMessage(result.result) ?? text : presentGlobalConversationMessage(result.result);
            searchRequestId = routed.searchRequestId ?? null;
            matchIds = routed.presentedMatchIds ?? [];
            conversationId = routed.conversationId ?? conversationId;
            if (global && global.kind !== "help") memory = emptyMemory();
          }
        } else if (!fallback && decision.kind === "faq_cost") {
          text = CONTEXTUAL_COST_POLICY; status = "information";
        } else if (!fallback && decision.kind === "out_of_scope") {
          text = "Posso ajudar você a encontrar e escolher profissionais de serviços na sua região. Sua busca continua salva. Qual atendimento você precisa?"; status = "information";
        } else if (!fallback && memory.hypotheses.length) {
          text = memory.hypotheses.length === 1
            ? `Você precisa de ${safeOpportunityText(memory.hypotheses[0].name, 120)} para esse problema? Pode confirmar ou explicar melhor.`
            : `Esse pedido pode envolver ${memory.hypotheses.map(item => safeOpportunityText(item.name, 120)).join(" ou ")}. Qual desses atendimentos você precisa?`;
          text = question ?? text;
        } else if (!fallback && decision.kind === "search") {
          // Never change context underneath a pending consent or a page not yet acknowledged as sent.
          const pending = conversationId ? await execute(`SELECT c.id FROM search_conversations c WHERE c.id = $1 AND
            (c.bilateral_pending IS NOT NULL OR EXISTS (SELECT 1 FROM channel_outbound_messages o
             JOIN channel_outbound_message_matches om ON om.channel_outbound_message_id = o.id
             JOIN matches m ON m.id = om.match_id WHERE m.search_request_id = c.search_request_id AND o.status <> 'sent'))`, [conversationId]) : { rows: [] };
          if (pending.rows.length) {
            memory = captured.memory;
            text = "Ainda há uma confirmação ou uma lista de opções pendente. Vamos concluir essa etapa antes de alterar a busca.";
          } else {
            const config = readSearchConversationConfig();
            if (conversationId) {
              // Preserve old requests/contacts; only the active conversation's current search is replaced.
              await execute(`UPDATE search_conversations SET pending_slot = 'location', search_request_id = NULL,
                processing_token = NULL, processing_started_at = NULL WHERE id = $1`, [conversationId]);
            }
            if (!memory.service || service?.status !== "resolved" || !service.match) {
              status = "needs_service"; text = "Qual serviço você precisa? Pode me contar o que aconteceu.";
              text = question ?? text;
            } else if (!memory.location || location?.status !== "resolved" || !location.match) {
              status = "needs_location";
              text = memory.location ? "Essa localização ainda não ficou clara. Pode informar a cidade e o estado ou um bairro de referência?" : `Em qual cidade você precisa de ${safeOpportunityText(memory.service.value, 120)}?`;
              text = question ?? text;
            } else {
              const match = location.match;
              const matching = await new PostgresMatchingRepository(transaction).search({ raw_text: record.rawText,
                service_id: service.match.service.id, latitude: match.latitude, longitude: match.longitude,
                city: match.city ?? undefined, state: match.state ?? undefined, neighborhood: match.neighborhood, limit: record.limitValue }, { customerId: captured.customerId });
              if (matching.kind !== "success") throw new ContextualBusyError();
              searchRequestId = matching.response.search_request_id;
              matchIds = matching.response.matches.map(item => item.match_id);
              status = matchIds.length ? "matched" : "no_matches";
              text = matchIds.length ? presentMatches(matching.response) : "Não encontrei opções para esse serviço nessa região agora. Quer tentar outra localização?";
            }
            const pendingSlot = status === "matched" ? "selection" : status === "needs_service" ? "service" : "location";
            if (!conversationId) {
              const conversation = await conversations.createPending({ customerId: captured.customerId, pendingSlot: pendingSlot === "selection" ? "location" : pendingSlot,
                originalRawText: record.rawText, serviceText: memory.service?.value ?? record.rawText, locationText: memory.location?.value ?? null,
                countryCode: record.countryCode, limitValue: record.limitValue, ttlMinutes: config.ttlMinutes });
              conversationId = conversation.id;
            }
            await execute(`UPDATE search_conversations SET pending_slot = $2, service_text = $3, location_text = $4,
              search_request_id = $5, last_message_text = $6, expires_at = NOW() + ($7 * INTERVAL '1 minute'), updated_at = NOW()
              WHERE id = $1`, [conversationId, pendingSlot, memory.service?.value ?? record.rawText, memory.location?.value ?? null, status === "matched" ? searchRequestId : null, record.rawText, config.ttlMinutes]);
          }
        }
        if (fallback) { status = "fallback"; memory = captured.memory; }
        await execute(`UPDATE contextual_turns SET error_code = $2 WHERE inbound_id = $1`, [record.id, fallback ? "contextual_fallback" : null]);
        memory.conversationId = (await conversations.findActiveByCustomerId(captured.customerId))?.id ?? null;
        result ??= contextualMessageSchema.parse({ route: "contextual", customer_id: captured.customerId, status });
        const outbound = await new PostgresChannelInboundMessageRepository(execute, transaction).markProcessedAndCreateOutbound({
          id: record.id, processingToken: record.processingToken!, result, customerId: captured.customerId, conversationId, searchRequestId,
          outbound: { channelInboundMessageId: record.id, provider: record.provider, recipientPhoneE164: record.phoneE164, textContent: text, searchRequestId, matchIds },
        });
        if (!outbound) throw new ContextualBusyError();
        const response = channelInboundMessageResponseSchema.parse({ message_id: record.id, duplicate: false, reply_text: outbound.textContent,
          outbound: { id: outbound.id, status: outbound.status }, result });
        return { memory, value: { kind: "response" as const, response } };
      });
    } catch (error) {
      if (error instanceof ContextualBusyError) {
        await query(`UPDATE channel_inbound_messages SET status = 'failed', error_code = 'contextual_processing', processing_token = NULL,
          processing_started_at = NULL WHERE id = $1 AND processing_token = $2`, [record.id, record.processingToken]);
        return { kind: "channel_message_processing" };
      }
      throw error;
    } finally { if (snapshot) await this.repository.release(snapshot); }
  }
}
