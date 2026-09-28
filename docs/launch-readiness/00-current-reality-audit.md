# Checkpoint A — Current Reality Audit & Evidence Reconciliation

**Data de Execução:** 2026-09-28
**Fase:** Launch Readiness / Homologação
**Auditor:** Agente de IA (Antigravity) — leitura estrita
**Branch de auditoria:** `audit/launch-readiness-current-reality`

> [!IMPORTANT]
> Este documento consolida a auditoria da realidade atual combinando verificação remota direta dos endpoints públicos, evidências documentais dos exports do n8n instalado fornecidos pelo operador e o conjunto efetivo de variáveis de ambiente do EasyPanel.
> Nenhuma modificação foi feita em código de produção, banco de dados, n8n, Evolution API, EasyPanel ou variáveis de ambiente de produção. Nenhum deploy ou reinício de serviço foi executado.

---

## Hierarquia Canônica de Evidências

Cada fato documentado nesta auditoria é explicitamente classificado por sua fonte de autoridade:

1. **✅ `VERIFIED REMOTELY NOW`:** Verificado empiricamente através de sondagem HTTP direta nos endpoints de produção (`minimenu-contatocerto-api`, `minimenu-contatocerto-web`, `n8n.koglim.com.br`, `evo.koglim.com.br`).
2. **📋 `OPERATOR-PROVIDED INSTALLED EXPORT EVIDENCE`:** Extraído dos arquivos exportados dos workflows instalados no n8n remoto fornecidos pelo operador.
3. **⚙️ `OPERATOR-PROVIDED CURRENT EASYPANEL ENV`:** Extraído da listagem de variáveis de ambiente configuradas no EasyPanel para o serviço `contatocerto-api`.
4. **🔒 `STILL REQUIRING AUTHENTICATED RUNTIME VERIFICATION`:** Requer sessão autenticada de operador no EasyPanel, psql de produção ou chave administrativa restrita.

---

