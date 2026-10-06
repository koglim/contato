# ADR-006: Ações Interativas e Experiência Button-First no WhatsApp

* **Status:** ACCEPTED / NOT YET IMPLEMENTED
* **Data:** 2026-10-02
* **Decisores:** Produto e Arquitetura ContatoCerto

---

> [!NOTE]
> **Direcionamento de Arquitetura e Experiência de Mensageria:**
> Este documento formaliza o direcionamento de arquitetura para a transição do modelo conversacional baseado exclusivamente em texto para uma experiência interativa prioritariamente baseada em botões e componentes visuais (*Button-First / Interactive Actions*) no WhatsApp. A Evolution API permanece como a camada de integração de mensageria vigente. Nenhuma migração de transporte ou alteração de código de execução é realizada no escopo deste documento.

---

## Contexto

Na arquitetura atual do ContatoCerto, as ações operacionais e transacionais no canal WhatsApp são suportadas por comandos de texto determinísticos estruturados em torno de um código público humanamente legível (`CC-XXXXXXXX`):

* **Profissional:** `não consigo CC-XXXXXXXX` (indisponibilidade), `concluído CC-XXXXXXXX` (declaração de conclusão), `confirmar CC-XXXXXXXX` (confirmação).
* **Cliente:** `concluído CC-XXXXXXXX` (declaração de conclusão), `confirmar CC-XXXXXXXX` (confirmação), `contestar CC-XXXXXXXX` (contestação).

Embora o parser conversacional e a camada de inteligência contextual tenham evoluído para suportar variações naturais sem código explícito quando existe um único contato ativo inequívoco, o fluxo textual apresenta limitações inerentes de usabilidade e segurança operacional:
1. **Fricção Cognitiva e Erros de Digitação:** Exigir que o usuário copie, cole ou digite códigos de 8 caracteres alfanuméricos aumenta a taxa de abandono e induz a erros de formatação.
2. **Ambiguidade em Atendimentos Simultâneos:** Quando um prestador atende múltiplos clientes no mesmo dia, qualquer inferência baseada em "último contato" ou texto solto (*"já terminei"*) introduz risco de vincular uma declaração ao contato incorreto.
3. **Padrão Moderno de Mensageria:** As interfaces oficiais de mensageria móvel (especialmente WhatsApp) suportam mensagens interativas com botões de resposta rápida (*Quick Reply Buttons*) e listas de seleção (*Interactive Lists*), que oferecem uma experiência mais fluida e reduzem a ambiguidade de interação.

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
     * **Ações Futuras (pós-v1):** `[Avaliar]`, `[Ver detalhes]`, `[Escolher profissional]`.

3. **Vinculação Estrita de Ações ao Agregado de Domínio:**
   * Cada ação interativa gerada pelo sistema **deve estar amarrada deterministicamente ao agregado de negócio específico** (contato, evento de conclusão ou solicitação de busca).
   * É expressamente proibido inferir o alvo de uma ação interativa a partir de:
     * "Último contato criado" ou "última mensagem trocada";
     * Contexto conversacional volátil em memória;
     * Apenas o número de telefone do remetente;
     * O texto visível do botão (*button label*).

4. **Conceito Arquitetural: Tokens de Ação Opacos (*Opaque Action Tokens*):**
   * Cada botão de resposta interativa carregará como identificador de payload um token opaco de alta entropia.
   * O token público **não deve conter semântica legível** (proibido prefixar com tipo de ação ou papel, ex: `act_c_conf_...`), utilizando apenas um namespace genérico opaco (ex.: `ia_<opaque>`).
   * A resolução do token no servidor mapeia de forma atômica e segura:
     * Tipo de ação pretendida (ex.: `confirm_completion`, `declare_unavailability`);
     * Identificador do agregado de domínio alvo (`contact_id`, `completion_id`);
     * Papel esperado do ator (`customer` ou `professional`);
     * Identidade e telefone autorizados do destinatário;
     * Estado de validade temporal e ciclo de vida do token.
   * **Privacidade e Segurança:** UUIDs brutos de banco de dados e dados pessoais sensíveis não são expostos no payload do botão.

