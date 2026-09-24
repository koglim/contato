# Model Migration Eval v1 — preparação, sem mudança de runtime

## Objetivo e fontes

Comparar a interpretação semântica atual (`gpt-5-mini-2025-08-07`) com
`gpt-5.6-terra` antes de qualquer migração de produção. A [documentação oficial
da OpenAI](https://developers.openai.com/api/docs/deprecations) prevê o desligamento
do snapshot atual em 11/12/2026 e indica Terra como substituto. A
[checklist de migração](https://developers.openai.com/api/docs/guides/deployment-checklist)
recomenda preservar workload/prompt, medir sucesso, latência, tokens e custo por
tarefa bem-sucedida antes de mudar comportamento.

Esta PR **não altera** o modelo, prompt, reasoning effort, timeout, limite de
output, fast path, controller, geocoder, matching ou configuração em produção.
O runner é isolado, não acessa banco, WhatsApp, n8n ou EasyPanel, e só usa a
Responses API quando uma execução paga for autorizada separadamente.

## Corpus e oráculo

`apps/api/evaluations/b2/model-migration-v1.json` versiona 40 referências a
casos sintéticos de development/heldout congelados, readiness, regression-v1 e
latency-v1. Os cinco arquivos de origem têm SHA-256 fixado no corpus após
normalizar CRLF/LF (portabilidade Windows/Linux): uma
alteração neles interrompe o self-check antes de qualquer chamada. Nenhum
corpus anterior foi modificado. Quatro casos de latency-v1 receberam oráculo
explícito nesta nova camada porque aquele corpus só anotava elegibilidade ao
fast path. Um caso sintético novo cobre a confirmação após uma hipótese retida.

Os casos cobrem erros de digitação, necessidade semântica indireta, português
coloquial/ruidoso e sem acentos, consulta informativa, negação, hipótese,
correção de serviço e cidade, continuação de contexto, hipótese retida,
confirmação, serviço ambíguo/ausente, mensagem curta de WhatsApp, evidência
conflitante, conteúdo fora de escopo, injeção e modificadores temporais.
Somente fixtures sintéticas são usadas; nenhuma mensagem privada foi copiada.
Esta seleção é uma triagem representativa de riscos conhecidos, não uma amostra
aleatória do tráfego real.

Para cada caso, o runner recompõe localmente a memória com os turnos de setup
dos corpora originais. O modelo recebe somente o `ContextualInput` do turno
avaliado, com o mesmo `CONTEXTUAL_INSTRUCTIONS`, catálogo, schema de
Structured Outputs e `store=false`. O oráculo e o transcript de teste **não**
são enviados ao modelo. A resposta passa por
`contextualInterpretationSchema` e depois por `controlContextualProposal`;
o acordo semântico compara intenção, speech act, chaves de serviço, localidade
normalizada, decisão e slots finais (serviço, cidade e hipóteses). A igualdade
de saída estrutural, sozinha, não é classificada como sucesso.

## Variantes e comparabilidade

| Variante | Modelo | `reasoning.effort` |
| --- | --- | --- |
| baseline | `gpt-5-mini-2025-08-07` | omitido, como no runtime atual |
| terra_medium | `gpt-5.6-terra` | `medium` |
| terra_low | `gpt-5.6-terra` | `low` |
| terra_none | `gpt-5.6-terra` | `none` |

A [página oficial do Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
confirma esses esforços, Responses API e Structured Outputs. O limite do
**experimento** é `max_output_tokens=4096` em todas as quatro variantes:
um *quality-comparison ceiling*, não uma reprodução exata de produção.
O benchmark anterior observou 896 tokens de reasoning em 900 tokens de output
permitidos, com resposta incompleta. O teto 4096 reduz esse truncamento como
confundidor de qualidade; ainda será medido `incomplete_reason`. Não altera
o teto de produção (900). O timeout de 20 s e `maxRetries=0` permanecem
iguais entre as variantes. A baseline preserva effort implícito; esta é uma
*current-model evaluation baseline*, não uma simulação idêntica do runtime.
Se Terra se destacar, uma validação posterior separada deverá usar o limite e
timeout reais de produção antes de qualquer migração.

São planejadas exatamente 160 chamadas (40 casos × 4 variantes). Cada caso
recebe as quatro variantes consecutivamente; a ordem é rotacionada por caso e
alternada em sentido reverso a cada bloco de quatro. Cada variante aparece
40 vezes, sendo 10 em cada posição. Não há randomização sem seed. Um resultado
de 40 observações por variante continua exploratório.

## Métricas e segurança dos resultados

Cada row contém ID/categoria sintéticos, variante/modelo/effort,
`execution_order`, validade estrutural, acordo semântico, decisão e slots
esperados/obtidos, duração, input/cached-input/output/reasoning/total tokens,
status da resposta, motivo de incompletude, HTTP status e custo estimado.
Resumo por variante: chamadas, acertos, mediana/min/max de latência, tokens,
incompletudes, erros de requisição, custo estimado e custo por acerto semântico.
Nenhuma query bruta, prompt, resposta do modelo, telefone ou coordenada é
impressa. A observação `cached_input_tokens=0` não implica falha de cache.
`prompt_cache_key` não é configurado.

O custo usa preços padrão publicados nas páginas oficiais de
[GPT-5 Mini](https://developers.openai.com/api/docs/models/gpt-5-mini) e
[GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
na preparação desta PR: Mini input/cached/output US$0,25/0,025/2 e Terra
US$2/0,20/12 por milhão de tokens. É uma **estimativa histórica**, não
fatura: cache write e requisições sem uso reportado não podem ser atribuídos
precisamente. A [tabela oficial atual](https://developers.openai.com/api/docs/pricing)
também distingue contexto curto/longo para GPT-5.6, e a página do
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) documenta
regras específicas de contexto longo e cache write. Não recalcular as rows
históricas nem usar o custo atual para decidir a variante nesta análise.

## Self-check local, sem custo

```sh
pnpm --filter @contatocerto/api eval:model-migration --self-check
```

O self-check valida hashes das fontes, unicidade, 40 oráculos completos, suas
decisões/slots no controller, 160 posições e distribuição equilibrada. Reporta
`model_calls=0`; não cria cliente OpenAI. A execução real tem guarda
separada de autorização, contagem exata e chave `OPENAI_API_KEY` **existente**.
A rodada paga autorizada separadamente foi concluída depois da preparação
desta PR: 160/160 posições, sem retomada. A análise abaixo não executa nem
repete chamadas. A decisão de eventual migração exige revisão posterior.
Nunca adicionar a chave ou resultados sensíveis ao repositório.

## Progresso e retomada da execução paga

O runner escreve somente em **stderr** um início e um fim por posição, por
exemplo `[1/160] adaptive-01 / baseline` e
`[1/160] done 4231ms valid=true semantic=true status=completed incomplete=null http=200`.
Não imprime mensagem, prompt, resposta, chave, telefone ou coordenadas. O
relatório JSON completo continua aparecendo apenas em **stdout** depois de
160 posições concluídas.

Cada row sanitizado é anexado e sincronizado em disco após a chamada em
`.eval-results/model-migration-v1-<corpus-sha256>-<prompt-sha256>.jsonl`,
diretório ignorado pelo Git. A primeira linha contém metadados: hashes de
corpus/prompt/plano, variantes, `max_output_tokens` e 160 chamadas planejadas.
Linhas seguintes contêm somente os campos seguros do row. O checkpoint
permanece para auditoria local; sem `--resume`, uma nova execução recusa
sobrescrevê-lo. Uma trava local impede execuções simultâneas sobre o mesmo
checkpoint; uma trava deixada por processo encerrado é isolada antes da
retomada.

`--resume` valida os metadados e cada row contra o prefixo contínuo do plano
antes de criar qualquer nova chamada. Pula somente posições completas e
válidas. Uma linha final sem terminador de linha (possível queda durante a
gravação) não é aceita como concluída e será repetida; uma linha completa
incompatível aborta. Erro conhecido de request/timeout produz row com
`request_error`, persistido sem retry automático; `maxRetries=0`. Uma chamada
interrompida sem row persistido pode ser cobrada e repetida ao retomar — não
há garantia de execução exatamente uma vez em falhas entre resposta e fsync.
O resumo final inclui `calls_planned`, `calls_completed`, `resumed_calls`
e `new_model_calls`.

Nenhuma ENV nova ou alterada. Não criar `OPENAI_REASONING_EFFORT` nem
`OPENAI_PROMPT_CACHE_KEY`. Sem migration nova, mudança n8n ou deploy.

## Análise offline do resultado efetivo do controller

```sh
pnpm --filter @contatocerto/api eval:model-migration:analyze
```

O analisador não precisa de `OPENAI_API_KEY`, não cria cliente nem executa
requisições. Ele lê **somente** o checkpoint existente, exige 160 rows completas
e valida os hashes de corpus, prompt e plano, variantes, limites, ordem e
campos esperados contra o plano recompilado. Arquivo incompleto ou incompatível
interrompe a análise sem alterar o checkpoint. Os resultados locais ficam em
`.eval-results/model-migration-v1-analysis.json` e `.md`, ambos ignorados pelo
Git. Eles contêm agregados, IDs e categorias sintéticos, nunca prompts,
respostas brutas, mensagens privadas, telefones ou coordenadas.

`semantic_agreement` permanece idêntico nas rows históricas e no runner.
No relatório, é rotulado conceitualmente como
`proposal_semantic_agreement`: intenção, speech act, chaves de serviço,
localização da proposal, decisão e slots finais devem concordar. A métrica
adicional `controller_outcome_agreement` compara somente decisão e slots finais
(serviço, localização e hipóteses), pois são o resultado efetivo após o
controller. O JSON também separa cada componente, matriz por caso contra
baseline, categorias originais e grupos documentados. O agrupamento é apenas
apresentação: nenhum caso é excluído, e categorias não mapeadas aparecem em
`other`. Não há ranking automático ou escolha de variante.

| Variante | Estrutural | Proposal estrita original | Controller outcome | Mediana | Reasoning tokens | Incomplete | Request errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 40/40 | 16/40 | 26/40 | 7254 ms | 24064 | 0 | 0 |
| terra_medium | 40/40 | 22/40 | 32/40 | 1699 ms | 92 | 0 | 0 |
| terra_low | 40/40 | 19/40 | 30/40 | 1587 ms | 0 | 0 | 0 |
| terra_none | 40/40 | 22/40 | 33/40 | 1731,5 ms | 0 | 0 | 0 |

Contra a baseline, medium melhora 7 casos e regride 1; low melhora 8 e
regride 4; none melhora 10 e regride 3. Há 21 casos em que todas as variantes
passam e 4 em que todas falham. Esses quatro precisam de revisão de oráculo,
prompt, schema e política do controller antes de fundamentar uma migração.
O relatório local traz as listas de caso e os passes/total por categoria.

Para **futuras** execuções, rows novas registram somente seis booleans
sanitizados (`intent_match`, `speech_act_match`, `service_keys_match`,
`proposal_location_match`, `decision_match`, `slots_match`). Rows históricas
continuam válidas sem esses campos; o benchmark não será repetido para
preenchê-los. Isso não altera o runtime de produção.
