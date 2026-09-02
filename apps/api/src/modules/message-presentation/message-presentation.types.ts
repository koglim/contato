import type { CustomerSearchMessageResponse } from "@contatocerto/shared";

export interface MessagePresenter {
  present(result: CustomerSearchMessageResponse): string;
}