5. **Isolamento e Segurança em Múltiplos Contatos Simultâneos:**
   * Um profissional que possua múltiplos atendimentos em andamento receberá mensagens distintas para cada cliente, cada qual com seus próprios botões e tokens de ação independentes:
     * Mensagem Cliente A / Contato A $\rightarrow$ Botão `[Concluído]` (Token A) $\rightarrow$ Afeta exclusivamente o Contato A.
     * Mensagem Cliente B / Contato B $\rightarrow$ Botão `[Concluído]` (Token B) $\rightarrow$ Afeta exclusivamente o Contato B.
   * Não existirá qualquer ambiguidade de "contato corrente".

6. **Autorização Rígida no Servidor (*Server-Side Verification*):**
   * Ao receber o evento de clique/resposta interativa:
     1. Identificar o remetente via equivalência canônica de telefone brasileiro E.164;
     2. Resolver o token opaco de ação no banco de dados com lock transacional;
     3. Validar se a mensagem outbound de origem possui status `'sent'`;
     4. Validar se o remetente é o ator autorizado para aquele token e papel;
     5. Validar se o agregado de domínio alvo ainda aceita aquela transição de estado;
     6. Executar a transição atômica no banco de dados com locks relacionais adequados.

7. **Garantia Estrita de Idempotência:**
   * Redirecionamentos, retries de webhook ou cliques repetidos pelo usuário **não podem** duplicar eventos de conclusão, contestação, indisponibilidade ou notificações.
   * Distinção clara entre:
     * **Token Consumido:** Registro transacional de resgate do token físico;
     * **Ação de Domínio Já Aplicada:** Reconhecimento pelo agregado de domínio de que o estado terminal pretendido já foi alcançado, retornando mensagem informativa sem criar novos eventos no ledger.

8. **Preservação Integral do Fallback Textual:**
   * Caso o transporte interativo falhe, o cliente de mensageria do usuário não suporte botões ou o usuário prefira digitar, os comandos textuais existentes (`confirmar CC-...`, `contestar CC-...`, `concluído CC-...`, `não consigo CC-...`) continuam em plena operação como camada de tolerância a falhas.

9. **Abstração de Transporte e Contratos Neutros:**
   * O domínio da aplicação e a camada de serviços **não dependem** da estrutura JSON específica de payloads da Evolution API ou da Meta.
   * A arquitetura adota contratos neutros de domínio (`InteractiveOutboundPayload`, `InteractiveAction`).
   * O adaptador de transporte específico (*Transport Adapter* no n8n) é o único responsável por traduzir essas estruturas para os formatos do provedor em uso.

10. **Capacidades Oficiais da WhatsApp Cloud API:**
    * Fica registrado como capacidade externa verificada que a WhatsApp Cloud API oficial da Meta suporta mensagens interativas com *reply buttons* e *list messages*. Os botões carregam identificadores definidos pelo integrador, e a interação selecionada é retornada de forma estruturada no webhook de resposta do usuário.

11. **Estratégia de Integração e Provedores:**
    * A Evolution API é o componente de transporte vigente do ContatoCerto (`DOMAIN_EVOLUTION_COUPLING = PARTIAL`).
    * A escolha entre Evolution API gerenciando Cloud API ou integração direta com a Meta Graph API será homologada em momento oportuno.

---

## Contrato de Implementação v1 (*Implementation Contract v1*)

Esta seção estabelece as especificações canônicas para a engenharia do WP6 e da Migration 028:

### 1. Escopo Estrito da v1 (Ações Pós-Conexão)
O escopo da v1 de Ações Interativas limita-se estritamente ao ciclo de vida pós-conexão bilateral:
* **Profissional:**
  * `declare_completion` $\rightarrow$ Botão `[Concluído]`
  * `declare_unavailability` $\rightarrow$ Botão `[Não consigo atender]`
