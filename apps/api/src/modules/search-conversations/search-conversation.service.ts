import { randomUUID } from "node:crypto";
import type { ContinueSearchConversationInput, StartSearchConversationInput } from "@contatocerto/shared";
import type { SearchConversationConfig } from "../../config/search-conversation.js";
import type { MessageSearchService } from "../message-search/message-search.types.js";
import type { SearchOrchestrationService } from "../search-orchestration/search-orchestration.types.js";
import type {
  ContinueSearchConversationOutcome,
  SearchConversationRecord,
  SearchConversationRepository,
  SearchConversationService,
  StartSearchConversationOutcome,
} from "./search-conversation.types.js";

function hasUsableLocation(locationText: string | null) {
  return locationText !== null && locationText.trim().length > 0;
}

export class DefaultSearchConversationService implements SearchConversationService {
  constructor(
    private readonly repository: SearchConversationRepository,
    private readonly messageSearchService: MessageSearchService,
    private readonly searchOrchestrationService: SearchOrchestrationService,
    private readonly config: SearchConversationConfig,
  ) {}

  async start(
    input: StartSearchConversationInput,
    context: { customerId?: string } = {},
  ): Promise<StartSearchConversationOutcome> {
    const search = await this.messageSearchService.search(input, context);
    if (search.kind === "service_unavailable") return search;

    if (search.response.status === "needs_location" && search.response.stage === "interpretation") {
      const conversation = await this.repository.createPending({
        ...(context.customerId ? { customerId: context.customerId } : {}),
        pendingSlot: "location",
        originalRawText: input.raw_text,
        serviceText: search.response.interpretation.service_text,
        locationText: null,
        countryCode: input.country_code,
        limitValue: input.limit,
        ttlMinutes: this.config.ttlMinutes,
      });
      return {
        kind: "response",
        response: {
          conversation_id: conversation.id,
          conversation_status: "active",
          pending_slot: "location",
          result: search.response,
        },
      };
    }

    if (
      search.response.status === "needs_service"
      && search.response.stage === "service_resolution"
      && hasUsableLocation(search.response.interpretation.location_text)
    ) {
      const conversation = await this.repository.createPending({
        ...(context.customerId ? { customerId: context.customerId } : {}),
        pendingSlot: "service",
        originalRawText: input.raw_text,
        serviceText: search.response.interpretation.service_text,
        locationText: search.response.interpretation.location_text,
        countryCode: input.country_code,
        limitValue: input.limit,
        ttlMinutes: this.config.ttlMinutes,
      });
      return {
        kind: "response",
        response: {
          conversation_id: conversation.id,
          conversation_status: "active",
          pending_slot: "service",
          result: search.response,
        },
      };
    }

    if (search.response.status === "matched" && hasUsableLocation(search.response.interpretation.location_text)) {
      const conversation = await this.repository.createAwaitingSelection({
        ...(context.customerId ? { customerId: context.customerId } : {}),
        originalRawText: input.raw_text,
        serviceText: search.response.interpretation.service_text,
        locationText: search.response.interpretation.location_text,
        countryCode: input.country_code,
        limitValue: input.limit,
        searchRequestId: search.response.orchestration.matching.search_request_id,
        ttlMinutes: this.config.ttlMinutes,
      });
      return {
        kind: "response",
        response: {
          conversation_id: conversation.id,
          conversation_status: "active",
          pending_slot: "selection",
          result: search.response,
        },
      };
    }

    return {
      kind: "response",
      response: {
        conversation_id: null,
        conversation_status: "completed",
        result: search.response,
      },
    };
  }

  async continueConversation(
    conversationId: string,
    input: ContinueSearchConversationInput,
  ): Promise<ContinueSearchConversationOutcome> {
    const existing = await this.repository.findById(conversationId);
    const invalidState = this.invalidState(existing);
    if (invalidState) return { kind: invalidState };

    const processingToken = randomUUID();
    const conversation = await this.repository.claim(
      conversationId,
      processingToken,
      this.config.processingLeaseSeconds,
    );
    if (!conversation) {
      const current = await this.repository.findById(conversationId);
      const currentInvalidState = this.invalidState(current);
      return { kind: currentInvalidState ?? "conversation_processing" };
    }

    if (conversation.pendingSlot === null || (conversation.pendingSlot === "service" && !hasUsableLocation(conversation.locationText))) {
      await this.repository.releaseClaim(conversationId, processingToken);
      return { kind: "conversation_not_active" };
    }

    const serviceText = conversation.pendingSlot === "service" ? input.raw_text : conversation.serviceText;
    const locationText = conversation.pendingSlot === "location" ? input.raw_text : conversation.locationText!;

    let orchestration;
    try {
      orchestration = await this.searchOrchestrationService.orchestrate({
        raw_text: conversation.originalRawText,
        service_text: serviceText,
        location_text: locationText,
        country_code: conversation.countryCode,
        limit: conversation.limitValue,
      }, conversation.customerId ? { customerId: conversation.customerId } : {});
    } catch (error) {
      await this.repository.releaseClaim(conversationId, processingToken);
      throw error;
    }

    if (orchestration.kind === "service_unavailable") {
      await this.repository.releaseClaim(conversationId, processingToken);
      return orchestration;
    }

    if (orchestration.response.status === "needs_location") {
      const updated = await this.repository.updatePending({
        id: conversationId,
        processingToken,
        pendingSlot: "location",
        serviceText,
        locationText,
        lastMessageText: input.raw_text,
        ttlMinutes: this.config.ttlMinutes,
      });
      if (!updated) return { kind: "conversation_not_active" };
      return {
        kind: "response",
        response: {
          conversation_id: conversationId,
          conversation_status: "active",
          pending_slot: "location",
          result: orchestration.response,
        },
      };
    }

    if (orchestration.response.status === "needs_service") {
      const updated = await this.repository.updatePending({
        id: conversationId,
        processingToken,
        pendingSlot: "service",
        serviceText,
        locationText,
        lastMessageText: input.raw_text,
        ttlMinutes: this.config.ttlMinutes,
      });
      if (!updated) return { kind: "conversation_not_active" };
      return {
        kind: "response",
        response: {
          conversation_id: conversationId,
          conversation_status: "active",
          pending_slot: "service",
          result: orchestration.response,
        },
      };
    }

    if (orchestration.response.status === "matched") {
      const moved = await this.repository.moveToAwaitingSelection({
        id: conversationId,
        processingToken,
        serviceText,
        locationText,
        lastMessageText: input.raw_text,
        searchRequestId: orchestration.response.matching.search_request_id,
        ttlMinutes: this.config.ttlMinutes,
      });
      if (!moved) return { kind: "conversation_not_active" };
      return {
        kind: "response",
        response: {
          conversation_id: conversationId,
          conversation_status: "active",
          pending_slot: "selection",
          result: orchestration.response,
        },
      };
    }

    const completed = await this.repository.complete({
      id: conversationId,
      processingToken,
      serviceText,
      locationText,
      lastMessageText: input.raw_text,
      searchRequestId: orchestration.response.matching.search_request_id,
    });
    if (!completed) return { kind: "conversation_not_active" };

    return {
      kind: "response",
      response: {
        conversation_id: conversationId,
        conversation_status: "completed",
        pending_slot: null,
        result: orchestration.response,
      },
    };
  }

  private invalidState(record: SearchConversationRecord | null) {
    if (!record) return "conversation_not_found" as const;
    if (record.isExpired || record.status === "expired") return "conversation_expired" as const;
    if (record.status !== "active" || record.pendingSlot === null) return "conversation_not_active" as const;
    return null;
  }
}
