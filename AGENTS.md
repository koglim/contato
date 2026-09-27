# Instruções para Desenvolvedores e Agentes de IA (AGENTS.md)

Este documento contém os mandamentos operacionais e diretrizes obrigatórias de condução técnica no repositório do **ContatoCerto**. Qualquer desenvolvedor humano ou agente autônomo de IA deve seguir rigorosamente estas instruções.

---

## 📋 12 Regras de Ouro de Condução

1. **Comece Sempre pelo Mapa de Documentação:** Antes de planejar qualquer intervenção ou modificação, leia atentamente [docs/README.md](docs/README.md) para compreender a estrutura e a hierarquia do projeto.
2. **Consulte a Documentação Canônica:** Entenda o produto através dos seis pilares canônicos: [docs/PROJECT.md](docs/PROJECT.md), [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md), [docs/PRODUCT_JOURNEYS.md](docs/PRODUCT_JOURNEYS.md), [docs/PRODUCT_RULES.md](docs/PRODUCT_RULES.md), [docs/ROADMAP.md](docs/ROADMAP.md) e [docs/TECHNICAL_OVERVIEW.md](docs/TECHNICAL_OVERVIEW.md).
3. **Inspecione o Código em `main`:** Nunca assuma como o código funciona baseado apenas em memória ou conversa. Inspecione o código-fonte, os schemas e os testes automatizados vigentes no branch `main` antes de escrever novas soluções.
4. **Cuidado com Documentos Históricos:** Relatórios de entregas passadas (ex.: `V1_EXECUTION.md`, `API_PRODUCT_CORE_HANDOFF.md`, `CUMULATIVE_REVIEW.md`) contêm evidências históricas valiosas, mas **não** devem ser usados para deduzir o comportamento atual do sistema. Código e migrations em `main` são a autoridade máxima.
5. **Preserve os Invariantes de Domínio:** Nunca viole as garantias fundamentais da plataforma:
   * Sem cobrança por lead;
   * Pool de 20, páginas de 3 e limite máximo de 6 profissionais por busca;
   * Transações atômicas com locks determinísticos para concorrência de leads e assinaturas;
   * A IA interpreta texto, mas jamais toma decisões transacionais ou muta o domínio ([ADR-002](docs/decisions/ADR-002-ai-interpretation-vs-deterministic-domain-authority.md)).
6. **Mantenha a Documentação Sincronizada:** Todo Pull Request que alterar comportamento de negócio, fluxos ou arquitetura deve obrigatoriamente atualizar os documentos canônicos correspondentes em `docs/`.
7. **Registre Decisões Relevantes via ADRs:** Alterações arquiteturais estruturais ou mudanças de direcionamento de produto exigem a criação ou atualização de um Architecture Decision Record em [docs/decisions/](docs/decisions/README.md).
8. **Nunca Altere Produção Diretamente:** Não faça alterações manuais em instâncias remotas do n8n, EasyPanel, bancos de produção ou provedores de mensageria sem autorização explícita e procedimento de homologação versionado.
9. **Cobrança / Gateways Estão Estritamente Congelados:** É expressamente proibido implementar integrações com Stripe, Mercado Pago, Asaas, fluxos de checkout, Pix financeiro ou cupons vinculados a faturamento ([ADR-003](docs/decisions/ADR-003-billing-provider-decision-frozen.md)).
10. **Distinga Sempre CURRENT de TARGET:** Ao planejar ou documentar, deixe claro se uma capacidade já está funcionando no código atual (`CURRENT`) ou se é uma meta futura planejada (`TARGET`), como no caso do Ciclo de Conexão v2 ([ADR-004](docs/decisions/ADR-004-connection-lifecycle-v2-direction.md)).
11. **Nunca Exponha Segredos ou Credenciais:** Jamais comite chaves de API, senhas, tokens, números de telefone reais ou hashes de pepper nos arquivos de documentação, commits ou testes. Documente apenas os nomes das variáveis.
12. **Testes e CI são a Única Evidência Aceita:** Nenhuma funcionalidade é considerada concluída sem testes automatizados aprovados (lint, typecheck, build, test) executados localmente e confirmados pelo workflow de CI do GitHub Actions.
