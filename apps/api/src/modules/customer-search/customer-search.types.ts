import type {
  ChannelLocationInput,
  CustomerSearchMessageInput,
  CustomerSearchMessageResponse,
} from "@contatocerto/shared";

export type CustomerSearchRouteOutcome =
  | { kind: "response"; response: CustomerSearchMessageResponse; conversationId: string | null; searchRequestId: string | null; presentedMatchIds: string[] }
  | { kind: "customer_conversation_conflict" }
  | { kind: "customer_phone_identity_collision" }
  | { kind: "conversation_processing" }
  | { kind: "service_unavailable" }
  | { kind: "selection_idempotency_key_required" }
  | { kind: "selection_show_more_pending" };

export type CustomerSearchRouteInput = CustomerSearchMessageInput & { selectionKey?: string };

export type CustomerSearchTurnOwnershipInput = {
  phone_e164: string;
  raw_text?: string | null;
  location?: ChannelLocationInput | null;
};

export interface CustomerSearchRouter {
  route(input: CustomerSearchRouteInput): Promise<CustomerSearchRouteOutcome>;
  shouldOwnTurn?(input: CustomerSearchTurnOwnershipInput): Promise<boolean>;
}
