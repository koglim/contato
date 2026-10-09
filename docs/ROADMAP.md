# Roadmap do ContatoCerto

Este documento define o planejamento estruturado de evolução do **ContatoCerto**. Para manter o foco e a estabilidade técnica, o roadmap é organizado em horizontes de prioridade sem datas arbitrárias de calendário.

---

# DONE

Funcionalidades totalmente concluídas, integradas ao branch `main` e validadas por suítes de testes automatizados:

* **Núcleo de Busca e Catálogo:** Resolução determinística de serviços com tolerância fonética/fuzzy, resolução em memória de municípios brasileiros (IBGE), cobertura geográfica espacial e cálculo de raio via PostGIS (`ST_DWithin`) e fallback Pelias/HeiGIT.
* **Algoritmo de Matching e Ranking:** Algoritmo justo (*fair-v1*), pool de até 20 profissionais elegíveis, apresentação em blocos de 3 e limite máximo de 6 profissionais por busca.
* **Contato Bilateral e Consentimento:** Transação atômica que registra o contato (`contacts`), captura snapshot dos dados cadastrais e gera o código público `CC-XXXXXXXX` mediante seleção e consentimento informado do cliente para o compartilhamento bilateral de contatos.
* **Durabilidade de Mensageria (Tabelas de Fila):** Tabelas `channel_inbound_messages` e `channel_outbound_messages` com controle de leases transacionais, proteção contra crash de workers, expurgo sanitizado, deduplicação idempotente e quarentena de conflitos.
* **Motor Conversacional Híbrido (B2):** Arquitetura para processamento de áudio/texto com memória estruturada de hipóteses e slots contextuais.
* **Identidade Individual do Profissional (PRs #10 a #13):** Separação de contas (`accounts`) e profissionais (`professionals`), autenticação sem senha (OTP de 6 dígitos via WhatsApp com TTL de 5 minutos e HMAC via `PROFESSIONAL_AUTH_PEPPER`), autocadastro e reivindicação de perfis legados.
* **Governança de Status Profissional:** Enum `professional_status` com estados estritos (`'draft'`, `'active'`, `'suspended'`), vínculo a categorias e áreas de atendimento.
* **Assinaturas e Entitlements Neutros (PR #14):** Modelagem de planos e assinaturas de profissionais (Migration 025). Lock atômico de concorrência (`FOR UPDATE OF professionals`) garantindo que apenas assinantes ativos no modo `account_managed` recebam novos contatos (perfis `legacy_unmanaged` provisoriamente isentos).
* **Conclusão e Confirmação de Atendimentos (PR #15):** Registro de encerramento do serviço (`concluído CC-XXXXXXXX`) por qualquer das partes, confirmação (`confirmar CC-XXXXXXXX`) ou contestação (`contestar CC-XXXXXXXX`) pela contraparte com código obrigatório no parser atual, isolados de contexto de busca.
* **Ciclo de Conexão Bilateral v2 (PR #17 — Migration 027):** Conexão imediata no status `shared` mediante seleção e consentimento informado do cliente, eliminação do segundo aceite obrigatório do profissional, telemetria imutável de indisponibilidade via `professional_unavailability_events` (P0027), suporte a múltiplas conexões por busca via índice `(search_request_id, professional_id)` e elegibilidade direta para conclusão a partir de `shared`.
* **Inteligência de Conversa e Seleção v2 (PR #18):** Interação natural na etapa de seleção ("me fale mais do João", "qual o mais perto?", "qual o mais barato?", "compara os dois", "tem mais opções?"), barreira estrita de segurança pergunta vs seleção (ADR-002), apresentadores determinísticos com 0 chamada de composição à IA, fast paths determinísticos com 0 chamadas de IA e comandos de conclusão/confirmação/contestação com código-livre ou código público com resolução inteligente de múltiplos contatos.
* **Painel Web do Profissional (`/dashboard`):** Aplicação Next.js com BFF, autenticação via cookie assinado, edição de dados cadastrais (telefone em modo somente-leitura), serviços, áreas de atendimento e disponibilidade.
* **Ações Interativas Button-First e Template Quick Reply (WP6.9 / Gate B — Concluído em Produção Real):** Transporte de oportunidade ao profissional via template oficial da Meta (`contato_certo_nova_solicitacao_v1`) com botões Quick Reply, tokens autoritativos de ação (`ia_<opaque>`), extração determinística ponta a ponta no Gateway n8n após PR #40, declaração de conclusão iniciada por botão e confirmação bilateral com fechamento atômico do contato em `completed` ([`docs/launch-readiness/01-wp6-9-gate-b-closeout.md`](launch-readiness/01-wp6-9-gate-b-closeout.md)).
* **Design System Foundation v1 (WP7.0 — PR #39):** Implementação formal da fundação do Design System do ContatoCerto (`apps/web/design-system/`): tokens primitives/semantic/component, dark mode first-party sem FOUC, escala tipográfica Inter, layout primitives (`Box`, `Stack`, `Inline`, `Grid`, `Container`), catálogo de componentes base (Radix Primitives + CSS Modules), Lucide React, App Shell responsivo e Storybook com testes automatizados de browser e acessibilidade a11y em CI (conforme [`docs/DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md)).
* **Migração Visual do Painel Web (WP7.1 — PR #42):** Migração integral da camada visual do painel do profissional (`/dashboard`, `/profile`, `/services`, `/service-areas`, `/availability`, onboarding, seletor de perfis, loading e error states) para o ContatoCerto Design System v1. Concluído e mesclado no PR #42 (commit `9be011983b18957f3186cc5bc121279f6349c6d1`, CI pós-merge `37855033820` SUCCESS). Casca de aplicação (`AppShell`) responsiva, suporte nativo a light/dark mode, correções completas de acessibilidade (82 stories validadas em Chromium com a11y) e remoção integral do CSS legado do dashboard em `globals.css`. Preservados integralmente contratos de BFF, semântica de autenticação/sessão, schema do PostgreSQL, workflows do n8n e regras de domínio.
* **Localização v2 — Fundação de Entrada (Migration 029 / ADR-007):** Ingestão nativa de mensagens de pino de localização do WhatsApp (`message.locationMessage`), dutos estruturados Gateway -> Inbox durável (`channel_inbound_messages`), coordenadas exatas como autoridade máxima de busca espacial, geocodificação reversa para enriquecimento de metadados, memória durável de última localização (`customer_last_locations`) e confirmação explícita obrigatória antes do reuso (`location_confirmation`) com zero reuso silencioso e zero chamadas LLM.

---

# NOW

Iniciativas ativas e imediatas para o ciclo atual de desenvolvimento:

1. **Launch Readiness / Homologação Residual:**
   * Checkpoint A & A.2 de auditoria da realidade atual e runtime remoto concluído em 2026-09-28 ([`docs/launch-readiness/00-current-reality-audit.md`](launch-readiness/00-current-reality-audit.md)).
   * **Homologação em Produção Real (2026-10-01 a 2026-10-09):** Happy path Golden E2E #2, subfluxos de indisponibilidade profissional, contestação bilateral (T34), seleção expirada (T18), ciclo completo de notificação via template e conclusão bilateral de atendimento por botões rápidos (WP6.9 / Gate B — [`docs/launch-readiness/01-wp6-9-gate-b-closeout.md`](launch-readiness/01-wp6-9-gate-b-closeout.md)) e preservação/retomada de busca com outra busca ativa (T29 — [`docs/launch-readiness/02-t29-real-e2e-closeout.md`](launch-readiness/02-t29-real-e2e-closeout.md)) comprovados em produção real. **T29 — REAL PRODUCTION HOMOLOGATION COMPLETE / PASS** (`LAUNCH_READINESS_T29_RESIDUAL = CLOSED`).
2. **Localização v2 (Fundação de Entrada):**
   * Implementada no código (Migration 029 / ADR-007). Aguardando homologação em ambiente de homologação/produção após merge.
3. **Reconciliação n8n / Evolution / Workflows Versionados:**
   * O Shared Delivery e o Gateway foram sincronizados em produção no Gate B. Pendente apenas a reimportação do suporte a `professional_auth_challenge` para habilitar OTP (`PROFESSIONAL_AUTH_ENABLED=true`).
4. **Sincronização Contínua da Documentação:**
   * Manter a disciplina de atualizar a documentação canônica a cada PR com alteração funcional ou arquitetural.

---

# NEXT

Funcionalidades planejadas para a sequência imediata após a conclusão do bloco NOW:

* **Avaliações e Reputação (Reviews & Ratings):** Coleta estruturada de notas e depoimentos após a confirmação bilateral da conclusão, com ponderação no algoritmo de ranking.
* **Telemetria e Analytics do Funil:** Instrumentação e produto de visualização de métricas de conversão ao longo do funil (*candidate → match → shown → selected → bilateral connection → completion*).
* **Painel Web do Profissional v2:** Expansão do `/dashboard` com tela visual de atendimentos, métricas de exposição, taxa de seleção, histórico financeiro de assinatura e status de reputação.
* **Painel Administrativo para Operadores:** Interface para auditoria de quarentena da Inbox, moderação de perfis e suporte ao cliente.
* **Homologação de Carga e Resiliência de Transporte:** Testes de estresse com alta concorrência de números simultâneos e injeção de falhas controladas no provedor de mensageria.
* **Automação de Testes E2E Web:** Cobertura de fluxos do painel via Playwright.
* **Endurecimento de Confiabilidade:** Estratégias de backup/restore testadas, tolerância a particionamento de rede e observabilidade aprimorada com tracing distribuído.

---

# GROWTH

Ideias e alavancas de crescimento orgânico e viral do marketplace (para futura validação comercial):

* **Programa de Indicação entre Profissionais (Member Get Member):** Convite de colegas com link rastreável e bonificação de dias em plano de assinatura.
* **Perfil Público Compartilhável:** Página web indexável (SEO) do profissional com botão direto para contratação conversacional.
* **Loops de Recontratação:** Gatilhos para recontratar o mesmo profissional em serviços periódicos (ex.: limpeza de ar-condicionado a cada 6 meses).
* **Indicação pelo Cliente:** Ao final de um serviço bem avaliado, link para o cliente compartilhar o ContatoCerto com amigos no WhatsApp.
* *Nota de Dependência:* Todas as mecânicas de incentivo dependem da futura estratégia comercial e da descongelação das regras de faturamento.

---

# FROZEN

Itens formalmente congelados e expressamente **proibidos de implementação** no momento ([ADR-003](decisions/ADR-003-billing-provider-decision-frozen.md)):

* **Seleção e Integração de Gateways de Pagamento:** Stripe, Mercado Pago, Asaas, Pagar.me, etc.
* **Telas e Fluxos de Checkout:** Cobrança de cartão de crédito, débito ou emissão automatizada de chaves Pix para pagamento de planos.
* **Webhooks Financeiros e Reconciliação:** Tratamento de notificações de chargeback, inadimplência e conciliação bancária.
* **Mecânicas de Cupons e Descontos Monetários:** Promoções que afetem diretamente o faturamento.
* **Recompensas Financeiras em Dinheiro:** Premiações monetárias por indicação.

---

# PARKING LOT

Ideias, melhorias e direcionamentos de produto identificados para evolução futura sem bloqueio do lançamento atual:

### A. Direções de Produto e Arquitetura (Documentação Apenas — Não Implementar)
* **Soft Expiry / Apresentação Retomável de Lista de Profissionais (PR #30 — [ADR-005](decisions/ADR-005-soft-expiry-resumable-presentation.md)):** Janela negocial configurável de 24 horas (`SEARCH_PRESENTATION_RESUME_TTL_MINUTES = 1440`) para seleção tardia direta (numérica, ordinal ou nominal) de profissionais apresentados (`shown_at`), mantendo o TTL conversacional de 30 minutos inalterado e revalidando atomicamente a elegibilidade com zero chamadas de IA. Implementado no PR #30 com validação automatizada; homologação em produção real pendente.
* **Ações Interativas e Experiência Button-First no WhatsApp ([ADR-006](decisions/ADR-006-interactive-actions-button-first.md)):**
  * Direcionamento futuro para integração com a WhatsApp Cloud API oficial:
    * Preservação do código público `CC-XXXXXXXX` para auditoria, suporte e fallback.
    * Substituição da digitação manual por botões interativos nativos (*Confirmar*, *Contestar*, *Concluído*, *Não consigo atender*).
    * Vinculação determinística entre cada ação interativa e seu respectivo contato/evento, assegurando idempotência e suporte a múltiplos contatos concorrentes por profissional.
    * Adoção de modelo baseado em *tokens opacos de ação vinculados à autorização contato/ação/ator*.
    * *Nota:* A Evolution API segue como integrador de mensageria atual; a migração para Cloud API é pacote de trabalho independente.
* **Endurecimento de Acessibilidade no Design System (Table):** Permitir passagem de rótulo contextual (`aria-label`) para a região de rolagem horizontal da `Table` quando múltiplas tabelas coexistirem na mesma página (atualmente padronizado com `role="region"`, `aria-label="Tabela de dados"`). Melhoria futura não-bloqueante herdada do WP7.1.

### B. Oportunidades de Produto e Engajamento
* **Follow-up Automático de Inatividade:** Mensagem delicada para clientes que pararam no meio da busca sem escolher.
* **Saudação Personalizada para Usuários Recorrentes:** Reconhecimento do histórico prévio do cliente na primeira mensagem.
* **Lembretes Inteligentes:** Alertas prévios para agendamentos combinados com o profissional.
* **Navegação Completa por Categorias:** Link externo para consultar o mapa integral de serviços atendidos.
* **Recomendações Suplementares:** Apresentação de uma nova página de opções caso o cliente rejeite explicitamente os 3 primeiros nomes sem precisar reiniciar a busca.
* **Envio de Documentos e Verificação de Identidade (KYC):** Upload de certificados, diplomas e antecedentes para selo de verificação no painel.
* **Portfólio com Fotos:** Galeria de imagens de trabalhos anteriores no perfil do profissional.
