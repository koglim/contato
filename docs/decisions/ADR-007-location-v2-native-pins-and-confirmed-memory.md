# ADR-007: Localização v2 — Pinos Nativos de WhatsApp, Coordenadas Exatas e Memória Confirmada de Localização

* **Status:** ACCEPTED / IMPLEMENTED / MERGED
* **Data:** 2026-10-09
* **Decisores:** Produto e Arquitetura ContatoCerto

---

> [!NOTE]
> **Fundação de Entrada de Localização v2 (Implementação e Integração no PR #45):**
> Este documento formaliza a arquitetura e as regras de domínio para a ingestão nativa de pinos de localização do WhatsApp, preservação de coordenadas geográficas exatas no matching espacial, geocodificação reversa para enriquecimento contextual e a memória durável de última localização com confirmação explícita obrigatória antes do reuso. Implementado no **PR #45** (`feat/location-v2-foundation`, Migration 029) e integrado ao branch canônico `main` (commit de merge `3c74fbba13d2d4879c8e8ca4ce472c4a9605ff61`, CI pós-merge `38009843312` SUCCESS). Deploy e homologação em produção permanecem pendentes de etapa operacional autorizada.

---

## Contexto

Na versão 1 (V1) do ContatoCerto, toda a resolução de localização dependia exclusivamente de mensagens de texto livres interpretadas por regras de extração léxica (`extractExplicitLocation`) ou geocodificação direta via OpenRouteService a partir de strings digitadas (ex.: *"preciso de eletricista em Sinop"*).

Esse modelo apresentava limitações fundamentais de produto e precisão:
1. **Fricção de Uso no Canal Mobile:** No WhatsApp, clientes frequentemente preferem compartilhar a localização atual ou fixada via recurso nativo de pin do aplicativo em vez de digitar o nome da cidade ou bairro.
2. **Precisão Espacial vs. Centroides:** Ao depender de nomes de cidades, o matching calculava distâncias a partir do centroide do município, desconsiderando a distância real do cliente em cidades com grande extensão territorial ou áreas rurais adjacentes.
3. **Falta de Continuidade para Clientes Frequentes:** Clientes que utilizam a plataforma repetidamente eram forçados a redigitar sua cidade a cada nova busca, aumentando o abandono no primeiro contato.
4. **Risco de Reuso Involuntário ou Silencioso:** Assumir tacitamente que o cliente sempre deseja atendimento na mesma localização anterior gera atrito e falhas graves caso a solicitação atual seja para outro endereço (ex.: casa vs. local de trabalho, viagem ou imóvel de parentes).

---

## Decisão

1. **Ingestão Nativa de Localização do WhatsApp:**
   * O gateway n8n (`gateway.json` / `gateway-contract.mjs`) reconhece e extrai nativamente mensagens de localização do WhatsApp sob `message.locationMessage` (com suporte defensivo a `message.location`).
   * As coordenadas `latitude` (-90 a +90) e `longitude` (-180 a +180) são validadas de forma estritamente determinística no Gateway antes de qualquer repasse ao domínio.
   * Mensagens com coordenadas inválidas ou fora dos limites geográficos são descartadas de forma segura.

2. **Dutos Estruturados e Preservação de Coordenadas:**
   * O payload transita pelo Gateway até o Inbox durável (`channel_inbound_messages`) com campos colunares próprios: `latitude`, `longitude` e `location_name` (opcional).
   * **Privacidade Estrita:** Endereços completos de rua (`location_address` / `pin_address`) e payloads brutos de provedor **não são persistidos** no banco de dados. A localização durável limita-se a latitude, longitude, nome seguro opcional e metadados canônicos de cidade/UF/país/rótulo derivados pelo domínio.
   * Mensagens de pino puro (sem texto acompanhante) são admitidas com `raw_text = null`, flexibilizando os schemas compartilhados (`@contatocerto/shared`) com validação mútua de presença (`raw_text !== undefined || location !== undefined`).

3. **Autoridade Estrita das Coordenadas Exatas no Matching:**
   * **As coordenadas do pino enviado pelo cliente são a autoridade máxima e estrita para a busca espacial.**
   * As coordenadas exatas **nunca** são substituídas pelo centroide de município ou distrito obtido por geocodificação.
   * O geocodificador reverso (`OpenRouteServiceGeocodingProvider.reverseGeocode`) é invocado apenas para obter metadados textuais e legíveis para o cliente (ex.: rótulo `"Sinop - MT"` ou `"localização enviada"` em caso de falha de rede/provedor).
   * O serviço de matching (`PostgresMatchingRepository`) recebe as coordenadas exatas do pino para cálculo de distância euclidiana / raio de atendimento.

4. **Memória Durável de Última Localização (`customer_last_locations`):**
   * Persiste exclusivamente o último ponto de atendimento do cliente em tabela dedicada com constraint única por cliente (`customer_id`).
   * Apenas dados consolidados são salvos: latitude, longitude, cidade, estado, país, rótulo formatado e origem (`whatsapp_native`, `text_resolved`, `memory_reuse`).
   * Toda localização válida e utilizável é elegível para memória independente de encontrar profissionais (`no_matches` ou `matched`), tanto em buscas por pino nativo quanto por texto resolvido.
   * Payloads brutos de provedores e endereços sensíveis de logradouro residencial **não são armazenados**, garantindo a conformidade com privacidade e LGPD.

5. **Confirmação Explícita Obrigatória (Zero Reuso Silencioso):**
   * **É terminantemente proibido reutilizar a localização anterior de um cliente de forma silenciosa ou implícita.**
   * Quando um cliente com localização salva inicia uma nova busca informando apenas o serviço (ex.: *"preciso de eletricista"*), a conversa transiciona para o novo slot de espera: `pending_slot: 'location_confirmation'`.
   * A mensagem de confirmação pergunta de forma clara:
     > *"É para {label} novamente? Responda sim ou não. Se preferir, envie outra cidade ou sua localização pelo WhatsApp."*
   * Comportamento das respostas:
     * **Afirmativa ("sim", "s", "isso", "isso mesmo", "mesmo lugar", "pode ser"):** busca executada com as coordenadas salvas, atualizando a memória com origem `memory_reuse`, avançando para seleção de profissionais.
     * **Negativa ("não", "nao", "n", "outra", "outro lugar", "mudar", "mudar localização", "mudar localizacao"):** coordenadas limpas, conversa move-se para `pending_slot: 'location'`, solicitando a nova cidade ou pino.
     * **Substituição direta (nova cidade ou novo pino):** resolve imediatamente a nova localização e executa a busca, atualizando a memória.
     * **Amígua / Não compreendida:** reapresenta o prompt de confirmação de forma segura sem mutar dados ou quebrar o fluxo.

6. **Autoridade Determinística e Limites da IA (ADR-002):**
   * Em conformidade absoluta com o [ADR-002](ADR-002-ai-interpretation-vs-deterministic-domain-authority.md), **nenhuma chamada a LLM é utilizada** para extrair coordenadas, avaliar confirmações de memória ou mutar os slots de conversa de localização.
   * Todo o parsing de confirmação (`parseLocationConfirmation`) e roteamento é 100% determinístico e coberto por testes unitários exaustivos.

7. **Proteção Transacional e Política de Rollback:**
   * A migration 029 (`029_add_location_v2_foundation.js`) inclui trava de segurança programática (`P0029` / `LOCATION_V2_ROLLBACK_BLOCKED`) impedindo rollbacks acidentais que possam truncar dados de histórico de localização de clientes em produção.

---

## Consequências

### Positivas
* **Experiência do Usuário Fluida:** O cliente pode simplesmente enviar o pino de sua residência ou local de trabalho com um toque no WhatsApp.
* **Precisão Insuperável:** O cálculo de distância e raio de atendimento do profissional utiliza a coordenada real da solicitação, e não um centroide municipal arbitrário.
* **Segurança e Consentimento:** A exigência de confirmação explícita elimina surpresas ou contratações na cidade errada quando o cliente se desloca.
* **Robustez Operacional:** Fallbacks determinísticos garantem que falhas de geocodificação reversa externa não interrompam o atendimento do cliente.

### Compromissos e Desafios
* Necessidade de manter a quota do provedor OpenRouteService monitorada para requisições de `/reverse`.
* Clientes em regiões de divisa municipal ou áreas rurais distantes dependem da precisão do sinal de GPS do aparelho transmissor.

---

## Relacionamentos

* Precedido por: [ADR-002: Limites entre Interpretação por IA e Autoridade de Domínio Determinística](ADR-002-ai-interpretation-vs-deterministic-domain-authority.md)
* Precedido por: [ADR-006: Ações Interativas e Experiência Button-First no WhatsApp](ADR-006-interactive-actions-button-first.md)
