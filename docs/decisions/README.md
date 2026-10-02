# Registros de Decisão de Arquitetura (ADRs)

Este diretório contém os **Architecture Decision Records (ADRs)** do **ContatoCerto**. Os ADRs registram o contexto histórico, as justificativas e as consequências de decisões arquiteturais e de produto críticas tomadas ao longo do projeto.

---

## 📋 Índice de Decisões

| ADR | Título | Data | Status |
| :--- | :--- | :---: | :---: |
| [**ADR-001**](ADR-001-github-documentation-source-of-truth.md) | Documentação no GitHub e Branch `main` como Fonte Única da Verdade | 2026-09-27 | **ACCEPTED** |
| [**ADR-002**](ADR-002-ai-interpretation-vs-deterministic-domain-authority.md) | Limites entre Interpretação por IA e Autoridade de Domínio Determinística | 2026-09-27 | **ACCEPTED** |
| [**ADR-003**](ADR-003-billing-provider-decision-frozen.md) | Congelamento Formal de Gateways de Pagamento e Cobrança | 2026-09-27 | **ACCEPTED** |
| [**ADR-004**](ADR-004-connection-lifecycle-v2-direction.md) | Direção de Produto para o Ciclo de Conexão Bilateral v2 | 2026-09-27 | **IMPLEMENTED (PR #17)** |
| [**ADR-005**](ADR-005-soft-expiry-resumable-presentation.md) | Soft Expiry / Apresentação Retomável de Lista de Profissionais | 2026-10-02 | **IMPLEMENTED IN PR #30 (AUTOMATED VALIDATION)** |
| [**ADR-006**](ADR-006-interactive-actions-button-first.md) | Ações Interativas e Experiência Button-First no WhatsApp | 2026-10-02 | **ACCEPTED / NOT YET IMPLEMENTED** |

---

## 📝 Formato dos Documentos

Cada ADR deve seguir uma estrutura padronizada contendo:
* **Título e Número**
* **Status:** (ex.: `ACCEPTED`, `SUPERSEDED`, `ACCEPTED / NOT YET IMPLEMENTED`)
* **Data:** Data de formalização da decisão.
* **Contexto:** Problema ou dilema que motivou a decisão.
* **Decisão:** Escolha técnica ou de produto adotada.
* **Consequências:** Impactos positivos, negativos e compromissos assumidos.
* **Relacionamentos:** Referência a ADRs predecessores ou sucessores quando aplicável.
