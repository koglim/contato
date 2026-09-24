# Model Migration Stability & Semantic Escalation Eval v1

Esta etapa continua o Draft PR #6, sem migração de modelo ou deploy. Foram
concluídos, em rodadas já autorizadas, os benchmarks de **160 + 80 + 40
chamadas**. Não repetir nenhuma rodada. Os três checkpoints permanecem locais,
ignorados pelo Git e sem alterações nesta documentação.

## Evidência que motiva a etapa

| Métrica production-shaped (900 tokens) | GPT-5 Mini atual | Terra medium |
| --- | ---: | ---: |
| Validade estrutural | 33/40 | 40/40 |
| Proposta semântica | 15/40 | 18/40 |
| Controller outcome | 25/40 | 29/40 |
| Effective runtime outcome | 28/40 | 36/40 |
| Mediana | 7039,5 ms | 1660 ms |
| Incomplete | 7 | 0 |
| Request errors | 0 | 0 |
| Reasoning tokens | 24896 | 85 |
| Total tokens | 66091 | 40355 |

Terra medium teve três regressões efetivas nessa rodada: `adaptive-02`,
`readiness-17` e `confirmation-electric`. As duas primeiras perderam hipóteses
de serviço úteis; são casos semânticos, não justificam mapear “chuveiro” ou
“pia” para serviços com regex. A terceira é uma confirmação explícita da única
hipótese já conhecida e, por isso, recebe uma regra determinística conservadora.
Como os resultados de 4096 e 900 tokens divergem em casos individuais, uma
única execução por caso não mede estabilidade.

## Confirmação determinística

Se existe exatamente uma hipótese, o turno pode confirmá-la sem interpretação
AI quando contém um marcador inicial `sim`, `isso`, `isso mesmo` ou `confirmo`
e, após ele, somente o nome canônico completo daquela hipótese. Também são
aceitas as formas curtas `preciso de <serviço>` e `é <serviço>` após o marcador.
A correspondência do nome é insensível a acento/caixa, mas não admite outro
serviço, negação, condicional, pergunta ou texto adicional. A forma explícita
também exige que o resolver existente reconheça o mesmo serviço por
`exact`/`phrase` (nunca `fuzzy`). As confirmações isoladas já existentes
permanecem. Quando confirmada, a hipótese é persistida como serviço com
`source=user_confirmation`, as hipóteses são limpas e a busca determinística
segue com os slots existentes. As demais mensagens continuam no fluxo AI.

Isso não altera prompt, controller, fast path de busca, catálogo, matching ou
política de seleção/consentimento. Testes de unidade cobrem exemplos positivos
e negativos; uma integração PostgreSQL verifica estado persistido e ausência
de chamada de interpretação na confirmação explícita.

## Benchmark de estabilidade concluído (40/40)

