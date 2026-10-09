# Relatório de Conclusão: Homologação em Produção Real do Cenário T29

**Cenário:** T29 — Preservação e Retomada de Busca com Outra Busca Ativa  
**Status:** CLOSED / PASS  
**Data da Homologação em Produção:** 2026-10-09  
**Ambiente:** Produção Real (Evolution API / Meta Cloud API / n8n Gateway / ContatoCerto API & PostgreSQL)  
**Branch / Base:** `main` @ `8df941b19ef0f94425ca79fdcfb4557b7e479faa` (após PR #43)  
**Bloqueadores:** NENHUM  

---

## 1. Sumário Executivo

Este documento encerra formalmente a homologação em ambiente de produção real do cenário residual **T29 ("Preservação / Retomada de Busca com Outra Busca Ativa")**, completando a matriz de validação do ciclo de conexão bilateral e gerenciamento de contexto conversacional do **ContatoCerto**.

O cenário T29 comprova que o sistema preserva de forma estrita e atômica o invariante de contexto único ativo (`ONLY_ONE_ACTIVE_CONTEXT = YES`) quando ocorrem eventos assíncronos de indisponibilidade profissional:
1. Quando um profissional declara indisponibilidade em uma busca anterior (Busca A) e o cliente já iniciou e mantém uma busca posterior ativa (Busca B), a Busca B **não é sobrescrita nem corrompida**.
2. A Busca A é associada a um código de retomada e mantida em espera sem reativação preemptiva desordenada.
3. O cliente é notificado de que sua busca atual prossegue normalmente e recebe instrução explícita de comando para retomar a busca anterior se assim desejar (`retomar <código>`).
4. Ao enviar o comando de retomada, o sistema realiza uma troca de contexto atômica e segura: a Busca B é salva/suspensa com seu próprio código de retomada, e a Busca A é restaurada como a única conversa ativa no slot de seleção (`pending_slot = 'selection'`).

Com a execução e auditoria em produção realizadas em 2026-10-09, **o cenário residual T29 está formalmente homologado e fechado (`CLOSED / PASS`)**.

---

## 2. Semântica Canônica e Regras de Negócio

Conforme a arquitetura canônica e o módulo de domínio (`professional-unavailability.domain.ts`):
* **TTL Conversacional:** O ciclo de vida de uma sessão de conversa é controlado por `SEARCH_CONVERSATION_TTL_MINUTES = 30`.
* **Condição de Retomada com Outra Busca Ativa:**
  * A conversa de seleção associada ao contato recusado deve ser válida no relógio do banco (`expires_at > NOW()`).
  * Uma segunda conversa de busca associada ao mesmo cliente deve estar ativa e dentro do TTL (`status = 'active' AND expires_at > NOW()`).
  * Verificadas ambas as condições, a busca concorrente permanece ativa, a busca anterior recebe `resume_slot = 'selection'` e `resume_code = contact.public_code`, e o cliente recebe texto instruindo a continuidade da busca concorrente e o comando de retorno.
* **Tratamento de Sessão Expirada:** Caso a busca original tenha excedido o TTL de 30 minutos, o domínio determina que sessões expiradas não sejam ressuscitadas, enviando notificação de busca expirada com convite para início de nova pesquisa (`EXPECTED_EXPIRED_PRIOR_SEARCH_BRANCH`).

---

## 3. Classificação das Tentativas (Attempt #1 vs. Attempt #2)

### A. Tentativa #1 (Fixture Expirada — 2026-10-09 Manhã)
* **Contexto:** Buscas A e B criadas na madrugada (~00:30–00:58 UTC). Ação de recusa executada pelo operador às 11:47 UTC (~11 horas após criação).
* **Resultado Observado:** Cliente recebeu:
  > *"O profissional informou que não poderá atender a solicitação de Eletricista, código CC-85L86W5F. A busca anterior expirou. Você pode iniciar uma nova busca de Eletricista em Sinop / MT."*
* **Classificação Técnica:** `EXPECTED_EXPIRED_PRIOR_SEARCH_BRANCH` (NÃO é falha de produto).
* **Justificativa:** Ambas as conversas haviam superado o TTL de 30 minutos (`SEARCH_A_EXPIRED_BY_MINUTES = 647.87`, `SEARCH_B_EXPIRED_BY_MINUTES = 619.45`). O código avaliou `conversation.valid = false`, exercitando de forma 100% determinística a proteção contra restauração de sessões expiradas.

### B. Tentativa #2 (Ensaio E2E Real Válido — 2026-10-09 Manhã)
* **Contexto:** Fluxo completo executado contiguamente em ~8 minutos (dentro da janela segura de 30 minutos).
* **Resultado Observado:** Recusa processada com preservação da busca concorrente, entrega de comando de retorno, envio de comando pelo cliente e restauração da Busca A no slot de seleção com suspensão da Busca B.
* **Classificação Técnica:** `T29_REAL_E2E_RESULT = PASS`.

---

## 4. Evidências Autorizadas de Produção Real (Tentativa #2)

### A. Entidades e Identificadores das Buscas
* **Busca A:**
  * `SEARCH_A_CONVERSATION_ID`: `450ba090-ffc0-4e16-903c-e81dae33bbfc`
  * `SEARCH_A_REQUEST_ID`: `08960d5f-733c-4740-8488-3fed6e27d062`
  * `PUBLIC_CODE`: `CC-3SXZCVE8`
  * `CREATED_AT`: `2026-10-09T11:54:17.985167Z`
  * `EXPIRES_AT`: `2026-10-09T12:24:17.985167Z`
  * **Estado Final (Pós-Retomada):** `status = active`, `pending_slot = selection`, `resume_slot = NULL`, `resume_code = CC-3SXZCVE8`, `completed_at = NULL`.
* **Contato A:**
  * `CONTACT_ID`: `a6cc997d-89e2-462a-b7de-eec2dfc24e9c`
  * `PROFESSIONAL_ID`: `3a4c8330-a68e-4b18-b70e-3700330c0413` (Richard)
  * `STATUS`: `shared` (não-destrutivo)
* **Busca B:**
  * `SEARCH_B_CONVERSATION_ID`: `2da79047-f0cd-4c5a-b1f6-51b6c392e2bd`
  * `CREATED_AT`: `2026-10-09T11:55:32.304511Z`
  * `EXPIRES_AT`: `2026-10-09T12:25:32.304511Z`
  * **Estado Final (Pós-Retomada):** `status = completed`, `pending_slot = NULL`, `resume_slot = location`, `resume_code = CC-N6BXRNT8`, `completed_at = 2026-10-09T12:02:45.873188Z`.

### B. Evidência de Recusa / Declaração de Indisponibilidade
* **Inbound da Recusa:**
  * `INBOUND_ID`: `68712ecc-c3c6-481f-9cfa-fc136e209ecd`
  * `DECLINE_INBOUND_AT`: `2026-10-09T11:57:14.629912Z`
  * `PROVIDER_MESSAGE_ID`: `contato-certo-oficial:wamid.HBgMNTU2NjkyNTY5MTI5FQIAEhgWM0VCMEZENDBENUFCODU3NkQ3MzAwRAA=`
  * `RAW_TEXT`: `"Não consigo atender"`
* **Token Interativo Consumido:**
  * `ACTION_ID`: `d5bf1e85-8940-415c-8143-5851628c65c1`
  * `ACTION_TYPE`: `declare_unavailability`
  * `STATUS`: `consumed` (`consumed_at = 2026-10-09T11:57:14.695623Z`)
* **Evento Imutável de Indisponibilidade:**
  * `UNAVAILABILITY_EVENT_ID`: `0584c353-94af-4269-a0c8-4463bfb5daa5`
  * `CREATED_AT`: `2026-10-09T11:57:14.654495Z`
  * `UNAVAILABILITY_EVENT_COUNT_FOR_CONTACT`: `1`
* **Notificação de Atualização Despachada ao Cliente:**
  * `DECLINE_CUSTOMER_OUTBOUND_ID`: `418678be-0adf-484c-b6a5-70e1c8c654be`
  * `PURPOSE`: `customer_contact_update`
  * `STATUS`: `sent`
  * `PROVIDER_MESSAGE_ID`: `wamid.HBgMNTU5OTg0MTE5MDcwFQIAERgSRjM5Rjg4RTQzNEYwNzY5NUE3AA==`
  * `TEXTO`: *"O profissional informou que não poderá atender a solicitação de Eletricista, código CC-3SXZCVE8. Sua busca atual por Eletricista continua normalmente. Para voltar à solicitação anterior, envie “retomar CC-3SXZCVE8”."*

### C. Evidência de Retomada pelo Cliente (Context Swap)
* **Inbound de Retomada do Cliente:**
  * `RESUME_INBOUND_ID`: `c3ba57e6-63b8-42a7-ba30-bda98dc757b8`
  * `RESUME_INBOUND_AT`: `2026-10-09T12:02:45.842395Z`
  * `RAW_TEXT`: `"retomar CC-3SXZCVE8"`
  * `STATUS`: `processed`
  * `ROUTE`: `opportunity`
  * `RESULT_KIND`: `resumed`
* **Outbound de Resposta ao Cliente:**
  * `RESUME_OUTBOUND_ID`: `9c6507a6-dbe1-4894-a02b-689030e92177`
  * `PURPOSE`: `customer_reply`
  * `STATUS`: `sent`
  * `PROVIDER_MESSAGE_ID`: `wamid.HBgMNTU5OTg0MTE5MDcwFQIAERgSMjNFRDBFMTk0QTcxMjhFMjU1AA==`
  * `TEXTO`: *"Retomamos sua busca de Eletricista. Escolha outra opção apresentada ou peça ‘mostrar mais’. A outra busca ficou salva. Para voltar a ela, envie “retomar CC-N6BXRNT8”.*

### D. Comprovação Temporal de Validade do TTL
* **No momento da recusa do profissional (`11:57:14Z`):**
  * `SEARCH_A_VALID_AT_DECLINE = YES` (criada às `11:54:17Z`, restavam ~27 min de TTL).
  * `SEARCH_B_VALID_AT_DECLINE = YES` (criada às `11:55:32Z`, restavam ~28 min de TTL).
* **No momento do comando de retomada do cliente (`12:02:45Z`):**
  * `SEARCH_A_VALID_AT_RESUME = YES` (restavam ~21,5 min de TTL).
  * `SEARCH_B_VALID_AT_RESUME = YES` (restavam ~22,7 min de TTL).
* **Tempo Total Transcorrido:** Menos de 9 minutos desde a criação da Busca A até a retomada final.

---

## 5. Matriz de Invariantes Comprovados

| Invariante | Descrição | Status |
| :--- | :--- | :---: |
| **Invariante 1** | A Busca B sobreviveu intacta à recusa profissional ocorrida na Busca A | **PASS** |
| **Invariante 2** | A Busca A tornou-se explicitamente retomável através do seu código público (`CC-3SXZCVE8`) | **PASS** |
| **Invariante 3** | A Busca B permaneceu como a única conversa ativa do cliente antes do comando de retomada | **PASS** |
| **Invariante 4** | A retomada explícita preservou a Busca B em vez de descartá-la | **PASS** |
| **Invariante 5** | A Busca B recebeu `resume_slot = 'location'` e código de retomada dedicado (`CC-N6BXRNT8`) | **PASS** |
| **Invariante 6** | A Busca A foi reativada com `status = 'active'` e `pending_slot = 'selection'` | **PASS** |
| **Invariante 7** | Exatamente uma conversa permaneceu ativa após a troca de contexto (`ACTIVE_CONVERSATION_COUNT = 1`) | **PASS** |
| **Invariante 8** | O Contato A original permaneceu com `status = 'shared'` (imutabilidade de conexões já compartilhadas) | **PASS** |
| **Invariante 9** | Exatamente um evento imutável `professional_unavailability_events` foi registrado para o contato | **PASS** |
| **Invariante 10** | Nenhum contato duplicado foi gerado durante o fluxo (`CONTACTS_FOR_SEARCH_A_COUNT = 1`) | **PASS** |
| **Invariante 11** | O transporte real do WhatsApp entregou com sucesso a notificação de recusa com instruções de retomada | **PASS** |
| **Invariante 12** | O transporte real do WhatsApp entregou com sucesso a confirmação de retomada e o código da busca salva | **PASS** |

---

## 6. Classificação de Mutações de Produção

As mutações ocorridas durante este ensaio em produção foram exclusivamente mutações normais de caminho de produto geradas por interações manuais autorizadas de ponta a ponta via WhatsApp:
* Criação de conversas de busca (`search_conversations`) e requisição de busca (`search_requests`);
* Criação e atualização de contatos (`contacts`);
* Registro de mensagens de entrada (`channel_inbound_messages`) e saída (`channel_outbound_messages`);
* Consumo de token de ação interativa (`interactive_action_tokens`);
* Registro append-only de evento de indisponibilidade (`professional_unavailability_events`);
* Disparo real de mensagens de teste via WhatsApp.

**Garantias Operacionais Verificadas:**
* Nenhuma mutação manual via SQL administrativo foi realizada no banco de dados.
* Nenhuma alteração foi realizada nos workflows do n8n.
* Nenhuma alteração de configuração na Evolution API, Meta Cloud API ou EasyPanel.
* Nenhuma alteração de variáveis de ambiente (`ENV`).
* A auditoria final de evidências foi conduzida em modo estritamente somente-leitura (**READ-ONLY**).

---

## 7. Decisão de Homologação

```text
T29_REAL_E2E_RESULT=PASS
T29_PRODUCTION_HOMOLOGATED=YES
LAUNCH_READINESS_T29_RESIDUAL=CLOSED
```

Com este encerramento formal, a matriz de cobertura em produção real cobre:
1. **Happy Path:** Busca, apresentação, seleção e entrega bilateral (Golden E2E #2).
2. **Indisponibilidade Profissional com Reescolha na Mesma Busca:** Subfluxo direto de T29 (2026-10-01).
3. **Conclusão e Contestação Bilateral:** Declaração e contestação de atendimento (T34, 2026-10-01).
4. **Contexto Expirado:** Seleção tardia contra lista expirada com fast-path determinístico (T18, 2026-10-02).
5. **Ações Interativas Button-First:** Templates oficiais da Meta com Quick Reply e conclusão bilateral via botões rápidos (WP6.9 / Gate B, 2026-10-08).
6. **Preservação e Retomada com Outra Busca Ativa:** Context swap completo e coexistência de buscas salvas (T29 Completo, 2026-10-09).
