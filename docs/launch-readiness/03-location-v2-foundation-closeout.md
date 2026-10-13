# Relatório de Conclusão e Homologação em Produção: Localização v2 — Fundação de Entrada

**Pacote de Trabalho:** Localização v2 — Fundação de Entrada (Pinos Nativos, Coordenadas Exatas e Memória Confirmada)  
**Status do Repositório:** REPOSITORY_IMPLEMENTATION_COMPLETE / MERGED INTO MAIN  
**Status de Produção:** PRODUCTION_HOMOLOGATED (5/5 CASES PASS)  
**Data de Fechamento do Repositório (PR #45):** 2026-10-10  
**Data de Homologação em Produção (PR #47 + E2E 5/5):** 2026-10-12  
**PRs Relacionados:** #45 (`feat/location-v2-foundation`), #46 (`docs/location-v2-foundation-closeout`), #47 (`fix/location-v2-contextual-native-pin-routing`)  
**Base / Ramo Canônico Atual (`main`):** `e2b434d01d8c0b84afe4455f8ea00d9e7f746cd7`  
**Commit de Merge da Fundação (PR #45):** `3c74fbba13d2d4879c8e8ca4ce472c4a9605ff61` (HEAD `762e9fdf2cf90823754a9a3cd40f10015bf53976`)  
**Commit de Merge da Correção de Interoperabilidade Contextual (PR #47):** `e2b434d01d8c0b84afe4455f8ea00d9e7f746cd7` (HEAD `43773a105be6a9f855fd8f874d0236de77740cf5`)  
**CI do PR #47 (HEAD Exato / Pós-Merge `main`):** Runs `38073973954` (SUCCESS) / `38076217454` (SUCCESS)  
**Migration de Banco de Dados:** 029 (`029_add_location_v2_foundation.js` — Ativa em Produção; Guard `P0029` acionado)  
**Arquitetura Canônica:** [ADR-007](../decisions/ADR-007-location-v2-native-pins-and-confirmed-memory.md)  
**Bloqueadores:** NENHUM  

---

## 1. Sumário Executivo

Este documento formaliza o encerramento completo — em repositório e em ambiente de produção real — do pacote de trabalho **Localização v2 — Fundação de Entrada**, implementado originalmente no **PR #45**, documentado no **PR #46**, aperfeiçoado na interoperabilidade determinística com o motor contextual no **PR #47** (`e2b434d01d8c0b84afe4455f8ea00d9e7f746cd7`) e homologado em produção real via WhatsApp em 5 de 5 cenários ponta a ponta (`LOCATION_V2_PRODUCTION_E2E=PASS`, `LOCATION_V2_PRODUCTION_HOMOLOGATED=YES`).

A fundação de Localização v2 entrega e comprova em operação real:
* Ingestão nativa de pinos de localização estática do WhatsApp (`message.locationMessage`) via Evolution API e n8n Gateway (`HwNYhTmAUT2NI7HW`);
* Cálculo espacial PostGIS com autoridade estrita das coordenadas geográficas reais do pino (sem substituição por centroides municipais ou geocodificação direta de rótulo);
* Geocodificação reversa exclusivamente para enriquecimento de metadados amigáveis (`"Cidade - UF"`);
* Memória durável da última localização do cliente (`customer_last_locations`) com confirmação explícita obrigatória antes do reuso (`location_confirmation`), zero reuso silencioso e zero chamadas LLM;
* Propriedade determinística de turno pelo `CustomerSearchRouter` sobre estados transacionais de Localização v2, impedindo interceptação pelo `ContextualConversationService`.

---

## 2. Capacidades Entregues e Ativas em Produção

1. **Ingestão Nativa de Pinos do WhatsApp:**
   * Reconhecimento determinístico de `message.locationMessage` e envelopes defensivos de localização no Gateway n8n (`gateway-contract.mjs` / workflow ativo `HwNYhTmAUT2NI7HW`).
   * Validação estrita de limites numéricos de latitude (-90 a +90) e longitude (-180 a +180).
   * Suporte a mensagens de pino puro (sem legenda ou texto de serviço) com `raw_text = null`.

2. **Dutos Estruturados e Fronteira de Privacidade:**
   * Admissão colunar estruturada na Inbox durável (`channel_inbound_messages.latitude`, `longitude`, `location_name`).
   * Minimização estrita de privacidade em conformidade com o ADR-007: nomes completos de ruas, logradouros residenciais e payloads brutos de provedor são descartados e **não** persistem como texto negocial de localização.

3. **Autoridade Estrita de Coordenadas Exatas:**
   * No matching espacial (`PostgresMatchingRepository`), as coordenadas reais do pino enviado pelo cliente são a autoridade máxima para o cálculo de raio e ordenação espacial.
   * As coordenadas reais **nunca** são substituídas por centroides de municípios ou distritos nem por forward geocoding de `"Cidade - UF"`.
   * O geocodificador reverso externo (`OpenRouteServiceGeocodingProvider.reverseGeocode`) é invocado apenas para enriquecimento contextual e exibição amigável (`"Cidade - UF"`), com fallback resiliente para rótulo padrão em caso de indisponibilidade de rede.

4. **Memória Durável de Última Localização (`customer_last_locations`):**
   * Armazenamento durável e seguro do último local de busca de cada cliente (`customer_id`), com isolamento por constraint única e registro canônico de proveniência (`whatsapp_native`, `text_resolved`, `memory_reuse`).
   * Atualizado tanto em cenários com profissionais encontrados (`matched`) quanto em buscas sem candidatos (`no_matches`).

5. **Confirmação Explícita Obrigatória (Zero Reuso Silencioso):**
   * Proibição categórica de reuso tácito ou involuntário de localização anterior.
   * Quando o cliente com memória salva inicia uma busca informando apenas o serviço, a conversa transiciona para o slot `location_confirmation` e solicita confirmação explícita (*"É para {label} novamente?..."*).
   * Parsing determinístico (ADR-002) sem LLM para respostas afirmativas, negativas, substituição por nova localidade ou esclarecimento.

6. **Substituição de Segundo Pino Pendente Serviço:**
   * Quando o cliente envia um primeiro pino (P1), entra no slot de espera de serviço (`pending_slot = 'service'`) e posteriormente envia um segundo pino (P2) antes do serviço, o manipulador `handleLocationPinWhileAwaitingService` substitui deterministicamente e integralmente o snapshot canônico da localização na mesma conversa e em `customer_last_locations`, sem preservar resíduos de P1.

7. **Interoperabilidade Determinística com Motor Contextual (PR #47):**
   * Quando `CONVERSATION_AI_ENABLED=true` está ativo em produção, o `ChannelInboxService` (`shouldRouterOwnTurn`) e o `DefaultCustomerSearchRouter.shouldOwnTurn` garantem que o `CustomerSearchRouter` detenha a propriedade determinística sobre: (Condição A) todo inbound contendo coordenadas nativas estruturadas (`latitude` + `longitude`); (Condição B) turnos em conversa ativa com `pending_slot = 'service'` e coordenadas de pino autoritativas já armazenadas; (Condição C) turnos em conversa ativa com `pending_slot = 'location_confirmation'`; e (Condição D) turnos service-first sem conversa ativa quando existe memória em `customer_last_locations`, o texto resolve um serviço e não há localização explícita no texto. Consequentemente, um pino nativo recebido enquanto a conversa está em `pending_slot = 'location'` é roteado deterministicamente pela Condição A (coordenadas estruturadas presentes no inbound atual), e não por `pending_slot = 'location'` isoladamente. No encadeamento do repositório de produção, `shouldOwnTurn` utiliza `findByPhoneE164` para a busca read-only do cliente antes de decidir a propriedade determinística do turno (mantendo fallback de compatibilidade para `findOrCreateByPhoneE164` apenas quando `findByPhoneE164` não estiver disponível na implementação do repositório).

8. **Proteção Transacional e Política de Rollback da Migration 029:**
   * Como o banco de dados de produção agora contém dados reais estruturados de Localização v2, a trava programática `P0029` (`LOCATION_V2_ROLLBACK_BLOCKED`) encontra-se ativamente engatilhada (`P0029_GUARD_CURRENTLY_TRIGGERED=YES`).
   * O rollback destrutivo da Migration 029 é estritamente proibido em produção (`PRODUCTION_MIGRATION_029_ROLLBACK=PROHIBITED`), vigorando exclusivamente a estratégia `FORWARD_FIX_ONLY`.

---

## 3. Matriz de Evidências Automatizadas

| Nível de Teste | Arquivo / Suíte | Resultado |
| :--- | :--- | :---: |
| **Contratos n8n / Workflows** | `workflows/n8n/gateway-contract.test.mjs` | 68/68 PASS |
| **Testes Unitários de Domínio e Inbox** | `customer-search.service.test.ts`, `channel-inbox.service.test.ts`, `search-conversation.service.test.ts`, `location-confirmation.parser.test.ts` | PASS |
| **Integração Real PostgreSQL / PostGIS (Migration 029)** | `apps/api/integration/migration-029-location-v2.integration.test.ts` | 22/22 Cenários Verticais PASS |
| **Integração de Bypass Contextual e Interoperabilidade (PR #47)** | `apps/api/integration/contextual-location-bypass.integration.test.ts` | PASS |
| **CI GitHub Actions (PR #45 / Post-Merge `main`)** | Runs `38007603486` / `38009843312` | SUCCESS |
| **CI GitHub Actions (PR #47 / Post-Merge `main` @ `e2b434d`)** | Runs `38073973954` / `38076217454` | SUCCESS |

---

## 4. Nota de Causa-Raiz e Validação do PR #47

Durante o início do ensaio E2E em produção (com `CONVERSATION_AI_ENABLED=true`), constatou-se que os pinos nativos do WhatsApp já haviam sido extraídos corretamente, persistidos na tabela `channel_inbound_messages` com `latitude` e `longitude` estruturadas (características de eventos de pino puro incluem `raw_text = null`) e estavam integralmente disponíveis no registro reclamado da Inbox, **não** havendo falha de parsing ou de extração no Gateway ou na Evolution API.

O bloqueador inicial residia na precedência de roteamento em `ChannelInboxService.processClaimed()`: quando o `ContextualConversationService` estava configurado, `processClaimed()` delegava a execução a `this.contextualConversation.handle(claimed)` antes de alcançar o `CustomerSearchRouter`. Assim, turnos nativos de Localização v2 podiam ser consumidos pela camada contextual embora suas coordenadas estruturadas já tivessem sido extraídas e persistidas.

O **PR #47** (mesclado em `main` no commit `e2b434d01d8c0b84afe4455f8ea00d9e7f746cd7` e implantado via EasyPanel) introduziu a propriedade determinística de turno (`shouldOwnTurn` / `shouldRouterOwnTurn`) sob quatro condições exatas para contornar o `ContextualConversationService` e alcançar o `CustomerSearchRouter`:
* **Condição A (Coordenadas Estruturadas no Inbound):** Todo inbound que carrega `latitude` e `longitude` estruturadas faz bypass imediato do manipulador contextual e segue diretamente para o `CustomerSearchRouter` (o que inclui pinos nativos enviados enquanto uma conversa ativa está em `pending_slot = 'location'`, os quais são reclamados pela Condição A das coordenadas estruturadas no inbound, e não por `pending_slot = 'location'` isoladamente);
* **Condição B (Serviço Pendente com Pino Armazenado):** Conversas ativas em `pending_slot = 'service'` que já possuem coordenadas de pino autoritativas armazenadas (`pinLatitude` / `pinLongitude`) permanecem sob autoridade estrita do `CustomerSearchRouter`;
* **Condição C (Confirmação de Localização Lembrada):** Conversas ativas em `pending_slot = 'location_confirmation'` permanecem sob autoridade estrita do `CustomerSearchRouter`;
* **Condição D (Início Service-First com Memória Existente):** Quando não há conversa ativa, existe registro em `customer_last_locations`, o texto recebido resolve um serviço e não contém localização explícita, o turno é reclamado deterministicamente pelo `CustomerSearchRouter` (no encadeamento do repositório de produção, `shouldOwnTurn` utiliza `findByPhoneE164` para a busca read-only do cliente antes de decidir a propriedade determinística, com fallback de compatibilidade para `findOrCreateByPhoneE164` caso `findByPhoneE164` não esteja disponível), acionando o slot `location_confirmation`.

A campanha subsequente de homologação em produção comprovou a eficácia da correção (`PR47_PRODUCTION_FIX_VALIDATED=YES`).

---

## 5. Evidências de Homologação E2E em Produção Real (5/5 Casos PASS)

Todos os 5 casos canônicos foram executados manualmente pelo operador via WhatsApp real contra o ambiente de produção (`main` @ `e2b434d01d8c0b84afe4455f8ea00d9e7f746cd7`) e auditados em modo estritamente read-only no PostgreSQL de produção. Por conformidade de privacidade, números de telefone e coordenadas exatas de latitude/longitude são omitidos.

### Caso 1 — Serviço Primeiro -> Pino Nativo (`CASE1=PASS`)
* **Precondição de Memória Validada (`CASE1_MEMORY_EXISTED_BEFORE_SERVICE=NO`):** O Caso 1 utilizou um cliente (`021c32f2-9375-4922-9333-9c6173ae7537`, cujo registro em `customers` havia sido criado minutos antes na mesma sessão por mensagens introdutórias) que **não possuía nenhum registro em `customer_last_locations` antes do turno service-first**.
* **Sequência Auditada:**
  * **Inbound de Serviço (`Eletricista`):** `215b715e-196a-47b7-ba96-e800ec854e79` (`status=processed`). Iniciou a conversa `c41f2ca3-65d1-4d8e-bd24-1daf82b80fe0` com `status=active`, `pending_slot=location`, `search_request_id=NULL` e enviou o prompt `"Em qual cidade você precisa de Eletricista?"` (Outbound `db5953fa-fa7f-4c25-a0de-c526196f0c90`, `status=sent`).
  * **Inbound de Pino Nativo (Cuiabá - MT):** `03ec427e-c59a-4dbe-823a-7c7074aa20d3` (`status=processed`, coordenadas estruturadas presentes, `raw_text=NULL`). Reclamado deterministicamente pelo `CustomerSearchRouter` via Condição A (coordenadas nativas estruturadas presentes no inbound; ramo `active_pending_location_native_pin`, 0 chamadas ao motor contextual) e consumido pela **mesma conversa** `c41f2ca3-65d1-4d8e-bd24-1daf82b80fe0`.
  * **Busca e Fechamento:** Criou `search_request_id = 2f974904-4912-472a-ace1-12a749d2a402` (`status=ready`, 0 profissionais elegíveis / 0 apresentados em Cuiabá), gravou a memória inicial em `customer_last_locations` (`source=whatsapp_native`, `city=Cuiaba`, `state=MT`, coordenadas idênticas ao pino nativo sem substituição por forward geocoding), concluiu a conversa (`status=completed`, `pending_slot=NULL`) e enviou o aviso de ausência de cobertura (Outbound `63fc48f4-dcd7-4032-84f0-251138e5d11d`, `status=sent`). Zero contatos e zero notificações a profissionais.

### Caso 2 — Pino Nativo Primeiro -> Serviço (`CASE2=PASS`)
* **Sequência Auditada:**
  * **Inbound de Pino Nativo (Sinop - MT):** `ea17da36-dc47-4dc7-b904-77c48b544e14` (`status=processed`, `route=started`). Iniciou a conversa pin-first `45f7f1bc-a7ff-4615-b014-c5bd8e433539` com `status=active`, `pending_slot=service`, `location_source=whatsapp_native`, `search_request_id=NULL`, atualizou `customer_last_locations` e enviou `"Recebemos sua localização. Qual serviço você precisa?"` (Outbound `e2c9eb91-5f7c-419d-acea-0826fc382a9c`, `status=sent`).
  * **Inbound de Serviço (`Eletricista`):** `f4e3b831-43ce-4bd8-970e-641c7703e37d` (`status=processed`, `route=continued`). Continuou deterministicamente na **mesma conversa** `45f7f1bc-a7ff-4615-b014-c5bd8e433539` (Condição B, 0 chamadas ao motor contextual), resolveu `Eletricista` (`exact`) e executou a busca `32f771c6-f89a-4094-9621-e82f1ea9c57b` com as coordenadas exatas do pino nativo.
  * **Resultado:** 3 profissionais apresentados (Julia, Farol e Richard) via Outbound `6a8aaaa3-90ab-4d1c-831c-f6a8155f7250` (`status=sent`), conversa em `pending_slot=selection`, zero seleções, zero contatos e zero notificações a profissionais.

### Caso 3 — Localização Lembrada -> Confirmação Afirmativa Explícita (`CASE3=PASS`)
* **Sequência Auditada:**
  * Após comando `"Nova busca"` (Inbound `e987f277-590c-47af-8d37-c438581eff8a`), o envio de `"Eletricista"` (Inbound `f5ace664-a79f-4b09-aa1e-bb0c4dfcb20e`) foi reclamado via Condição D e iniciou a conversa `8c6beb57-07b0-4873-9aec-a413d8b85d4e` em `pending_slot=location_confirmation`, perguntando explicitamente: *"É para Sinop - MT novamente? Responda sim ou não. Se preferir, envie outra cidade ou sua localização pelo WhatsApp."* (zero reuso silencioso).
  * **Confirmação Afirmativa (`"Isso"`):** Inbound `f497e214-c7a7-4c34-969e-0874136a120a` reclamado via Condição C e interpretado deterministicamente por `parseLocationConfirmation()` como `confirm` (0 chamadas ao motor contextual), reutilizando as coordenadas exatas salvas (`location_source=memory_reuse`, sem substituição por forward geocoding) na busca `cad763df-dfc8-492a-80d2-079792ac20d3`.
  * **Resultado:** 3 profissionais apresentados, zero seleções, zero contatos e zero notificações a profissionais.

### Caso 4 — Localização Lembrada -> Recusa Explícita -> Novo Pino Nativo (`CASE4=PASS`)
* **Sequência Auditada:**
  * Após `"Nova busca"` (`ffcfe82a-c83a-4dd3-882a-23e8fcdd38a5`) e `"Eletricista"` (`5a9257d4-1402-4127-a8c3-24e31aaaabe5`, Condição D) abrirem a conversa `df28f2b7-5145-48b0-a037-78a4dd62ae35` em `pending_slot=location_confirmation` (Sinop - MT), o operador respondeu `"Não"` (Inbound `afc4d7ec-5870-4ea9-8fe0-3caed2179813`, Condição C).
  * A recusa limpou as coordenadas estagiadas na conversa, transicionou `pending_slot` para `location` sem executar busca na localização antiga e solicitou a nova cidade.
  * **Novo Pino Nativo (Cuiabá - MT):** Inbound `68e1b4b3-a588-4acc-ace0-de7b5840d89a` reclamado deterministicamente via Condição A (coordenadas estruturadas presentes no inbound) e consumido pela **mesma conversa** `df28f2b7-5145-48b0-a037-78a4dd62ae35`, criando a busca `e2d87f15-3c0e-4cf5-9c78-f8b7c993bf94` com as coordenadas exatas do novo pino (`location_source=whatsapp_native`), atualizando `customer_last_locations` para Cuiabá - MT e retornando 0 elegíveis / 0 apresentados com conversa finalizada em `completed`. Zero contatos e zero notificações a profissionais.

### Caso 5 — Substituição de Segundo Pino (`P1 -> P2 -> Serviço`) (`CASE5=PASS`)
* **Sequência Auditada:**
  * **Primeiro Pino Nativo `P1` (Sinop - MT):** Inbound `66898e36-b5a3-4c57-adee-1b265ce6f8d9` iniciou a conversa `9904f400-c0de-40fe-8857-299edbe85bef` em `pending_slot=service`.
  * **Segundo Pino Nativo `P2` (Sinop - MT, local distinto de `P1`):** Inbound `2321abdf-ca6f-42ce-8ce7-20845c2112f5` substituiu deterministicamente `P1` na **mesma conversa** `9904f400-c0de-40fe-8857-299edbe85bef` e em `customer_last_locations` (`P1` deixou de ser canônico).
  * **Inbound de Serviço (`Eletricista`):** Inbound `5e8c209c-a91e-40ef-b5c1-3857732b087c` executou a busca `914e5be7-f08d-4307-af36-2348578d2990` utilizando estritamente as coordenadas exatas de `P2` (`location_source=whatsapp_native`, 0 chamadas ao motor contextual), apresentando 3 profissionais com distâncias calculadas a partir de `P2`. Zero seleções, zero contatos e zero notificações a profissionais.

---

## 6. Estado Operacional e Invariantes Globais Validados em Produção

```text
LOCATION_V2_DATABASE_FOUNDATION=ACTIVE
LOCATION_V2_GATEWAY_NATIVE_PIN_EXTRACTION=ACTIVE
LOCATION_V2_CONTEXTUAL_INTEROP_FIX=ACTIVE
LOCATION_V2_PRODUCTION_E2E=PASS
LOCATION_V2_PRODUCTION_HOMOLOGATED=YES

CASE1_PRODUCTION_HOMOLOGATED=YES
CASE2_PRODUCTION_HOMOLOGATED=YES
CASE3_PRODUCTION_HOMOLOGATED=YES
CASE4_PRODUCTION_HOMOLOGATED=YES
CASE5_PRODUCTION_HOMOLOGATED=YES

PR47_PRODUCTION_FIX_VALIDATED=YES

P0029_GUARD_CURRENTLY_TRIGGERED=YES
PRODUCTION_MIGRATION_029_ROLLBACK=PROHIBITED
PRODUCTION_ROLLBACK_STRATEGY=FORWARD_FIX_ONLY
```

* **Invariantes Globais Comprovados:**
  * Extração nativa de `locationMessage` pela Evolution API e pelo Gateway n8n ativa em produção;
  * Fundação de banco da Migration 029 e tabela `customer_last_locations` operacionais em produção;
  * Coordenadas exatas do pino nativo permanecem autoritativas do início ao fim; geocodificação reversa restrita a metadados amigáveis;
  * Localização lembrada exige confirmação explícita (`location_confirmation`); confirmação negativa limpa o estado estagiado e jamais busca silenciosamente a localização antiga;
  * Segundo pino (`P2`) substitui deterministicamente o primeiro pino (`P1`) na conversa e na memória;
  * `CustomerSearchRouter` detém a propriedade determinística dos estados transacionais da Localização v2 sem interceptação pelo `ContextualConversationService`;
  * Invariante de no máximo 1 conversa ativa não-expirada por cliente preservado em todos os casos;
  * Nenhum payload bruto de provedor e nenhum logradouro/endereço residencial completo persistido como texto negocial de localização;
  * Zero notificações acidentais a profissionais durante toda a campanha de homologação.

---

## 7. Achado Opcional Não-Bloqueante (Parking Lot)

* **Consistência Transacional em Localização + Texto Conjunto:**
  No fluxo combinado em que o cliente envia pino de localização e texto de serviço em um único evento inbound, uma melhoria arquitetural futura poderá aprimorar a consistência transacional entre a gravação em `customer_last_locations` e a conversa ativa caso a orquestração subsequente retorne `service_unavailable` após a atualização da memória. Este item não bloqueia o fechamento da fundação e permanece registrado no [ROADMAP.md](../ROADMAP.md) sob `# PARKING LOT`.

