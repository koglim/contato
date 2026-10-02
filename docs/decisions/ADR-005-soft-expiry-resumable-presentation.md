# ADR-005: Soft Expiry / Apresentação Retomável de Lista de Profissionais

* **Status:** IMPLEMENTED IN PR #30 / AUTOMATED VALIDATION / CI (PRODUCTION REVALIDATION PENDING)
* **Data:** 2026-10-02
* **Decisores:** Produto e Arquitetura ContatoCerto

---

> [!NOTE]
> **Implementação em PR #30 (v1 — 24 Horas):**
> Este documento formalizou o direcionamento de arquitetura para a funcionalidade de apresentação retomável de profissionais (*Soft Expiry*), implementada no PR #30 com janela configurável de **24 horas** (`SEARCH_PRESENTATION_RESUME_TTL_MINUTES = 1440`). O TTL de 30 minutos de `SEARCH_CONVERSATION_TTL_MINUTES` permanece inalterado para o contexto de conversação em tempo real. A seleção tardia direta (numérica, ordinal ou nominal) revalida atomicamente a elegibilidade do profissional e restabelece a conexão bilateral caso elegível dentro do prazo de 24h de `shown_at`. Validação automatizada e CI completas; homologação em produção real pendente.

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
   * A seleção tardia exige revalidação da elegibilidade do profissional na **mesma transação atômica** que efetiva a seleção/conexão, utilizando os locks e invariantes de domínio necessários para prevenir qualquer brecha de concorrência ou defasagem temporal (TOCTOU — *Time-of-Check to Time-of-Use*).
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

7. **Fixação da Janela em v1 (24 Horas / 1440 Minutos):**
   * A janela temporal de validade negocial da apresentação para o MVP v1 foi fixada em **24 horas** (`SEARCH_PRESENTATION_RESUME_TTL_MINUTES = 1440`), configurável via variável de ambiente.
   * O anchor temporal auditável é `matches.shown_at`, registrado estritamente quando a mensagem de apresentação atinge `outbound.status = 'sent'`.
   * Essa janela é revalidada de forma atômica dentro da transação de seleção (`selectResumableShownMatch`). Telemetria futura em produção poderá calibrar esse valor.

8. **Precedência de Contexto Ativo:**
   * Uma busca recente ou um contexto conversacional ativo subsequente sempre possui precedência determinística sobre qualquer apresentação histórica anterior.

9. **Escopo v1 e Respostas Determinísticas:**
   * **Seleção Direta:** Aplica-se à seleção direta nominal, ordinal ou numérica (`1`, `2`, `3`, `primeiro`, `segundo`, `Quero o Profissional X`).
   * **Opção Inelegível:** Se o profissional tornou-se inativo ou inelegível dentro da janela de 24h, retorna deterministamente `CONTEXTUAL_RESUMABLE_SELECTION_UNAVAILABLE` (*"Essa opção não está mais disponível. Envie uma nova mensagem com o serviço e a cidade para eu atualizar as opções."*), com zero contatos criados e zero chamadas de IA.
   * **Lista com > 24h:** Mantém a resposta determinística canônica do T18 `CONTEXTUAL_EXPIRED_SELECTION` (*"Essa lista de profissionais expirou. Envie uma nova mensagem com o serviço e a cidade para eu buscar opções atualizadas."*).

---

## Consequências

### Positivas
* **Redução de Fricção no WhatsApp:** O cliente não é penalizado nem obrigado a responder em menos de 30 minutos para contratar um profissional já apresentado.
* **Alinhamento com a Realidade do Usuário:** Suporta pausas naturais na conversa características do uso cotidiano de mensageria móvel.
* **Desacoplamento Arquitetural:** Separa o ciclo de vida da sessão conversacional em memória/banco do ciclo de vida da oferta comercial.
* **Segurança e Integridade Preservadas:** A revalidação atômica em tempo de transação impede a seleção tardia de profissional que falhe na revalidação quando as invariantes transacionais são satisfeitas.
* **Zero IA na Seleção Resumida:** Nenhum custo nem latência de LLM ou geocodificador são incorridos na retomada determinística.

### Negativas / Compromissos / Trade-offs
* **Sobrecarga de Revalidação Concorrente:** A transação de seleção tardia efetua locks na autoridade do profissional e na linha do match (`selectResumableShownMatch`).
* **Escopo Restrito em v1:** Comandos de paginação/navegação (`mostrar mais`) e inquiries pós-expiração permanecem sob o comportamento T18 (expirado), sem expansão para navegação conversacional profunda em listas antigas.
