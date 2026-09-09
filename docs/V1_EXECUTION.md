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
| Inbox / Outbox | Parcial, estabilizada | Recibo/retenção 017, limite de abandono, FIFO independente e diagnóstico; recuperação Inbox/admin ainda pendentes |
| Revalidação da primeira escolha | Corrigida (F04) | Status, serviço/catálogo, contato canônico e cobertura obrigatórios em nova seleção/apresentação |
| Entrega n8n | Parcial / homologação pendente | Dois exports inativos testados; gateway de produção/versões ainda não fornecidos |
| Conversa contextual híbrida | Parcial | Parser e fallback de localização; sem B2 completa |
| Identidade e onboarding | Ausente | Acesso demonstrativo com profissional fixo |
| Painel | Parcial | Allowlist no BFF fecha F02; status/telefone somente leitura; falta ownership individual |
| Conclusão / avaliações | Ausente como jornada | Tabelas existem; estados e interfaces não |
| Assinatura / cobrança | Ausente | Gateway, preço e políticas ainda pendentes de decisão |
| Administração / operação | Parcial | Diagnóstico sem PII, logs sanitizados e runbook; papéis/alertas/recuperação auditada pendentes |
| QA | Parcial | 276 API, 12 web, 7 workflows e 80 integrações; falta browser, carga e transporte real |

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

Último checkpoint de código acima: `1cd80a6e699dbabdc64199a7b62026e72062e60a`.
Lint, typecheck, build, 276 testes API + 12 web + 7 workflows passaram localmente
e no CI. As 80 integrações PostgreSQL/PostGIS passaram duas vezes no CI: antes e
depois de down compatível 017–008 e reaplicação 008–017. Rollbacks protegidos
014/015/016/017 verificam preservação e falha esperada, não limpeza de evidências.
Nenhuma migration foi executada em produção. O relatório da execução informa o
SHA/CI final do HEAD, incluindo a consolidação documental posterior.

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
evidência/pendência. A fase A foi concluída; B/C e a proteção F02 avançaram, mas
essas fases não estão integralmente homologadas. B2 e D–I não foram concluídas.

## Onde continuar

1. Obter versões de n8n/Evolution e export sanitizado do gateway atual. Conectar
   em homologação o transporte compartilhado, autenticação, texto/áudio e entrada
   durável sem duplicar o envio imediato. Não reescrever a API bilateral pronta.
2. Completar recuperação de Inbox/admin e política de obsolescência por finalidade;
   uma retenção não pode ser liberada apagando evidência. Instrumentar alertas.
3. Iniciar B2 conforme o plano: memória confirmada separada de inferência, proposta
   estruturada validada por controlador e candidatos reais, resposta persistida,
   dataset de 300 casos com divisão reservada e avaliação autorizada. Nenhuma nova
   chamada de IA nem seleção automática foi ativada neste checkpoint.
4. Identidade/onboarding: decidir canal e proteção de transporte OTP, então contas,
   sessões e ownership. O profissional fixo continua impedindo uso multiusuário.
5. Prosseguir E–I: atendimento/avaliação, entitlement, gateway aprovado, painéis,
   retenção, restore, carga, revisão humana e release. São trabalho remanescente,
   não itens que um CI verde da Outbox resolve.

Release manual, configuração n8n, incidente/rollback e ensaio de backup estão em
[OPERATIONS.md](OPERATIONS.md) e [workflows/n8n/README.md](../workflows/n8n/README.md).
Não há nova variável API/web; migration 017 deve preceder a API deste checkpoint.

## Decisões e dependências externas

- Confirmar versões e exports atuais de n8n/Evolution antes de homologar transporte.
- Gateway e preço de assinatura, trial/carência e legado exigem decisão comercial.
- Canal real de OTP, modalidade WhatsApp, opt-in/templates e credenciais devem ser
  configurados pelo operador; não usar entrega fictícia em produção.
- Conclusão/contestação, suporte, retenção e revisão de políticas precisam de
  validação do responsável. Não declarar conformidade jurídica.
- PostgreSQL/PostGIS descartável é executado no CI; Docker/psql não estão
  disponíveis neste computador. Produção nunca é ambiente de teste.

Classificação atual: núcleo funcional; **V1 comercial ainda não concluída**.
