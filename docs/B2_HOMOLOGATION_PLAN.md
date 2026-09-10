# B2.2 — proposta de homologação (NÃO executada)

Preparação em 10/09/2026. Não autoriza chamadas pagas, produção ou WhatsApp.
B2 permanece desligada. Nenhuma variável ou migration nova nesta revisão.

## Modelos propostos e custo

Comparar **gpt-5.4-nano-2026-03-17** (candidato econômico) com
**gpt-5.4-mini-2026-03-17** (candidato de maior capacidade), usando o mesmo modelo
para interpretar e compor em cada rodada. Não trocar o modelo configurado nem
escolher vencedor antes da avaliação. Ambos documentam Responses e Structured
Outputs; isso não comprova qualidade em português ou no catálogo do ContatoCerto.
Disponibilidade/permissão da conta precisa ser confirmada pelo operador.

Preços consultados na documentação oficial em 10/09/2026, USD por milhão de tokens,
sem desconto de cache/Batch, impostos ou adicional regional:

| Modelo | Entrada | Saída | Fonte |
| --- | ---: | ---: | --- |
| GPT-5.4 nano | 0,20 | 1,25 | [Modelo e preços](https://developers.openai.com/api/docs/models/gpt-5.4-nano) |
| GPT-5.4 mini | 0,75 | 4,50 | [Modelo e preços](https://developers.openai.com/api/docs/models/gpt-5.4-mini) |

Hipótese de orçamento, não medição: interpretação com 2.000 tokens de entrada e
até 900 de saída; composição com 800 de entrada e até 300 de saída. Um par custa
aproximadamente **US$ 0,00206 nano / US$ 0,00750 mini**. Cálculo:
`(entrada_interpretação + entrada_composição) × preço_entrada / 1e6 +
(saída_interpretação + saída_composição) × preço_saída / 1e6`.
Tokens reais podem variar; o catálogo maior aumenta a entrada. Falhas podem ser
cobradas mesmo sem usage retornado. Sem alegação de limite financeiro rígido.

Proposta concreta de autorização futura:

1. Piloto readiness: 18 casos / 27 turnos por modelo; até 54 chamadas, limitadas a
   **60 por execução**, incluindo interpretação e composição. Dois modelos:
   até 120 chamadas autorizadas, estimativa conjunta de **US$ 0,26** sob a
   hipótese acima. Reservar **US$ 1** e revisar usage antes de prosseguir.
2. Benchmark congelado: 300 casos / 720 turnos por modelo (504 development + 216
   heldout). Máximo teórico de 1.440 chamadas/modelo; executar development em duas
   metades de 105 casos e heldout em uma rodada. Cada metade tem limite de 1.000
   chamadas; heldout, 450. Interromper quando atingir o teto, sem retry automático.
   Estimativa conservadora conjunta dos 720 pares em ambos os modelos:
   **US$ 6,89**, fora o piloto. Propor **US$ 10 no total** como envelope a ser
   autorizado e acompanhado manualmente, não como gasto já aprovado.
3. Não aumentar teto, repetir rodadas ou acrescentar modelos automaticamente.
   O runner impõe até 1.000 chamadas e 15 minutos por execução. Se incompleto,
   registra `not_evaluated` e sai com código 2; usar offset para continuar apenas
   casos pendentes mediante autorização remanescente. Não contar omissão como acerto.

Comando de piloto, **somente depois da autorização e credencial fornecida**:

```powershell
pnpm --filter @contatocerto/api eval:b2 --real --authorize-paid-evaluation --suite=readiness --model=gpt-5.4-nano-2026-03-17 --max-calls=60 --summary --report=b2-nano-pilot-report.json
```

Repetir com o snapshot mini e outro nome de arquivo apenas se autorizado.
Para development congelado: `--split=development --offset=0 --limit=105` e
`--offset=105 --limit=105`, `--max-calls=1000`; para heldout:
`--split=heldout --max-calls=450`. Não usar `--suite=readiness` nessas rodadas.
Arquivos existentes não são sobrescritos. Nenhum comando acima foi executado.

## Catálogo, corpus e revisão humana

- `readiness.json` usa os oito serviços do seed atual, sem dados pessoais:
  Eletricista, Encanador, Ar-condicionado, Montador de móveis, Diarista, Pintor,
  Chaveiro e Pequenos reparos; descrições nulas, como no seed. São nomes/chaves,
  não profissionais disponíveis. É o piloto de integração com o catálogo base.
- Corpus congelado 210/90 permanece byte-identical. Seu catálogo histórico de
  três serviços é uma **fixture sintética**, incluindo Pedreiro; não representa
  o catálogo do seed nem prova cobertura da produção. Seus resultados são
  reportados separadamente do piloto. Não modificar labels para melhorar score.
- Antes de homologar cobertura comercial, revisar snapshot sanitizado do catálogo
  ativo e obter novo conjunto humano reservado, separado do treino. Não inventar
  disponibilidade nem executar matching real no avaliador sem banco.
- `readiness.json` é desenvolvimento adicional, não holdout. Não inserir exemplos
  ou gabaritos do reservado nos prompts. Congelar versão/prompt/modelo antes de
  executar heldout real; erro exige relatório e novo ciclo, não decorar respostas.

Trilha JSON por turno: entrada/contexto permitido enviado, interpretação,
decisão do controlador, contexto/saída da composição, texto final validado ou
fallback, memória resultante e campos vazios para revisão humana. Usage inclui
tokens/modelo efetivo/latência por estágio quando disponível. Versão b2.2 e hashes
do prompt, catálogo e corpus identificam a rodada.

**Fronteira explícita:** o runner não executa geocoder, matching, seleção ou
Inbox; nesses resultados o texto final é `null` e a fronteira é registrada.
Não gerar lista fictícia só para preencher o relatório. Jornadas completas com
respostas finais, transação, persistência e efeitos são cobertas separadamente
por testes PostgreSQL/Inbox com modelo/geocoder simulados. A rodada real de
conversa ponta a ponta ainda exige ambiente descartável de homologação e revisão
humana; nenhum resultado parcial do runner a substitui.

Dois revisores devem avaliar todos os turnos do piloto e todas as respostas do
heldout: clareza e naturalidade (1–5), fidelidade aos fatos, campo perguntado,
contexto preservado, ação indevida e observação. Divergências exigem revisão,
não aprovação por média. Artefatos só podem conter dados sintéticos/autorizados;
nunca copiar conversas pessoais ou chaves para relatórios públicos.

## Critérios propostos (metas, não resultados obtidos)

- Zero contato/seleção/consentimento indevido, vazamento de dado privado,
  profissional/preço/disponibilidade inventados ou promessa de ação não realizada.
- ≥95% de decisão + slots corretos; ≥90% por categoria; erros críticos bloqueiam
  independentemente da média. Separar falhas injetadas das observadas no modelo.
- ≥95% de perguntas pertinentes ao campo faltante/ambíguo; ≤5% de perguntas
  desnecessárias e ≤5% de fallback não injetado. Contar fallback de composição
  mesmo quando o controlador termina corretamente.
- Clareza/naturalidade humana ≥4/5 em pelo menos 90% das respostas revisadas;
  fidelidade obrigatória em 100%. Modelo caro não ganha automaticamente.
- Metas de latência: interpretação p95 ≤5 s, composição p95 ≤2 s, turno sem
  geocoder p95 ≤8 s. Timeouts permanecem 6 s/chamada, sem retry SDK.
- Persistência e efeitos: replay sem nova geração; um contato/Outbox por chave;
  correções revalidadas; nenhum campo conhecido perguntado novamente por engano.
- Homologação do transporte e recuperação autônoma de Inbox são gates adicionais.

## Publicação futura

Após aprovação: conferir `pgmigrations` no ambiente alvo e aplicar **todas** as
migrations pendentes na ordem, incluindo **017 e 018 quando ausentes**, antes da
API. Não aplicar apenas 018 supondo 017 existente. Publicar com
`CONTEXTUAL_CONVERSATION_ENABLED=false`; avaliar/homologar; ativação é uma decisão
manual posterior. `CONTEXTUAL_CONVERSATION_MODEL` e `OPENAI_API_KEY` permanecem
os mesmos contratos. Nenhuma variável do EasyPanel foi alterada.

## Próximo checkpoint obrigatório: recuperação autônoma da Inbox

**Pendente de implementação; necessário antes da operação pública.** Não é
resolvido pelo dispatcher de Outbox nem pelo fato de uma entrada retornar 409.

Proposta para o checkpoint:

1. Worker interno autenticado, desligável, reivindica atomicamente a entrada
   elegível mais antiga de cada cliente. Lease/token + `SKIP LOCKED` e validação
   de payload original; nunca dois processadores efetivos para a mesma entrada.
2. Recuperar processamento abandonado após lease expirada, em até 60 s no teste
   operacional. Reutilizar proposta/rascunho/resultado já persistidos; não gerar
   novamente nem recriar busca, contato, reserva ou Outbox concluídos.
3. Limite proposto de **cinco tentativas efetivas**, incluindo leases abandonadas;
   backoff de 30/60/120/240 s entre tentativas. Disputa de lock não consome tentativa.
   Definir contadores, transições e erros estáveis em schema/migration do próximo
   checkpoint, sem reutilizar erro genérico como autorização para descartar dados.
4. Falha permanente (payload conflitante/resultado corrompido/limite esgotado)
   vai para quarentena auditável, não `processed` fictício. Alertar operador.
   Não apagar evidências nem avançar a fila silenciosamente.
5. Preservar FIFO: entrada posterior do mesmo cliente não ultrapassa uma anterior
   recuperável; outros clientes continuam. Quarentena exige disposição explícita
   auditada antes de liberar o contexto; revalidar TTL e contexto, sem reutilizar
   opções expiradas. Não confundir disposição administrativa com consentimento.
6. Testar PostgreSQL real: crash antes/depois de salvar proposta, antes/depois do
   commit, tokens obsoletos, dois workers, reinício, limite, erro permanente,
   cliente bloqueado vs outro cliente e reexecução administrativa idempotente.
7. Evidência mínima: fila converge sem replay manual nos casos recuperáveis,
   ordem preservada, zero duplicidade lógica, tentativas/razão auditáveis,
   métrica de idade/quantidade por estado sem telefone/texto em logs.

Isso protege efeitos lógicos; exatamente-uma-entrega no WhatsApp ainda depende
dos recibos/reconciliação do transporte e não pode ser prometida só com lease.
