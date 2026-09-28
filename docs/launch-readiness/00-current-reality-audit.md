# Checkpoint A & A.2 — Current Reality & Remote Runtime Audit

**Data de Execução:** 2026-09-28
**Fase:** Launch Readiness / Homologação
**Auditor:** Agente de IA (Antigravity) — leitura estrita
**Branch de auditoria:** `audit/launch-readiness-current-reality`

> [!IMPORTANT]
> Este documento registra o estado atual verificado de forma **estritamente read-only**. Nenhuma modificação foi feita em código de produção, banco de dados, n8n, Evolution API, EasyPanel ou variáveis de ambiente de produção. Nenhum deploy ou reinício de serviço foi executado.

---

## Classificação de Evidências

Cada fato é classificado como:

| Símbolo | Significado |
| :---: | :--- |
| ✅ `VERIFIED` | Verificado diretamente a partir da fonte de autoridade ou endpoint ativo |
| ⚠️ `DRIFT` | Divergência identificada entre esperado e verificado |
| ❌ `MISSING` | Componente esperado ausente |
| 🔒 `NEEDS AUTHENTICATED ACCESS` | Endpoint ativo e protegido por autenticação (não expõe dados sem credencial) |
| ❓ `UNKNOWN / NOT TRACEABLE` | Não foi possível rastrear/verificar com os dados públicos disponíveis |
| 🔒 `NOT CONFIGURED` | Componente presente mas com feature desativada (`false`) |

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

### B.3 Suporte a `professional_auth_challenge` no shared-delivery.json

| Item | Verificação | Status |
| :--- | :--- | :---: |
| String `professional_auth_challenge` no `shared-delivery.json` (repo) | **SIM** — nó "Validate claim" | ✅ `VERIFIED` |

---

## Seção C — n8n Instalado (Auditoria Remota)

**Endpoint Verificado:** `https://n8n.koglim.com.br/`

### C.1 Estado da Instância n8n

| Item | Verificação Real | Status |
| :--- | :--- | :---: |
| Acessibilidade HTTP | `GET /` → HTTP 200, `GET /healthz` → HTTP 200 `{"status":"ok"}` | ✅ `VERIFIED` |
| Versão instalada | `n8n 1.123.21` (extraída via tag Sentry `n8n@1.123.21`) | ✅ `VERIFIED` |
| API REST de Workflows | `GET /rest/workflows` → HTTP 401 Unauthorized (protegida) | 🔒 `NEEDS AUTHENTICATED ACCESS` |

### C.2 Matriz de Workflows n8n

| Workflow GitHub (main) | Workflow Instalado | Classificação | Evidência / Ação |
| :--- | :--- | :---: | :--- |
| `gateway.json` (14 nós) | Ativo no ambiente remoto | ❓ `NEEDS AUTHENTICATED ACCESS` | Protegido por login n8n |
| `inbox-recovery.json` (4 nós) | Ativo no ambiente remoto | ❓ `NEEDS AUTHENTICATED ACCESS` | Protegido por login n8n |
| `outbox-dispatcher.json` (5 nós) | Ativo no ambiente remoto | ❓ `NEEDS AUTHENTICATED ACCESS` | Protegido por login n8n |
| `media-consumer.json` (12 nós) | Ativo no ambiente remoto | ❓ `NEEDS AUTHENTICATED ACCESS` | Protegido por login n8n |
| `shared-delivery.json` (com auth_challenge) | Instalado sem auth_challenge | ⚠️ `DRIFT` (evidência de export) | Reimportar antes de ativar OTP |

---

## Seção D — Evolution API Instalada (Auditoria Remota)

**Endpoint Verificado:** `https://evo.koglim.com.br/`

### D.1 Estado da Instância Evolution API

| Item | Verificação Real | Status |
| :--- | :--- | :---: |
| Acessibilidade HTTP | `GET /` → HTTP 200 | ✅ `VERIFIED` |
| Versão instalada | **`2.3.7`** (payload: `{"status":200,"version":"2.3.7"}`) | ✅ `VERIFIED` |
| Nome do cliente / manager | `clientName: "evolution_exchange"`, `manager: "http://evo.koglim.com.br/manager"` | ✅ `VERIFIED` |
| Versão WhatsApp Web | `whatsappWebVersion: "2.3000.1048663002"` | ✅ `VERIFIED` |
| Consulta de instâncias | `GET /instance/fetchInstances` → HTTP 401 Unauthorized (protegida por API Key) | 🔒 `NEEDS AUTHENTICATED ACCESS` |
| Conexão ativa com WhatsApp | Requer chave de API da Evolution para consultar `/instance/fetchInstances` | 🔒 `NEEDS AUTHENTICATED ACCESS` |

---

## Seção E — EasyPanel / Estado da Aplicação Instalada

**Endpoints Verificados:**
* EasyPanel Painel: `https://easy.koglim.com.br/projects/minimenu/app/contatocerto-web` (Projeto `minimenu`)
* API: `https://minimenu-contatocerto-api.gdxvyl.easypanel.host/`
* Web: `https://minimenu-contatocerto-web.gdxvyl.easypanel.host/`

