# Checkpoint A — Current Reality Audit

**Data de Execução:** 2026-09-28
**Fase:** Launch Readiness / Homologação
**Auditor:** Agente de IA (Antigravity) — leitura estrita
**Branch de auditoria:** `audit/launch-readiness-current-reality`

> [!IMPORTANT]
> Este documento registra o estado atual verificado de forma **estritamente read-only**. Nenhuma modificação foi feita em código de produção, banco de dados, n8n, Evolution API, EasyPanel ou variáveis de ambiente de produção.

---

## Classificação de Evidências

Cada fato é classificado como:

| Símbolo | Significado |
| :---: | :--- |
| ✅ `VERIFIED` | Verificado diretamente a partir da fonte de autoridade |
| ⚠️ `DRIFT` | Divergência identificada entre esperado e verificado |
| ❌ `MISSING` | Componente esperado ausente |
| 🔶 `NOT ACCESSIBLE` | Sistema externo inacessível nesta auditoria local |
| ❓ `UNKNOWN` | Não foi possível verificar com os dados disponíveis |
| 🔒 `NOT CONFIGURED` | Componente presente mas sem configuração ativa |

---

## Seção A — Baseline do GitHub

### A.1 SHA Canônico de main

| Item | Valor | Status |
| :--- | :--- | :---: |
| SHA esperado | `b9e48582d7b39ab6cb5d42c3fb977a091f11bf56` | ✅ `VERIFIED` |
| SHA verificado via API GitHub | `b9e48582d7b39ab6cb5d42c3fb977a091f11bf56` | ✅ `VERIFIED` |
| PR #18 status | Squash-merged em `main` | ✅ `VERIFIED` |
| main local atualizado para HEAD | Sim — `git pull origin main` executado | ✅ `VERIFIED` |

### A.2 Commits Recentes em main (últimas 5 entradas)

