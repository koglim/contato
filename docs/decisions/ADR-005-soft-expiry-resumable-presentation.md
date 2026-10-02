# ADR-005: Soft Expiry / Apresentação Retomável de Lista de Profissionais

* **Status:** ACCEPTED / NOT YET IMPLEMENTED
* **Data:** 2026-10-02
* **Decisores:** Produto e Arquitetura ContatoCerto

---

> [!NOTE]
> **Direcionamento de Produto e Arquitetura:**
> Este documento formaliza o direcionamento de arquitetura para a futura funcionalidade de apresentação retomável de profissionais (*Soft Expiry*). Nenhuma alteração de código ou migração de banco de dados está autorizada no escopo deste registro. O comportamento determinístico de expiração de contexto implementado no PR #27 (T18) permanece como o padrão operacional vigente até a implementação formal desta decisão.

---

## Contexto

Atualmente, o parâmetro de configuração do sistema:

$$\text{SEARCH\_CONVERSATION\_TTL\_MINUTES} = 30$$

controla a janela de tempo do **contexto conversacional ativo** (`search_conversations`).

Durante os testes de homologação em produção real (outubro/2026), comprovou-se que após 30 minutos a lista de profissionais apresentada é corretamente rejeitada pelo motor conversacional, e a correção de UX implementada no PR #27 (T18) garante o retorno de uma mensagem determinística explícita avisando o cliente que a lista expirou e orientando-o a iniciar uma nova busca.

No entanto, o feedback de produto e o comportamento real de usuários no WhatsApp demonstraram que 30 minutos é uma janela restritiva demais para ser tratada como a **validade negocial definitiva de uma lista de profissionais apresentada**.

Em um cenário real de contratação de serviços:
1. O cliente realiza a busca e recebe a lista de profissionais elegíveis.
2. O cliente é interrompido por afazeres diários ou precisa de tempo para analisar as opções.
3. Horas mais tarde, o cliente retorna à conversa no WhatsApp e responde com o número ou nome de um dos profissionais apresentados (ex.: *"2"* ou *"Quero o Farol"*).
4. Forçar o cliente a redigitar o pedido de busca do zero quando os profissionais apresentados ainda podem estar perfeitamente disponíveis gera atrito desnecessário na jornada do usuário.

Portanto, torna-se necessário separar formalmente:

$$\mathbf{TTL\ de\ Contexto\ Conversacional\ (UI/Sess\tilde{a}o)} \quad \neq \quad \mathbf{Validade\ de\ Apresenta\c{c}\tilde{a}o\ e\ Sele\c{c}\tilde{a}o\ (Neg\acute{o}cio)}$$

---

## Decisão

1. **Separação de Janelas Temporais:**
   * O TTL de 30 minutos de `search_conversations` permanece como uma fronteira de implementação para gerenciar o estado da máquina de conversação ativa.
   * Ele **não** define a janela definitiva de validade do produto para a lista de profissionais apresentada ao cliente.

2. **Mecanismo de Apresentação Retomável (*Resumable Presentation*):**
   * Em uma etapa futura de engenharia, a plataforma implementará um mecanismo que permitirá ao cliente fazer referência a profissionais apresentados em buscas anteriores, mesmo após a expiração do contexto conversacional ativo de 30 minutos.

3. **Revalidação Atômica Obrigatória no Instante da Seleção Tardia:**
   * A aceitação de uma seleção tardia baseada em histórico de apresentação **exige revalidação atômica de elegibilidade** do profissional no exato milissegundo em que a seleção é processada no banco de dados.
   * A revalidação deve executar rigorosamente todas as regras canônicas de autoridade de domínio, incluindo:
     * Status ativo do profissional (`status = 'active'`);
     * Elegibilidade da categoria/serviço ofertado;
     * Regularidade de assinatura/entitlement no modo `account_managed` (quando aplicável);
     * Cobertura geográfica e raio de atendimento válidos para a localização da busca original;
     * Demais invariantes de integridade do catálogo e domínio.

4. **Distinção entre Reconhecimento Semântico e Autorização Transacional ([ADR-002](ADR-002-ai-interpretation-vs-deterministic-domain-authority.md)):**
   * O reconhecimento semântico (*"o cliente está se referindo ao profissional Farol da lista anterior"*) é um fato contextual.
   * A autorização (*"o profissional Farol ainda é elegível para receber esta conexão neste momento"*) é uma decisão transacional exclusiva do banco de dados relacional.
   * As evidências históricas da apresentação original permanecem imutáveis e auditáveis no ledger.

5. **Tratamento de Inelegibilidade Superveniente:**
   * Caso o profissional referenciado não seja mais elegível no momento da seleção tardia (por exemplo, foi suspenso, desativou o serviço ou mudou sua área de atendimento):
     * **NÃO criar contato** (`contacts`);
     * **NÃO violar invariantes de negócio**;
     * Retornar resposta determinística e transparente explicando que aquela opção específica não está mais disponível e oferecer opções atualizadas / nova busca.

6. **Critério de Obsolescência Extrema (*Hard Floor / Presentation Refresh*):**
   * Caso a apresentação original seja considerada excessivamente antiga de acordo com a política de produto a ser fixada, a plataforma não deve utilizá-la silenciosamente, emitindo um convite claro de atualização (*refresh*).

7. **Não Fixação de Duração Arbitrária nesta Etapa:**
   * **Nenhum valor arbitrário de política (ex.: 12 horas, 24 horas, 48 horas) é definido ou fixado neste ADR.**
   * A janela temporal de validade negocial da apresentação será definida em especificação de produto posterior, embasada em dados de uso real, métricas de conversão e telemetria de produção.

8. **Precedência de Contexto Ativo:**
   * Uma busca recente ou um contexto conversacional ativo subsequente sempre possui precedência determinística sobre qualquer apresentação histórica anterior.

9. **Vigência do Tratamento T18 Atual:**
   * Até que o mecanismo de *Soft Expiry* seja especificado e implementado em código, o comportamento determinístico estabelecido no PR #27 (T18) permanece como a resposta oficial do sistema para seleções em contextos expirados.

---

## Consequências

### Positivas
* **Redução de Fricção no WhatsApp:** O cliente não é penalizado nem obrigado a responder em menos de 30 minutos para contratar um profissional já apresentado.
* **Alinhamento com a Realidade do Usuário:** Suporta pausas naturais na conversa características do uso cotidiano de mensageria móvel.
* **Desacoplamento Arquitetural:** Separa o ciclo de vida da sessão conversacional em memória/banco do ciclo de vida da oferta comercial.
* **Segurança e Integridade Preservadas:** A revalidação atômica em tempo de transação impede categoricamente que profissionais inaptos recebam contatos tardios.

### Negativas / Compromissos / Trade-offs
* **Identidade Persistida de Apresentação:** Exigirá modelagem de dados para registrar e rastrear o conjunto de profissionais formalmente apresentados (*shown candidates*) com chave determinística de apresentação.
* **Sobrecarga de Revalidação Concorrente:** A transação de seleção tardia precisará efetuar locks e checagens de elegibilidade adicionais que não eram necessárias quando a conversa estava restrita à memória de curto prazo.
* **Desambiguação de Múltiplas Buscas:** Clientes que realizaram múltiplas buscas para serviços diferentes em momentos distintos exigirão regras determinísticas de desambiguação contextual.
* **Definição de Política Pendente:** A duração final da janela de *Soft Expiry* permanece como um ponto em aberto a ser decidido antes da codificação.
