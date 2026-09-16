import assert from "node:assert/strict";
import test from "node:test";
import OpenAI, { APIConnectionTimeoutError, InternalServerError, type ClientOptions } from "openai";
import { ConversationAIProviderError, OpenAIContextualProvider } from "./contextual.provider.js";
import type { ContextualInput } from "./contextual.contract.js";

const input: ContextualInput = {
  message: "oi",
  service: null,
  location: null,
  pending: null,
  hypotheses: [],
  catalog: [{ key: "encanador", name: "Encanador", description: "Reparos hidráulicos" }],
};

function fakeProvider(output: unknown, status = "completed", error?: Error, responseOverrides: Record<string, unknown> = {}) {
  let options: ClientOptions | undefined;
  let request: unknown;
  const provider = new OpenAIContextualProvider("configured-model", "super-secret", {
    timeoutMs: 27_000,
    clientFactory: clientOptions => {
      options = clientOptions;
      return { responses: { create: async (body: unknown) => {
        request = body;
        if (error) throw error;
        return { status, output_parsed: output, output: [], model: "configured-model", usage: { input_tokens: 10, output_tokens: 5 }, ...responseOverrides };
      } } } as unknown as OpenAI;
    },
  });
  return { provider, options: () => options, request: () => request };
}

function record(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  return value as Record<string, unknown>;
}

test("OpenAI conversation provider uses Responses Structured Outputs without tools or persisted OpenAI memory", async () => {
  const output = { intent: "greeting", speech_act: "information", services: [], location: null,
    natural_reply: "Olá! Como posso ajudar?", confidence: "high", uncertain: false };
  const context = fakeProvider(output);
  assert.deepEqual(await context.provider.interpret(input), output);
  assert.deepEqual(context.options(), { apiKey: "super-secret", timeout: 27_000, maxRetries: 0 });
  const request = record(context.request());
  assert.equal(request.model, "configured-model");
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 900);
  assert.equal("tools" in request, false);
  assert.equal("conversation" in request, false);
  assert.equal("previous_response_id" in request, false);
  assert.equal(JSON.stringify(request).includes("super-secret"), false);
  const format = record(record(request.text).format);
  assert.equal(format.type, "json_schema");
  assert.equal(format.strict, true);
  assert.equal(format.name, "contextual_interpretation");
  const messages = request.input as Array<Record<string, unknown>>;
  assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(String(messages[0]?.content)), input);
});

test("OpenAI conversation provider accepts strict structured output from output_text", async () => {
  const output = { intent: "search", speech_act: "request", services: [{ key: "tomada", evidence: "tomada" }],
    location: { text: "Cuiabá", evidence: "Cuiabá" }, natural_reply: null, confidence: "high", uncertain: false };
  const context = fakeProvider(undefined, "completed", undefined, { output_text: JSON.stringify(output) });
  assert.deepEqual(await context.provider.interpret(input), output);
});

test("OpenAI conversation provider reads a structured content part when convenience fields are absent", async () => {
  const output = { intent: "greeting", speech_act: "information", services: [], location: null,
    natural_reply: "Olá! Como posso ajudar?", confidence: "high", uncertain: false };
  const context = fakeProvider(undefined, "completed", undefined, {
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }],
  });
  assert.deepEqual(await context.provider.interpret(input), output);
});

test("OpenAI conversation provider accepts free catalog evidence such as tomada from output_parsed", async () => {
  const output = { intent: "search", speech_act: "request", services: [{ key: "tomada", evidence: "tomada" }],
    location: { text: "Cuiabá", evidence: "Cuiabá" }, natural_reply: null, confidence: "high", uncertain: false };
  assert.deepEqual(await fakeProvider(output).provider.interpret(input), output);
});

test("OpenAI conversation provider rejects incomplete and schema-invalid output", async () => {
  for (const context of [
    fakeProvider(null),
    fakeProvider({ intent: "greeting", natural_reply: "Olá" }),
    fakeProvider({ intent: "greeting", speech_act: "information", services: [], location: null, natural_reply: "Olá", confidence: "high", uncertain: false, phone: "+5566999999999" }),
    fakeProvider({ intent: "greeting", speech_act: "information", services: [], location: null, natural_reply: "Olá", confidence: "high", uncertain: false }, "incomplete"),
  ]) await assert.rejects(() => context.provider.interpret(input));
});

test("invalid structured output retains safe response-shape metadata", async () => {
  const context = fakeProvider(undefined, "completed", undefined, {
    output_text: "{\"intent\":\"search\"}",
    output: [{ type: "message", content: [{ type: "output_text", text: "{\"intent\":\"search\"}" }] }],
  });
  await assert.rejects(() => context.provider.interpret(input), (error: unknown) => {
    assert.ok(error instanceof ConversationAIProviderError);
    assert.equal(error.reason, "invalid_structured_output");
    assert.deepEqual(error.structuredOutput, {
      parserSource: "output_text", responseStatus: "completed", incomplete: false, refusal: false,
      outputTypes: ["message"], contentTypes: ["output_text"], schemaVersion: "b2.4",
    });
    return true;
  });
});

test("incomplete and refusal responses are not parsed as successful output", async () => {
  const output = { intent: "greeting", speech_act: "information", services: [], location: null,
    natural_reply: "Olá!", confidence: "high", uncertain: false };
  for (const context of [
    fakeProvider(undefined, "incomplete", undefined, { output_text: JSON.stringify(output), incomplete_details: { reason: "max_output_tokens" } }),
    fakeProvider(undefined, "completed", undefined, { output: [{ type: "message", content: [{ type: "refusal", refusal: "redacted" }] }] }),
  ]) {
    await assert.rejects(() => context.provider.interpret(input), (error: unknown) => {
      assert.ok(error instanceof ConversationAIProviderError);
      assert.equal(error.reason, "invalid_structured_output");
      assert.equal(error.structuredOutput?.incomplete || error.structuredOutput?.refusal, true);
      return true;
    });
  }
});

test("OpenAI conversation provider classifies timeout, provider and structured output failures", async () => {
  const cases = [
    [fakeProvider(null, "completed", new APIConnectionTimeoutError()), "timeout", undefined],
    [fakeProvider(null, "completed", new InternalServerError(503, {}, "unavailable", new Headers())), "provider_error", 503],
    [fakeProvider(null), "invalid_structured_output", undefined],
  ] as const;
  for (const [context, reason, statusHttp] of cases) {
    await assert.rejects(() => context.provider.interpret(input), (error: unknown) => {
      assert.ok(error instanceof ConversationAIProviderError);
      assert.equal(error.reason, reason);
      assert.equal(error.statusHttp, statusHttp);
      return true;
    });
  }
});
