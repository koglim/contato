import type { MessageSearchInput, MessageSearchResponse } from "@contatocerto/shared";

export type MessageSearchOutcome =
  | { kind: "response"; response: MessageSearchResponse }
  | { kind: "service_unavailable" };

export type MessageSearchService = {
  search(input: MessageSearchInput): Promise<MessageSearchOutcome>;
};
