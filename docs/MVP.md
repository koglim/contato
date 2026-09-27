# V1 — Jornada e Critérios do MVP

> [!NOTE]
> **Status do Documento:** Este documento descreve os critérios e o escopo original de concepção do MVP V1.
> Para a definição canônica consolidada do produto, arquitetura vigente e roadmap de evolução, consulte:
> * [**docs/README.md**](README.md) — Mapa Geral de Documentação
> * [**docs/PROJECT.md**](PROJECT.md) — Definição Canônica do Produto
> * [**docs/CURRENT_STATE.md**](CURRENT_STATE.md) — Estado Atual do Sistema
> * [**docs/ROADMAP.md**](ROADMAP.md) — Planejamento Estruturado de Entregas

---

## Jornada Central da V1

A V1 do ContatoCerto completa o fluxo fundamental de atendimento:

```
cliente solicita serviço
→ sistema entende a necessidade
→ identifica localização
→ encontra profissionais
→ apresenta opções
→ cliente escolhe profissional
→ contato é registrado
→ posteriormente é possível avaliar
```

* **Entregas Consolidadas:** Resolução de serviços e municípios, cobertura espacial PostGIS, ranking justo, apresentação em páginas de 3, seleção transacional, consentimento para compartilhamento bilateral de contatos e snapshot de contato já existem e possuem testes de integração. Identidade individual e onboarding (PRs #10–#13), assinatura profissional & entitlements neutros (PR #14) e conclusão e confirmação bilateral de atendimento (PR #15) estão totalmente integrados e aprovados em `main`.
* **Governança Documental (PR #16):** Reconciliação canônica da documentação, estabelecimento da Fonte Única da Verdade e alinhamento do roadmap de produto.
* **Próximas Etapas:** O ciclo de avaliações estruturadas e reputação, a homologação final de ponta a ponta com instâncias reais de WhatsApp e o Ciclo de Conexão v2 ([ADR-004](decisions/ADR-004-connection-lifecycle-v2-direction.md)) constam como próximas etapas no [ROADMAP.md](ROADMAP.md).
* **Cobrança / Gateways:** Permanecem formalmente congelados ([ADR-003](decisions/ADR-003-billing-provider-decision-frozen.md)).
* **Invariantes Fundamentais:** Preservar pool máximo de 20 candidatos, páginas de 3 e teto de apresentação de 6 profissionais; cliente sempre gratuito e monetização por assinatura profissional, sem qualquer cobrança por lead.
