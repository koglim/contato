export type MessageLocationFallbackInput = {
  raw_text: string;
  country_code: string;
};

export type MessageLocationFallbackResult =
  | { status: "resolved"; location_text: string }
  | { status: "unresolved"; location_text: null };

export type MessageLocationFallbackErrorKind = "unavailable" | "rate_limited" | "provider_error";

export class MessageLocationFallbackProviderError extends Error {
  constructor(readonly kind: MessageLocationFallbackErrorKind, options?: ErrorOptions) {
    super(`Message location fallback failed: ${kind}`, options);
    this.name = "MessageLocationFallbackProviderError";
  }
}

export interface MessageLocationFallbackProvider {
  readonly name: string;
  resolve(input: MessageLocationFallbackInput): Promise<MessageLocationFallbackResult>;
}