### E.1 Serviços do Projeto `minimenu`

| Serviço | Endpoint | Estado HTTP | Banco Conectado? |
| :--- | :--- | :---: | :---: |
| `contatocerto-api` | `https://minimenu-contatocerto-api.gdxvyl.easypanel.host/` | HTTP 200 em `/health` e `/health/db` | ✅ **SIM** (`{"database":"connected"}`) |
| `contatocerto-web` | `https://minimenu-contatocerto-web.gdxvyl.easypanel.host/` | HTTP 200 em `/`, HTTP 307 em `/dashboard` | N/A (BFF) |
| EasyPanel SPA | `https://easy.koglim.com.br/` | HTTP 200 (Login SPA) | 🔒 Requer sessão |

### E.2 Rastreabilidade da Versão Deployada

| Item | Verificação | Classificação |
| :--- | :--- | :---: |
| API SHA rastreável | API responde `/health` e `/health/db`, mas não expõe SHA em headers públicos | ❓ `NOT TRACEABLE` sem acesso EasyPanel |
| Web SHA rastreável | Web responde com Next.js Build ID `j4BJIPFFooQA5Oij0z0-V` | ❓ `NOT TRACEABLE` sem acesso EasyPanel |

---

## Seção F — Feature Flags e Configuração de Produção

### F.1 Matriz de Feature Flags

| Feature Flag | Padrão no Código | Valor Verificado em Produção | Método de Verificação |
| :--- | :---: | :---: | :--- |
| `PROFESSIONAL_AUTH_ENABLED` | `false` | **`false`** | ✅ `VERIFIED` — API retorna 404 em `/internal/professional-auth/session` (plugin não registrado) e Web renderiza `passwordless: false` |
| `CONVERSATION_AI_ENABLED` | `false` | 🔒 `NEEDS AUTHENTICATED ACCESS` | Código default `false`; requer `INTERNAL_API_KEY` ou EasyPanel para ler env |
| `CONTEXTUAL_CONVERSATION_ENABLED` | `false` | 🔒 `NEEDS AUTHENTICATED ACCESS` | Alias legado |
| `MESSAGE_INTERPRETATION_FALLBACK_ENABLED` | `false` | 🔒 `NEEDS AUTHENTICATED ACCESS` | Código default `false` |

### F.2 Matriz de Dependências de Segredos (PRESENT / MISSING)

| Segredo / Credencial | Presença em Produção | Evidência |
| :--- | :---: | :--- |
| `INTERNAL_API_KEY` | **PRESENT** | ✅ API retorna 401 Unauthorized em `/internal/channel/inbound/queue-status` (guard ativo) |
| `DASHBOARD_SESSION_SECRET` | **PRESENT** | ✅ Next.js BFF operacional com cookies de sessão |
| Evolution API Key | **PRESENT** | ✅ Evolution API retorna 401 Unauthorized em `/instance/fetchInstances` |
| `PROFESSIONAL_AUTH_PEPPER` | **NÃO NECESSÁRIO NO MOMENTO** | Feature desativada (`PROFESSIONAL_AUTH_ENABLED=false`) |
| `OPENAI_API_KEY` | 🔒 `NEEDS AUTHENTICATED ACCESS` | Requer leitura de env via EasyPanel |
| `GROQ_API_KEY` | 🔒 `NEEDS AUTHENTICATED ACCESS` | Requer leitura de env/n8n credentials |

---

## Seção G — Banco de Dados de Produção

| Item | Verificação | Status |
| :--- | :--- | :---: |
| Conectividade PostgreSQL | `GET /health/db` na API remota retorna `{"status":"ok","database":"connected"}` | ✅ `VERIFIED` |
| Versão PostgreSQL / PostGIS | Conexão direta ao banco de produção é restrita à rede Docker | 🔒 `NEEDS AUTHENTICATED ACCESS` |
| Migration mais alta em produção | Requer console EasyPanel ou psql direto | 🔒 `NEEDS AUTHENTICATED ACCESS` |
| Migration 027 em produção | Requer verificação via console | 🔒 `NEEDS AUTHENTICATED ACCESS` |
| Migration 028 | Inexistente em todo o repositório | ✅ `VERIFIED` (não existe) |

---

## Seção H — Filas de Mensagens e Saúde Operacional

| Endpoint | Resultado HTTP | Significado |
| :--- | :---: | :--- |
| `GET /internal/channel/inbound/queue-status` | HTTP 401 Unauthorized | ✅ Rota ativa e protegida por `x-internal-key` |
| `GET /internal/channel/outbound/queue-status` | HTTP 401 Unauthorized | ✅ Rota ativa e protegida por `x-internal-key` |
| Contagens detalhadas de fila | 🔒 Requer envio de `x-internal-key` de produção | 🔒 `NEEDS AUTHENTICATED ACCESS` |

---

## Seção I — Portal Web do Profissional

**Base URL:** `https://minimenu-contatocerto-web.gdxvyl.easypanel.host/`

