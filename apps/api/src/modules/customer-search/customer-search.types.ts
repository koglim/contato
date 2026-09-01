import type {
  CustomerSearchMessageInput,
  CustomerSearchMessageResponse,
} from "@contatocerto/shared";

export type CustomerSearchRouteOutcome =
  | { kind: "response"; response: CustomerSearchMessageResponse }
  | { kind: "customer_conversation_conflict" }
  | { kind: "conversation_processing" }
  | { kind: "service_unavailable" };

export interface CustomerSearchRouter {
  route(input: CustomerSearchMessageInput): Promise<CustomerSearchRouteOutcome>;
}
