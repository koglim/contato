# Relatório de Conclusão: Localização v2 — Fundação de Entrada

**Pacote de Trabalho:** Localização v2 — Fundação de Entrada (Pinos Nativos, Coordenadas Exatas e Memória Confirmada)  
**Status do Repositório:** REPOSITORY_IMPLEMENTATION_COMPLETE / MERGED INTO MAIN  
**Status de Produção:** PENDING_OPERATIONAL_ACTIVATION  
**Data de Fechamento do Repositório:** 2026-10-10  
**PR:** #45 (`feat/location-v2-foundation`)  
**Base / Ramo Canônico:** `main` @ `3c74fbba13d2d4879c8e8ca4ce472c4a9605ff61`  
**HEAD Aprovado do PR #45:** `762e9fdf2cf90823754a9a3cd40f10015bf53976`  
**Commit de Merge:** `3c74fbba13d2d4879c8e8ca4ce472c4a9605ff61`  
**CI de HEAD Exato (PR #45):** Run `38007603486` (SUCCESS)  
**CI Pós-Merge (`main`):** Run `38009843312` (SUCCESS)  
**Migration de Banco de Dados:** 029 (`029_add_location_v2_foundation.js`)  
**Arquitetura Canônica:** [ADR-007](../decisions/ADR-007-location-v2-native-pins-and-confirmed-memory.md)  
**Bloqueadores:** NENHUM  

---

## 1. Sumário Executivo

Este documento formaliza o encerramento no repositório do pacote de trabalho **Localização v2 — Fundação de Entrada**, implementado no **PR #45**, aprovado por revisão independente, integrado ao branch canônico `main` e validado por baterias completas de testes automatizados e integração de banco de dados no GitHub Actions.

A fundação de Localização v2 introduz no ContatoCerto a capacidade de ingestão de pinos nativos de localização do WhatsApp, cálculo espacial com autoridade estrita de coordenadas geográficas reais, enriquecimento contextual amigável ("Cidade - UF") sem alteração de coordenadas de matching, memória durável da última localização do cliente e confirmação explícita obrigatória antes do reuso, com zero reuso silencioso e zero chamadas LLM.

> [!IMPORTANT]
> **Distinção Mandatória entre Repositório e Produção:**
> A integração do código ao branch `main` com CI aprovado atesta que o software está pronto e verificado no repositório, mas **NÃO** significa que a capacidade foi implantada em produção.
>
> * A Migration 029 **não** foi executada no banco de dados de produção.
> * A instância instalada do n8n do operador **não** foi atualizada com o novo nó de extração de localização do gateway.
> * Nenhum ensaio ponta a ponta com pino real de WhatsApp foi realizado no ambiente de produção.
> * A ativação em produção exige procedimento operacional controlado e autorizado.

---

## 2. Capacidades Entregues no Código

1. **Ingestão Nativa de Pinos do WhatsApp:**
   * Reconhecimento determinístico de `message.locationMessage` e envelopes defensivos de localização no Gateway n8n (`gateway-contract.mjs`).
   * Validação estrita de limites numéricos de latitude (-90 a +90) e longitude (-180 a +180).
   * Suporte a mensagens de pino puro (sem legenda ou texto de serviço) com `raw_text = null`.

2. **Dutos Estruturados e Fronteira de Privacidade:**
   * Admissão colunar estruturada na Inbox durável (`channel_inbound_messages.latitude`, `longitude`, `location_name`).
   * Minimização estrita de privacidade em conformidade com o ADR-007: nomes completos de ruas, logradouros residenciais e payloads brutos de provedor são descartados e **não** persistem em banco de dados.

3. **Autoridade Estrita de Coordenadas Exatas:**
   * No matching espacial (`PostgresMatchingRepository`), as coordenadas reais do pino enviado pelo cliente são a autoridade máxima para o cálculo de raio e ordenação espacial.
   * As coordenadas reais **nunca** são substituídas por centroides de municípios ou distritos.
   * O geocodificador reverso externo (`OpenRouteServiceGeocodingProvider.reverseGeocode`) é invocado apenas para enriquecimento contextual e exibição amigável ("Cidade - UF"), com fallback resiliente para rótulo padrão em caso de indisponibilidade de rede.

4. **Memória Durável de Última Localização (`customer_last_locations`):**
   * Armazenamento durável e seguro do último local de busca de cada cliente (`customer_id`), com isolamento por constraint única e registro canônico de proveniência (`whatsapp_native`, `text_resolved`, `memory_reuse`).
   * Atualizado tanto em cenários com profissionais encontrados (`matched`) quanto em buscas sem candidatos (`no_matches`).

5. **Confirmação Explícita Obrigatória (Zero Reuso Silencioso):**
   * Proibição categórica de reuso tácito ou involuntário de localização anterior.
   * Quando o cliente inicia uma busca informando apenas o serviço, a conversa transiciona para o slot `location_confirmation` e solicita confirmação explícita (*"É para {label} novamente?..."*).
   * Parsing determinístico (ADR-002) sem LLM para respostas afirmativas, negativas, substituição por nova localidade ou esclarecimento.

6. **Substituição de Segundo Pino Pendente Serviço:**
   * Quando o cliente envia um primeiro pino (P1), entra no slot de espera de serviço (`pending_slot = 'service'`) e posteriormente envia um segundo pino (P2) antes do serviço, o manipulador `handleLocationPinWhileAwaitingService` substitui integral e atomicamente as coordenadas e metadados na conversa e na memória, sem deixar resíduos de P1.
   * Suporte a pino combinado com texto (`location + raw_text`) no mesmo evento, utilizando P2 como autoridade máxima imediata.

7. **Consistência Canônica em `matched` e `no_matches`:**
   * O snapshot estruturado de localização (`latitude`, `longitude`, `name`, `source`, `city`, `state`) é finalizado deterministicamente em todas as saídas de orquestração de busca, assegurando consistência em repositórios e tabelas de busca.

8. **Proteção Transacional e Migração 029:**
   * Adição segura de colunas e tabela `customer_last_locations` com trava de proteção contra rollback acidental (`P0029` / `LOCATION_V2_ROLLBACK_BLOCKED`).
   * Testes regressivos comprovam a preservação dos invariantes históricos dos cenários T18 (seleção expirada) e T29 (preservação/retomada de busca com outra busca ativa).

---

## 3. Matriz de Evidências Automatizadas

| Nível de Teste | Arquivo / Suíte | Quantidade / Resultado |
| :--- | :--- | :---: |
| **Contratos n8n / Workflows** | `workflows/n8n/gateway-contract.test.mjs` | 68/68 PASS |
| **Testes Unitários de Domínio** | `customer-search.service.test.ts`, `search-conversation.service.test.ts`, `location-confirmation.parser.test.ts` | 199/199 PASS |
| **Integração Real PostgreSQL / PostGIS** | `apps/api/integration/migration-029-location-v2.integration.test.ts` | 22/22 Cenários Verticais PASS |
| **CI GitHub Actions (Exact HEAD PR #45)** | Run `38007603486` | PASS (Status: completed / Conclusion: success) |
| **CI GitHub Actions (Post-Merge `main`)** | Run `38009843312` | PASS (Status: completed / Conclusion: success) |

---

## 4. Auditoria de Estado de Produção

Em estrita conformidade com a governança do repositório ([AGENTS.md](../../AGENTS.md)):

```text
REPOSITORY_IMPLEMENTATION=COMPLETE
MAIN_INTEGRATION=COMPLETE
AUTOMATED_VALIDATION=PASS

PRODUCTION_DEPLOYMENT=NOT_PERFORMED
MIGRATION_029_PRODUCTION=NOT_APPLIED
INSTALLED_N8N_LOCATION_V2=NOT_UPDATED
REAL_WHATSAPP_LOCATION_E2E=NOT_PERFORMED
```

* **Deploy em Produção:** NENHUM contêiner ou serviço em produção foi reiniciado ou atualizado com a imagem contendo as alterações do PR #45.
* **Banco de Dados de Produção:** A Migration 029 NÃO foi executada na instância remota do PostgreSQL.
* **Instância n8n Instalada:** Os nós de extração de pino nativo e roteamento NÃO foram importados ou ativados no n8n em produção.
* **Provedores de Mensageria:** NENHUMA mutação foi realizada na Evolution API, Meta Cloud API ou instâncias de WhatsApp.

---

## 5. Achado Opcional Não-Bloqueante (Parking Lot)

* **Consistência Transacional em Localização + Texto Conjunto:**
  No fluxo combinado em que o cliente envia pino de localização e texto de serviço em um único evento inbound, uma melhoria arquitetural futura poderá aprimorar a consistência atômica entre a gravação em `customer_last_locations` e a conversa ativa caso a orquestração subsequente retorne `service_unavailable` após a atualização da memória. Este item não bloqueia o fechamento da fundação e foi devidamente registrado no [ROADMAP.md](../ROADMAP.md) sob `# PARKING LOT`.