| # | SHA (8) | Mensagem | Data |
| :---: | :--- | :--- | :--- |
| 1 | `b9e48582` | feat: Conversation Intelligence & Selection v2 (#18) | 2026-09-28T20:17:36Z |
| 2 | `9afb9e5c` | feat: Connection Lifecycle v2 (#17) | 2026-09-28T02:04:46Z |
| 3 | `43ee04c8` | docs: Product Canon & Documentation Reconciliation (#16) | 2026-09-27T21:28:59Z |
| 4 | `e2686ae7` | feat: Contact Completion & Confirmation v1 (#15) | 2026-09-27T13:54:10Z |
| 5 | `67bce800` | feat: add professional subscription and entitlements (#14) | 2026-09-27T02:05:58Z |

### A.3 Pull Requests Abertos

| Item | Valor | Status |
| :--- | :--- | :---: |
| PRs abertos | **0** (zero) | ✅ `VERIFIED` |

### A.4 CI em main (HEAD b9e48582)

| Run | Status | Conclusão | Observação |
| :--- | :---: | :---: | :--- |
| Push CI — Run ID `36478160592` | completed | **success** | ✅ `VERIFIED` — execução mais recente pós-merge PR #18 |
| Workflow `verify` (check-run no HEAD) | completed | **success** | ✅ `VERIFIED` |

> [!NOTE]
> CI verificado via `GET /repos/koglim/contato/commits/{sha}/check-runs` — retornou `{"name":"verify","status":"completed","conclusion":"success"}`.

### A.5 Migração Mais Alta no Repositório

| Item | Valor | Status |
| :--- | :--- | :---: |
| Migração mais alta em `database/migrations/` | `027_add_connection_lifecycle_v2.js` | ✅ `VERIFIED` |
| Migração 028 existe? | **Não** | ✅ `VERIFIED` |
| Total de arquivos de migration | 27 (001 a 027) | ✅ `VERIFIED` |

---

## Seção B — Inventário da Arquitetura Versionada (main)

### B.1 Estrutura do Monorepo

| Componente | Caminho | Tecnologia |
| :--- | :--- | :--- |
| API Backend | `apps/api` | Fastify / TypeScript / Node.js |
| Web Portal | `apps/web` | Next.js 16.x / TypeScript |
| Shared Types | `packages/shared` | TypeScript |
| Workflows n8n | `workflows/n8n/` | 5 arquivos JSON exportados |
| Migrations | `database/migrations/` | node-pg-migrate (001–027) |

### B.2 Inventário dos Workflows n8n Versionados

| Arquivo | Nome do Workflow | `active` | Nós | Responsabilidade |
| :--- | :--- | :---: | :---: | :--- |
| `gateway.json` | ContatoCerto - WhatsApp Gateway | `false` | 14 | Webhook JWT, roteamento texto/áudio, Inbox, claim por ID |
| `inbox-recovery.json` | ContatoCerto - Inbox Recovery | `false` | 4 | Recuperação de mensagens com lease expirado |
| `outbox-dispatcher.json` | ContatoCerto - Outbox Dispatcher | `false` | 5 | Claim da fila Outbox, orçamento, invoca shared-delivery |
| `media-consumer.json` | ContatoCerto - Durable Audio Consumer | `false` | 12 | Claim de mídia, transcrição Groq/OpenAI, persistência |
| `shared-delivery.json` | ContatoCerto - Shared Outbox Delivery | `false` | 11 | Entrega de negócio via Evolution, gate de propósito, sent/failed/hold |

> [!NOTE]
> Todos os 5 workflows versionados têm `active: false` no JSON exportado, conforme esperado — eles são ativados manualmente no ambiente instalado pelo operador após importação e rotação de credenciais.

### B.3 Suporte a `professional_auth_challenge` no shared-delivery.json

| Item | Verificação | Status |
| :--- | :--- | :---: |
| String `professional_auth_challenge` presente no `shared-delivery.json` | **SIM** — encontrada no nó "Validate claim" | ✅ `VERIFIED` |
| Isso significa que o workflow versionado atual suporta o propósito `professional_auth_challenge` | Confirmado | ✅ `VERIFIED` |

> [!IMPORTANT]
> O workflow **versionado** em `main` já suporta `professional_auth_challenge`. O workflow **instalado** no n8n remoto pode ainda não ter sido atualizado — ver Seção C.

### B.4 Capacidades Implementadas e Cobertas por CI em main

As seguintes capacidades estão implementadas no código de `main` e aprovadas em CI:

| Capacidade | Status no Código |
| :--- | :---: |
| Busca, resolução de serviços, matching e ranking espacial | ✅ IMPLEMENTADO |
| Contato bilateral atômico (status `shared`, Migration 027) | ✅ IMPLEMENTADO |
| Ciclo de conexão v2 (sem segundo aceite, indisponibilidade profissional) | ✅ IMPLEMENTADO |
| Durabilidade de mensageria (Inbox + Outbox + leases) | ✅ IMPLEMENTADO |
| Identidade e autenticação profissional OTP via WhatsApp | ✅ IMPLEMENTADO (sob flag) |
| Assinaturas e entitlements neutros de gateway | ✅ IMPLEMENTADO |
| Conclusão e confirmação bilateral de atendimentos | ✅ IMPLEMENTADO |
| Inteligência conversacional e Seleção v2 | ✅ IMPLEMENTADO |
| Portal Web do profissional (`/dashboard`) | ✅ IMPLEMENTADO |

---

## Seção C — n8n Instalado (Auditoria Remota)

> [!WARNING]
> **🔶 NOT ACCESSIBLE** — A instância remota do n8n (EasyPanel) **não é acessível** a partir deste ambiente local. O arquivo `.env` local aponta para `localhost` e não contém URLs de produção do EasyPanel, n8n ou Evolution API.

### C.1 O que é verificável a partir de evidência histórica do operador

A documentação em `docs/CURRENT_STATE.md` (Seção 3) registra a seguinte evidência histórica do operador (classificada como `OPERATOR EVIDENCE` — não verificada nesta auditoria):

| Item | Evidência do Operador | Classificação |
| :--- | :--- | :---: |
| Versão do n8n instalado | `1.123.21` | ❓ `UNKNOWN` — não reverificado nesta auditoria |
| Gateway (WhatsApp Gateway) | Ativo no n8n remoto | ❓ `UNKNOWN` — não reverificado |
| Durable Audio Consumer | Ativo no n8n remoto | ❓ `UNKNOWN` — não reverificado |
| Inbox Recovery | Ativo no n8n remoto | ❓ `UNKNOWN` — não reverificado |
| Outbox Dispatcher | Ativo no n8n remoto | ❓ `UNKNOWN` — não reverificado |
| Shared Outbox Delivery | Invocado como subworkflow (active=false no instalado) | ❓ `UNKNOWN` — não reverificado |
| Suporte a `professional_auth_challenge` no instalado | **DRIFT CONHECIDO** — instalado não tem suporte; versionado tem | ⚠️ `DRIFT` |

### C.2 Matriz de Drift — Workflows n8n

| Workflow GitHub (main) | Workflow Instalado | Classificação | Impacto no Lançamento |
| :--- | :--- | :---: | :--- |
| `gateway.json` (14 nós) | Presumido instalado e ativo | ❓ `UNKNOWN` | Crítico — bloqueia recepção de mensagens |
| `inbox-recovery.json` (4 nós) | Presumido instalado e ativo | ❓ `UNKNOWN` | Alto — bloqueia recuperação de inbox |
| `outbox-dispatcher.json` (5 nós) | Presumido instalado e ativo | ❓ `UNKNOWN` | Crítico — bloqueia envio de mensagens |
| `media-consumer.json` (12 nós) | Presumido instalado e ativo | ❓ `UNKNOWN` | Médio — bloqueia transcrição de áudio |
| `shared-delivery.json` (com auth_challenge) | Instalado SEM auth_challenge | ⚠️ `DRIFT` | Bloqueia `PROFESSIONAL_AUTH_ENABLED=true` |

> [!IMPORTANT]
> **Ação de remediação necessária antes do lançamento da autenticação OTP:** O operador deve reimportar o `shared-delivery.json` versionado no n8n instalado antes de habilitar `PROFESSIONAL_AUTH_ENABLED=true` em produção.

---

## Seção D — Evolution API Instalada (Auditoria Remota)

> [!WARNING]
> **🔶 NOT ACCESSIBLE** — A instância remota da Evolution API (EasyPanel) **não é acessível** a partir deste ambiente local.

### D.1 Evidência histórica do operador

| Item | Evidência Histórica | Classificação |
| :--- | :--- | :---: |
| Versão da Evolution API | `v2.3.7` (evidência histórica em `TRANSPORT_HOMOLOGATION.md`) | ❓ `UNKNOWN` — não reverificado nesta auditoria |
| Instância conectada ao WhatsApp | Reportada como ativa pelo operador | ❓ `UNKNOWN` — não reverificado |
| Webhook configurado para n8n | Reportado como configurado | ❓ `UNKNOWN` — não reverificado |
| Estado de saúde | Desconhecido sem acesso ao painel | ❓ `UNKNOWN` |

> [!CAUTION]
> A documentação existente menciona Evolution API `v2.3.7`. Esta auditoria **NÃO confirma** que essa versão ainda está instalada. O operador deve verificar a versão instalada diretamente no EasyPanel.

---

## Seção E — EasyPanel / Estado da Aplicação Instalada

> [!WARNING]
> **🔶 NOT ACCESSIBLE** — O painel EasyPanel não é acessível a partir deste ambiente local. Não há URLs de produção no `.env` local.

### E.1 Serviços esperados em produção

| Serviço | Esperado | Estado Instalado | Classificação |
| :--- | :--- | :--- | :---: |
| ContatoCerto API (Fastify) | Ativo na porta 3333 | ❓ `UNKNOWN` | ❓ `UNKNOWN` |
| ContatoCerto Web (Next.js) | Ativo na porta 3000 | ❓ `UNKNOWN` | ❓ `UNKNOWN` |
| PostgreSQL + PostGIS | Ativo na porta 5432 | ❓ `UNKNOWN` | ❓ `UNKNOWN` |
| n8n | Ativo | ❓ `UNKNOWN` | ❓ `UNKNOWN` |
| Evolution API | Ativo | ❓ `UNKNOWN` | ❓ `UNKNOWN` |
| Redis | Não esperado pelo código versionado | ❓ `UNKNOWN` | ❓ `UNKNOWN` |

> [!NOTE]
> O código em `main` não faz referência a Redis. A durabilidade de fila é inteiramente baseada em PostgreSQL (`channel_inbound_messages`, `channel_outbound_messages`).

### E.2 Rastreabilidade da versão deployada

| Item | Classificação |
| :--- | :---: |
| Versão deployada da API vinculada a SHA Git | ❓ `UNKNOWN` — não verificável sem acesso ao EasyPanel |

> [!CAUTION]
> **DEPLOYED VERSION NOT TRACEABLE** — Sem acesso ao EasyPanel, não é possível confirmar se a API em produção está rodando o código do `main @ b9e48582`. O operador deve verificar qual imagem/tag/commit está atualmente deployado.

---

## Seção F — Feature Flags / Autoridade de Configuração

### F.1 Flags — Código vs Local vs Produção

| Feature Flag | Padrão no Código | Valor no .env Local | Effective em Produção | Status |
| :--- | :---: | :---: | :---: | :---: |
| `CONVERSATION_AI_ENABLED` | `false` | `false` | ❓ `UNKNOWN` | ⚠️ Pode divergir — operador reportou `true` |
| `CONTEXTUAL_CONVERSATION_ENABLED` | `false` (alias legado) | não definido | ❓ `UNKNOWN` | ❓ `UNKNOWN` |
| `MESSAGE_INTERPRETATION_FALLBACK_ENABLED` | `false` | `false` | ❓ `UNKNOWN` | ❓ `UNKNOWN` |
| `PROFESSIONAL_AUTH_ENABLED` | `false` | não definido | ❓ `UNKNOWN` | 🔒 `NOT CONFIGURED` localmente |

> [!NOTE]
> O código (`contextual-conversation.ts` linha 6): `const enabled = env.CONVERSATION_AI_ENABLED ?? env.CONTEXTUAL_CONVERSATION_ENABLED ?? "false"`. O padrão é `"false"` em código. `CONVERSATION_AI_ENABLED` tem precedência absoluta sobre o alias legado.

### F.2 Credenciais de Segredos — Presença Local

| Segredo / Credencial | Presença Local (.env) |
| :--- | :---: |
| `INTERNAL_API_KEY` | PRESENT |
| `DASHBOARD_SESSION_SECRET` | PRESENT |
| `OPENAI_API_KEY` | MISSING |
| `OPENROUTESERVICE_API_KEY` | MISSING |
| `PROFESSIONAL_AUTH_PEPPER` | MISSING (não configurado localmente) |
| `GROQ_API_KEY` | MISSING |
| Evolution API credentials | MISSING (sem URL de produção no local) |
| n8n Evolution credentials | MISSING |

> [!IMPORTANT]
> A ausência de `OPENAI_API_KEY` e `GROQ_API_KEY` no ambiente local é **esperada** — o `.env` local é o ambiente de desenvolvimento/testes. A presença em produção não pôde ser verificada nesta auditoria.

---

## Seção G — Realidade do Banco de Dados (Local)

### G.1 Banco Local (ambiente de desenvolvimento/testes)

| Item | Valor | Status |
| :--- | :--- | :---: |
| PostgreSQL versão | `16.4 (Debian 16.4-1.pgdg110+2)` | ✅ `VERIFIED` |
| PostGIS versão | `3.4.3` | ✅ `VERIFIED` |
| Número de migrations executadas | **27** | ✅ `VERIFIED` |
| Migration mais alta | `027_add_connection_lifecycle_v2` | ✅ `VERIFIED` |
| Migration 028 presente? | **NÃO** | ✅ `VERIFIED` |
| Índice único bilateral presente? | `contacts_bilateral_search_professional_unique_idx` — **PRESENT** | ✅ `VERIFIED` |
| Triggers de imutabilidade em `professional_unavailability_events` | `professional_unavailability_events_immutable` e `professional_unavailability_events_no_truncate` — **ativos** | ✅ `VERIFIED` |

### G.2 Tabelas Core Presentes no Schema Local

Todas as tabelas esperadas estão presentes:

```
account_identifiers, accounts, channel_inbound_messages, channel_inbound_recovery_events,
channel_media_events, channel_outbound_message_matches, channel_outbound_messages,
channel_transport_events, contact_completion_events, contact_completions, contacts,
contextual_budgets, contextual_memories, contextual_turns, customers, matches,
opportunity_response_events, pgmigrations, professional_auth_challenges,
professional_membership_events, professional_memberships, professional_service_areas,
professional_services, professional_sessions, professional_subscription_events,
professional_subscriptions, professional_unavailability_events, professionals,
reviews, search_conversations, search_requests, service_aliases, service_categories,
services, spatial_ref_sys, subscription_plan_entitlements, subscription_plans
```

### G.3 Enums de Status das Filas

| Enum | Valores Confirmados |
| :--- | :--- |
| `channel_inbound_message_status` | `received`, `processing`, `processed`, `failed` |
| `channel_outbound_message_status` | `pending`, `processing`, `sent`, `failed` |

> [!NOTE]
> O enum de status da Inbox **NÃO contém** `pending` ou `quarantined` — valores são `received`, `processing`, `processed`, `failed`. Isso é relevante para operações de monitoramento.

### G.4 Estado das Filas (Banco Local)

O banco local é o ambiente de desenvolvimento/testes. As filas estão **completamente vazias**:

| Fila | Estado |
| :--- | :---: |
| `channel_inbound_messages` | 0 mensagens (banco local vazio) |
| `channel_outbound_messages` | 0 mensagens (banco local vazio) |
| Mensagens presas com lease expirado | 0 |
| Contatos bilaterais | 0 (banco local vazio) |
| Eventos de indisponibilidade | 0 |
| Conclusões | 0 |
| Assinaturas profissionais | 0 |
| Profissionais cadastrados | 0 |

> [!IMPORTANT]
> **O banco de dados auditado é o banco LOCAL de desenvolvimento (`localhost:5433`), não o banco de produção.** O banco de produção está no EasyPanel e não foi acessível nesta auditoria.

---

## Seção H — Saúde de Filas de Mensagens (Produção)

> [!WARNING]
> **🔶 NOT ACCESSIBLE** — O banco de produção não está acessível neste ambiente local. Os dados de filas abaixo são do banco de desenvolvimento local (vazios).

Para consultar a saúde das filas em produção, o operador deve executar em produção:

```
GET /internal/channel/inbound/queue-status
GET /internal/channel/outbound/queue-status
```

---

## Seção I — Realidade do Portal Web do Profissional

> [!WARNING]
> **🔶 NOT ACCESSIBLE** — O portal web de produção não é acessível a partir deste ambiente local. O servidor local (porta 3000) não está em execução.

### I.1 O que está versionado (main)

| Item | Status no Código |
| :--- | :---: |
| `/dashboard` implementado | ✅ `VERIFIED` — `apps/web` presente e buildado em CI |
| Autenticação via cookie assinado | ✅ `VERIFIED` no código |
| OTP via WhatsApp (PROFESSIONAL_AUTH_ENABLED) | ✅ `VERIFIED` — implementado, desativado por padrão |
| Rastreabilidade da versão deployada | ❓ `UNKNOWN` |

---

## Seção J — Realidade da IA / Modelos

### J.1 Configuração de IA (Código em main)

| Item | Valor no Código | Status Local |
| :--- | :--- | :---: |
| `CONVERSATION_AI_ENABLED` | `false` (padrão) | `false` no .env local |
| `OPENAI_CONVERSATION_MODEL` | Variável (sem padrão hardcoded) | Vazio no .env local |
| `OPENAI_CONVERSATION_TIMEOUT_MS` | `20000` (padrão) | `20000` no .env local |
| `MESSAGE_INTERPRETATION_FALLBACK_ENABLED` | `false` (padrão) | `false` no .env local |
| `DEFAULT_MESSAGE_INTERPRETATION_FALLBACK_MODEL` | `"gpt-5.6-luna"` (padrão no código) | — |
| `DEFAULT_OPENAI_CONVERSATION_TIMEOUT_MS` | `20_000` | — |
| `OPENAI_API_KEY` | Ausente → IA desativada | MISSING local |
| `GROQ_API_KEY` | Para transcrição de áudio via n8n | MISSING local |

### J.2 Nota sobre CONVERSATION_AI_ENABLED em produção

O `docs/CURRENT_STATE.md` (Seção 2) registra que evidências do operador indicam que o ambiente instalado pode ter sido configurado com `CONVERSATION_AI_ENABLED=true`. Isso **não foi verificado** nesta auditoria.

---

## Seção K — Matriz de Drift

| Componente | Estado Esperado (GitHub main) | Estado Instalado | Classificação | Impacto | Remediação Necessária? |
| :--- | :--- | :--- | :---: | :--- | :---: |
| **API — SHA deployado** | `b9e48582` | Não verificável | ❓ `UNKNOWN` | Alto | Verificar no EasyPanel |
| **Web — SHA deployado** | `b9e48582` | Não verificável | ❓ `UNKNOWN` | Médio | Verificar no EasyPanel |
| **DB — Migrations** | 027 (local: verificado) | Produção: não verificado | ❓ `UNKNOWN` | Crítico | Operador deve verificar |
| **n8n Gateway** | 14 nós, ativo | Presumido instalado | ❓ `UNKNOWN` | Crítico | Reverificar instalado |
| **n8n Inbox Recovery** | 4 nós, ativo | Presumido instalado | ❓ `UNKNOWN` | Alto | Reverificar instalado |
| **n8n Outbox Dispatcher** | 5 nós, ativo | Presumido instalado | ❓ `UNKNOWN` | Crítico | Reverificar instalado |
| **n8n Media Consumer** | 12 nós, ativo | Presumido instalado | ❓ `UNKNOWN` | Médio | Reverificar instalado |
| **shared-delivery.json (auth_challenge)** | Suportado em versionado | NÃO suportado no instalado | ⚠️ `DRIFT` | Bloqueia OTP Auth | **SIM** — antes de habilitar `PROFESSIONAL_AUTH_ENABLED=true` |
| **Evolution API versão** | v2.3.7 (evidência histórica) | Não verificado | ❓ `UNKNOWN` | — | Operador deve verificar |
| **CONVERSATION_AI_ENABLED em produção** | `false` (padrão no código) | Evidência histórica: `true` | ⚠️ `DRIFT` provável | Moderado — IA ativa sem homologação formal | Verificar valor atual em produção |
| **Feature flags (prod)** | Conforme .env.example | Não verificável | ❓ `UNKNOWN` | Variável | Operador deve verificar |

---

## Seção L — Classificação de Blockers de Lançamento

### BLOCKERS (impedem lançamento formal se confirmados)

| # | Descrição | Classificação | Evidência |
| :---: | :--- | :---: | :--- |
| L.1 | **Deployed API/Web não rastreáveis ao SHA `b9e48582`** — sem acesso EasyPanel, não é possível confirmar se o código deployado é o mesmo de main | `NEEDS ACCESS` | EasyPanel inacessível localmente |
| L.2 | **Migrations de produção não verificadas** — sem acesso ao banco de produção, não confirmado se migration 027 está aplicada | `NEEDS ACCESS` | Banco produção inacessível localmente |
| L.3 | **n8n workflows instalados não comparados com versionados** — não é possível confirmar se os workflows em execução são os mesmos de main | `NEEDS ACCESS` | n8n remoto inacessível |

### REQUIRED BEFORE LAUNCH (bloqueia feature específica)

| # | Descrição | Feature Bloqueada |
| :---: | :--- | :--- |
| L.4 | **shared-delivery.json instalado não suporta `professional_auth_challenge`** — workflow instalado diverge do versionado | `PROFESSIONAL_AUTH_ENABLED=true` (OTP Auth) |
| L.5 | **`PROFESSIONAL_AUTH_PEPPER` não configurado localmente** — necessário para OTP funcionar | Autenticação OTP profissional |
| L.6 | **`OPENAI_API_KEY` ausente** — necessário se `CONVERSATION_AI_ENABLED=true` em produção | Inteligência Conversacional |

### NON-BLOCKING (não bloqueiam lançamento do produto core)

| # | Descrição |
| :---: | :--- |
| L.7 | Avaliações e reputação (Reviews & Ratings) — não implementadas, não são bloqueadoras |
| L.8 | Painel Administrativo para operadores — backlog futuro |
| L.9 | Localização v2 (localização nativa WhatsApp) — planejada no NOW mas não bloqueia o produto atual |
| L.10 | Testes E2E automáticos do portal web (Playwright) — pendente, não bloqueia |
| L.11 | Pagamentos e gateways de cobrança — formalmente congelados (ADR-003) |

---

## Seção M — Documentação e Governança Git

Veja commits e PR gerados por esta auditoria.

---

## Seção N — Relatório Final de 23 Itens

| # | Item | Verificado | Resultado |
| :---: | :--- | :---: | :--- |
| 1 | SHA de main | ✅ | `b9e48582d7b39ab6cb5d42c3fb977a091f11bf56` — exato |
| 2 | PR #18 status | ✅ | Squash-merged, CLOSED |
| 3 | PRs abertos | ✅ | **0** (zero) |
| 4 | CI em main HEAD | ✅ | `success` — Run #36478160592 |
| 5 | Migration mais alta (repositório) | ✅ | `027_add_connection_lifecycle_v2` |
| 6 | Migration 028 | ✅ | **NÃO existe** |
| 7 | Workflows n8n versionados (inventário) | ✅ | 5 arquivos: gateway, inbox-recovery, outbox-dispatcher, media-consumer, shared-delivery |
| 8 | shared-delivery suporta `professional_auth_challenge` (versionado) | ✅ | **SIM** — string encontrada no nó "Validate claim" |
| 9 | shared-delivery instalado suporta `professional_auth_challenge` | ⚠️ | **DRIFT CONHECIDO** — instalado não suporta |
| 10 | n8n versão instalada | ❓ | Evidência histórica: 1.123.21 — não reverificado |
| 11 | Evolution API versão instalada | ❓ | Evidência histórica: v2.3.7 — não reverificado |
| 12 | WhatsApp conexão ativa | ❓ | Não verificável localmente |
| 13 | EasyPanel — API serviço | ❓ | `NOT ACCESSIBLE` |
| 14 | EasyPanel — Web serviço | ❓ | `NOT ACCESSIBLE` |
| 15 | API deployada rastreável ao SHA de main | ❓ | `DEPLOYED VERSION NOT TRACEABLE` sem acesso EasyPanel |
| 16 | `CONVERSATION_AI_ENABLED` em produção | ⚠️ | Evidência do operador sugere `true`; não verificado |
| 17 | `PROFESSIONAL_AUTH_ENABLED` em produção | ❓ | Presumido `false`; não verificado |
| 18 | `MESSAGE_INTERPRETATION_FALLBACK_ENABLED` em produção | ❓ | Não verificável |
| 19 | PostgreSQL versão (local) | ✅ | `16.4` |
| 20 | PostGIS versão (local) | ✅ | `3.4.3` |
| 21 | Migration 027 aplicada (banco local) | ✅ | **SIM** — 27 migrations confirmadas |
| 22 | Filas de mensagens (banco local) | ✅ | Banco local vazio (desenvolvimento/testes) |
| 23 | Launch Readiness — fase ativa | ✅ | Iniciada — PR de auditoria aberto como DRAFT |

---

## Conclusão do Checkpoint A

**O repositório GitHub (`main @ b9e48582`) está íntegro, CI verde e sem PRs pendentes.**

Os principais blockers de lançamento são de **acesso operacional**, não de código:

1. O operador precisa **verificar diretamente no EasyPanel** se a API/Web deployada corresponde ao SHA de main.
2. O operador precisa **confirmar no banco de produção** que migration 027 está aplicada.
3. O operador precisa **reverificar os workflows n8n instalados** e, em especial, **reimportar o `shared-delivery.json` versionado** antes de habilitar `PROFESSIONAL_AUTH_ENABLED=true`.

O único drift técnico verificável nesta auditoria é o item 9: **o `shared-delivery.json` instalado não suporta `professional_auth_challenge`** — já documentado em `docs/CURRENT_STATE.md` Seção 7.

---

*Gerado em: 2026-09-28 | Branch: `audit/launch-readiness-current-reality` | SHA base: `b9e48582d7b39ab6cb5d42c3fb977a091f11bf56`*