## Seção A — Baseline do GitHub (`main`)

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
| PRs abertos no repositório | **1** (PR #19 — Draft desta auditoria) | ✅ `VERIFIED` |

### A.4 CI em main (HEAD b9e48582)

| Run | Status | Conclusão | Observação |
| :--- | :---: | :---: | :--- |
| Push CI — Run ID `36478160592` | completed | **success** | ✅ `VERIFIED` — execução pós-merge PR #18 |
| Workflow `verify` (check-run no HEAD) | completed | **success** | ✅ `VERIFIED` |

### A.5 Migração Mais Alta no Repositório

| Item | Valor | Status |
| :--- | :--- | :---: |
| Migração mais alta em `database/migrations/` | `027_add_connection_lifecycle_v2.js` | ✅ `VERIFIED` |
| Migração 028 existe? | **Não** | ✅ `VERIFIED` |
| Total de arquivos de migration | 27 (001 a 027) | ✅ `VERIFIED` |

---

## Seção B — Inventário da Arquitetura Versionada (`main`)

### B.1 Estrutura do Monorepo

| Componente | Caminho | Tecnologia |
| :--- | :--- | :--- |
| API Backend | `apps/api` | Fastify / TypeScript / Node.js |
| Web Portal | `apps/web` | Next.js 16.x / TypeScript |
| Shared Types | `packages/shared` | TypeScript |
| Workflows n8n | `workflows/n8n/` | 5 arquivos JSON exportados |
| Migrations | `database/migrations/` | node-pg-migrate (001–027) |

### B.2 Inventário dos Workflows n8n Versionados (GitHub `main`)

| Arquivo | Nome do Workflow | `active` no Repo | Nós | Responsabilidade |
| :--- | :--- | :---: | :---: | :--- |
| `gateway.json` | ContatoCerto - WhatsApp Gateway | `false` | 14 | Webhook JWT, roteamento texto/áudio, Inbox, claim por ID |
| `inbox-recovery.json` | ContatoCerto - Inbox Recovery | `false` | 4 | Recuperação de mensagens com lease expirado |
| `outbox-dispatcher.json` | ContatoCerto - Outbox Dispatcher | `false` | 5 | Claim da fila Outbox, orçamento, invoca shared-delivery |
| `media-consumer.json` | ContatoCerto - Durable Audio Consumer | `false` | 12 | Claim de mídia, transcrição Groq/OpenAI, persistência |
| `shared-delivery.json` | ContatoCerto - Shared Outbox Delivery | `false` | 11 | Entrega de negócio via Evolution, gate de propósito, sent/failed/hold |

---

## Seção C — n8n: Estado Instalado e Matriz de Drift

**Endpoint Verificado Remotamente:** `https://n8n.koglim.com.br/` (HTTP 200, versão `n8n 1.123.21` ✅ `VERIFIED REMOTELY NOW`).

### C.1 Estado Ativo dos Workflows Instalados (Evidência de Export do Operador)

| Workflow Instalado | `active` no Export | Observação |
| :--- | :---: | :--- |
| ContatoCerto - WhatsApp Gateway | `true` | Ativo recebendo mensagens de entrada |
| ContatoCerto - Outbox Dispatcher | `true` | Ativo processando fila de saída |
| ContatoCerto - Inbox Recovery | `true` | Ativo recuperando leases expirados |
| ContatoCerto - Durable Audio Consumer | `true` | Ativo transcrevendo mensagens de áudio |
| ContatoCerto - Shared Outbox Delivery | `false` | **Esperado:** invocado como subworkflow pelo Dispatcher/Gateway |

### C.2 Matriz de Drift Detalhada: Instalado vs GitHub `main`

| Componente | Instalado (Export Operador) | GitHub `main @ b9e48582` | Classificação do Drift | Impacto no Lançamento |
| :--- | :--- | :--- | :---: | :--- |
| **Shared Delivery: Propósitos Autorizados** | `customer_reply`, `professional_contact_notification`, `professional_reply`, `customer_contact_update`, `channel_notice` | Inclui adicionalmente **`professional_auth_challenge`** | ⚠️ **CONFIRMED DRIFT** | Bloqueia entrega de desafios OTP via WhatsApp se `PROFESSIONAL_AUTH_ENABLED=true` |
| **Estratégia de Configuração** | URLs e IDs de instâncias/workflows hardcoded diretamente nos nós | Parametrizado via `$vars` canônicas (`CONTATOCERTO_API_BASE_URL`, `EVOLUTION_API_BASE_URL`, etc.) | ⚠️ **CONFIGURATION DRIFT** | Débito de configuração; não impede execução enquanto URLs hardcoded apontarem para os hosts corretos |
| **WhatsApp Gateway: Acknowledge Inbox** | Nó `Acknowledge Inbox` com **`disabled: true`** | Nó `Acknowledge Inbox` **ativo** (sem `disabled`) | ⚠️ **FUNCTIONAL DRIFT** | Exige reconciliação antes da homologação final de ponta a ponta |

---

## Seção D — Evolution API Instalada (Auditoria Remota)

**Endpoint Verificado Remotamente:** `https://evo.koglim.com.br/` (HTTP 200 ✅ `VERIFIED REMOTELY NOW`).

| Item | Valor Verificado | Fonte |
| :--- | :--- | :---: |
| Versão Instalada | **`2.3.7`** | ✅ `VERIFIED REMOTELY NOW` (payload raiz) |
| Client Name | `evolution_exchange` | ✅ `VERIFIED REMOTELY NOW` |
| Versão WhatsApp Web | `2.3000.1048663002` | ✅ `VERIFIED REMOTELY NOW` |
| Manager URL | `http://evo.koglim.com.br/manager` | ✅ `VERIFIED REMOTELY NOW` |
| Endpoint `/instance/fetchInstances` | HTTP 401 Unauthorized (guard de API Key ativo) | ✅ `VERIFIED REMOTELY NOW` |
| Sessão WhatsApp Ativa (QR / Conexão) | Requer chave de API da Evolution para consulta | 🔒 `STILL REQUIRING AUTHENTICATED VERIFICATION` |

---

## Seção E — EasyPanel / Estado da Aplicação Instalada

**Endpoints Verificados Remotamente:**
* EasyPanel Painel: `https://easy.koglim.com.br/projects/minimenu/app/contatocerto-web` (Projeto `minimenu`)
* API: `https://minimenu-contatocerto-api.gdxvyl.easypanel.host/`
* Web: `https://minimenu-contatocerto-web.gdxvyl.easypanel.host/`

### E.1 Serviços do Projeto `minimenu`

| Serviço | Endpoint | Estado HTTP | Banco Conectado? | Fonte |
| :--- | :--- | :---: | :---: | :---: |
| `contatocerto-api` | `https://minimenu-contatocerto-api.gdxvyl.easypanel.host/` | HTTP 200 em `/health` e `/health/db` | ✅ **SIM** (`{"database":"connected"}`) | ✅ `VERIFIED REMOTELY NOW` |
| `contatocerto-web` | `https://minimenu-contatocerto-web.gdxvyl.easypanel.host/` | HTTP 200 em `/`, HTTP 307 em `/dashboard` | N/A (BFF) | ✅ `VERIFIED REMOTELY NOW` |
| EasyPanel SPA | `https://easy.koglim.com.br/` | HTTP 200 (Login SPA) | 🔒 Requer sessão | ✅ `VERIFIED REMOTELY NOW` |

### E.2 Rastreabilidade de Versão Deployada

| Item | Situação | Classificação |
| :--- | :--- | :---: |
| API SHA rastreável | API responde `/health` e `/health/db`, mas não expõe SHA em headers públicos | ❓ `NOT TRACEABLE` sem acesso EasyPanel |
| Web SHA rastreável | Web responde com Next.js Build ID `j4BJIPFFooQA5Oij0z0-V` | ❓ `NOT TRACEABLE` sem acesso EasyPanel |

---

## Seção F — Variáveis de Ambiente do EasyPanel e Feature Flags

**Fonte de Evidência:** ⚙️ `OPERATOR-PROVIDED CURRENT EASYPANEL ENV`

### F.1 Variáveis Não-Secretas do `contatocerto-api` em Produção

```env
SERVICE_RESOLUTION_FUZZY_THRESHOLD=0.53
SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP=0.10
OPENROUTESERVICE_BASE_URL=https://api.heigit.org/pelias/v1
LOCATION_RESOLUTION_CONFIDENCE_THRESHOLD=0.85
LOCATION_RESOLUTION_AMBIGUITY_GAP=0.10
MESSAGE_INTERPRETATION_FALLBACK_ENABLED=true
MESSAGE_INTERPRETATION_FALLBACK_MODEL=gpt-5-mini
MESSAGE_INTERPRETATION_FALLBACK_TIMEOUT_MS=5000
OPENAI_CONVERSATION_MODEL=gpt-5.6-terra
SEARCH_CONVERSATION_TTL_MINUTES=30
SEARCH_CONVERSATION_PROCESSING_LEASE_SECONDS=60
CHANNEL_INBOUND_PROCESSING_LEASE_SECONDS=60
CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS=60
OPENAI_CONVERSATION_TIMEOUT_MS=20000
CONTEXTUAL_CONVERSATION_ENABLED=false
CONVERSATION_AI_ENABLED=true
```

### F.2 Matriz Corrigida de Feature Flags em Produção

| Feature Flag | Padrão no Código | Valor no EasyPanel (Operador) | Estado Efetivo | Regra de Precedência / Observação |
| :--- | :---: | :---: | :---: | :--- |
| **`CONVERSATION_AI_ENABLED`** | `false` | **`true`** | **`ENABLED`** | Precedência absoluta sobre `CONTEXTUAL_CONVERSATION_ENABLED`. Modelo ativo: `gpt-5.6-terra`. |
| **`CONTEXTUAL_CONVERSATION_ENABLED`** | `false` | `false` | `false` | Alias legado sobreposto por `CONVERSATION_AI_ENABLED`. |
| **`MESSAGE_INTERPRETATION_FALLBACK_ENABLED`** | `false` | **`true`** | **`ENABLED`** | Fallback para extração de localização ativo com modelo `gpt-5-mini` (timeout 5s). |
| **`PROFESSIONAL_AUTH_ENABLED`** | `false` | *(não definido / ausente)* | **`DISABLED` (`false`)** | Confirmado por `GET /internal/professional-auth/session` retornando 404 (rotas não registradas) e Web com `passwordless: false`. |

### F.3 Matriz de Presença de Segredos (Apenas `PRESENT` / `MISSING`)

| Segredo / Credencial | Presença em Produção | Observação de Governança |
| :--- | :---: | :--- |
| `DATABASE_URL` | **PRESENT** | ✅ Confirmado por `/health/db` conectado |
| `INTERNAL_API_KEY` | **PRESENT** | ✅ Confirmado por `/internal/channel/inbound/queue-status` retornando 401 |
| `DASHBOARD_SESSION_SECRET` | **PRESENT** | ✅ Confirmado por Next.js BFF ativo |
| `OPENAI_API_KEY` | **PRESENT** | Necessário para `CONVERSATION_AI_ENABLED=true` e fallback |
| `OPENROUTESERVICE_API_KEY` | **PRESENT** | Utilizado pelo geocodificador Pelias |
| `GROK_API_KEY` *(nome no ENV do EasyPanel)* | **PRESENT** | *(Ver nota de áudio abaixo)* |
| `PROFESSIONAL_AUTH_PEPPER` | **NÃO APLICÁVEL** | Feature desativada (`PROFESSIONAL_AUTH_ENABLED=false`) |

### F.4 Nota Arquitetural sobre Groq e Áudio

O ambiente do EasyPanel contém uma variável nomeada como `GROK_API_KEY`.
**Análise de impacto:** O workflow de transcrição de áudio instalado (`Durable Audio Consumer`) executa no n8n e consome diretamente as credentials do n8n:
- Credential Groq: `ContatoCerto Groq`
- Credential OpenAI (fallback): `ContatoCerto OpenAI`

Portanto, a grafia da variável no EasyPanel **não é um bloqueador** do pipeline de áudio, uma vez que a autenticação de transcrição é gerenciada internamente pelo n8n.

---

## Seção G — Banco de Dados de Produção

| Item | Verificação | Status |
| :--- | :--- | :---: |
| Conectividade PostgreSQL | `GET /health/db` na API remota retorna `{"status":"ok","database":"connected"}` | ✅ `VERIFIED REMOTELY NOW` |
| Versão PostgreSQL / PostGIS em Prod | Conexão restrita à rede Docker | 🔒 `STILL REQUIRING AUTHENTICATED VERIFICATION` |
| Migration 027 em Produção | Requer consulta à tabela `pgmigrations` via psql/console | 🔒 `STILL REQUIRING AUTHENTICATED VERIFICATION` |
| Migration 028 | Inexistente em todo o repositório e histórico de migrações | ✅ `VERIFIED` (não existe) |

---

## Seção H — Portal Web do Profissional

**Base URL:** `https://minimenu-contatocerto-web.gdxvyl.easypanel.host/`

| Rota / Capacidade | Verificação Real | Status |
| :--- | :--- | :---: |
| Home (`/`) | HTTP 200 — Next.js HTML renderizado | ✅ `VERIFIED REMOTELY NOW` |
| `/dashboard` | HTTP 307 → redireciona para `/dashboard/access` | ✅ `VERIFIED REMOTELY NOW` |
| `/dashboard/access` | HTTP 200 — página de acesso profissional renderizada | ✅ `VERIFIED REMOTELY NOW` |
| Formulário de Acesso | Renderiza campo de senha temporária (`<input type="password" name="password"/>`) | ✅ `VERIFIED REMOTELY NOW` |
| Modo Passwordless (OTP) | `passwordless: false` no payload SSR do Next.js | ✅ `VERIFIED REMOTELY NOW` |
| Disparo de OTP | **NÃO executado** (preservado conforme diretriz estrita de homologação) | ✅ PRESERVADO |

---

## Seção I — Matriz de Decisão e Prontidão de Lançamento

### 1. Prontidão E2E: Fluxo de Atendimento do Cliente (WhatsApp)

> O fluxo de busca, matching e conexão bilateral de clientes no WhatsApp opera de forma **100% independente** da autenticação OTP do profissional.

| Componente | Estado | Impacto no E2E do Cliente |
| :--- | :---: | :--- |
| API Backend (`contatocerto-api`) | ✅ Running / DB Conectado | **Pronto** |
| Evolution API (`evo.koglim.com.br`) | ✅ Running v2.3.7 | **Pronto** (confirmar pareamento WhatsApp) |
| n8n (`n8n.koglim.com.br`) | ✅ Running v1.123.21 / Workflows ativos | **Pronto** (confirmar webhook ativo) |
| Banco de Dados | ✅ Conectado | **Pronto** |
| Conversação IA | ✅ `CONVERSATION_AI_ENABLED=true` com `gpt-5.6-terra` | **Pronto** sob motor B2 |
| **Bloqueio para E2E do Cliente:** | **NENHUM BLOQUEIO DE CÓDIGO** | Prerequisito operacional: verificar WhatsApp conectado |

### 2. Prontidão: Portal Web do Profissional & Autenticação OTP

| Componente | Estado | Impacto |
| :--- | :---: | :--- |
| Web Portal (`contatocerto-web`) | ✅ Running / `/dashboard/access` ativo | Acesso via senha temporária ativo |
| `PROFESSIONAL_AUTH_ENABLED` | `false` (em API e Web) | OTP desativado por design nesta fase |
| n8n `shared-delivery.json` | ⚠️ Requer reimportação para suportar `professional_auth_challenge` | Bloqueia ativação futura de OTP |

---

## Seção J — Classificação Consolidada de Pendências

| Classificação | Item | Ação Necessária |
| :--- | :--- | :--- |
| `BLOCKER TO E2E` | Nenhum defeito de código identificado | Confirmação operacional de pareamento WhatsApp na Evolution API |
| `REQUIRED BEFORE LAUNCH` | n8n `shared-delivery.json` sem suporte a OTP | Reimportar workflow versionado antes de virar flag `PROFESSIONAL_AUTH_ENABLED=true` |
| `REQUIRED BEFORE LAUNCH` | n8n `gateway.json` com `Acknowledge Inbox` desativado | Reconciliar export com GitHub main antes do tráfego real de lançamento |
| `REQUIRED BEFORE LAUNCH` | Confirmação de SHA no EasyPanel | Operador checar tag/commit no EasyPanel para certificar `b9e48582` |
| `REQUIRED BEFORE LAUNCH` | Confirmação de Migration 027 em prod DB | Operador checar tabela `pgmigrations` no banco de produção |
| `NON-BLOCKING` | Reviews & Ratings, Location v2, Admin UI | Escopos futuros do roadmap |
| `STILL REQUIRING AUTHENTICATED ACCESS` | Queue counters ao vivo, logs internos, pareamento WhatsApp | Consultar com chaves de operador |

---

## Conclusão do Checkpoint A / A.2 / Reconciliação

1. **Repositório GitHub (`main @ b9e48582`):** Íntegro, CI verde, PR #18 mergeado com sucesso.
2. **Ambiente Remoto:** Todos os 4 serviços externos (`contatocerto-api`, `contatocerto-web`, `n8n`, `evo`) estão **online e respondendo HTTP 200**.
3. **Versões Confirmadas:** Evolution API é exatamente `v2.3.7`; n8n é exatamente `v1.123.21`.
4. **Drift de n8n Documentado:** `Shared Outbox Delivery` lacks `professional_auth_challenge` e `Gateway` possui `Acknowledge Inbox` desabilitado nos exports instalados.
5. **Configuração de IA:** `CONVERSATION_AI_ENABLED=true` em produção com modelo `gpt-5.6-terra`.
6. **Autenticação Profissional:** `PROFESSIONAL_AUTH_ENABLED=false` confirmado em API e Web, operando sob senha temporária.

---

*Gerado em: 2026-09-28 | Branch: `audit/launch-readiness-current-reality` | PR: #19*