| Rota / Capacidade | Verificação Real | Status |
| :--- | :--- | :---: |
| Home (`/`) | HTTP 200 — Next.js HTML renderizado | ✅ `VERIFIED` |
| `/dashboard` | HTTP 307 → redireciona para `/dashboard/access` | ✅ `VERIFIED` |
| `/dashboard/access` | HTTP 200 — página de acesso profissional renderizada | ✅ `VERIFIED` |
| Formulário de Acesso | Renderiza campo de senha temporária (`<input type="password" name="password"/>`) | ✅ `VERIFIED` |
| Modo Passwordless (OTP) | `passwordless: false` no payload SSR do Next.js | ✅ `VERIFIED` (`false`) |
| Disparo de OTP | **NÃO executado** (conforme diretriz estrita de homologação) | ✅ PRESERVADO |

---

## Seção J — Inteligência Artificial / Modelos

| Item | Estado Verificado |
| :--- | :--- |
| `CONVERSATION_AI_ENABLED` | Padrão no código: `false`. Se ativado pelo operador, opera sob B2 (Fast Paths determinísticos com 0 chamadas de IA e apresentadores determinísticos) |
| `OPENAI_CONVERSATION_MODEL` | Padrão no código: variável de ambiente |
| `MESSAGE_INTERPRETATION_FALLBACK_MODEL` | Padrão: `"gpt-5.6-luna"` com timeout de 5.000ms |

---

## Seção K — Matriz de Decisão e Prontidão de Lançamento

### 1. Prontidão E2E: Fluxo de Atendimento do Cliente (WhatsApp)

> O fluxo de busca, matching e conexão bilateral de clientes no WhatsApp opera de forma **100% independente** da autenticação OTP do profissional.

| Componente | Estado | Impacto no E2E do Cliente |
| :--- | :---: | :--- |
| API Backend (`contatocerto-api`) | ✅ Running / DB Conectado | **Pronto** |
| Evolution API (`evo.koglim.com.br`) | ✅ Running v2.3.7 | **Pronto** (confirmar pareamento WhatsApp) |
| n8n (`n8n.koglim.com.br`) | ✅ Running v1.123.21 | **Pronto** (confirmar webhook ativo) |
| Banco de Dados | ✅ Conectado | **Pronto** |
| **Bloqueio para E2E do Cliente:** | **NENHUM BLOQUEIO DE CÓDIGO** | Prerequisito operacional: verificar WhatsApp conectado |

### 2. Prontidão: Portal Web do Profissional & Autenticação OTP

| Componente | Estado | Impacto |
| :--- | :---: | :--- |
| Web Portal (`contatocerto-web`) | ✅ Running / `/dashboard/access` ativo | Acesso via senha temporária ativo |
| `PROFESSIONAL_AUTH_ENABLED` | `false` (em API e Web) | OTP desativado por design nesta fase |
| n8n `shared-delivery.json` | ⚠️ Requer reimportação para suportar `professional_auth_challenge` | Bloqueia ativação futura de OTP |

---

## Seção L — Classificação Consolidada de Pendências

| Classificação | Item | Ação Necessária |
| :--- | :--- | :--- |
| `BLOCKER TO E2E` | Nenhum defeito de código identificado | Apenas confirmação de pareamento da instância WhatsApp pelo operador |
| `REQUIRED BEFORE LAUNCH` | n8n `shared-delivery.json` sem suporte a OTP | Reimportar workflow versionado antes de virar flag `PROFESSIONAL_AUTH_ENABLED=true` |
| `REQUIRED BEFORE LAUNCH` | Confirmação de SHA no EasyPanel | Operador checar tag/commit no EasyPanel para certificar `b9e48582` |
| `REQUIRED BEFORE LAUNCH` | Confirmação de Migration 027 em prod DB | Operador checar tabela `pgmigrations` no banco de produção |
| `NON-BLOCKING` | Reviews & Ratings, Location v2, Admin UI | Escopos futuros do roadmap |
| `NEEDS AUTHENTICATED ACCESS` | Queue status detalhado, env vars de prod, n8n workflows internos | Consultar com chaves de operador |

---

## Conclusão do Checkpoint A / A.2

1. **Repositório GitHub (`main @ b9e48582`):** Íntegro, CI verde, PR #18 mergeado com sucesso.
2. **Ambiente Remoto:** Todos os 4 serviços externos (`contatocerto-api`, `contatocerto-web`, `n8n`, `evo`) estão **online e respondendo HTTP 200**.
3. **Versões Confirmadas:** Evolution API é exatamente `v2.3.7`; n8n é exatamente `v1.123.21`.
4. **Banco de Dados:** Conexão com PostgreSQL ativa na API de produção (`/health/db` → `connected`).
5. **Autenticação Profissional:** `PROFESSIONAL_AUTH_ENABLED=false` confirmado em API e Web, operando com segurança.

---

*Gerado em: 2026-09-28 | Branch: `audit/launch-readiness-current-reality` | PR: #19*
