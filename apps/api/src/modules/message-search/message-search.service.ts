import type { MessageSearchInput } from "@contatocerto/shared";
import {
  MessageLocationFallbackProviderError,
  type MessageLocationFallbackErrorKind,
  type MessageLocationFallbackProvider,
} from "../message-interpretation-fallback/message-location-fallback.types.js";
import type { MessageInterpretationService } from "../message-interpretation/message-interpretation.types.js";
import type { SearchOrchestrationService } from "../search-orchestration/search-orchestration.types.js";
import type { MessageSearchOutcome, MessageSearchService } from "./message-search.types.js";

type MessageSearchFallbackOptions = {
  enabled: boolean;
  onError?: (event: { kind: MessageLocationFallbackErrorKind; durationMs: number }) => void;
};

const fallbackReason = {
  unavailable: "fallback_unavailable",
  rate_limited: "fallback_rate_limited",
  provider_error: "fallback_provider_error",
} as const;

export class HybridMessageSearchService implements MessageSearchService {
  constructor(
    private readonly messageInterpretationService: MessageInterpretationService,
    private readonly searchOrchestrationService: SearchOrchestrationService,
    private readonly messageLocationFallbackProvider: MessageLocationFallbackProvider,
    private readonly fallbackOptions: MessageSearchFallbackOptions,
  ) {}

  async search(input: MessageSearchInput): Promise<MessageSearchOutcome> {
    const interpretation = this.messageInterpretationService.interpret({
      raw_text: input.raw_text,
      country_code: input.country_code,
    });

    let resolvedInterpretation;
    if (interpretation.status === "needs_location") {
      if (!this.fallbackOptions.enabled) {
        return this.interpretationFailure("missing_explicit_location", interpretation);
      }

      const startedAt = Date.now();
      try {
        const fallback = await this.messageLocationFallbackProvider.resolve({
          raw_text: interpretation.raw_text,
          country_code: interpretation.country_code,
        });
        if (fallback.status === "unresolved") {
          return this.interpretationFailure("location_not_understood", interpretation);
        }
        resolvedInterpretation = {
          status: "interpreted" as const,
          raw_text: interpretation.raw_text,
          service_text: interpretation.raw_text,
          location_text: fallback.location_text,
          country_code: interpretation.country_code,
          interpretation: {
            service_strategy: "full_message" as const,
            location_strategy: "llm_fallback" as const,
          },
        };
      } catch (error) {
        const kind = error instanceof MessageLocationFallbackProviderError ? error.kind : "provider_error";
        this.fallbackOptions.onError?.({ kind, durationMs: Date.now() - startedAt });
        return this.interpretationFailure(fallbackReason[kind], interpretation);
      }
    } else {
      resolvedInterpretation = interpretation;
    }

    const orchestration = await this.searchOrchestrationService.orchestrate({
      raw_text: resolvedInterpretation.raw_text,
      service_text: resolvedInterpretation.service_text,
      location_text: resolvedInterpretation.location_text,
      country_code: resolvedInterpretation.country_code,
      limit: input.limit,
    });

    if (orchestration.kind === "service_unavailable") return orchestration;

    switch (orchestration.response.status) {
      case "needs_service":
        return {
          kind: "response",
          response: {
            status: "needs_service",
            stage: "service_resolution",
            reason: orchestration.response.reason,
            interpretation: resolvedInterpretation,
            orchestration: orchestration.response,
          },
        };
      case "needs_location":
        return {
          kind: "response",
          response: {
            status: "needs_location",
            stage: "location_resolution",
            reason: orchestration.response.reason,
            interpretation: resolvedInterpretation,
            orchestration: orchestration.response,
          },
        };
      case "matched":
        return {
          kind: "response",
          response: {
            status: "matched",
            stage: "matching",
            reason: null,
            interpretation: resolvedInterpretation,
            orchestration: orchestration.response,
          },
        };
      case "no_matches":
        return {
          kind: "response",
          response: {
            status: "no_matches",
            stage: "matching",
            reason: null,
            interpretation: resolvedInterpretation,
            orchestration: orchestration.response,
          },
        };
    }
  }

  private interpretationFailure(
    reason: "missing_explicit_location" | "location_not_understood" | "fallback_unavailable" | "fallback_rate_limited" | "fallback_provider_error",
    interpretation: Extract<ReturnType<MessageInterpretationService["interpret"]>, { status: "needs_location" }>,
  ): MessageSearchOutcome {
    return {
      kind: "response",
      response: {
        status: "needs_location",
        stage: "interpretation",
        reason,
        interpretation,
        orchestration: null,
      },
    };
  }
}
