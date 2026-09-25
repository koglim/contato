# Model Migration Runtime v1 — preparação reversível

Este PR prepara, mas **não executa**, a migração de `gpt-5-mini-2025-08-07` para
`gpt-5.6-terra`. O modelo configurado em produção permanece Mini durante a
revisão. A única mudança no request de runtime é `reasoning.effort="medium"`
para a **interpretação** quando `OPENAI_CONVERSATION_MODEL` for exatamente
`gpt-5.6-terra`. Com Mini, o campo `reasoning` continua ausente. Composition
mantém seu request existente, sem política nova de reasoning. Prompt, schema,
controller, budgets, `max_output_tokens`, timeout, retry e `store=false` não
mudam.

Terra medium foi escolhido com base nos experimentos históricos documentados
em [Model Migration Eval v1](MODEL_MIGRATION_EVAL_V1.md) e
[Model Migration Stability v1](MODEL_MIGRATION_STABILITY_V1.md). No benchmark
production-shaped, o effective runtime foi 36/40 para Terra medium versus
28/40 para Mini, com medianas de 1660 ms e 7039,5 ms, respectivamente. Esses
resultados são observações de amostra, não garantia de comportamento futuro.
As 160 + 80 + 40 chamadas pagas anteriores não devem ser repetidas neste PR.

High global **não** foi aprovado. A hipótese de cascade medium→high não faz
parte desta implementação. A troca real da ENV existente
`OPENAI_CONVERSATION_MODEL` ocorrerá somente após merge, revisão e autorização
separada. Nenhuma ENV é criada ou alterada neste PR; não há mudança de
EasyPanel, n8n ou migration. Para rollback futuro, basta devolver essa mesma
ENV de `gpt-5.6-terra` para `gpt-5-mini-2025-08-07`: a política específica de
Terra deixa automaticamente de ser enviada, sem mudança de código.
