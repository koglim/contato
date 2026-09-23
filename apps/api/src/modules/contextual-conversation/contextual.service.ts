import { channelInboundMessageResponseSchema, contextualMessageSchema, type ChannelInboundMessageResponse, type CustomerSearchMessageResponse } from "@contatocerto/shared";
import { type DatabaseClient } from "../../database/connection.js";
import { InboxFenceError, InboxPermanentError } from "../channel-inbox/inbox-recovery.policy.js";
import { readSearchConversationConfig } from "../../config/search-conversation.js";
import { DEFAULT_OPENAI_CONVERSATION_TIMEOUT_MS } from "../../config/contextual-conversation.js";
import { PostgresCatalogRepository } from "../catalog/catalog.repository.js";
import { PostgresServiceResolutionRepository } from "../service-resolution/service-resolution.repository.js";
import type { ServiceResolutionRepository } from "../service-resolution/service-resolution.types.js";
import type { LocationResolutionService } from "../location-resolution/location-resolution.types.js";
import { extractExplicitLocation } from "../message-interpretation/message-interpretation.location.js";
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
import { parseBilateralConfirmation } from "../bilateral-contact/bilateral-contact.policy.js";
import { resolveProfessionalSelection } from "../selection-command/professional-selection.resolver.js";
import { CONTEXTUAL_POLICY, contextualProposalSchema, controlContextualProposal, emptyMemory, normalizeContextualText, validateContextualQuestion, type ContextualDecision, type ContextualProvider } from "./contextual.contract.js";
import { ContextualBusyError, PostgresContextualRepository, type ContextualSnapshot } from "./contextual.repository.js";
import { CONTEXTUAL_COST_POLICY, CONTEXTUAL_FALLBACK, CONTEXTUAL_CLARIFY, CONTEXTUAL_GREETING, CONTEXTUAL_SMALL_TALK, CONTEXTUAL_SCOPE, contextualQuestionContext, contextualClarificationText, contextualCatalogText, validatePersistedContextualQuestion } from "./contextual.reply.js";
import { classifyConversationAIError, withConversationAITimeout, type ConversationAIFallbackEvent, type ConversationAIFallbackReason, type ConversationAIStage } from "./contextual.provider.js";
import { deterministicSearchProposal } from "./contextual.fast-path.js";

export interface ContextualInboxHandler { handle(record: ChannelInboundMessageRecord): Promise<ChannelInboxOutcome> }
export { CONTEXTUAL_COST_POLICY } from "./contextual.reply.js";
const stripPrivate = (text: string) => text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, "[email omitido]").replace(/\+?\d[\d\s().-]{7,}\d/gu, "[número omitido]").replace(/https?:\/\/\S+/gu, "[link omitido]");
type ContextualConversationOptions = {
  timeoutMs?: number;
  onFallback?: (event: ConversationAIFallbackEvent) => void;
  onDecision?: (event: {
    decision: ContextualDecision["kind"];
    serviceResolution: "exact" | "phrase" | "fuzzy" | "semantic" | "confirmed_memory" | "none";
    hadPriorHypothesis: boolean;
    locationCandidate: boolean;
    locationResolution: "resolved" | "ambiguous" | "unresolved" | "not_attempted";
    fallback: boolean;
  }) => void;
  onExecutionPath?: (event: { path: "deterministic_fast_path" | "ai_interpretation" | "persisted_proposal" | "confirmed_hypothesis" | "critical_delegate";
    interpretationCalled: boolean; compositionCalled: boolean; serviceResolution: "exact" | "phrase" | "fuzzy" | "semantic" | "confirmed_memory" | "none";
    locationResolution: "resolved" | "ambiguous" | "unresolved" | "not_attempted"; finalStatus: string; totalDurationMs: number }) => void;
};

export class ContextualConversationService implements ContextualInboxHandler {
  private failures = 0;
  private circuitUntil = 0;
  constructor(
    private readonly provider: ContextualProvider,
    private readonly location: LocationResolutionService,
    private readonly options: ContextualConversationOptions = {},
    private readonly repository = new PostgresContextualRepository(),
    private readonly catalog = new PostgresCatalogRepository(),
    private readonly services: ServiceResolutionRepository = new PostgresServiceResolutionRepository(),
  ) {}

