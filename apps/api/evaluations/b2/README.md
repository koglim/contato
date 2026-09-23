# Avaliação B2.2 — interpretação, composição e revisão humana

300 casos rotulados: **210 development + 90 heldout**, em arquivos separados.
15 categorias, 20 casos por categoria. Não há mensagens de clientes reais.
O holdout não é incluído em prompts ou exemplos de runtime; não ajustar prompts
para seus erros durante comparação de modelos. Parafraseamentos compartilham
categorias entre os splits: não alegar um estudo cego independente de famílias.

Casos com contexto executam turnos de preparação no controlador antes do turno
avaliado; a memória resultante, não o gabarito, é entregue ao modelo. Retomada
inclui interrupção por FAQ. O restante são entradas iniciais ou falhas injetadas.
Não são 300 execuções da Inbox: concorrência, DB, consentimento e Outbox são
cobertos separadamente pelas integrações PostgreSQL reais.

O corpus v1 continua congelado, inclusive os 90 reservados. `readiness.json`
adiciona 18 casos de desenvolvimento com o catálogo de oito serviços do seed;
não é holdout nem substitui o conjunto original. Versão do runtime/prompt: b2.4.
`regression-v1.json` é uma suíte complementar de cinco regressões da
orquestração adaptativa (evidência de catálogo, hipótese entre turnos, cidade sem
UF e negação). Ela não altera os conjuntos congelados.
`latency-v1.json` é um corpus sintético separado de elegibilidade do caminho
determinístico. Rode `pnpm --filter @contatocerto/api eval:latency --summary`;
o benchmark mede apenas a função local, sem OpenAI, banco ou latência de rede.

## Execução sem gasto

`pnpm --filter @contatocerto/api eval:b2 --split=all --summary`

`pnpm --filter @contatocerto/api eval:b2 --suite=readiness --summary`

`pnpm --filter @contatocerto/api eval:b2 --suite=regression --summary`

Por padrão usa development; `--split=all` inclui os dois conjuntos com relatório
separado por categoria/split e digest SHA256. O CI roda propostas e composições
simuladas e verifica integridade, validação e controle. **300/300 nesse modo não
significa 100% de entendimento da IA**, nem mede custo/latência do provedor.

As perguntas passam pelo mesmo plano de campos e validador da API.
`--report=b2-NOME-report.json` grava a trilha completa dentro do diretório da API,
sem sobrescrever arquivo existente; `--summary` reduz apenas o stdout. O CI publica
relatórios sintéticos em artifact por SHA, retido por 14 dias. Relatórios locais
com esse padrão são ignorados pelo Git. Não incluir chaves/dados reais.

## Execução real, somente após autorização específica

`pnpm --filter @contatocerto/api eval:b2 --real --authorize-paid-evaluation --model=MODELO_APROVADO --max-calls=50 --split=development`

Exige OPENAI_API_KEY, modelo explícito, teto de chamadas e flag de autorização. Definir antes um
orçamento e os modelos aprovados. Nunca executar automaticamente no CI. A flag
é barreira técnica, não substitui a autorização do responsável. Cada conversa
pode chamar o modelo em seus turnos de preparação; portanto, o total de chamadas
é maior que o número de casos. Requisições têm timeout e limite de tokens, sem
retry do SDK, teto de 1.000 chamadas e janela máxima de 15 minutos por execução.
Não há DB, WhatsApp, criação de contato ou ação de produção.

O catálogo congelado é uma fixture curta (Encanador, Eletricista, Pedreiro), não
o seed atual nem o catálogo de produção. O piloto readiness usa os oito nomes e
chaves reais do seed, sem disponibilidade/profissionais. Avaliação real final precisa também
de snapshot autorizado/anonimizado do catálogo e revisão do conjunto com humanos.

O relatório mostra modo, modelo, hashes do corpus/catálogo/prompts, entrada e
contexto permitido por turno, interpretação, decisão, memória, contexto de
composição, pergunta proposta, resposta final/fallback, latência, tokens e
chamadas por estágio. Não imprime segredo nem payload de erro externo.
Campos `human_review` ficam nulos para preenchimento independente. Sem matching
ou seleção reais, `final_response=null` indica a fronteira com o domínio: não
inventar uma ação concluída. As jornadas Inbox/PostgreSQL automatizadas cobrem
essa parte separadamente; homologação real ponta a ponta ainda está pendente.
Preço monetário e naturalidade humana ficam **não medidos**. Casos de falha são
artificiais e não devem ser apresentados como taxa observada do modelo.

O teto `--max-calls` inclui **interpretação e composição**, inclusive setup; falha
não libera a chamada consumida. Interrompido por tempo/orçamento: `not_evaluated`,
exit 2, sem contar como acerto. `--offset/--limit` permite retomar casos restantes.
Setup é refeito para cada caso selecionado, sem usar memória do gabarito.

Hashes congelados: development
`0b71df0a91982c9aaa2749c923f6ad5b46c51f72f815742e6fdc2b76c34bfcdb`, heldout
`010ef5428f7705c6eb4766604c024ec54575366c5e94ffca04199c8fccf1cf1b`.
Readiness v1: `37b875960fc1fc9c3a7eea3c3e8788d28a86aea821a5da7485f8e4ff0c55b794`.
Os testes protegem os arquivos congelados contra alteração; hashes referem-se
ao conteúdo LF do repositório. A trilha registra também os bytes lidos na rodada.

## Protocolo de aceite ainda pendente

1. Aprovar orçamento, 2–3 modelos e política de dados.
2. Avaliar development sem efeitos; comparar entendimento, abstinência e latência.
3. Congelar modelo/prompt/política, então executar heldout sem ajuste posterior.
4. Revisar perguntas e resultados com humanos: pertinência, fluidez, perguntas
   desnecessárias, correções, ações indevidas e alucinações. Meta não é resultado.
5. Se houver qualquer ação indevida ou dado inventado, bloquear ativação.
6. Executar conversas de homologação da Inbox com banco descartável e transporte
   simulado; shadow/canário reais exigem autorização separada.

Nenhuma chamada paga nem revisão humana foi executada nesta entrega.

Modelos, orçamento e critérios concretos: [B2_HOMOLOGATION_PLAN.md](../../../../docs/B2_HOMOLOGATION_PLAN.md).
