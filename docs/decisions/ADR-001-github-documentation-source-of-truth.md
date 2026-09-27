# ADR-001: Documentação no GitHub e Branch main como Fonte Única da Verdade

* **Status:** ACCEPTED
* **Data:** 2026-09-27
* **Decisores:** Engenharia e Produto ContatoCerto

---

## Contexto

À medida que o projeto ContatoCerto evoluiu ao longo de diversos ciclos de desenvolvimento e PRs incrementais, formou-se um vasto acervo de documentos técnicos, relatórios de handoff (`API_PRODUCT_CORE_HANDOFF.md`), relatórios de entrega (`B2_DELIVERY_REPORT.md`, `V1_EXECUTION.md`) e notas de homologação.

Alguns desses documentos registravam o estado de marcos parciais anteriores, gerando potenciais contradições com a implementação mais recente em `main`. Além disso, a presença de uma infraestrutura instalada em produção com fluxos orquestrados no n8n levantou a questão sobre onde reside a autoridade final da verdade do sistema: se nos fluxos instalados remotamente, nos relatórios históricos ou no código versionado.

## Decisão

1. **Autoridade Canônica do Código em `main`:** O código-fonte, os schemas de banco de dados (migrations) e os testes automatizados integrados ao branch `main` no repositório do GitHub constituem a **autoridade suprema e definitiva** sobre o comportamento real do ContatoCerto.
2. **Governança da Documentação Versionada:** A documentação oficial do projeto reside exclusivamente dentro do diretório `docs/` no GitHub. Nenhuma ferramenta externa (n8n, EasyPanel, chats ou dashboards) é aceita como substituta da documentação versionada.
3. **Preservação de Evidências Históricas:** Documentos de entregas passadas são preservados como registros de evidência histórica, mas devem conter avisos claros indicando que representam o estado na data de sua criação, devendo os leitores recorrer à documentação canônica recente para entender o comportamento vigente.
4. **Tratamento de Divergências (Drift):** Qualquer discrepância entre o que está instalado em ambientes externos (ex.: workflows n8n) e o que está versionado em `main` deve ser documentada como débito de reconciliação, prevalecendo a especificação do repositório como a meta de conformidade.

## Consequências

* **Positivas:**
  * Elimina ambiguidades conceituais para novos engenheiros e agentes de IA.
  * Garante que toda mudança de arquitetura ou regra de negócio passe por revisão de código via Pull Request.
  * Impede que alterações pontuais feitas manualmente em ferramentas externas quebrem os invariantes do sistema sem versionamento.
* **Negativas / Compromissos:**
  * Exige a disciplina contínua de atualizar a documentação canônica paralelamente às alterações de código em cada PR.