* **Cliente:**
  * `confirm_completion` $\rightarrow$ Botão `[Confirmar]`
  * `contest_completion` $\rightarrow$ Botão `[Contestar]`

*Nota sobre Pré-Conexão:* A seleção interativa de profissionais na busca (`[Escolher profissional]`) **não faz parte** do escopo da Migration 028 e permanece como capacidade futura planejada, pois tokens v1 exigem `contact_id` relacional obrigatório.

### 2. Validade Temporal e Domínio (Desacoplamento de ADR-005)
* A validade de um token de ação é governada conjuntamente por:
  1. **Política Temporal de Expiração:** Campo `expires_at` do token;
  2. **Autoridade de Estado do Domínio:** Validação em tempo real do estado do contato/conclusão na mesma transação.
* **Independência de ADR-005:** Os tokens interativos **não herdam** a janela de 24 horas (1440 minutos) do ADR-005. O TTL de cada tipo de ação permanece como decisão aberta de produto/implementação (ex.: "Concluído" pode ser válido por dias após a conexão; "Confirmar" é válido enquanto a conclusão estiver pendente).

### 3. Modelo Outbound de Domínio (Opção A)
* **Tabela `channel_outbound_messages`:**
  * `message_type VARCHAR(32) NOT NULL DEFAULT 'text'`
  * `text_content TEXT NOT NULL CHECK (length(text_content) BETWEEN 1 AND 2000)` (texto canônico de fallback e auditoria)
  * `interactive_payload JSONB NULL`
  * **Constraint SQL:**
    ```sql
    CHECK (
      (message_type = 'text' AND interactive_payload IS NULL)
      OR (message_type = 'interactive' AND interactive_payload IS NOT NULL)
    )
    ```
* **Schema de Payload Provider-Neutral (`schema_version: 1`):**
  ```json
  {
    "schema_version": 1,
    "type": "button_group",
    "body": "Texto da notificação para o usuário.",
    "actions": [
      {
        "action_id": "ia_7f9a1b2c3d4e5f6a7b8c9d0e",
        "label": "Confirmar"
      }
    ]
  }
  ```
  *Rótulos representam apresentação visual; `action_id` representa identidade transacional. Payloads específicos de transporte (Evolution/Meta) são proibidos no domínio.*

### 4. Modelo Inbound de Domínio (Opção B)
* **Tabela `channel_inbound_messages`:**
  * `raw_text TEXT NOT NULL` (mantido preenchido pelo gateway para auditoria e compatibilidade)
  * `interactive_action_id VARCHAR(120) NULL`
  * **Índice:** `CREATE INDEX channel_inbound_messages_action_id_idx ON channel_inbound_messages(interactive_action_id) WHERE interactive_action_id IS NOT NULL;`
* **Autoridade Decisória:** Quando `interactive_action_id` estiver presente, a autoridade de negócio deriva exclusivamente da resolução atômica do token no banco. O texto do rótulo (`raw_text`) **nunca toma decisões de domínio**.