  private fallbackReason(error: unknown, stage: ConversationAIStage): ConversationAIFallbackReason {
    if (stage === "interpretation" || stage === "composition") return classifyConversationAIError(error).reason;
    if (stage === "budget") return "policy_limit";
    if (stage === "proposal_persistence" || stage === "draft_persistence") return "state_error";
    if (stage === "controller") return "controller_error";
    return "dependency_error";
  }

  private reportFallback(error: unknown, startedAt: number, stage: ConversationAIFallbackEvent["stage"]) {
    const failure = classifyConversationAIError(error);
    try {
      this.options.onFallback?.({
        reason: this.fallbackReason(error, stage),
        durationMs: Math.max(0, Date.now() - startedAt),
        model: this.provider.model,
        stage,
        ...((stage !== "interpretation" && stage !== "composition") || failure.statusHttp === undefined ? {} : { statusHttp: failure.statusHttp }),
        ...(failure.structuredOutput === undefined ? {} : { structuredOutput: failure.structuredOutput }),
      });
    } catch {
      // Observability must never replace the deterministic fallback.
    }
  }

  private reportDecision(event: Parameters<NonNullable<ContextualConversationOptions["onDecision"]>>[0]) {
    try { this.options.onDecision?.(event); } catch { /* Observability is non-authoritative. */ }
  }

  private reportExecutionPath(event: Parameters<NonNullable<ContextualConversationOptions["onExecutionPath"]>>[0]) {
    try { this.options.onExecutionPath?.(event); } catch { /* Observability is non-authoritative. */ }
  }

