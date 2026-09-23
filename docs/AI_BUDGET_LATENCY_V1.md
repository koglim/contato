# AI Budget & Latency v1

The contextual controller keeps exclusive authority over search, selection, consent and domain results. A direct search can skip OpenAI interpretation only when the existing service resolver returns a non-fuzzy catalog match, the location extractor finds a literal place, the complete utterance matches the narrow request grammar, and no selection is pending. The generated proposal is still passed through `controlContextualProposal` and persisted before domain effects. Other turns retain interpretation and hypothesis handling.

Location questions (missing or unresolved/ambiguous place) and simple missing-service questions use the existing deterministic presenter. Semantic service confirmation can still use composition. Drafts are persisted before effects and reused after retry. Neither the model nor its output-token limit changed in the runtime.

`conversation_ai_usage` logs stage, model, duration, input/cached/output/reasoning/total tokens and response status, including responses whose structured output is incomplete. `conversation_ai_fallback` includes the safe `incomplete_reason` (`max_output_tokens`, `content_filter`, `other` or null). `contextual_execution_path` logs selected path, per-turn AI calls, domain resolution status, final status and duration. These events contain no message, phone, prompt, coordinates or response text. Missing SDK usage fields become zero; a failing observer cannot affect the decision.

## Validation and measurement

`pnpm --filter @contatocerto/api eval:latency --summary` runs the 13-case synthetic eligibility corpus without OpenAI or a database. It includes direct requests, negation, informational questions, hypotheses, prompt injection, typo, semantic need and a geographically ambiguous municipality. The microbenchmark measures only the local eligibility function, not an end-to-end response or network latency. API integration tests cover the Inbox path, call counts, matching boundary, persisted draft and critical commands when PostgreSQL is available.

The frozen B2 development and heldout corpora, readiness and adaptive regression suites remain separate. Their mocked model agreement is not evidence of real model quality or production latency. Use `conversation_ai_usage` and `contextual_execution_path` in production after a later release to calculate actual call rate, tokens and stage duration; this PR itself does not measure production after deployment.

The controlled composition comparison is intentionally isolated from runtime configuration. With a separately approved paid evaluation budget and `OPENAI_API_KEY`, run:

`pnpm --filter @contatocerto/api eval:composition-budget --authorize-paid-evaluation --model=gpt-5-mini --max-calls=9`

It tests three synthetic composition contexts against current 300 tokens, 300 tokens with minimal reasoning effort, and 900 tokens at default effort. It records only validation and usage metadata. It does not print generated questions, touch the database or change runtime settings. No paid comparison was run as part of this PR. The [OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) explains why reasoning tokens can exhaust `max_output_tokens` before visible output; the [OpenAI changelog](https://developers.openai.com/api/docs/changelog) documents `minimal` effort for the GPT-5 family.

Known limits: the direct grammar is intentionally conservative and may route valid but unusually phrased requests to the existing AI path. The synthetic latency figure excludes database, geocoding, matching, provider and WhatsApp delivery time. Missing provider usage on transport errors cannot be reconstructed.