### 5. Tabela de Tokens de Ação (`interactive_action_tokens`)
* **Estrutura SQL Proposta na Migration 028:**
  ```sql
  CREATE TABLE interactive_action_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_token VARCHAR(120) NOT NULL UNIQUE,
    action_type TEXT NOT NULL,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
    completion_id UUID REFERENCES contact_completions(id) ON DELETE RESTRICT,
    intended_actor_role TEXT NOT NULL CHECK (intended_actor_role IN ('customer', 'professional')),
    intended_phone_e164 VARCHAR(32) NOT NULL CHECK (intended_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    outbound_message_id UUID NOT NULL REFERENCES channel_outbound_messages(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'revoked', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    consumed_inbound_id UUID UNIQUE REFERENCES channel_inbound_messages(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
      (status = 'consumed' AND consumed_at IS NOT NULL AND consumed_inbound_id IS NOT NULL)
      OR (status <> 'consumed' AND consumed_at IS NULL AND consumed_inbound_id IS NULL)
    ),
    CHECK (
      (action_type = 'confirm_completion' AND completion_id IS NOT NULL AND intended_actor_role = 'customer')
      OR (action_type = 'contest_completion' AND completion_id IS NOT NULL AND intended_actor_role = 'customer')
      OR (action_type = 'declare_completion' AND completion_id IS NULL AND intended_actor_role = 'professional')
      OR (action_type = 'declare_unavailability' AND completion_id IS NULL AND intended_actor_role = 'professional')
    )
  );

  CREATE INDEX interactive_action_tokens_contact_idx
    ON interactive_action_tokens(contact_id, action_type, status);

  CREATE INDEX interactive_action_tokens_expiry_idx
    ON interactive_action_tokens(status, expires_at)
    WHERE status = 'active';
  ```

### 6. Consistência entre Contato e Conclusão Alvo
* Para qualquer token onde `completion_id IS NOT NULL`, o consumo do token deve obrigatoriamente travar e verificar na mesma transação:
  * `contact_completions.id = token.completion_id`
  * `contact_completions.contact_id = token.contact_id`
* É expressamente proibido permitir que um token com `contact_id = Contato A` aponte ou atue sobre um `completion_id` pertencente a um `Contato B`.

### 7. Invariante de Ação Condicionada a Outbound Enviado
* Um token só é acionável quando seu outbound de origem estiver com `status = 'sent'`.
* Durante a validação transacional do token, o sistema verifica obrigatoriamente:
  1. `channel_outbound_messages.id = token.outbound_message_id`
  2. `channel_outbound_messages.status = 'sent'`
  3. O destinatário registrado no outbound corresponde à identidade do ator autorizado.
* Tokens vinculados a mensagens outbound pendentes, em processamento, com falha ou em qualquer estado diferente de `status = 'sent'` são rejeitados.

### 8. Autorização por Identidade Telefônica Canônica
* A autorização do remetente utiliza a autoridade existente no repositório (`normalizeBrazilianMobilePhone`, `getPhoneIdentityAliases`, `arePhoneIdentitiesEquivalent`).
* O telefone validado do remetente deve conferir simultaneamente com:
  * `token.intended_phone_e164`
  * O snapshot bilateral canônico gravado no contato (`contacts.bilateral_snapshot`).

### 9. Atomicidade de Criação e Consumo
* **Criação Atômica & Consistência de Conjunto:**
  * A aplicação gera os identificadores opacos de ação em memória;
  * O campo `interactive_payload.actions[]` contém exatamente esses identificadores;
  * As linhas correspondentes em `interactive_action_tokens` são inseridas na **mesma transação de banco de dados**, referenciando o mesmo `outbound_message_id`;
  * Nenhum outbound interativo comitado pode conter um `action_id` sem a respectiva linha autoritativa em `interactive_action_tokens`;
  * Nenhum token criado para aquele outbound pode referenciar um alvo divergente da especificação de ação produzida;
  * Se qualquer token falhar, a mensagem outbound é abortada.
* **Consumo Atômico:** A transição `status = 'consumed'` do token e a mutação do agregado de domínio (`contacts` / `contact_completions`) ocorrem na mesma transação atômica serializada.

### 10. Compartilhamento da Autoridade de Domínio
Os fluxos textuais existentes e os novos fluxos por botão interativo convergem para os **mesmos métodos transacionais de domínio**:
* `executeCompletionDeclaration(db, contact, actorRole, inboundId)`
* `executeCompletionConfirmation(db, contact, actorRole, inboundId)`
* `executeCompletionContestation(db, contact, actorRole, inboundId)`
* `executeUnavailabilityDeclaration(db, contact, professionalId, inboundId)`

Os parsers de texto e o validador de tokens atuam unicamente como camadas de extração/autorização; a mutação do domínio e a emissão de eventos permanecem compartilhadas através da mesma autoridade transacional de domínio.

