# Execução da V1 — estado canônico

Base confirmada em 09/09/2026: `main` em `5c20bd92cb13d8867ca21bcc819104dbf76ce1ff`,
CI [34384354307](https://github.com/koglim/contato/actions/runs/34384354307) aprovado.
Branch de execução: `codex/marketplace-v1-completion`.

Este documento acompanha o plano fornecido por Ricardo em
`ContatoCerto_Plano_Completo_e_Prompt_Astra.md`. Documentos e checkpoints antigos
são histórico; código, contratos e migrations atuais prevalecem.

## Inventário após este checkpoint

| Domínio | Estado verificado | Evidência / pendência |
| --- | --- | --- |
| Busca, resolução e ranking | Implementado | API + PostGIS, fair-v1, pool 20 / página 3 / teto 6 |
| Escolha e contato bilateral | Implementado | Transação, consentimento, snapshots, selectionKey |
| Resposta profissional e retomada | Implementado | Migration 015, recusa preserva outra busca |
| Inbox / Outbox | Implementação de recuperação disponível; homologação pendente | 017/019: recibos, leases, FIFO, backoff, fencing, quarentena/admin e diagnóstico; consumidor agendado inativo |
| Revalidação da primeira escolha | Corrigida (F04) | Status, serviço/catálogo, contato canônico e cobertura obrigatórios em nova seleção/apresentação |
| Entrega n8n | Candidato preparado / homologação pendente | Cinco exports inativos; áudio/avisos duráveis020, administração e Shared Delivery; versões1.123.21/2.3.7; execução real pendente |
| Conversa contextual híbrida | Implementação B2 disponível, desligada | Memória/hipóteses, controlador, perguntas fundamentadas, persistência e corpus 300; modelo real/revisão humana pendentes |
| Identidade e onboarding | Implementado | PRs #10–#13 (Migrations 021–024): Contas, OTP passwordless, auditoria e ownership individual |
| Painel | Parcial | Allowlist no BFF fecha F02; status/telefone somente leitura; suporte a ownership individual |
| Conclusão / avaliações | Parcial (Conclusão implementada) | PR #15 (Migration 026): conclusão e confirmação bilateral; Avaliações/reputação pendentes (PR #16) |
| Assinatura / cobrança | Parcial (Assinatura implementada) | PR #14 (Migration 025): planos e entitlements do marketplace; Gateways de pagamento congelados |
| Administração / operação | Parcial | Diagnóstico sem PII, logs sanitizados, disposição auditada da Inbox; papéis individuais, alertas ativos e administração Outbox pendentes |
| QA | Parcial | Baseline ampliado pela suíte B2 e corpus; resultados/SHA exatos no relatório B2; falta browser, carga, modelo e transporte reais |

## Entregas publicadas e evidência

| Commit | Entrega | CI aprovado |
| --- | --- | --- |
| `e7c0767` | Baseline e inventário | Incluído nos checkpoints seguintes |
| `60d55ab` | Elegibilidade obrigatória antes de nova seleção | [34401153725](https://github.com/koglim/contato/actions/runs/34401153725) |
| `0a44902` | Recibo idempotente, hold, limite de leases e migration 017 | [34401960396](https://github.com/koglim/contato/actions/runs/34401960396) |
| `ac74cc2` | Consumidor compartilhado e dispatcher inativos + bilateral PostgreSQL | [34403284985](https://github.com/koglim/contato/actions/runs/34403284985) |
| `41cea96` | Limite de autosserviço no servidor e formulário | [34403801659](https://github.com/koglim/contato/actions/runs/34403801659) |
| `209bda7` | Diagnóstico agregado da fila | [34404276101](https://github.com/koglim/contato/actions/runs/34404276101) |
| `1cd80a6` | Sanitização de logs e runbook operacional | [34404857753](https://github.com/koglim/contato/actions/runs/34404857753) |
| `ba57af4` | B2: contexto, hipóteses, perguntas fundamentadas, recuperação, FIFO e corpus 300 | [34475297400](https://github.com/koglim/contato/actions/runs/34475297400) |
| `883544c` | B2.2: pedidos interrogativos, catálogo informativo, composição e jornadas Inbox | [34478125708](https://github.com/koglim/contato/actions/runs/34478125708) |
| `103a7cb` | Inbox autônoma: FIFO/fencing, retry/quarentena/admin, recuperação B2 e legado | [34484998845](https://github.com/koglim/contato/actions/runs/34484998845) |
| `860c304` | Transporte inativo fixado em n8n 1.123.21 / Evolution 2.3.7: gateway JWT, áudio, shared e fixture B2 estável | [34500007769](https://github.com/koglim/contato/actions/runs/34500007769) |

Checkpoint anterior à B2: `1cd80a6e699dbabdc64199a7b62026e72062e60a`.
Lint, typecheck, build, 276 testes API + 12 web + 7 workflows passaram localmente
e no CI. As 80 integrações PostgreSQL/PostGIS passaram duas vezes no CI: antes e
depois de down compatível 017–008 e reaplicação 008–017. Rollbacks protegidos
014/015/016/017 verificam preservação e falha esperada, não limpeza de evidências.
Nenhuma migration foi executada em produção. O relatório da execução informa o
SHA/CI final do HEAD, incluindo a consolidação documental posterior.

Checkpoint de código B2: `ba57af48ae6db63806ff0adce488791c479cfa6b`.
CI aprovado com 287 testes API, 12 web, 7 workflows, 300 casos simulados e 91
integrações PostgreSQL antes/depois da reaplicação. Evidências, limites e gates
estão em [B2_DELIVERY_REPORT.md](B2_DELIVERY_REPORT.md). Isto conclui a entrega
técnica independente desta rodada, não a homologação conversacional ou a V1.

Revisão B2.2: `883544c79872ca87d08f385fc4847ab89bf97fe9`, CI aprovado com 297
testes API + 12 web + 7 workflows, 96 integrações duas vezes, 300 casos congelados
e 18 adicionais. A retomada por janela do avaliador acrescenta um teste no próximo
checkpoint. [B2_HOMOLOGATION_PLAN.md](B2_HOMOLOGATION_PLAN.md) propõe modelos,
catálogo, orçamento e gates; nenhuma chamada paga executada. A recuperação
autônoma da Inbox foi implementada no checkpoint 019 abaixo; sua ativação e
homologação operacional continuam pendentes antes da operação pública.

Checkpoint 019 parte de `916dbf6d004ab85e816be554cec0095457da0e9a` sem alterar
o corpus/prompt B2. Acrescenta claim FIFO por telefone, cinco tentativas efetivas,
backoff, fencing, quarentena e disposição auditada. Proposta/rascunho reutilizados
somente na mesma revisão; contexto alterado pede confirmação sem novos efeitos.
O consumidor n8n gerado permanece inativo. Evidências por cenário, limites e
ordem de publicação em [INBOX_RECOVERY.md](INBOX_RECOVERY.md).

## Checkpoints e ordem

1. A — registrar baseline, critérios e lacunas reais (este documento).
2. B/C — revalidar seleção/apresentação, tornar confirmação repetível, limitar
   abandono, preparar entrega compartilhada e workflows com testes de contrato.
3. B2 — interpretação contextual e controlador com evidências; avaliação separada
   de 300 casos e revisão humana antes da ativação.
4. D — identidade individual, OTP protegido, sessões, ownership e onboarding.
5. E — oportunidades, conclusão declarada, confirmação/contestação e avaliações.
6. F — assinatura/entitlement independentes de fornecedor e legado explícito.
7. G — cobrança em sandbox após decisão do fornecedor e políticas comerciais.
8. H/I — produto público, administração, privacidade, carga e release validada.

As fases não são consideradas prontas apenas por ter schema ou mock. Cada entrega
deve registrar testes executados, CI do SHA e o que depende de homologação externa.
Não ativar workflows, enviar WhatsApp real, cobrar, fazer merge ou deploy nesta
execução. Publicar commits para revisão/CI na branch de execução.

## Matriz de aceite do plano

[V1_ACCEPTANCE.md](V1_ACCEPTANCE.md) registra cada cenário T01–T60 com estado e
evidência/pendência. As fases A, B/C e B2 avançaram. A fase D (identidade individual)
foi concluída nos PRs #10–#13. A fase F (assinatura e entitlements v1) foi concluída
no PR #14 (com billing congelado). A conclusão bilateral da fase E foi concluída no
PR #15; avaliações (PR #16) e homologações finais permanecem como próximas etapas.

## Onde continuar

1. Homologar o candidato em [TRANSPORT_HOMOLOGATION.md](TRANSPORT_HOMOLOGATION.md):
   versões/export foram fornecidos e analisados; cinco exports inativos preparados.
   Rotacionar segredos encontrados no export original, validar JWT/rede/áudio,
   shared, recovery e consumer de mídia. Validar durabilidade, expurgo e reentregas
   implementados na020 antes de operação pública. Não reescrever a API bilateral.
2. Homologar recuperação Inbox/admin implementada na 019, incluindo reinício do
   consumidor e casos em quarentena. Homologar administração da Outbox020 e definir
   política de obsolescência por finalidade; não liberar retenção apagando evidência.
   Instrumentar alertas e validar carga/duração dos locks legados.
3. Homologar B2: autorizar modelos/orçamento, executar comparação no development,
   congelar configuração e avaliar heldout com revisão humana. Corpus e runner
   estão em `apps/api/evaluations/b2`; controles e limites em
   [B2_CONTEXTUAL_CONVERSATION.md](B2_CONTEXTUAL_CONVERSATION.md).
   Não houve chamada paga nem ativação nesta execução.
4. Identidade/onboarding: decidir canal e proteção de transporte OTP, então contas,
   sessões e ownership. O profissional fixo continua impedindo uso multiusuário.
5. Prosseguir E–I: atendimento/avaliação, entitlement, gateway aprovado, painéis,
   retenção, restore, carga, revisão humana e release. São trabalho remanescente,
   não itens que um CI verde da Outbox resolve.

Release manual, configuração n8n, incidente/rollback e ensaio de backup estão em
[OPERATIONS.md](OPERATIONS.md) e [workflows/n8n/README.md](../workflows/n8n/README.md).
Para B2/Inbox, conferir e aplicar todas as migrations pendentes, incluindo 017, 018, 019 e 020
quando ausentes, antes da API; não supor que o ambiente já aplicou a 017.
Variáveis canônicas da B2: `CONVERSATION_AI_ENABLED=false` e
`OPENAI_CONVERSATION_MODEL` (sem default); `OPENAI_API_KEY` é reutilizada.
Os nomes `CONTEXTUAL_CONVERSATION_*` permanecem aliases temporários.
Publicar primeiro com B2 desligada, avaliar/homologar e só ativar mediante decisão
manual. Nenhuma dessas ações em produção foi executada.
O checkpoint Inbox não acrescenta variáveis nem dependências. Pausar ingresso e
consumidores durante a troca para 020; não manter réplicas antigas sem fencing.

## Decisões e dependências externas

- Versões informadas: n8n 1.123.21, Evolution 2.3.7, community node 1.0.4.
  Conferidas estaticamente; execução do motor/credenciais/rede reais ainda pendente.
- Gateway e preço de assinatura, trial/carência e legado exigem decisão comercial.
- Canal real de OTP, modalidade WhatsApp, opt-in/templates e credenciais devem ser
  configurados pelo operador; não usar entrega fictícia em produção.
- Conclusão/contestação, suporte, retenção e revisão de políticas precisam de
  validação do responsável. Não declarar conformidade jurídica.
- PostgreSQL/PostGIS descartável é executado no CI; Docker/psql não estão
  disponíveis neste computador. Produção nunca é ambiente de teste.

Classificação atual: núcleo funcional; **V1 comercial ainda não concluída**.

## Checkpoint de transporte versionado

Parte de `4dca0216a74714987a33a6ac856ce1b0e353d6f6`; sem mudanças de produção,
corpus, API de negócio ou migrations. Acrescenta gateway inativo, JWT nativo,
preservação texto/áudio, limites, confirmação conservadora da Evolution 2.3.7,
HTTP fullResponse text para 204, testes do grafo e integração PostgreSQL com
consumidores concorrentes. Export original não foi versionado por conter secrets.
Nova Variable **n8n**: EVOLUTION_WEBHOOK_ORIGIN; nenhuma variável API/EasyPanel.
As demais Variables/credentials e riscos estão no runbook do transporte.
Homologação manual e alertas continuam gates; durabilidade de mídia/avisos está
implementada na020, com validação e limites em TRANSPORT_DURABILITY.md,
não resultados comprovados pelo CI. B2 permanece desligada.

Código validado em `860c3048e0c2ea838ef45e91fc09f4568c654c06`: lint, typecheck,
build, 303 testes API + 12 web + 40 workflows; 300 casos B2 e 18 readiness
simulados; 127 integrações PostgreSQL antes e depois do rollback/reaplicação
até019, sem falhas. CI vinculado na tabela; a consolidação documental posterior
também exige CI do próprio HEAD. Nenhuma execução paga ou transporte real.


## Checkpoint 020 — durabilidade de áudio e intervenção

Implementação e critérios de aceite em [TRANSPORT_DURABILITY.md](TRANSPORT_DURABILITY.md).
Nova migration020; áudio/aviso antes do ACK, resultado persistido, leases/quarentena,
retenção, disposição auditada e diagnóstico agregado. CI inclui PostgreSQL real,
rollback protegido/compatível020–008 e reaplicação até020. Serviços externos
simulados; versões fixadas e exports inativos. Nenhuma variável/credential nova.
Publicação futura: todas as migrations pendentes (017–020 quando aplicável) antes
da API; depois cinco workflows ainda inativos e homologação autorizada. B2 off.
Não houve deploy/merge/envio/avaliação paga. V1 comercial continua incompleta.

Evidência da020: `25f1995e15e6e77d5d88bad06499cd77d0a383fb`,
[Actions34505279126](https://github.com/koglim/contato/actions/runs/34505279126),
success: API306/web12/workflows40; PostgreSQL144×2, migrations/down/reaplicação020,
B2 simulado300 e readiness18. Consolidação posterior deve conferir CI do próprio
SHA; ver registro no runbook de durabilidade. Homologação real continua pendente.

## Revisão cumulativa final — 2026-09-10

Comparação com main `5c20bd92cb13d8867ca21bcc819104dbf76ce1ff`, correções
`137feeb56bbe5b39f57250ac85f8137215ae56ce`,
[CI success](https://github.com/koglim/contato/actions/runs/34514506480).
Quarentena Inbox preservada por claim/resultado/expurgo de mídia; allowlist MIME,
status HTTP de entrada inválida e chaves opcionais vazias corrigidos com regressões.
API 311, web 12, workflows 40; PostgreSQL 150 × 2; migrations/rollback/reaplicação
até 020; B2 300 + readiness 18 simulados. Instalação congelada, lint, typecheck,
build e exports reproduzíveis aprovados. Nenhuma migration ou variável nova.
Inventário, sequência de atualização, riscos e limites de aceite estão em
[CUMULATIVE_REVIEW.md](CUMULATIVE_REVIEW.md). B2 off, workflows inativos; somente
integração controlada de desenvolvimento preparada, não liberação pública/V1.