  async handle(record: ChannelInboundMessageRecord): Promise<ChannelInboxOutcome> {
    const turnStartedAt = Date.now();
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
      const hadPriorHypothesis = snapshot.memory.hypotheses.length > 0;
      let serviceResolution: "exact" | "phrase" | "fuzzy" | "semantic" | "confirmed_memory" | "none" = snapshot.memory.service ? "confirmed_memory" : "none";
      let locationCandidate = false;
      let path: "deterministic_fast_path" | "ai_interpretation" | "persisted_proposal" | "confirmed_hypothesis" | "critical_delegate" = "ai_interpretation";
      let interpretationCalled = false;
      let compositionCalled = false;
      if (global || recoveredSelection || (snapshot.pendingSlot === "selection" && (command !== null || namedSelection || parseBilateralConfirmation(record.rawText) !== null))) {
        path = "critical_delegate";
        decision = { kind: "delegate", memory: snapshot.memory, correction: false };
      } else if (snapshot.memory.hypotheses.length === 1 && /^(sim|isso|isso mesmo|confirmo)$/.test(confirmation)) {
        path = "confirmed_hypothesis";
        const hypothesis = snapshot.memory.hypotheses[0];
        decision = { kind: "search", correction: false, memory: { ...snapshot.memory, service: { value: hypothesis.name, source: "user_confirmation", inboundId: record.id }, hypotheses: [] } };
      } else {
        let providerAttempted = false;
        let fallbackStage: ConversationAIStage = "catalog";
        let fallbackStartedAt = Date.now();
        let catalog: Array<{ key: string; name: string; description: string | null }> = [];
        let explicitService: string | null = null;
        let explicitServiceKey: string | null = null;
        let explicitServiceEvidence: string | null = null;
        try {
          catalog = (await this.catalog.listServices({})).slice(0, CONTEXTUAL_POLICY.maxCatalog)
            .map(item => ({ key: item.slug, name: item.name.slice(0, 200), description: item.description?.slice(0, 200) ?? null }));
          fallbackStage = "service_resolution";
          fallbackStartedAt = Date.now();
          const explicit = await this.services.resolve({ text: record.rawText });
          const explicitMatch = explicit.status === "resolved" && explicit.match && explicit.match.method !== "fuzzy"
            && (` ${normalizeContextualText(record.rawText)} `).includes(` ${normalizeContextualText(explicit.match.matched_term)} `)
            ? explicit.match : null;
          explicitService = explicitMatch?.service.name ?? null;
          explicitServiceKey = explicitMatch?.service.slug ?? null;
          explicitServiceEvidence = explicitMatch?.matched_term ?? null;
          if (explicit.status === "resolved" && explicit.match) serviceResolution = explicit.match.method;
          let proposal = snapshot.proposal;
          if (proposal) path = "persisted_proposal";
          if (!proposal) {
            if (snapshot.pendingSlot !== "selection" && explicitMatch && catalog.some(item => item.key === explicitMatch.service.slug && item.name === explicitMatch.service.name)) {
              proposal = deterministicSearchProposal(record.rawText, explicitMatch.matched_term, explicitMatch.service.slug);
            }
            if (proposal) path = "deterministic_fast_path";
          }
          if (!proposal) {
            fallbackStage = "interpretation";
            fallbackStartedAt = Date.now();
            if (this.circuitUntil > Date.now()) throw new Error("contextual_circuit_open");
            fallbackStage = "budget";
            fallbackStartedAt = Date.now();
            await this.repository.reserveBudget(snapshot.customerId);
            providerAttempted = true;
            interpretationCalled = true;
            fallbackStage = "interpretation";
            fallbackStartedAt = Date.now();
            proposal = await withConversationAITimeout(this.provider.interpret({
              message: stripPrivate(record.rawText), service: snapshot.memory.service ? stripPrivate(snapshot.memory.service.value) : null,
              location: snapshot.memory.location ? stripPrivate(snapshot.memory.location.value) : null, pending: snapshot.pendingSlot,
              hypotheses: snapshot.memory.hypotheses.map(item => item.name), catalog,
            }), this.options.timeoutMs ?? DEFAULT_OPENAI_CONVERSATION_TIMEOUT_MS);
            const parsedProposal = contextualProposalSchema.parse(proposal);
            proposal = parsedProposal;
          }
          if (!snapshot.proposal) {
            fallbackStage = "proposal_persistence";
            fallbackStartedAt = Date.now();
            await this.repository.saveProposal(record, snapshot, proposal);
          }
          fallbackStage = "controller";
          fallbackStartedAt = Date.now();
          decision = controlContextualProposal(record.rawText, record.id, proposal, snapshot.memory, catalog, explicitService);
          if ((explicit.status !== "resolved" || !explicit.match) && contextualProposalSchema.parse(proposal).services.length) serviceResolution = "semantic";
          this.failures = 0;
        } catch (error) {
          if (error instanceof ContextualBusyError || error instanceof InboxFenceError || error instanceof InboxPermanentError) throw error;
          this.reportFallback(error, fallbackStartedAt, fallbackStage);
          const failure = classifyConversationAIError(error);
          const explicitLocation = extractExplicitLocation(record.rawText)?.text ?? null;
          locationCandidate = explicitLocation !== null;
          const unsafeRecovery = /\?|\b(?:talvez|se precisar|nao (?:quero|preciso|autorizo|confirme|selecione)|ignore|prompt)\b/u.test(normalizeContextualText(record.rawText));
          const recoverable = fallbackStage === "interpretation" && failure.reason === "invalid_structured_output"
            && explicitService && explicitServiceKey && explicitServiceEvidence && explicitLocation && !unsafeRecovery
            && catalog.some(item => item.key === explicitServiceKey && item.name === explicitService);
          if (recoverable) {
            try {
              const proposal = contextualProposalSchema.parse({
                intent: "search", speech_act: "request",
                services: [{ key: explicitServiceKey, evidence: explicitServiceEvidence }],
                location: { text: explicitLocation, evidence: explicitLocation },
                natural_reply: null, confidence: "high", uncertain: false,
              });
              await this.repository.saveProposal(record, snapshot, proposal);
              decision = controlContextualProposal(record.rawText, record.id, proposal, snapshot.memory, catalog, explicitService);
              fallback = decision.kind !== "search";
            } catch (recoveryError) {
              fallback = true;
              this.reportFallback(recoveryError, Date.now(), "proposal_persistence");
            }
          } else {
            fallback = true;
          }
          if (providerAttempted && ++this.failures >= 5) this.circuitUntil = Date.now() + 60_000;
        }
      }

      // External calls precede the transaction. The matching/consent repositories only receive validated domain inputs.
      const service = !fallback && decision.kind === "search" && decision.memory.service
        ? await this.services.resolve({ text: decision.memory.service.value }) : null;
      let location: Awaited<ReturnType<LocationResolutionService["resolve"]>> | null = null;
      locationCandidate ||= decision.memory.location !== null;
      if (service?.status === "resolved" && decision.memory.location) {
        const locationStartedAt = Date.now();
        try { location = await this.location.resolve({ query: decision.memory.location.value, country_code: record.countryCode, limit: 5 }); }
        catch (error) {
          this.reportFallback(error, locationStartedAt, "location_resolution");
          fallback = true;
          decision = { kind: "clarify", memory: snapshot.memory, correction: false };
        }
      }
      this.reportDecision({
        decision: decision.kind,
        serviceResolution,
        hadPriorHypothesis,
        locationCandidate,
        locationResolution: location?.status ?? "not_attempted",
        fallback,
      });
      const captured = snapshot;
      let question = snapshot.draft;
      const questionContext = fallback ? null : contextualQuestionContext(decision, service?.status === "resolved", location?.status === "resolved");
      if (questionContext && question) {
        try { validatePersistedContextualQuestion(question, questionContext); }
        catch { throw new InboxPermanentError("persisted_draft_invalid"); }
      }
      if (questionContext && !question && (questionContext.target === "location" || (questionContext.target === "service" && questionContext.reason === "missing"))) {
        question = contextualClarificationText(questionContext);
        await this.repository.saveDraft(record, snapshot, question);
      }
      if (questionContext && !question && this.provider.composeQuestion) {
        let fallbackStage: ConversationAIStage = "budget";
        let fallbackStartedAt = Date.now();
        try {
          await this.repository.reserveBudget(snapshot.customerId);
          compositionCalled = true;
          fallbackStage = "composition";
          fallbackStartedAt = Date.now();
          question = validateContextualQuestion(await withConversationAITimeout(
            this.provider.composeQuestion(questionContext),
            this.options.timeoutMs ?? DEFAULT_OPENAI_CONVERSATION_TIMEOUT_MS,
          ), questionContext);
          fallbackStage = "draft_persistence";
          fallbackStartedAt = Date.now();
          await this.repository.saveDraft(record, snapshot, question);
        } catch (error) {
          if (error instanceof ContextualBusyError || error instanceof InboxFenceError || error instanceof InboxPermanentError) throw error;
          this.reportFallback(error, fallbackStartedAt, fallbackStage);
          // A failed composer is also a completed wording decision. Reuse its fallback after a DB retry.
          question = contextualClarificationText(questionContext);
          await this.repository.saveDraft(record, snapshot, question);
        }
      }
      const outcome = await this.repository.commit(record, captured, async client => {
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
        let text = fallback ? CONTEXTUAL_FALLBACK : CONTEXTUAL_CLARIFY;

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
        } else if (!fallback && decision.kind === "catalog_info") {
          text = contextualCatalogText(decision.catalogServices ?? []); status = "information";
        } else if (!fallback && decision.kind === "greeting") {
          text = decision.naturalReply ?? CONTEXTUAL_GREETING; status = "information";
        } else if (!fallback && decision.kind === "small_talk") {
          text = decision.naturalReply ?? CONTEXTUAL_SMALL_TALK; status = "information";
        } else if (!fallback && decision.kind === "out_of_scope") {
          text = decision.naturalReply ?? CONTEXTUAL_SCOPE; status = "information";
        } else if (!fallback && decision.kind === "clarify" && decision.naturalReply) {
          text = decision.naturalReply;
        } else if (!fallback && memory.hypotheses.length) {
          text = question ?? contextualClarificationText(questionContext!);
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
              status = "needs_service"; text = question ?? contextualClarificationText(questionContext!);
            } else if (!memory.location || location?.status !== "resolved" || !location.match) {
              status = "needs_location";
              text = question ?? contextualClarificationText(questionContext!);
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
      this.reportExecutionPath({ path, interpretationCalled, compositionCalled, serviceResolution,
        locationResolution: location?.status ?? "not_attempted",
        finalStatus: outcome.kind === "response" ? outcome.response.result.route === "contextual"
          ? outcome.response.result.status : outcome.response.result.route : outcome.kind,
        totalDurationMs: Math.max(0, Date.now() - turnStartedAt) });
      return outcome;
    } catch (error) {
      if (error instanceof ContextualBusyError) {
        return { kind: "channel_message_processing" };
      }
      throw error;
    } finally { if (snapshot) await this.repository.release(snapshot); }
  }
}