### 11. Proteção de Rollback na Migration 028 (`P0028`)
* O método `down()` da Migration 028 segue o padrão canônico de proteção contra perda de dados.
* Antes de reverter, a migration adquire locks em modo exclusivo e verifica a existência de dados interativos:
  ```sql
  LOCK TABLE
    interactive_action_tokens,
    channel_outbound_messages,
    channel_inbound_messages
  IN ACCESS EXCLUSIVE MODE;

  DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM interactive_action_tokens)
      OR EXISTS (SELECT 1 FROM channel_outbound_messages WHERE message_type = 'interactive' OR interactive_payload IS NOT NULL)
      OR EXISTS (SELECT 1 FROM channel_inbound_messages WHERE interactive_action_id IS NOT NULL)
    THEN
      RAISE EXCEPTION 'INTERACTIVE_ACTIONS_ROLLBACK_BLOCKED: interactive action records exist; manual data reconciliation required'
        USING ERRCODE = 'P0028';
    END IF;
  END $$;
  ```

### 12. Fronteira de Adaptadores n8n
* **Arquivos Canônicos:**
  * Gateway: `workflows/n8n/gateway.json` e `workflows/n8n/gateway-contract.mjs`
  * Delivery: `workflows/n8n/shared-delivery.json` e `workflows/n8n/delivery-contract.mjs`
* O acoplamento com a Evolution API é restrito a esses adaptadores de transporte (`DOMAIN_EVOLUTION_COUPLING = PARTIAL`). A API e o domínio desconhecem payloads específicos de provedor.

### 13. Sequência Canônica de Entrega (Work Packages)
1. **WP6.1 (Este PR):** Formalização do Contrato Canônico de Implementação (Documentação).
2. **WP6.2:** Migration 028 e Schemas Compartilhados no `@contatocerto/shared` (sem corte de runtime).
3. **WP6.3:** Extração dos métodos transacionais de domínio preservando os testes textuais verdes.
4. **WP6.4:** `ActionTokenService` e Inbox Dual-Path na API (testes de integração da API).
5. **WP6.5:** Adaptadores n8n (Gateway Inbound e Shared Delivery Outbound) com testes de contrato.
6. **WP6.6:** Validação funcional de capacidades do provedor e homologação controlada em produção.
7. **WP6.7:** *Canary Rollout Guard* fail-closed com controle bilateral de telefones permitidos antes da ativação global.

### 14. Salvaguarda de Rollout Canário Bilateral (*Canary Rollout Guard*)
* Para permitir a homologação de botões reais em produção sem expor clientes e profissionais não homologados, a emissão interativa é protegida por um mecanismo estrito *fail-closed*:
  * `INTERACTIVE_ACTIONS_ENABLED=true|false` (chave mestra).
  * `INTERACTIVE_ACTIONS_ROLLOUT_MODE=allowlist|all` (padrão: `allowlist`).
  * `INTERACTIVE_ACTIONS_ALLOWED_PHONES=<csv>` (lista de telefones E.164 autorizados).
* **Semântica Bilateral Mandatória:** No modo `allowlist`, a emissão interativa ocorre **somente se AMBOS** o cliente (`customer_phone_e164`) e o profissional (`professional_phone_e164`) estiverem na lista autorizada. Se qualquer um dos lados não pertencer à lista, o sistema reverte deterministicamente para mensagens de texto simples e zero tokens são gerados.
* **Processamento Inbound Não Bloqueado:** A camada de recepção e execução de tokens (`InteractiveActionService.handle()`) não é bloqueada pelo filtro de emissão, garantindo que qualquer token válido previamente emitido seja processado e consumido normalmente.

