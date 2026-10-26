# Documentação do ContatoCerto

Bem-vindo à documentação oficial do **ContatoCerto**. Este repositório adota uma política estrita de governança e hierarquia documental para garantir consistência entre o código em produção, as decisões de produto e os registros históricos.

---

## 🏛️ Política da Fonte Única da Verdade (Source of Truth)

A documentação do ContatoCerto segue a seguinte hierarquia canônica de autoridade:

1. **Implementação no GitHub `main`:** É a autoridade máxima e definitiva sobre o comportamento versionado do sistema. Código, testes automatizados e migrations em `main` prevalecem sobre qualquer prosa.
2. **Documentação Canônica de Produto (`docs/` raiz):** Define a visão de produto, regras de negócio vigentes, jornadas de usuário e estado atual consolidado.
3. **Documentação Técnica Especializada:** Detalha o funcionamento interno de subsistemas específicos (dados, APIs, segurança, mensageria).
4. **Registros de Decisão de Arquitetura (`docs/decisions/`):** Explica o *porquê* das decisões arquiteturais e de produto adotadas (ADRs).
5. **Documentos Históricos e Evidências de Execução:** Relatórios de entrega, planos de homologação e auditorias passadas preservam evidências históricas com banners de status, mas **não** sobrepõem a documentação canônica nem o código em `main`.
6. **Infraestrutura Instalada vs. Versionada:** Divergências entre ambientes remotos (ex.: n8n instalado) e arquivos versionados no repositório são tratadas como débitos de reconciliação documentados, e não como fonte de verdade.

> [!IMPORTANT]
> **Nunca utilize ferramentas externas ou instâncias remotas (ex.: n8n instalado) como fonte de verdade da documentação.** A documentação versionada no GitHub é a única autoridade aceita.

---

## 🗺️ Mapa de Navegação

### 1. Ponto de Partida Obrigatório (Canônico)

Qualquer desenvolvedor ou agente de IA deve iniciar a leitura por estes seis documentos fundamentais:

| Documento | Finalidade |
| :--- | :--- |
| [**PROJECT.md**](PROJECT.md) | **Definição canônica do produto**: proposta de valor, visão conversacional, modelo de negócio e princípios essenciais. |
| [**CURRENT_STATE.md**](CURRENT_STATE.md) | **Estado real do sistema no commit atual**: o que está implementado, o que está sob feature-flag, o que está congelado e divergências conhecidas. |
| [**PRODUCT_JOURNEYS.md**](PRODUCT_JOURNEYS.md) | **Jornadas de ponta a ponta**: cliente, profissional e operador, com distinção clara entre *comportamento atual* e *direção futura*. |
| [**PRODUCT_RULES.md**](PRODUCT_RULES.md) | **Regras de negócio canônicas**: autoridade da IA vs. determinismo, classificação da verdade da informação, neutralidade de recomendação e assinaturas. |
| [**ROADMAP.md**](ROADMAP.md) | **Roadmap estruturado do projeto**: seções estritas `# DONE`, `# NOW`, `# NEXT`, `# GROWTH`, `# FROZEN` e `# PARKING LOT`. |
| [**TECHNICAL_OVERVIEW.md**](TECHNICAL_OVERVIEW.md) | **Visão técnica concisa**: arquitetura de contêineres (Mermaid), fronteiras de responsabilidade, arquitetura de contexto de IA, localização e funil de métricas. |

---

### 2. Registros de Decisão de Arquitetura (ADRs)

Decisões de engenharia e produto que moldam os invariantes do sistema estão registradas em [docs/decisions/](decisions/README.md):

