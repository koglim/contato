# Avaliação B2 — corpus sintético v1

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

## Execução sem gasto

`pnpm --filter @contatocerto/api eval:b2 --split=all`

Por padrão usa development; `--split=all` inclui os dois conjuntos com relatório
separado por categoria/split e digest SHA256. O CI roda somente propostas
simuladas e verifica integridade, validação e controle. **300/300 nesse modo não
significa 100% de entendimento da IA**, nem mede custo/latência do provedor.

## Execução real, somente após autorização específica

`pnpm --filter @contatocerto/api eval:b2 --real --authorize-paid-evaluation --model=MODELO_APROVADO --max-calls=50 --split=development`

Exige OPENAI_API_KEY, modelo explícito, teto de chamadas e flag de autorização. Definir antes um
orçamento e os modelos aprovados. Nunca executar automaticamente no CI. A flag
é barreira técnica, não substitui a autorização do responsável. Cada conversa
pode chamar o modelo em seus turnos de preparação; portanto, o total de chamadas
é maior que o número de casos. Requisições têm timeout e limite de tokens, sem
retry do SDK, teto de 1.000 chamadas e janela máxima de 15 minutos por execução.
Não há DB, WhatsApp, criação de contato ou ação de produção.

O catálogo do avaliador é uma fixture curta de serviços existentes no seed, não
um snapshot do catálogo inteiro de produção. Avaliação real final precisa também
de snapshot autorizado/anonimizado do catálogo e revisão do conjunto com humanos.

O relatório mostra modo, modelo, hashes, decisões esperadas/reais, memória final,
latência, chamadas e falhas. Não imprime segredo nem payload de erro externo.
Preço monetário e naturalidade humana ficam **não medidos**. Casos de falha são
artificiais e não devem ser apresentados como taxa observada do modelo.

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
