# B2 — conversa contextual híbrida

Checkpoint de implementação, não autorização de ativação. Nenhum modelo real,
WhatsApp ou geocoder de produção é chamado pelas validações automáticas.

## Contrato e fronteiras

A Inbox existente continua sendo a entrada. O handler B2 é opcional, depois do
roteamento de oportunidades profissionais; `CONVERSATION_AI_ENABLED=false`
preserva o caminho anterior. O replay reconhece resultados B2 mesmo com a flag
desligada e usa o texto persistido na Outbox, sem regeneração.

A interpretação usa Responses/Structured Outputs, schema estrito e catálogo
ativo real limitado a 100 serviços, com descrições limitadas a 200 caracteres.
Sem ferramentas, histórico integral, telefone, IDs de clientes/profissionais ou credenciais no contexto. No estágio de resolução de serviço (`pending="service"` ou `"location"`), também não há preços nem dados de candidatos no contexto. No estágio de seleção (`pending="selection"`), o catálogo é enviado vazio (0 itens) e entram exclusivamente os candidatos exibidos (até 6 profissionais da página 1/2) com atributos sem PII, incluindo fatos de preço determinísticos (`price_formatted`, `priceMode`). Mensagem e descrições são dados não confiáveis.
Evidências/localidade devem corresponder a trechos completos da mensagem original.
Uma profissão explicitamente reconhecida pode ser confirmada; uma associação
semântica sugerida pelo modelo permanece hipótese até confirmação do cliente.
O geocoder continua sendo a autoridade para coordenadas e ambiguidade geográfica.

Em b2.2, novas interpretações incluem `speech_act`: request, information,
hypothetical, negated ou unclear. Interrogação sozinha não bloqueia pedidos.
`catalog_info` responde sobre serviços usando catálogo/evidências, sem iniciar
busca nem alterar slots. Propostas b2.1 persistidas continuam legíveis.
O contrato público da Inbox não mudou.

Em b2.3, o mesmo Structured Output passou a exigir `confidence` (`high`,
`medium` ou `low`) e `natural_reply`, além dos intents não transacionais
`greeting` e `small_talk`. `natural_reply` só é utilizável para saudação,
conversa breve, esclarecimento ou retorno de fora de escopo. A API limita o
texto a 320 caracteres e rejeita telefone, e-mail, link, preço, disponibilidade,
Texto de resposta rejeitada é substituído por texto determinístico. Confiança baixa não altera memória nem
inicia busca sem uma evidência de domínio suficiente.

Em PR #18 (Selection Intelligence v2), a interpretação aceita `inquire_candidate`, `compare_candidates` e `show_more` quando a conversa aguarda seleção (`pending="selection"`). Apenas os candidatos apresentados da busca ativa (`shownCandidates`, até 6 profissionais exibidos) entram no contexto do modelo com atributos não PII. Perguntas sobre candidatos nunca efetuam a seleção nem mutam o domínio (ADR-002) e são respondidas exclusivamente via `SelectionInquiryPresenter` ou fast path determinístico (distância/preço) com 0 chamadas de composição. Comandos de conclusão sem código ("já terminei", "confirmo") são resolvidos deterministicamente para 1 contato elegível único.

Na orquestração adaptativa v1, o controlador separa `speech_act`, evidência de
serviço, localização e ação seguinte. Um match de catálogo `exact`/`phrase` é
evidência forte somente quando corresponde literalmente à mensagem, o catálogo
está ativo e o ato é um pedido sem negação, correção ou conflito. Nessa condição,
`clarify`, `uncertain` ou `confidence=low` do modelo não descartam o fato de
domínio. Evidência fuzzy e hipótese semântica permanecem hipóteses; uma nova
evidência semântica compatível apenas preserva a hipótese anterior e resulta em
pergunta de confirmação fundamentada. Isso não concede ações de seleção,
consentimento ou contato.

Para defeitos compatíveis com o catálogo, a instrução de interpretação pede uma
hipótese semântica com evidência literal em vez de um `clarify` genérico. A
confirmação continua obrigatória antes de o serviço entrar na memória confirmada.

Construções como `em Cuiabá`, `em Sinop` e `lá em Cuiabá` geram um candidato de
localização sem inventar UF. O geocoder continua sendo a autoridade para
existência e ambiguidade; locais genéricos como `em casa` continuam descartados.

Comandos globais exatos têm prioridade e não chamam IA. Seleção e consentimento
reutilizam a mensagem original, os repositórios e a transação existentes. A IA
não pode escolher posição, consentir ou compartilhar telefone em seu schema.
FAQ de custo usa política versionada em código: cliente gratuito e serviço
combinado/pago diretamente ao profissional. FAQ/fora de escopo/falhas não alteram
os slots. Correção de localização conserva serviço e registros antigos; correção
explícita de serviço conserva localização. Ambas reexecutam matching e
troca somente a busca da conversa ativa. Correção aguarda se houver lista não
confirmada como enviada ou consentimento pendente; não descarta silenciosamente.

## Persistência e concorrência

Migration **018_add_contextual_conversation** cria memória confirmada com origem
e inbound de evidência, hipóteses separadas, revisão, lease, turnos idempotentes e
orçamentos. `down` bloqueia com `P0018` se existirem memórias/turnos ou inbounds
marcados `contextual_queue=true`; nunca apaga
histórico para permitir downgrade. Migrations 001–017 não foram editadas.

