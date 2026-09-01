import type { SearchOrchestrationInput, SearchOrchestrationResponse } from "@contatocerto/shared";
import type { SearchExecutionContext } from "../matching/matching.types.js";

export type SearchOrchestrationOutcome =
  | { kind: "response"; response: SearchOrchestrationResponse }
  | { kind: "service_unavailable" };

export type SearchOrchestrationService = {
  orchestrate(input: SearchOrchestrationInput, context?: SearchExecutionContext): Promise<SearchOrchestrationOutcome>;
};
