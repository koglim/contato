import type { MessageSearchInput } from "@contatocerto/shared";
import type { MessageInterpretationService } from "../message-interpretation/message-interpretation.types.js";
import type { SearchOrchestrationService } from "../search-orchestration/search-orchestration.types.js";
import type { MessageSearchOutcome, MessageSearchService } from "./message-search.types.js";

export class DeterministicMessageSearchService implements MessageSearchService {
  constructor(
    private readonly messageInterpretationService: MessageInterpretationService,
    private readonly searchOrchestrationService: SearchOrchestrationService,
  ) {}

  async search(input: MessageSearchInput): Promise<MessageSearchOutcome> {
    const interpretation = this.messageInterpretationService.interpret({
      raw_text: input.raw_text,
      country_code: input.country_code,
    });

    if (interpretation.status === "needs_location") {
      return {
        kind: "response",
        response: {
          status: "needs_location",
          stage: "interpretation",
          reason: "missing_explicit_location",
          interpretation,
          orchestration: null,
        },
      };
    }

    const orchestration = await this.searchOrchestrationService.orchestrate({
      raw_text: interpretation.raw_text,
      service_text: interpretation.service_text,
      location_text: interpretation.location_text,
      country_code: interpretation.country_code,
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
            interpretation,
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
            interpretation,
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
            interpretation,
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
            interpretation,
            orchestration: orchestration.response,
          },
        };
    }
  }
}
