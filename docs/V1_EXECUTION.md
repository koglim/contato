# Execução da V1 — estado canônico

Base confirmada em 09/09/2026: `main` em `5c20bd92cb13d8867ca21bcc819104dbf76ce1ff`,
CI [34384354307](https://github.com/koglim/contato/actions/runs/34384354307) aprovado.
Branch de execução: `codex/marketplace-v1-completion`.

Este documento acompanha o plano fornecido por Ricardo em
`ContatoCerto_Plano_Completo_e_Prompt_Astra.md`. Documentos e checkpoints antigos
são histórico; código, contratos e migrations atuais prevalecem.

## Inventário da base

| Domínio | Estado verificado | Evidência / pendência |
| --- | --- | --- |
| Busca, resolução e ranking | Implementado | API + PostGIS, fair-v1, pool 20 / página 3 / teto 6 |
| Escolha e contato bilateral | Implementado | Transação, consentimento, snapshots, selectionKey |
| Resposta profissional e retomada | Implementado | Migration 015, recusa preserva outra busca |
| Inbox / Outbox | Parcial | Retry 016; confirmar envio repetido e abandono ainda precisam correção |
| Revalidação da primeira escolha | Risco confirmado no código (F04) | Predicado atual dispensa elegibilidade quando não há recusa |
| Entrega n8n | Parcial / homologação pendente | Exports usados em produção não estão no repositório |
| Conversa contextual híbrida | Parcial | Parser e fallback de localização; sem B2 completa |
| Identidade e onboarding | Ausente | Acesso demonstrativo com profissional fixo |
| Painel | Parcial | Perfil, serviços, cobertura e disponibilidade; falta ownership |
| Conclusão / avaliações | Ausente como jornada | Tabelas existem; estados e interfaces não |
| Assinatura / cobrança | Ausente | Gateway, preço e políticas ainda pendentes de decisão |
| Administração / operação | Parcial | Chave interna; falta administração por papéis e recuperação auditada |
| QA | Parcial | Baseline: 270 API, 6 web, 66 integrações; falta browser e transporte real |

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

Os IDs correspondem à seção 15 do plano. Baseline não equivale a revalidação de
todos os critérios; quando o cenário do plano exige mais, fica parcial.

| IDs | Situação inicial | Trabalho necessário |
| --- | --- | --- |
| T01–T02 | Parcial | Fluxos atuais testados; linguagem contextual em B2 |
| T03–T07 | Não executado | Contratos, autenticidade e mídia no gateway real |
| T08–T09 | Baseline aprovada | Replay e conflito de payload existentes |
| T10–T13 | Parcial | API testada; falta consumidor de transporte integrado |
| T14–T16 | Riscos F06/F07 confirmados | Limite de abandono e recibo idempotente |
| T17–T18 | Não implementado | Ordenação relevante e obsolescência por finalidade |
| T19 | Baseline aprovada | Pool, teto, páginas e concorrência PostgreSQL |
| T20 | Parcial | Reserva preservada; recuperação terminal administrativa pendente |
| T21–T22 | Baseline aprovada | Aviso enviado e seleção concorrente |
| T23–T24 | Risco F04 confirmado | Elegibilidade obrigatória na primeira escolha; entitlement futuro |
| T25–T29 | Parcial | Domínio testado; falta entrega bilateral real e homologação |
| T30–T33 | Não implementado | Identidade, sessões e autosserviço seguro |
| T34–T38 | Não implementado | Atendimento, avaliação, assinatura e cobrança |
| T39–T43 | Não executado | Browser, canal, retenção, restore e carga |
| T44 | Baseline aprovada até 016 | Ampliar a cada migration nova |
| T45–T60 | Não implementado como B2 | Dataset, controlador e avaliação contextual |

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
