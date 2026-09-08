import type { CustomerSearchMessageResponse } from "@contatocerto/shared";

export type SearchRouteMessageResponse = Extract<CustomerSearchMessageResponse, { route: "started" | "continued" }>;

export interface MessagePresenter {
  present(result: SearchRouteMessageResponse): string;
}
