# ADR-004: Direção de Produto para o Ciclo de Conexão Bilateral v2

* **Status:** ACCEPTED / NOT YET IMPLEMENTED
* **Data:** 2026-09-27
* **Decisores:** Produto e Arquitetura ContatoCerto

---

> [!CAUTION]
> **Aviso de Não Implementação:**
> Este registro define uma **decisão de produto aprovada para implementação futura**.
> O código atualmente presente em `main` ainda opera sob o modelo legado (onde o status de aceite profissional participa da semântica de ciclo de vida). Esta ADR documenta a direção a ser implementada na próxima frente técnica, **não devendo ser considerada como código em execução no presente momento**.

---

## Contexto

No modelo original e na base atual de código do ContatoCerto, após a escolha do profissional pelo cliente, o registro de contato (`contacts`) transita por estados intermediários de resposta do profissional (como `pending`, `accepted` ou `rejected`).

Na prática de um marketplace conversacional de serviços locais:
1. O cliente procura um profissional com urgência e espera contato imediato.
2. Exigir que o profissional acesse o painel web, clique em um botão de aceite ou envie uma palavra-chave como *"aceito"* no WhatsApp antes que a conexão seja formalmente considerada existente cria uma fricção desnecessária e atrasa o atendimento.
3. Se ambos os lados já receberam o telefone um do outro, a **conexão factual já ocorreu no mundo real**.

## Decisão

1. **Equação da Conexão Bilateral v2:**
   $$\text{Seleção Ativa do Cliente} + \text{Consentimento Mútuo de Telefones} = \mathbf{CONEX\tilde{A}O\ ESTABELECIDA}$$
2. **Eliminação do Aceite Obrigatório:**
   * O profissional **não precisará** abrir dashboard, clicar em botão de aceite, enviar *"aceito"* ou realizar qualquer ação mandatória para que o contato exista e seja considerado entregue.
   * Ambas as partes recebem imediatamente os dados de contato recíprocos via WhatsApp.
3. **Sinal Opcional de Indisponibilidade:**
   * O profissional receberá a notificação da oportunidade contendo o telefone do cliente, resumo do serviço e endereço seguro.
   * O profissional terá a opção de sinalizar caso não possa atender (*"estou indisponível"*).
   * Essa resposta de indisponibilidade é classificada estritamente como **declaração unilateral do profissional**, servindo para telemetria de qualidade e para que o sistema possa oferecer opções adicionais ao cliente, sem apagar o fato de que a oportunidade foi entregue.
4. **Planejamento de Engenharia:**
   * Esta alteração será implementada na frente técnica subsequente (Connection Lifecycle v2), ajustando migrations, transições de status da tabela `contacts` e templates de mensagens.

## Consequências

* **Positivas:**
  * Alinha perfeitamente a semântica da plataforma com o comportamento real do WhatsApp no Brasil.
  * Acelera drasticamente a velocidade de fechamento entre cliente e prestador.
  * Simplifica as regras de auditoria e elimina estados intermediários ambíguos de contatos "presos aguardando aceite".
* **Negativas / Compromissos:**
  * Exigirá refatoração das consultas e testes que hoje assumem que um contato só pode ser concluído ou confirmado se tiver passado previamente pelo status `'accepted'`.
