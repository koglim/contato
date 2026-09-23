import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { CONTEXTUAL_COMPOSITION_INSTRUCTIONS, extractStructuredOutput } from "../src/modules/contextual-conversation/contextual.provider.js";
import { contextualCompositionSchema, validateContextualQuestion, type ContextualReplyContext } from "../src/modules/contextual-conversation/contextual.contract.js";

const args = process.argv.slice(2);
const model = args.find(arg => arg.startsWith("--model="))?.slice(8);
const maxCalls = Number(args.find(arg => arg.startsWith("--max-calls="))?.slice(12));
if (!args.includes("--authorize-paid-evaluation") || model !== "gpt-5-mini" || maxCalls !== 9 || !process.env.OPENAI_API_KEY) {
  throw new Error("Controlled composition evaluation requires explicit authorization, --model=gpt-5-mini, OPENAI_API_KEY and --max-calls=9; no request was made");
}

const contexts: ContextualReplyContext[] = [
  { target: "service_confirmation", services: ["Eletricista"], location: null, reason: "ambiguous" },
  { target: "service_confirmation", services: ["Eletricista", "Encanador"], location: "Sinop", reason: "ambiguous" },
  { target: "service", services: [], location: "Cuiabá", reason: "ambiguous" },
];
const variants = [
  { name: "current", max_output_tokens: 300, reasoning: undefined },
  { name: "minimal_effort", max_output_tokens: 300, reasoning: { effort: "minimal" as const } },
  { name: "larger_output_limit", max_output_tokens: 900, reasoning: undefined },
];
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 0 });
const rows = [];
for (const context of contexts) for (const variant of variants) {
  const started = Date.now();
  try {
    const response = await client.responses.create({ model, store: false, max_output_tokens: variant.max_output_tokens,
      ...(variant.reasoning ? { reasoning: variant.reasoning } : {}),
      instructions: CONTEXTUAL_COMPOSITION_INSTRUCTIONS,
      input: [{ role: "user", content: JSON.stringify(context) }],
      text: { format: zodTextFormat(contextualCompositionSchema, "contextual_question") },
    });
    let valid = false;
    try { valid = !!validateContextualQuestion(extractStructuredOutput(response, contextualCompositionSchema), context); } catch { /* shape only */ }
    rows.push({ target: context.target, variant: variant.name, valid, duration_ms: Date.now() - started,
      response_status: response.status ?? null, incomplete_reason: response.incomplete_details?.reason ?? null,
      input_tokens: response.usage?.input_tokens ?? 0, cached_input_tokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0, reasoning_tokens: response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
      total_tokens: response.usage?.total_tokens ?? 0 });
  } catch {
    rows.push({ target: context.target, variant: variant.name, valid: false, duration_ms: Date.now() - started,
      response_status: "request_error", incomplete_reason: null, input_tokens: 0, cached_input_tokens: 0,
      output_tokens: 0, reasoning_tokens: 0, total_tokens: 0 });
  }
}
console.log(JSON.stringify({ mode: "controlled_paid_composition_only", model, calls: rows.length, production_effects: "none", rows }, null, 2));
