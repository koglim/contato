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

## Resultado efetivo do runtime (análise offline)

A terceira métrica, `effective_runtime_outcome_agreement`, mantém intactos os
critérios anteriores. Ela aplica ao resultado do controller o roteamento
determinístico que o serviço faria em seguida. `delegate` fora de uma seleção
pendente produz esclarecimento: não entra no resolver de seleção. Para seleção
pendente, o analisador usa o parser de comandos e o resolver de nomes/ordinais
com opções **sintéticas**. Uma rota de seleção é rotulada somente como
`selection_attempt`, jamais como contato revelado ou seleção concluída. A
comparação exige também os slots finais do oráculo, inclusive hipóteses.

Essa é uma simulação offline do efeito do controller, não uma integração de
ponta a ponta: não consulta banco, geocoder, matching, consentimento ou
WhatsApp. `search_ready` significa intenção e slots para busca, não que a busca
achou profissionais. O relatório local mantém as matrizes antigas lado a lado.

| Variante | Proposal estrita | Controller outcome | Effective runtime outcome |
| --- | ---: | ---: | ---: |
| baseline | 16/40 | 26/40 | 33/40 |
| terra_medium | 22/40 | 32/40 | 37/40 |
| terra_low | 19/40 | 30/40 | 36/40 |
| terra_none | 22/40 | 33/40 | 37/40 |

Na métrica efetiva, Terra medium melhora quatro casos contra a baseline e não
regride nenhum dos 40; low melhora cinco e regride dois (`readiness-06`,
`b2-062`); none melhora seis e regride dois (`b2-042`, `b2-201`). Assim,
`b2-042` continua uma regressão real para none: a correção da cidade não é
preservada. O comportamento de `b2-201` em none também continua divergente.
Esses números são uma triagem de 40 casos, não aprovação de migração.

As quatro falhas unânimes anteriores eram da métrica *controller outcome*:

- `b2-161`, `b2-181`, `b2-182`: o `delegate` do modelo, no contexto desses
  casos, não faz seleção. O parser/resolver não reconhece a negação, hipótese
  ou hesitação como escolha. O resultado efetivo é esclarecimento, sem tentativa
  de seleção, nas quatro variantes.
- `confirmation-electric`: na simulação histórica de 160 chamadas, permanece
  falha efetiva nas quatro variantes. A confirmação determinística explícita
  foi adicionada posteriormente e é coberta por testes separados; as rows
  históricas não foram reescritas.

`readiness-05` com Terra medium também é esclarecimento efetivo, pois o
`delegate` ocorre fora de seleção pendente; não há mutação crítica. Um teste de
integração com PostgreSQL cobre essa proteção no serviço real. Nenhuma dessas
constatações muda prompt, controller ou runtime.

## Benchmark production-shaped concluído (80/80)

O segundo experimento é **separado** do checkpoint de 160 chamadas e comparou
somente baseline atual (`gpt-5-mini-2025-08-07`, effort omitido) contra
`gpt-5.6-terra` com `medium`, nos mesmos 40 casos. Intercala as variantes por
caso, invertendo a ordem a cada caso: 80 posições, 40 por variante e 20 vezes
cada uma na primeira posição. Usa o mesmo prompt, schema, entrada e controller,
com `max_output_tokens=900`, timeout de 20 s, `maxRetries=0` e `store=false`,
como no runtime atual. Com esse teto, a baseline teve sete respostas
incompletas e Terra medium nenhuma. Nenhum limite de produção foi alterado.

```sh
pnpm --filter @contatocerto/api eval:model-migration:production-shaped --self-check
```

O self-check valida o plano e retorna `model_calls=0`, sem chave. A rodada paga
foi autorizada separadamente e concluída com 80/80 chamadas, sem resume. O
runner exige a chave `OPENAI_API_KEY` já existente e limite exato de 80
chamadas. Gravou progresso em stderr e cada row sanitizado com fsync em
checkpoint próprio ignorado pelo Git; `--resume` verifica hashes, metadados e
prefixo contínuo antes de prosseguir. O mesmo limite de retomada permanece:
uma chamada interrompida antes do fsync pode ter sido cobrada e ser repetida.
**Não repetir as 80 chamadas.** Nenhuma ENV nova ou alterada; nenhuma
configuração EasyPanel necessária.

| Métrica production-shaped | GPT-5 Mini atual | Terra medium |
| --- | ---: | ---: |
| Estrutural | 33/40 | 40/40 |
| Proposal semântica | 15/40 | 18/40 |
| Controller outcome | 25/40 | 29/40 |
| Effective runtime outcome | 28/40 | 36/40 |
| Mediana | 7039,5 ms | 1660 ms |
| Incomplete | 7 | 0 |
| Request errors | 0 | 0 |

Terra medium teve regressões efetivas em `adaptive-02`, `readiness-17` e
`confirmation-electric`. A confirmação explícita da hipótese única passou a
ser determinística; os dois outros casos permanecem semânticos. A rodada
separada de estabilidade de **40/40 chamadas** repetiu apenas esses dois casos
com Terra medium/high. Seus resultados e a análise pareada constam em
[Model Migration Stability v1](MODEL_MIGRATION_STABILITY_V1.md). No conjunto,
160 + 80 + 40 chamadas pagas já foram concluídas; **nenhum benchmark deve ser
repetido**. Não houve migração de modelo, e high global não foi aprovado.
