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

export class DefaultSearchConversationService implements SearchConversationService {
  constructor(
    private readonly repository: SearchConversationRepository,
    private readonly messageSearchService: MessageSearchService,
    private readonly searchOrchestrationService: SearchOrchestrationService,
    private readonly config: SearchConversationConfig,
  ) {}

  async start(input: StartSearchConversationInput): Promise<StartSearchConversationOutcome> {
    const search = await this.messageSearchService.search(input);
    if (search.kind === "service_unavailable") return search;

    if (search.response.status === "needs_location" && search.response.stage === "interpretation") {
      const conversation = await this.repository.createPendingLocation({
        originalRawText: input.raw_text,
        serviceText: search.response.interpretation.service_text,
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

    return {
      kind: "response",
      response: {
        conversation_id: null,
        conversation_status: "completed",
        result: search.response,
      },
    };
  }

  async continueWithLocation(
    conversationId: string,
    input: ContinueSearchConversationInput,
  ): Promise<ContinueSearchConversationOutcome> {
    const existing = await this.repository.findById(conversationId);
    const invalidState = this.invalidState(existing);
    if (invalidState) return { kind: invalidState };

    const processingToken = randomUUID();
    const conversation = await this.repository.claimPendingLocation(
      conversationId,
      processingToken,
      this.config.processingLeaseSeconds,
    );
    if (!conversation) {
      const current = await this.repository.findById(conversationId);
      const currentInvalidState = this.invalidState(current);
      return { kind: currentInvalidState ?? "conversation_processing" };
    }

    let orchestration;
    try {
      orchestration = await this.searchOrchestrationService.orchestrate({
        raw_text: conversation.originalRawText,
        service_text: conversation.serviceText,
        location_text: input.raw_text,
        country_code: conversation.countryCode,
        limit: conversation.limitValue,
      });
    } catch (error) {
      await this.repository.releaseClaim(conversationId, processingToken);
      throw error;
    }

    if (orchestration.kind === "service_unavailable") {
      await this.repository.releaseClaim(conversationId, processingToken);
      return orchestration;
    }

    if (orchestration.response.status === "needs_location") {
      const updated = await this.repository.touchPendingLocation(
        conversationId,
        processingToken,
        input.raw_text,
        this.config.ttlMinutes,
      );
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

    const searchRequestId = orchestration.response.status === "matched" || orchestration.response.status === "no_matches"
      ? orchestration.response.matching.search_request_id
      : null;
    const completed = await this.repository.complete(
      conversationId,
      processingToken,
      input.raw_text,
      searchRequestId,
    );
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
    if (record.status !== "active" || record.pendingSlot !== "location") return "conversation_not_active" as const;
    return null;
  }
}
