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
**experimento** é `max_output_tokens=4096` em todas as quatro variantes.
O benchmark anterior observou 896 tokens de reasoning em 900 tokens de output
permitidos, com resposta incompleta. O teto 4096 reduz esse truncamento como
confundidor de qualidade; ainda será medido `incomplete_reason`. Não altera
o teto de produção (900). O timeout de 20 s e `maxRetries=0` permanecem
iguais entre as variantes. A baseline preserva effort implícito; esta é uma
comparação de modelo/configuração efetiva, não uma comparação que isola apenas
o nome do modelo.

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
US$2/0,20/12 por milhão de tokens. É uma **estimativa**, não fatura: cache
write e requisições sem uso reportado não podem ser atribuídos precisamente.
Rever tarifas antes de uma execução futura.

## Self-check local, sem custo

```sh
pnpm --filter @contatocerto/api eval:model-migration --self-check
```

O self-check valida hashes das fontes, unicidade, 40 oráculos completos, suas
decisões/slots no controller, 160 posições e distribuição equilibrada. Reporta
`model_calls=0`; não cria cliente OpenAI. A execução real tem guarda
separada de autorização, contagem exata e chave `OPENAI_API_KEY` **existente**.
Esta PR não executa a etapa paga; os resultados e a decisão de eventual
migração exigem revisão posterior. Nunca adicionar a chave ou resultados
sensíveis ao repositório.

Nenhuma ENV nova ou alterada. Não criar `OPENAI_REASONING_EFFORT` nem
`OPENAI_PROMPT_CACHE_KEY`. Sem migration nova, mudança n8n ou deploy.
