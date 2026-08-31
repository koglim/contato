import assert from "node:assert/strict";
import test from "node:test";
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  InternalServerError,
  RateLimitError,
  type ClientOptions,
} from "openai";
import type { MessageInterpretationFallbackConfig } from "../../config/message-interpretation-fallback.js";
import { MessageLocationFallbackProviderError } from "./message-location-fallback.types.js";
import { OpenAIMessageLocationFallbackProvider } from "./openai-message-location-fallback.provider.js";

const config: MessageInterpretationFallbackConfig = {
  enabled: true,
  apiKey: "server-secret-key",
  model: "configured-model",
  timeoutMs: 2_500,
};

type FakeParsedResponse = {
  status: string;
  output_parsed: unknown;
};

function providerWith(responseOrError: FakeParsedResponse | Error) {
  let clientOptions: ClientOptions | undefined;
  let request: unknown;
  const clientFactory = (options: ClientOptions) => {
    clientOptions = options;
    return {
      responses: {
        parse: async (body: unknown) => {
          request = body;
          if (responseOrError instanceof Error) throw responseOrError;
          return responseOrError;
        },
      },
    } as unknown as OpenAI;
  };
  return {
    provider: new OpenAIMessageLocationFallbackProvider(config, clientFactory),
    getClientOptions: () => clientOptions,
    getRequest: () => request,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  return value as Record<string, unknown>;
}

test("OpenAI fallback uses Responses Structured Outputs with a small stateless request", async () => {
  const context = providerWith({ status: "completed", output_parsed: { status: "resolved", location_text: "sinop" } });
  assert.deepEqual(await context.provider.resolve({ raw_text: "preciso de eletricista em sinop", country_code: "BR" }), {
    status: "resolved",
    location_text: "sinop",
  });
  assert.equal(context.provider.name, "openai");
  assert.deepEqual(context.getClientOptions(), {
    apiKey: "server-secret-key",
    timeout: 2_500,
    maxRetries: 0,
  });

  const request = asRecord(context.getRequest());
  assert.equal(request.model, "configured-model");
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 100);
  assert.deepEqual(request.reasoning, { effort: "none" });
  assert.equal("tools" in request, false);
  assert.equal("conversation" in request, false);
  assert.equal("previous_response_id" in request, false);
  assert.equal(JSON.stringify(request).includes("server-secret-key"), false);

  const text = asRecord(request.text);
  const format = asRecord(text.format);
  assert.equal(format.type, "json_schema");
  assert.equal(format.strict, true);
  assert.equal(format.name, "message_location_fallback");

  const messages = request.input as Array<Record<string, unknown>>;
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, "system");
  assert.equal(String(messages[0]?.content).includes("preciso de eletricista"), false);
  assert.equal(messages[1]?.role, "user");
  assert.deepEqual(JSON.parse(String(messages[1]?.content)), {
    raw_text: "preciso de eletricista em sinop",
    country_code: "BR",
  });
});

test("OpenAI fallback maps resolved and unresolved output_parsed without manual JSON parsing", async () => {
  const unresolved = providerWith({ status: "completed", output_parsed: { status: "unresolved", location_text: null } });
  assert.deepEqual(await unresolved.provider.resolve({ raw_text: "perto daqui", country_code: "BR" }), {
    status: "unresolved",
    location_text: null,
  });

  const trimmed = providerWith({ status: "completed", output_parsed: { status: "resolved", location_text: "  Cuiabá  " } });
  assert.deepEqual(await trimmed.provider.resolve({ raw_text: "estou em Cuiabá", country_code: "BR" }), {
    status: "resolved",
    location_text: "Cuiabá",
  });
});

test("OpenAI fallback rejects missing keys, malformed, null, incomplete and refusal-like responses", async () => {
  const noKey = new OpenAIMessageLocationFallbackProvider({ ...config, apiKey: undefined });
  await assert.rejects(
    () => noKey.resolve({ raw_text: "mensagem", country_code: "BR" }),
    (error: unknown) => error instanceof MessageLocationFallbackProviderError && error.kind === "unavailable",
  );

  for (const response of [
    { status: "completed", output_parsed: null },
    { status: "completed", output_parsed: { status: "resolved", location_text: null } },
    { status: "completed", output_parsed: { status: "unresolved", location_text: "Sinop" } },
    { status: "incomplete", output_parsed: { status: "resolved", location_text: "Sinop" } },
  ]) {
    const context = providerWith(response);
    await assert.rejects(
      () => context.provider.resolve({ raw_text: "mensagem", country_code: "BR" }),
      (error: unknown) => error instanceof MessageLocationFallbackProviderError && error.kind === "provider_error",
    );
  }
});

test("OpenAI fallback categorizes timeout, network, 429 and 5xx errors", async () => {
  const errors = [
    [new APIConnectionTimeoutError(), "unavailable"],
    [new APIConnectionError({ message: "network" }), "unavailable"],
    [new RateLimitError(429, {}, "rate limited", new Headers()), "rate_limited"],
    [new InternalServerError(500, {}, "upstream failed", new Headers()), "provider_error"],
  ] as const;

  for (const [upstreamError, expectedKind] of errors) {
    const context = providerWith(upstreamError);
    await assert.rejects(
      () => context.provider.resolve({ raw_text: "mensagem", country_code: "BR" }),
      (error: unknown) => error instanceof MessageLocationFallbackProviderError && error.kind === expectedKind,
    );
  }
});
