# B2 — entrega técnica e continuidade

Data: 10/09/2026. Branch: `codex/marketplace-v1-completion`.
Base preservada: `3ee8bc4584bb4bb6420f63ae730dd7dfa156afe9`.
Código principal B2.2 validado: `883544c79872ca87d08f385fc4847ab89bf97fe9`.
[CI do código](https://github.com/koglim/contato/actions/runs/34478125708): **success**.
O commit documental que contém este relatório deve também ter seu CI conferido
pelo SHA; não confundir a execução acima com uma execução de outro HEAD.

**Estado: implementação B2 disponível para revisão, desligada por padrão.
Qualidade conversacional com modelo real e homologação ainda pendentes.**
Nenhum merge, deploy, envio WhatsApp, ativação de workflow, cobrança ou chamada
paga de avaliação foi realizado. A V1 inteira não está concluída.

## Revisão B2.2 antes da homologação

- Removido o bloqueio baseado somente em `?`. `speech_act` distingue solicitação,
  informação, hipótese, recusa e intenção incerta; obrigatório nas novas saídas
  do modelo, opcional apenas para ler propostas b2.1 persistidas. Não há lista
  fechada de pedidos permitidos. Guardas adicionais de negação/instruções continuam.
- Pedidos interrogativos aproveitam dados explícitos; consulta de catálogo retorna
  informação verificada sem confirmar disponibilidade nem iniciar busca completa.
  Negação de defeito permanece distinta de recusa. Compartilhamento continua
  dependente das regras originais de seleção/consentimento da API.
- Plano de pergunta compartilhado pelo runtime e avaliador: campo faltante ou
  ambíguo, sem composição durante FAQ/fora de escopo/consulta do catálogo. Correção
  de serviço e cidade usa a mesma revalidação/transação da B2.
- Composição declara `target`, validado contra o controlador. Pergunta válida e
  fallback de composição ficam persistidos antes dos efeitos; retry após rollback
  não regenera nenhum deles. Guardas rejeitam fatos críticos e promessas comuns,
  sem alegação de prova semântica universal.
- Avaliador registra todos os turnos, entrada/contexto permitido, interpretação,
  decisão, composição, resposta final e campos de revisão humana. Matching/seleção
  sem banco são marcados como fronteira, com resposta final nula; não inventa sucesso.
- Mantidos os 300 casos congelados e hashes; adicionados 18 cenários de preparação
  com catálogo dos oito serviços do seed. CI salva traces sintéticos em artifact
  por SHA por 14 dias. Comparação real e revisão humana **não executadas**.
- Preparada retomada do avaliador por `--offset/--limit`, sem repetir casos já
  avaliados; os turnos preparatórios de cada caso selecionado ainda são necessários.

Proposta concreta de modelos, catálogo, limites, custos e critérios:
[B2_HOMOLOGATION_PLAN.md](B2_HOMOLOGATION_PLAN.md). O mesmo documento define o
checkpoint de recuperação autônoma da Inbox. A implementação 019 foi acrescentada
posteriormente; ver seção abaixo e [INBOX_RECOVERY.md](INBOX_RECOVERY.md).
**A revisão B2.2 não criou migration; o checkpoint Inbox posterior cria a 019.
Nenhuma variável ou dependência nova na recuperação.**

## Checkpoint posterior — Inbox autônoma (10/09/2026)

Base aprovada `916dbf6d004ab85e816be554cec0095457da0e9a` preservada. A recuperação
agora está implementada na API: claim autenticado/FIFO, backoff, limite de cinco,
fencing em todas as fronteiras de efeito, quarentena, disposição auditada e
diagnóstico agregado. Export n8n gerado **inativo**, sem envio de WhatsApp.

Novas integrações cobrem queda antes/depois da proposta/rascunho, rollback após
busca/Outbox, memória/TTL alterados, concorrência, erro de IA/geocoder e replay.
Fallback determinístico persistido é reconhecido por igualdade exata com o texto
calculado para o contexto atual, sem afrouxar validação de saída da IA. O legado
também passa a ter efeitos e resposta na mesma transação; geocoding legado pode
ocorrer durante esse lock limitado, risco documentado.

Contagens, CI por SHA, matriz dos 30 cenários, rollout e limites do checkpoint:
[INBOX_RECOVERY.md](INBOX_RECOVERY.md). Tabelas B2.2 abaixo são evidência histórica,
não a contagem do HEAD atual. Corpus 300, readiness 18, hashes, prompts/modelos
candidatos e separação simulado/real/humano permanecem intactos. B2 continua
desligada; nenhuma avaliação paga, homologação de transporte ou ativação ocorreu.

## Entrega

- Memória confirmada com origem/evidência e hipóteses da IA separadas; revisão e
  fingerprint impedem aplicar interpretação baseada em contexto obsoleto.
- Proposta estruturada estrita, catálogo ativo real e controlador determinístico.
  Serviço explícito e cidade podem ser aproveitados juntos; associação semântica
  incerta pede confirmação. Cidade antes do serviço também é preservada.
- Correções de localização refazem resolução/matching conservando histórico.
  Lista não enviada ou consentimento pendente impedem troca silenciosa.
- FAQ sobre custo e mensagens fora do escopo preservam a busca. Perguntas de
  esclarecimento podem ter redação natural fundamentada; listas, preços, contatos
  e consentimento continuam no presenter determinístico.
- Comandos globais, recuperação por selectionKey, candidatos mostrados e
  consentimento permanecem sob regras da API. A IA não recebe poder de executar
  ações, escolher profissional ou autorizar compartilhamento.
- Proposta e rascunho persistidos; transação curta reúne efeitos de domínio,
  memória, inbound e Outbox. Replay não regenera texto nem repete contato.
- Fila por chegada durável, lease, fencing, quotas e fallback para timeout,
  indisponibilidade ou saída inválida. Geocoder/modelo fora da transação.
- Corpus versionado de 300 casos e avaliador opt-in para futura comparação real.

Arquivos centrais: `apps/api/src/modules/contextual-conversation`, configuração
em `apps/api/src/config/contextual-conversation.ts`, integração da Inbox/app,
contrato aditivo em `packages/shared`, migration 018, integração PostgreSQL,
`apps/api/scripts/evaluate-contextual.ts`, corpus e workflow CI. Matching recebeu
injeção da transação compartilhada; ranking não foi alterado. Sem novas
dependências, edição do frontend, migrations anteriores ou workflows n8n.

## Evidência executada

| Validação | Resultado |
| --- | --- |
| Instalação com lockfile no CI | Aprovada |
| `pnpm lint` | Local e CI aprovados |
| `pnpm typecheck` | Local e CI aprovados |
| `pnpm build` | Shared, API e Next.js aprovados localmente e no CI |
| `pnpm test` no CI de código acima | 297 API + 12 web + 7 workflows = 316 aprovados; retomada por janela acrescenta um teste no checkpoint seguinte |
| `eval:b2 --split=all` | 300/300 simulados; 260 composições validadas; zero chamadas externas |
| `eval:b2 --suite=readiness` | 18/18; 9 composições válidas e 2 fallbacks injetados |
| Integrações PostgreSQL/PostGIS | 96/96, repetidas após reaplicação |
| Migrations | 018 aplicada; down protegido P0018; down compatível 018–008 e reaplicação 008–018 aprovados |
| Proteções anteriores de rollback | Preservadas e aprovadas no CI |
| Exports n8n existentes | Verificados, sem alteração |
| `git diff --check` | Aprovado |

PostgreSQL/PostGIS foi real e descartável **no CI**, não local: Docker/psql não
estão disponíveis neste computador. Modelo e geocoder das integrações são
simulados. As 11 integrações novas incluem matching/FAQ/correção, cidade antes
do serviço, consentimento, recovery legado, falha de transação, persistência da
pergunta, falta de quota, timeout, concorrência, FIFO e rollback protegido.
Cinco jornadas B2.2 adicionais verificam solicitações interrogativas, perguntas de
contato, catálogo/interrupções, correções completas, falha de composição e
localização não resolvida; o teste de rollback também cobre fallback persistido.
As falhas intermediárias de fixtures foram corrigidas sem enfraquecer constraints.

## O que os 300 casos demonstram — e o que não demonstram

210 development + 90 heldout, 15 categorias, 200 casos com preparação multi-turno.
Há ambiguidades, correções, FAQ/interrupção/retomada, regionalismos, abreviações,
negações, saída inválida, indisponibilidade e instruções indevidas. O runner
compara decisão **e memória final**. Não são 300 testes end-to-end da Inbox.

Hashes SHA256 dos arquivos avaliados no CI:

- development: `0b71df0a91982c9aaa2749c923f6ad5b46c51f72f815742e6fdc2b76c34bfcdb`
- heldout: `010ef5428f7705c6eb4766604c024ec54575366c5e94ffca04199c8fccf1cf1b`

São mensagens sintéticas, propostas e composições simuladas: o resultado prova regressões
do controlador, não compreensão, naturalidade, custo ou latência de um modelo.
Os splits compartilham famílias semânticas; não é estudo humano cego independente.
O avaliador usa catálogo pequeno de fixture, não o catálogo completo de produção.
Guardas lexicais das perguntas não provam segurança semântica universal.

**Pendente de autorização:** orçamento, modelos, política de dados e snapshot
adequado do catálogo; comparar development, congelar modelo/prompt, executar
heldout sem ajuste posterior e revisar conversas/perguntas com humanos.
Runner pago exige `--real --authorize-paid-evaluation --model=... --max-calls=...`;
a flag técnica não substitui consentimento do responsável. Procedimento completo
em [evaluations/b2/README.md](../apps/api/evaluations/b2/README.md).

## Configuração, migration e publicação futura

- Nova `CONTEXTUAL_CONVERSATION_ENABLED=false` por padrão.
- Nova `CONTEXTUAL_CONVERSATION_MODEL`, sem default; obrigatória ao habilitar.
- `OPENAI_API_KEY` existente reutilizada, obrigatória ao habilitar. Nenhum segredo
  foi incluído; nenhuma variável do EasyPanel foi alterada.
- Migration `018_add_contextual_conversation`: memória, turnos, orçamento e
  marcador de fila no inbound. Down recusa registros contextuais existentes com
  P0018; não apagar dados para forçar rollback. 001–017 intactas.
- Ordem manual futura: revisar/aprovar → aplicar todas as migrations pendentes,
  incluindo 017, 018 e 019 quando ausentes → publicar API com B2
  desligada → avaliação/homologação → ativar somente após autorização.
- Fallback operacional: desligar flag conserva replay já persistido; não desfaz
  dados. Preferir correção progressiva se o down estiver protegido.

Limites em código, política b2.2: 6 s por chamada, sem retry SDK; até duas chamadas
por turno; 900 tokens de interpretação e 300 de composição; 20 chamadas por
cliente/hora e 1.000 globais/hora; lease 30 s; pausa local após cinco falhas.
Isso não substitui teto financeiro, retenção de quotas ou monitoramento real.
Catálogo acima de 100 serviços requer estratégia de recuperação avaliada.

## Riscos e ponto de continuidade

1. Homologação B2/modelo real e revisão humana: não executadas, bloqueiam ativação.
2. Recovery/admin agora implementados na 019. O acionamento contínuo ainda exige
   homologar/importar/ativar o export; nenhuma execução agendada foi instalada.
   Quarentena bloqueia o cliente até disposição explícita; casos legados com
   efeitos incertos exigem reconciliação, não retry automático.
3. Transporte n8n/Evolution, autenticidade, áudio, crash entre envio externo e
   confirmação, obsolescência de mensagens e observabilidade exigem homologação.
4. Respostas críticas são deliberadamente determinísticas; paráfrases sensíveis
   não reconhecidas pedem esclarecimento, nunca ganham poderes via IA.

## Projeto completo: escopo restante

O núcleo já possui catálogo, profissionais/serviços/áreas/disponibilidade,
resolução de serviço/local, matching PostGIS, páginas e seleção segura, contato
bilateral/consentimento, aceite/recusa/retomada, Inbox/Outbox e painel inicial.
Isso é a base funcional, não um produto comercial integralmente homologado.

Faltam identidade individual/OTP/sessões/ownership e onboarding; jornada de
conclusão, contestação, avaliações e moderação; assinatura/entitlement e gateway
aprovado; produto público/painéis/admin completos; privacidade/retensão,
recuperação operacional, backup/restore ensaiado, carga e release real.
Cliente gratuito e monetização por assinatura profissional permanecem a direção;
não foi acrescentada cobrança por lead nem cobrança automática.

Mapa canônico: [V1_EXECUTION.md](V1_EXECUTION.md) e critérios T01–T60 em
[V1_ACCEPTANCE.md](V1_ACCEPTANCE.md). Próxima ação é homologar B2 e transporte
conforme autorização, não declarar a V1 pronta por haver CI verde.