* [**ADR-001**](decisions/ADR-001-github-documentation-source-of-truth.md): Governança documental e GitHub `main` como Fonte Única da Verdade.
* [**ADR-002**](decisions/ADR-002-ai-interpretation-vs-deterministic-domain-authority.md): Fronteiras estritas entre interpretação por IA e autoridade de domínio determinística.
* [**ADR-003**](decisions/ADR-003-billing-provider-decision-frozen.md): Congelamento formal de provedores e fluxos de checkout/cobrança.
* [**ADR-004**](decisions/ADR-004-connection-lifecycle-v2-direction.md): Direção de produto para o Ciclo de Conexão v2 (*Aceito / Implementado no PR #17*).
* [**ADR-005**](decisions/ADR-005-soft-expiry-resumable-presentation.md): Soft Expiry e apresentação retomável de lista de profissionais (*Implementado no PR #30*).
* [**ADR-006**](decisions/ADR-006-interactive-actions-button-first.md): Ações interativas e experiência button-first no WhatsApp (*Implementado e homologado no Gate B*).
* [**ADR-007**](decisions/ADR-007-location-v2-native-pins-and-confirmed-memory.md): Pinos nativos de WhatsApp e memória confirmada de localização (*Implementado e homologado no PR #45 / PR #47*).
* [**ADR-008**](decisions/ADR-008-direct-meta-and-bullmq-transactional-migration.md): Migração do caminho crítico transacional para Meta WhatsApp Cloud API direta e fila BullMQ/Redis (*Aceito / Target congelado no WP-DM0*).

---

### 3. Documentação Técnica Especializada de Subsistemas

Para aprofundamento na implementação de subsistemas específicos do ContatoCerto:

* **Arquitetura e Dados:**
  * [ARCHITECTURE.md](ARCHITECTURE.md): Arquitetura modular, camadas e ciclo de requisição.
  * [DATA_MODEL.md](DATA_MODEL.md): Modelo relacional PostgreSQL/PostGIS, constraints, migrations e tabelas.
  * [API.md](API.md): Contratos de endpoints HTTP públicos, internos e de canal.
  * [brazil-municipality-index.md](brazil-municipality-index.md): Resolução determinística e índice em memória de municípios brasileiros (IBGE).
* **Mensageria, Durabilidade e Operação:**
  * [OPERATIONS.md](OPERATIONS.md): Runbook operacional, sanitização de PII, monitoramento de filas e leases.
  * [OUTBOUND_DELIVERY.md](OUTBOUND_DELIVERY.md): Despacho de mensagens via Outbox durável e reconciliação.
  * [INBOX_RECOVERY.md](INBOX_RECOVERY.md): Recepção de mensagens da Inbox, idempotência, quarentena e recuperação.
  * [TRANSPORT_DURABILITY.md](TRANSPORT_DURABILITY.md): Integração com Evolution API, idempotência de canal e tolerância a falhas.
  * [workflows/n8n/README.md](../workflows/n8n/README.md): Especificação dos nós, orquestração e fluxos versionados do n8n.
* **Profissional, Identidade e Negócio:**
  * [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md): Fundação canônica v1 do Design System (tokens, dark mode, tipografia, layout primitives, shell).
  * [WEB_DASHBOARD.md](WEB_DASHBOARD.md): Portal web do profissional em Next.js (BFF, sessões e autosserviço).
  * [PROFESSIONAL_IDENTITY_FOUNDATION.md](PROFESSIONAL_IDENTITY_FOUNDATION.md): Fundação de identidade individual do profissional.
  * [PROFESSIONAL_PASSWORDLESS_AUTH.md](PROFESSIONAL_PASSWORDLESS_AUTH.md): Autenticação sem senha via OTP de 6 dígitos no WhatsApp.
  * [PROFESSIONAL_ONBOARDING_ELIGIBILITY.md](PROFESSIONAL_ONBOARDING_ELIGIBILITY.md): Máquina de estados de elegibilidade e cobertura de serviços.
  * [PROFESSIONAL_SIGNUP_LEGACY_CLAIM.md](PROFESSIONAL_SIGNUP_LEGACY_CLAIM.md): Fluxo de autocadastro e reivindicação de perfis legados.
  * [PROFESSIONAL_SUBSCRIPTIONS_ENTITLEMENTS.md](PROFESSIONAL_SUBSCRIPTIONS_ENTITLEMENTS.md): Modelo agnóstico de planos, assinaturas e acesso a novos leads.
  * [CONTACT_COMPLETION_CONFIRMATION.md](CONTACT_COMPLETION_CONFIRMATION.md): Ciclo de conclusão e confirmação bilateral de atendimentos.
* **Conversação Contextual:**
  * [B2_CONTEXTUAL_CONVERSATION.md](B2_CONTEXTUAL_CONVERSATION.md): Motor conversacional híbrido, memória contextual e hipóteses.

---

### 4. Documentos Históricos e de Evidência

Documentos que registram a trajetória de marcos de desenvolvimento anteriores. Devem ser lidos como **evidências da época de sua elaboração**, e não como a definição vigente do produto:

* [V1_EXECUTION.md](V1_EXECUTION.md): Relatório consolidado da execução técnica do MVP V1 até o PR #15.
* [V1_ACCEPTANCE.md](V1_ACCEPTANCE.md): Matriz de critérios de aceitação formal da V1 original.
* [CUMULATIVE_REVIEW.md](CUMULATIVE_REVIEW.md): Revisão técnica e de segurança da branch de integração inicial.
* [B2_DELIVERY_REPORT.md](B2_DELIVERY_REPORT.md): Relatório de entrega da etapa B2 (Conversa Contextual).
* [B2_HOMOLOGATION_PLAN.md](B2_HOMOLOGATION_PLAN.md): Plano de homologação inicial do motor conversacional.
* [TRANSPORT_HOMOLOGATION.md](TRANSPORT_HOMOLOGATION.md): Notas de homologação de transporte WhatsApp.
* [API_PRODUCT_CORE_HANDOFF.md](API_PRODUCT_CORE_HANDOFF.md): Registro de handoff do núcleo inicial de produto.
* [MODEL_MIGRATION_EVAL_V1.md](MODEL_MIGRATION_EVAL_V1.md) / [RUNTIME](MODEL_MIGRATION_RUNTIME_V1.md) / [STABILITY](MODEL_MIGRATION_STABILITY_V1.md): Dados empíricos de benchmark de modelos de IA.
* [AI_BUDGET_LATENCY_V1.md](AI_BUDGET_LATENCY_V1.md) / [V1_1](AI_LATENCY_V1_1.md): Estudos históricos de latência e consumo de tokens.
* [MVP.md](MVP.md): Escopo original e critérios iniciais do MVP V1.

---

## 🧭 Diretrizes para Agentes e Desenvolvedores

Se você for realizar qualquer alteração neste repositório:
1. Consulte sempre [**/AGENTS.md**](../AGENTS.md) na raiz do repositório para entender as regras estritas de condução.
2. Certifique-se de compreender a distinção entre o **Comportamento Atual** (em `CURRENT_STATE.md`) e a **Direção Futura** (em `ROADMAP.md` e ADRs).
3. Nunca altere o código em `main` sem cobrir com testes e preservar os invariantes de domínio.
