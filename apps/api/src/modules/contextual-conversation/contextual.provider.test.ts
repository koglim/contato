import assert from "node:assert/strict";
import test from "node:test";
import OpenAI, { type ClientOptions } from "openai";
import { OpenAIContextualProvider } from "./contextual.provider.js";
import type { ContextualInput } from "./contextual.contract.js";

const input: ContextualInput = {
  message: "oi",
  service: null,
  location: null,
  pending: null,
  hypotheses: [],
  catalog: [{ key: "encanador", name: "Encanador", description: "Reparos hidráulicos" }],
};

function fakeProvider(output: unknown, status = "completed") {
  let options: ClientOptions | undefined;
  let request: unknown;
  const provider = new OpenAIContextualProvider("configured-model", "super-secret", undefined, clientOptions => {
    options = clientOptions;
    return { responses: { parse: async (body: unknown) => {
      request = body;
      return { status, output_parsed: output, model: "configured-model", usage: { input_tokens: 10, output_tokens: 5 } };
    } } } as unknown as OpenAI;
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
  assert.deepEqual(context.options(), { apiKey: "super-secret", timeout: 6_000, maxRetries: 0 });
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

test("OpenAI conversation provider rejects incomplete and schema-invalid output", async () => {
  for (const context of [
    fakeProvider(null),
    fakeProvider({ intent: "greeting", natural_reply: "Olá" }),
    fakeProvider({ intent: "greeting", speech_act: "information", services: [], location: null, natural_reply: "Olá", confidence: "high", uncertain: false, phone: "+5566999999999" }),
    fakeProvider({ intent: "greeting", speech_act: "information", services: [], location: null, natural_reply: "Olá", confidence: "high", uncertain: false }, "incomplete"),
  ]) await assert.rejects(() => context.provider.interpret(input));
});