O [modelo Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
suporta Responses API, Structured Outputs e esforços `medium` e `high`. O
runner isolado comparou essas duas configurações somente em `adaptive-02` e
`readiness-17`, com 10 repetições por caso/variante: **40 chamadas concluídas**.
Não inclui a baseline antiga nem outras categorias; o objetivo é estabilidade
da recuperação de hipóteses, não score geral. Nenhuma variante é escolhida
automaticamente.

O plano intercala medium/high dentro de cada par caso–repetição e inverte a
primeira posição entre casos e repetições. Cada combinação caso/variante tem
10 chamadas e ocupa a primeira posição cinco vezes. Configuração:
`max_output_tokens=900`, timeout de 20 s, `maxRetries=0`, `store=false`, mesmo
prompt/schema/controller e sem `prompt_cache_key`. A
[documentação oficial de reasoning](https://developers.openai.com/api/docs/guides/reasoning)
explica que tokens de raciocínio consomem o teto de output e podem produzir
`incomplete` antes de haver texto visível. Nesta rodada não houve resposta
incompleta; o teto não foi alterado.

```sh
pnpm --filter @contatocerto/api eval:model-migration:stability --self-check
```

O self-check compila o corpus congelado, valida hashes e plano, mostra ordem,
variantes e `model_calls=0`; não cria cliente OpenAI. A execução paga foi
autorizada e concluída separadamente. O runner exige a `OPENAI_API_KEY`
**existente** e limite explícito de 40 para qualquer execução paga; não
executá-lo novamente.
O runner reutiliza progresso em stderr, checkpoint com fsync por row,
`--resume` validado contra corpus/prompt/plano, trava local e recusa de
sobrescrita. O arquivo novo
`.eval-results/model-migration-stability-v1-<corpus-sha>-<prompt-sha>.jsonl`
é isolado dos dois checkpoints históricos. Uma chamada interrompida antes do
fsync pode ser cobrada e repetida na retomada; não há garantia de
*exactly once* em falha entre resposta e persistência.

Cada row sanitizada inclui repetição, validade estrutural, proposta semântica,
controller outcome, effective runtime outcome, correspondência exata das
hipóteses, latência, tokens, incomplete e request errors. Não imprime ou
persiste mensagem bruta, prompt, resposta, telefone ou coordenadas.

| Caso | Esforço | Estrutural | Proposta | Controller | Efeito runtime | Hipóteses exatas | Mediana | Incomplete / errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `adaptive-02` | medium | 10/10 | 9/10 | 9/10 | 9/10 | 9/10 | 1994,5 ms | 0 / 0 |
| `adaptive-02` | high | 10/10 | 9/10 | 9/10 | 9/10 | 9/10 | 1830 ms | 0 / 0 |
| `readiness-17` | medium | 10/10 | 4/10 | 4/10 | 4/10 | 4/10 | 2291 ms | 0 / 0 |
| `readiness-17` | high | 10/10 | 8/10 | 8/10 | 8/10 | 8/10 | 2066 ms | 0 / 0 |

### Análise pareada offline

O pareamento usa o mesmo **índice de repetição** em cada caso; as chamadas não
compartilham seed nem garantem a mesma amostra estocástica. Pelo critério de
efeito runtime/hypótese exata:

- `adaptive-02`: medium falhou na repetição 7; high acertou nessa repetição.
  High falhou na repetição 5, em que medium acertou. O resultado observado de
  uma cascata `medium → high` somente quando medium falha seria **10/10**.
- `readiness-17`: medium falhou nas repetições 1, 3, 5, 6, 8 e 10; high
  acertou nas seis. High falhou nas repetições 7 e 9, em que medium acertou.
  A mesma cascata observada seria **10/10**.

Esses 10/10 são resultados deste pequeno experimento, **não garantia
estatística de 100%** nem prova de que high é melhor em todas as conversas.
High global **não foi aprovado**. Terra medium é a candidata primária para uma
futura PR de migração, ainda sujeita a revisão; o modelo em produção continua
inalterado.

### Hipótese arquitetural para PR separada

Uma eventual escalação só poderia considerar um retry high quando medium,
após o controller, terminar em `clarify` sem hipótese útil para um pedido
legítimo de serviço sem serviço explícito. O retry nunca poderá, por si só,
executar busca, seleção, consentimento, divulgação de contato, preço ou outra
mutação crítica. Uma aceitação inicial teria de permanecer em `clarify`,
adicionar hipótese(s) válidas do catálogo e rejeitar negação, condicional,
pergunta informativa, seleção pendente e comando crítico. **Nada disso foi
implementado neste PR.** Exige desenho, testes e revisão separados.

Nenhuma ENV nova ou alterada, configuração EasyPanel, migration ou workflow
n8n. Em uma futura migração, será necessário decidir separadamente a alteração
da ENV **existente** `OPENAI_CONVERSATION_MODEL=gpt-5.6-terra`; não fazê-la no
PR #6. Sem merge ou deploy nesta etapa.
