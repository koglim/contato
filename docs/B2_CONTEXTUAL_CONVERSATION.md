# B2 — conversa contextual híbrida

Checkpoint de implementação, não autorização de ativação. Nenhum modelo real,
WhatsApp ou geocoder de produção é chamado pelas validações automáticas.

## Contrato e fronteiras

A Inbox existente continua sendo a entrada. O handler B2 é opcional, depois do
roteamento de oportunidades profissionais; `CONTEXTUAL_CONVERSATION_ENABLED=false`
preserva o caminho anterior. O replay reconhece resultados B2 mesmo com a flag
desligada e usa o texto persistido na Outbox, sem regeneração.

A interpretação usa Responses/Structured Outputs, schema estrito e catálogo
ativo real limitado a 100 serviços, com descrições limitadas a 200 caracteres.
Sem ferramentas, histórico integral, telefone, IDs de clientes/profissionais,
preços ou credenciais no contexto. Mensagem e descrições são dados não confiáveis.
Evidências/localidade devem corresponder a trechos completos da mensagem original.
Uma profissão explicitamente reconhecida pode ser confirmada; uma associação
semântica sugerida pelo modelo permanece hipótese até confirmação do cliente.
O geocoder continua sendo a autoridade para coordenadas e ambiguidade geográfica.

Comandos globais exatos têm prioridade e não chamam IA. Seleção e consentimento
reutilizam a mensagem original, os repositórios e a transação existentes. A IA
não pode escolher posição, consentir ou compartilhar telefone em seu schema.
FAQ de custo usa política versionada em código: cliente gratuito e serviço
combinado/pago diretamente ao profissional. FAQ/fora de escopo/falhas não alteram
os slots. Correção conserva serviço e registros antigos, reexecuta matching e
troca somente a busca da conversa ativa. Correção aguarda se houver lista não
confirmada como enviada ou consentimento pendente; não descarta silenciosamente.

## Persistência e concorrência

Migration **018_add_contextual_conversation** cria memória confirmada com origem
e inbound de evidência, hipóteses separadas, revisão, lease, turnos idempotentes e
orçamentos. `down` bloqueia com `P0018` se existirem memórias/turnos; nunca apaga
histórico para permitir downgrade. Migrations 001–017 não foram editadas.

Registro de turno precede lease. Turnos pendentes são ordenados pela chegada do
inbound. Concorrente recebe o contrato recuperável `channel_message_processing`;
nenhum conteúdo é descartado. O transporte/operador precisa repetir inbounds
recuperáveis; ainda não existe worker autônomo de reprocessamento de Inbox.
Uma entrada abandonada pode bloquear as seguintes até sua recuperação.

Interpretação validada é persistida antes de efeitos. Na transação curta final:
fencing do token Inbox, lock do cliente, fencing da memória e fingerprint da
conversa, regras de domínio, memória, status do turno, inbound e Outbox.
Matching usa a mesma conexão/transação, sem alterar ranking. Chamadas de IA e
geocoder ficam fora dessa transação. Mudança concorrente no contexto invalida a
proposta anterior. Rollback não deixa busca ou contato sem Outbox.

## Limites e operação

Política `b2.1`: 6 s por chamada, sem retry do SDK, 900 tokens máximos de
interpretação e 300 de composição, até duas chamadas por turno,
20 chamadas/cliente/hora, 1.000 globais/hora, lease 30 s. Quotas são
reservadas no banco antes da chamada e compartilhadas entre réplicas; até erros
consomem quota. Circuit breaker local: cinco erros, pausa de 60 s. Não é orçamento
monetário: preço/modelo e orçamento financeiro precisam de decisão antes de ativar.
Quotas antigas ainda exigem política operacional de retenção.

Variáveis novas: `CONTEXTUAL_CONVERSATION_ENABLED` (default false) e
`CONTEXTUAL_CONVERSATION_MODEL` (sem modelo escolhido por conveniência). Reutiliza
`OPENAI_API_KEY`; não adicionar chave ao Git. Ordem futura, sempre manual:
aplicar 018 → publicar API com flag desligada → avaliar e revisar → ativação
autorizada. Desligar flag não desfaz efeitos nem perde replay.

## Evidência e limitações

Os testes com provider simulado comprovam controle e persistência, não compreensão
ou naturalidade de um modelo. Integração usa PostgreSQL/PostGIS reais e simula
somente modelo e geocoder. Textos críticos continuam no presenter determinístico.
Perguntas de esclarecimento são geradas a partir do resultado real da resolução
e campos faltantes, com schema/limites e rejeição de afirmações financeiras,
contatos e ações concluídas. Rascunho validado é persistido antes dos efeitos;
falha de composição usa pergunta determinística sem perder a interpretação.
Não se permite reescrever livremente preços, consentimento ou listas de pessoas.
Guardas textuais não são prova de segurança semântica universal: revisão humana
de perguntas e avaliação adversarial real continuam obrigatórias antes de ativar.
Paráfrases de comandos sensíveis não reconhecidas são esclarecidas, nunca
executadas pela confiança do modelo. Catálogo acima de 100 serviços requer
estratégia de recuperação avaliada; não declarar cobertura ilimitada.

Corpus sintético e protocolo em
[evaluations/b2](../apps/api/evaluations/b2/README.md): 210 casos de desenvolvimento
e 90 reservados, com preparação multi-turno, versões e hashes. O modo simulado
não valida naturalidade, qualidade de um modelo nem custos/latência externos.

Documentação do contrato OpenAI consultada:
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
