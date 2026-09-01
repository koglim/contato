import type { MessageSearchInput, MessageSearchResponse } from "@contatocerto/shared";
import type { SearchExecutionContext } from "../matching/matching.types.js";

export type MessageSearchOutcome =
  | { kind: "response"; response: MessageSearchResponse }
  | { kind: "service_unavailable" };

export type MessageSearchService = {
  search(input: MessageSearchInput, context?: SearchExecutionContext): Promise<MessageSearchOutcome>;
};