O inbound novo recebe `contextual_queue=true` no INSERT original, antes do handler.
Registro de turno precede lease. Entradas elegíveis ainda não processadas são
ordenadas pela chegada do inbound, inclusive quando um handler anterior ainda
não começou. Entradas antigas fora da B2 não entram retroativamente nessa fila.
Concorrente recebe o contrato recuperável `channel_message_processing`;
nenhum conteúdo é descartado. O transporte/operador precisa repetir inbounds
recuperáveis; ainda não existe worker autônomo de reprocessamento de Inbox.
Uma entrada abandonada pode bloquear as seguintes até sua recuperação.
Checkpoint de recuperação obrigatória antes da operação pública, com limite de
tentativas, quarentena e FIFO: [plano de homologação](B2_HOMOLOGATION_PLAN.md).

Interpretação validada é persistida antes de efeitos. Na transação curta final:
fencing do token Inbox, lock do cliente, fencing da memória e fingerprint da
conversa, regras de domínio, memória, status do turno, inbound e Outbox.
Matching usa a mesma conexão/transação, sem alterar ranking. Chamadas de IA e
geocoder ficam fora dessa transação. Mudança concorrente no contexto invalida a
proposta anterior. Rollback não deixa busca ou contato sem Outbox.

## Limites e operação

Política `b2.4`: timeout configurável com padrão de 20 s por chamada, sem retry do SDK, 900 tokens máximos de
interpretação e 300 de composição, até duas chamadas por turno,
20 chamadas/cliente/hora, 1.000 globais/hora, lease 30 s. Quotas são
reservadas no banco antes da chamada e compartilhadas entre réplicas; até erros
consomem quota. Circuit breaker local: cinco erros, pausa de 60 s. Não é orçamento
monetário: preço/modelo e orçamento financeiro precisam de decisão antes de ativar.
Quotas antigas ainda exigem política operacional de retenção.

Variáveis canônicas: `CONVERSATION_AI_ENABLED` (default false),
`OPENAI_CONVERSATION_MODEL` (sem modelo escolhido por conveniência),
`OPENAI_CONVERSATION_TIMEOUT_MS` (default `20000` ms) e `OPENAI_API_KEY`.
O mesmo timeout limita o cliente OpenAI e o watchdog do orquestrador. Os aliases legados `CONTEXTUAL_CONVERSATION_ENABLED` e
`CONTEXTUAL_CONVERSATION_MODEL` continuam aceitos temporariamente para não
quebrar uma configuração em migração; quando definidos, os nomes canônicos têm
prioridade. Não adicionar chave ao Git. Ordem futura, sempre manual:
aplicar todas as migrations pendentes, incluindo 017 e 018 quando ausentes →
publicar API com flag desligada → avaliar e revisar → ativação
autorizada. Desligar flag não desfaz efeitos nem perde replay.

## Evidência e limitações

Os testes com provider simulado comprovam controle e persistência, não compreensão
ou naturalidade de um modelo. Integração usa PostgreSQL/PostGIS reais e simula
somente modelo e geocoder. Textos críticos continuam no presenter determinístico.
Perguntas de esclarecimento são geradas a partir do resultado real da resolução
e campos faltantes, com schema/limites e rejeição de afirmações financeiras,
contatos e ações concluídas. Rascunho validado é persistido antes dos efeitos;
falha de composição usa pergunta determinística sem perder a interpretação.
Em b2.3, também esse fallback é persistido antes dos efeitos. O plano de pergunta
é compartilhado com o avaliador; `target` retornado precisa coincidir com o campo
faltante/ambíguo. FAQ/interrupções não disparam composição sobre hipóteses lembradas.
Não se permite reescrever livremente preços, consentimento ou listas de pessoas.
Guardas textuais não são prova de segurança semântica universal: revisão humana
de perguntas e avaliação adversarial real continuam obrigatórias antes de ativar.
Paráfrases de comandos sensíveis não reconhecidas são esclarecidas, nunca
executadas pela confiança do modelo. Catálogo acima de 100 serviços requer
estratégia de recuperação avaliada; não declarar cobertura ilimitada.

No estágio de resolução de serviço (`pending="service"` ou `"location"`), o contexto enviado ao modelo contém a mensagem atual sanitizada, serviço/localização confirmados, slot pendente, até três nomes de hipóteses e até 100 itens do catálogo com descrições truncadas. No estágio de seleção (`pending="selection"`), o catálogo é enviado VAZIO (0 itens) e entram exclusivamente até 6 candidatos exibidos (`shownCandidates`, até 6 profissionais da página 1/2) com atributos sem PII (`position`, `displayName`, `serviceName`, `summary`, `distanceMeters`, `priceMode`, `priceFromCents`, `priceToCents`, `isVerified`, `availability`). Não contém telefone, IDs de cliente/profissional, tokens, coordenadas brutas nem histórico bruto. A Responses API usa `store:false`; memória confirmada e hipóteses continuam no PostgreSQL.

Cada turno B2 registra, sem mensagem bruta ou telefone, a decisão do controlador,
o método de evidência de serviço, a presença de hipótese anterior, a existência de
candidato de localização, o resultado da resolução e o fallback quando houver.

Corpus sintético e protocolo em
[evaluations/b2](../apps/api/evaluations/b2/README.md): 210 casos de desenvolvimento
e 90 reservados, com preparação multi-turno, versões e hashes. O modo simulado
não valida naturalidade, qualidade de um modelo nem custos/latência externos.

Documentação do contrato OpenAI consultada:
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