### 15. Transporte de Notificação ao Profissional via Template UTILITY (WP6.9)
* **Contexto Operacional e Janela de 24h da Meta:**
  * O primeiro contato da plataforma com um profissional ocorre quase invariavelmente fora de uma janela de serviço de 24 horas (*customer-service window*) iniciada por ele.
  * Mensagens normais de texto ou botões interativos livres (`interactive: button_group` via `/message/sendButtons`) são categorizadas como *service messages* e rejeitadas pela Cloud API da Meta fora da janela de 24h.
  * Para permitir a entrega legal e garantida do primeiro aviso ao profissional, a notificação deve ser enviada como um template de utilidade (*business-initiated message*).
* **Modelo Canônico de Template:**
  * Template registrado: `contato_certo_nova_solicitacao_v1` (idioma `pt_BR`, categoria `UTILITY`). Template submetido à Meta; a ativação operacional exige status APPROVED.
  * Corpo paramétrico: 5 variáveis obrigatórias `{{1}}` (serviço), `{{2}}` (região/local), `{{3}}` (solicitação/resumo), `{{4}}` (telefone do cliente) e `{{5}}` (referência pública).
  * Componentes interativos: 2 botões de resposta rápida (*Quick Reply*) com rótulos `Concluído` e `Não consigo atender`.
* **Preservação Estrita da Autoridade de Domínio:**
  * Os botões do template transmitem deterministicamente como `payload` o token de ação opaco `ia_<opaque>` de 48 caracteres hexadecimais:
    * Botão 0 (`Concluído`): `ia_<completion_token>`
    * Botão 1 (`Não consigo atender`): `ia_<unavailability_token>`
  * Nenhuma decisão de domínio baseia-se no texto visível do botão. Ao clicar, a resposta do webhook do WhatsApp Cloud API (`message.button`) entrega o payload para o n8n Gateway, que extrai o `ia_<opaque>` e o submete ao `InteractiveActionService` exatamente como nos fluxos de botões interativos normais.
* **Controle de Transporte Configurável e Fail-Safe:**
  * `PROFESSIONAL_OPPORTUNITY_TRANSPORT=buttons|template` (padrão: `buttons` para total compatibilidade retroativa e testes locais).
  * `WHATSAPP_PROFESSIONAL_OPPORTUNITY_TEMPLATE_NAME` (ex.: `contato_certo_nova_solicitacao_v1`).
  * `WHATSAPP_PROFESSIONAL_OPPORTUNITY_TEMPLATE_LANGUAGE` (ex.: `pt_BR`).
  * Quando configurado como `template`, a transação bilateral de contato emite payload `template_quick_reply` em `channel_outbound_messages.interactive_payload`, que o n8n Shared Delivery despacha via `/message/sendTemplate/{instance}`.

---

## Consequências

### Positivas
* **Experiência do Usuário Fluida e Moderna:** Elimina a necessidade de memorização ou digitação de códigos em conversas no WhatsApp.
* **Eliminação de Erros de Entrada:** Botões evitam erros de digitação, ambiguidades ortográficas e falhas de formatação de código.
* **Segurança Robusta em Cenários Concorrentes:** A vinculação estrita por token evita a ambiguidade de alvo entre múltiplos contatos simultâneos.
* **Resiliência e Continuidade Operacional:** Manutenção do suporte a comandos textuais como fallback garante que nenhum usuário fique bloqueado por incompatibilidade de cliente.
* **Arquitetura Provedor-Neutra:** O núcleo transacional é projetado para permanecer independente de schemas específicos de provedores (Evolution/Meta); a tradução de provedor fica restrita à fronteira do adaptador de transporte.

### Negativas / Compromissos / Trade-offs
* **Necessidade de Camada de Abstração:** Exige desenvolvimento e manutenção de adaptadores de transporte desacoplados para mensagens interativas no n8n.
* **Gerenciamento de Estado de Tokens:** Requer armazenamento relacional e validação atômica de tokens no backend com tratamento de concorrência e idempotência.
* **Dependência de Recursos do Provedor de Mensageria:** Exige homologação cuidadosa da versão do provedor de mensageria para assegurar a entrega consistente dos componentes de botões.
