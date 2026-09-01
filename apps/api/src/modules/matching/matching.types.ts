import type { MatchingSearchInput, MatchingSearchResponse } from "@contatocerto/shared";

export const MATCHING_AVAILABILITY_FRESHNESS_MINUTES = 240;

export type SearchExecutionContext = {
  customerId?: string;
};

export type MatchingSearchOutcome =
  | { kind: "service_not_found" }
  | { kind: "service_inactive" }
  | { kind: "success"; response: MatchingSearchResponse };

export type MatchingRepository = {
  search(input: MatchingSearchInput, context?: SearchExecutionContext): Promise<MatchingSearchOutcome>;
};
