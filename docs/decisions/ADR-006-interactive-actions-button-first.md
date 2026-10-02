# ADR-006: Ações Interativas e Experiência Button-First no WhatsApp

* **Status:** ACCEPTED / NOT YET IMPLEMENTED
* **Data:** 2026-10-02
* **Decisores:** Produto e Arquitetura ContatoCerto

---

> [!NOTE]
> **Direcionamento de Arquitetura e Experiência de Mensageria:**
> Este documento formaliza o direcionamento de arquitetura para a transição do modelo conversacional baseado exclusivamente em texto para uma experiência interativa prioritariamente baseada em botões e componentes visuais (*Button-First / Interactive Actions*) no WhatsApp. A Evolution API permanece como a camada de integração de mensageria vigente. Nenhuma migração de transporte ou alteração de código está autorizada no escopo deste documento.

---

## Contexto

Na arquitetura atual do ContatoCerto, as ações operacionais e transacionais no canal WhatsApp são suportadas por comandos de texto determinísticos estruturados em torno de um código público humanamente legível (`CC-XXXXXXXX`):

* **Profissional:** `não consigo CC-XXXXXXXX` (indisponibilidade), `concluído CC-XXXXXXXX` (declaração de conclusão), `confirmar CC-XXXXXXXX` (confirmação).
* **Cliente:** `concluído CC-XXXXXXXX` (declaração de conclusão), `confirmar CC-XXXXXXXX` (confirmação), `contestar CC-XXXXXXXX` (contestação).

Embora o parser conversacional e a camada de inteligência contextual tenham evoluído para suportar variações naturais sem código explícito quando existe um único contato ativo inequívoco, o fluxo textual apresenta limitações inerentes de usabilidade e segurança operacional:
1. **Fricção Cognitiva e Erros de Digitação:** Exigir que o usuário copie, cole ou digite códigos de 8 caracteres alfanuméricos aumenta a taxa de abandono e induz a erros de formatação.
2. **Ambiguidade em Atendimentos Simultâneos:** Quando um prestador atende múltiplos clientes no mesmo dia, qualquer inferência baseada em "último contato" ou texto solto (*"já terminei"*) introduz risco de vincular uma declaração ao contato incorreto.
3. **Padrão Moderno de Mensageria:** As interfaces oficiais de mensageria móvel (especialmente WhatsApp) suportam mensagens interativas com botões de resposta rápida (*Quick Reply Buttons*) e listas de seleção (*Interactive Lists*), que oferecem uma experiência amplamente superior e à prova de ambiguidades.

---

## Decisão

1. **Preservação do Código Público `CC-XXXXXXXX`:**
   * O código público `CC-XXXXXXXX` **permanece como elemento canônico** da plataforma para:
     * Identificador público legível em recibos e resumos de texto;
     * Referência para suporte ao cliente e atendimento a disputas operacionais;
     * Auditoria e rastreabilidade humana em logs e relatórios;
     * Mecanismo obrigatório de *fallback* textual em canais ou clientes sem suporte a mensagens interativas.

2. **Transição para Experiência Button-First / Action-First:**
   * O código público **não será** o mecanismo primário de interação do usuário uma vez que os componentes interativos estejam disponíveis no canal.
   * A interface primária no WhatsApp passa a ser baseada em botões de ação nativos:
     * **Para o Profissional:** `[Concluído]`, `[Não consigo atender]`.
     * **Para o Cliente:** `[Confirmar]`, `[Contestar]`.
     * **Ações Futuras:** `[Avaliar]`, `[Ver detalhes]`, `[Escolher profissional]`.

3. **Vinculação Estrita de Ações ao Agregado de Domínio:**
   * Cada ação interativa gerada pelo sistema **deve estar amarrada deterministicamente ao agregado de negócio específico** (contato, evento de conclusão ou solicitação de busca).
   * É expressamente proibido inferir o alvo de uma ação interativa a partir de:
     * "Último contato criado" ou "última mensagem trocada";
     * Contexto conversacional volátil em memória;
     * Apenas o número de telefone do remetente;
     * O texto visível do botão (*button label*).

4. **Conceito Arquitetural: Tokens de Ação Opacos (*Opaque Action Tokens*):**
   * Cada botão de resposta interativa carregará como identificador de payload um token opaco de alta entropia.
   * A resolução do token no servidor mapeia de forma atômica e segura:
     * Tipo de ação pretendida (ex.: `confirm_completion`, `declare_unavailability`);
     * Identificador do agregado de domínio alvo (`contact_id`, `completion_id`, etc.);
     * Papel esperado do ator (`customer` ou `professional`);
     * Identidade e telefone autorizados do destinatário;
     * Estado de validade temporal e ciclo de vida do token.
   * **Privacidade e Segurança:** UUIDs brutos de banco de dados e dados pessoais sensíveis não devem ser expostos diretamente no payload do botão.

5. **Isolamento e Segurança em Múltiplos Contatos Simultâneos:**
   * Um profissional que possua múltiplos atendimentos em andamento receberá mensagens distintas para cada cliente, cada qual com seus próprios botões e tokens de ação independentes:
     * Mensagem Cliente A / Contato A $\rightarrow$ Botão `[Concluído]` (Token A) $\rightarrow$ Afeta exclusivamente o Contato A.
     * Mensagem Cliente B / Contato B $\rightarrow$ Botão `[Concluído]` (Token B) $\rightarrow$ Afeta exclusivamente o Contato B.
   * Não existirá qualquer ambiguidade de "contato corrente".

