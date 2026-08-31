import type { SearchOrchestrationInput, SearchOrchestrationResponse } from "@contatocerto/shared";

export type SearchOrchestrationOutcome =
  | { kind: "response"; response: SearchOrchestrationResponse }
  | { kind: "service_unavailable" };

export type SearchOrchestrationService = {
  orchestrate(input: SearchOrchestrationInput): Promise<SearchOrchestrationOutcome>;
};
