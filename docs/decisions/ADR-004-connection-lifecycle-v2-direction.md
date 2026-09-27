# ADR-004: Direção de Produto para o Ciclo de Conexão Bilateral v2

* **Status:** IMPLEMENTED (PR #17 — Connection Lifecycle v2)
* **Data:** 2026-09-27
* **Decisores:** Produto e Arquitetura ContatoCerto

---

> [!NOTE]
> **Implementação Concluída:**
> Esta decisão foi implementada no PR #17 através da Migration 027 (`027_add_connection_lifecycle_v2.js`), estabelecendo a criação direta de contatos como `shared`, telemetria imutável de indisponibilidade via `professional_unavailability_events` e elegibilidade direta para conclusão de serviços.

---

## Contexto

No modelo original e na base atual de código do ContatoCerto, após a escolha do profissional pelo cliente, o registro de contato (`contacts`) transita por estados onde a resposta profissional (`accepted` ou `declined` dentro do enum `contact_status`: `'requested'`, `'shared'`, `'accepted'`, `'declined'`, `'completed'`, `'cancelled'`) participa do ciclo de vida.

Na prática de um marketplace conversacional de serviços locais:
1. O cliente procura um profissional com urgência e espera contato imediato.
2. Exigir que o profissional acesse o painel web, clique em um botão de aceite ou envie uma palavra-chave como *"aceito"* no WhatsApp antes que a conexão seja formalmente considerada existente cria uma fricção desnecessária e atrasa o atendimento.
3. Se ambos os lados já receberam o telefone um do outro, a **conexão factual já ocorreu no mundo real**.

## Decisão

1. **Equação da Conexão Bilateral v2:**
   $$\text{Participação elegível do profissional} + \text{Seleção ativa do cliente} + \text{Consentimento informado do cliente para compartilhamento bilateral dos contatos} = \mathbf{CONEX\tilde{A}O\ ESTABELECIDA}$$
2. **Eliminação do Aceite Obrigatório:**
   * O profissional **não realiza um segundo aceite/autorização obrigatório** após ser selecionado pelo cliente.
   * Ambas as partes recebem imediatamente os dados de contato recíprocos via WhatsApp.
3. **Sinal Opcional de Indisponibilidade:**
   * O profissional receberá a notificação da oportunidade contendo o telefone do cliente, resumo do serviço e o contexto seguro de localização disponível.
   * O profissional terá a opção de sinalizar caso não possa atender (*"estou indisponível"*).
   * Essa resposta de indisponibilidade é classificada estritamente como **declaração unilateral do profissional**, servindo para telemetria operacional de qualidade e para que o sistema possa oferecer opções adicionais ao cliente, sem apagar o fato de que a oportunidade foi entregue.
4. **Implementação de Engenharia:**
   * Esta direção foi implementada na Migration 027 (`027_add_connection_lifecycle_v2.js`), com ajustes no `ContactCompletionService`, `ProfessionalOpportunityService`, schemas compartilhados e templates de mensagens.

## Consequências

* **Positivas:**
  * Alinha perfeitamente a semântica da plataforma com o comportamento real do WhatsApp no Brasil.
  * Acelera drasticamente a velocidade de fechamento entre cliente e prestador.
  * Simplifica as regras de auditoria e elimina estados intermediários ambíguos de contatos "presos aguardando aceite".
* **Negativas / Compromissos:**
  * **LEGACY:** Requeria refatoração das consultas e testes que assumiam que um contato só podia ser concluído ou confirmado se tivesse passado previamente pelo status `'accepted'`. Essa refatoração foi concluída no PR #17 (Migration 027 + ajustes no `ContactCompletionService`).