6. **Autorização Rígida no Servidor (*Server-Side Verification*):**
   * Ao receber o evento de clique/resposta interativa:
     1. Identificar o remetente via telefone E.164 verificado;
     2. Resolver o token opaco de ação no banco de dados;
     3. Validar se o remetente é o ator autorizado para aquele token e papel;
     4. Validar se o agregado de domínio alvo ainda aceita aquela transição de estado;
     5. Executar a transição atômica no banco de dados com locks relacionais adequados.

7. **Garantia Estrita de Idempotência:**
   * Redirecionamentos, retries de webhook ou cliques repetidos pelo usuário **não podem** duplicar eventos de conclusão, contestação, indisponibilidade ou notificações.
   * O sistema deve tratar execuções repetidas do mesmo token de forma idempotente, retornando a confirmação de recebimento sem reprocessar mutações de negócio.

8. **Preservação Integral do Fallback Textual:**
   * Caso o transporte interativo falhe, o cliente de mensageria do usuário não suporte botões ou o usuário prefira digitar, os comandos textuais existentes (`confirmar CC-...`, `contestar CC-...`, `concluído CC-...`, `não consigo CC-...`) continuam em plena operação como camada de tolerância a falhas.

9. **Abstração de Transporte e Contratos Neutros:**
   * O domínio da aplicação e a camada de serviços **não devem depender** da estrutura JSON específica de payloads da Evolution API ou da Meta.
   * A arquitetura adotará contratos neutros de domínio (ex.: `InteractiveAction`, `InteractiveActionMessage`, `InteractiveActionResponse`).
   * O adaptador de transporte específico (*Transport Adapter*) será o único responsável por traduzir essas estruturas para os formatos do provedor em uso.

10. **Capacidades Oficiais da WhatsApp Cloud API:**
    * Fica registrado como capacidade externa verificada que a WhatsApp Cloud API oficial da Meta suporta nativamente mensagens interativas (*interactive reply buttons* e *list messages*), atribuindo IDs únicos a cada botão e retornando esses identificadores estruturados nos webhooks de entrega e resposta.

11. **Estratégia de Integração e Provedores:**
    * A Evolution API é o componente de transporte vigente do ContatoCerto.
    * A escolha entre:
      * **Opção A:** Evolution API operando com o driver oficial WhatsApp Cloud API; ou
      * **Opção B:** Integração direta com a WhatsApp Cloud API da Meta sem intermediários,
      será objeto de uma análise técnica e operacional dedicada em momento oportuno, avaliando estabilidade de rede, latência, custos operacionais e facilidade de manutenção.

---

## Realidade Operacional da Evolution API (Alerta Arquitetural)

> [!WARNING]
> **Compatibilidade de Recursos entre Drivers na Evolution API:**
> Embora a Evolution API suporte instâncias baseadas tanto em Baileys quanto na API oficial da Meta (Cloud API), o mapeamento de campos específicos de mensagens interativas (cabeçalhos, rodapés, seções de botões) pode apresentar variações entre versões e drivers instalados.
> 
> Antes de habilitar o modo *Button-First* em produção:
> 1. Deve-se realizar homologação funcional na versão exata da Evolution API implantada no EasyPanel;
> 2. Não assumir paridade idêntica de campos sem validação em ambiente de staging;
> 3. Manter os contratos de domínio 100% agnósticos ao provedor de mensageria.
> 
> Essa observação representa uma salvaguarda preventiva de engenharia e **não constitui um bug ou defeito** da implementação atual do ContatoCerto.

---

## Diretrizes de Segurança dos Tokens de Ação

* **Proibição de Padrões Adivinháveis:** É expressamente proibido construir identificadores no formato `contact:<uuid>:confirm` ou qualquer esquema sequencial/previsível.
* **Tokens de Alta Entropia:** Os tokens devem ser gerados com aleatoriedade criptograficamente segura (ex.: strings base64url de 128+ bits ou hashes HMAC assinados).
* **Definições para a Fase de Implementação:** A especificação técnica de engenharia que implementar esta decisão definirá:
  * Mecanismo de persistência versus assinatura estática (HMAC com secret/pepper);
  * TTL e políticas de revogação/expiração de tokens;
  * Auditoria de ciclo de vida de tokens e deduplicação de webhooks de entrada.

---

## Consequências

### Positivas
* **Experiência do Usuário Fluida e Moderna:** Elimina a necessidade de memorização ou digitação de códigos em conversas no WhatsApp.
* **Eliminação de Erros de Entrada:** Botões evitam erros de digitação, ambiguidades ortográficas e falhas de formatação de código.
* **Segurança Robusta em Cenários Concorrentes:** Vinculação estrita via token elimina totalmente o risco de ações acidentais em contatos errados de profissionais com múltiplos atendimentos simultâneos.
* **Resiliência e Continuidade Operacional:** Manutenção do suporte a comandos textuais como fallback garante que nenhum usuário fique bloqueado por incompatibilidade de cliente.

### Negativas / Compromissos / Trade-offs
* **Necessidade de Camada de Abstração:** Exige desenvolvimento e manutenção de adaptadores de transporte desacoplados para mensagens interativas.
* **Gerenciamento de Estado de Tokens:** Requer armazenamento ou validação criptográfica de tokens no backend com tratamento de concorrência e idempotência.
* **Dependência de Recursos do Provedor de Mensageria:** Exige homologação cuidadosa da versão do provedor de mensageria para assegurar a entrega consistente dos componentes de botões.
