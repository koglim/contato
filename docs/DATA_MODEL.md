# Modelo de dados

## Evolução 017 — recibo e retenção de entrega

`channel_outbound_messages.sent_token_hash` guarda SHA-256 do token que confirmou
o envio; só existe em `sent`. `delivery_hold_reason` só existe em `processing`,
com motivos limitados a `transport_outcome_unknown` e `confirmation_pending`.
Nenhum token/recibo retroativo é gerado para dados legados. Índice parcial
`channel_outbound_recipient_queue_idx` apoia ordenação de notificações por
provider, destinatário, criação e ID. Não há nova variável.

Down rejeita evidências incompatíveis com `P0017`, preservando integralmente os
dados e as migrations anteriores. Ver [OUTBOUND_DELIVERY.md](OUTBOUND_DELIVERY.md).

## Evolução 014 — oportunidade bilateral e rollback protegido

- `contacts.public_code`: código canônico `CC-` + oito caracteres aleatórios, único por `lower(public_code)`. Sem sequência, UUID ou PII. Novos contatos bilaterais têm uma única oportunidade por busca, protegida por índice parcial.
- `contacts.bilateral_snapshot`: JSONB mínimo, validado por schema estrito antes da escrita. Serviço, local disponível, bairro explicitamente informado, resumo sanitizado (160 caracteres), nome público, dois telefones autorizados, código, versão do aviso, Outbox do aviso, inbound da escolha e momentos de envio/escolha/consentimento. `consent_method` distingue escolha após aviso e confirmação legada.
- `contacts.selection_conversation_id`: vínculo auditável com a conversa; `selection_key` continua identificando o inbound que efetivou a escolha/confirmou o legado. Trigger impede alteração do snapshot, código e identidade de uma oportunidade bilateral já persistida. Edição posterior de perfil não muda o replay.
- `channel_outbound_messages.business_key`: chave única parcial de idempotência de negócio. Notificação inicial usa `contact:<UUID interno>:initial`; essa chave nunca aparece no texto público. Replay do mesmo conteúdo não escreve nem muda o estado. As finalidades da 012 permanecem intactas.
- `channel_outbound_messages.bilateral_notice_version`: nulo em apresentações sem aviso auditável; novas apresentações/solicitações de consentimento usam `bilateral-v1`. O conteúdo permanece na própria Outbox. Consentimento exige confirmação `sent` anterior ao inbound autorizador e validação dos vínculos.
- `search_conversations.bilateral_pending`: estado de confirmação legada dentro de `selection`, com match/posição escolhidos, nome público limitado, chave/momento da escolha e Outbox/versão do prompt. Não contém telefones. Recusa limpa a pendência; cancelamento/expiração tornam a conversa inativa. Nenhuma confirmação de contexto inativo pode criar contato.
- `channel_inbound_messages.bilateral_response`: resultado público estrito de pedido de confirmação/recusa, para recuperação após crash antes de `processed`. Sem telefones. O resultado final selecionado vem do contato/snapshot e a resposta textual vem da Outbox já criada atomicamente.

**Legados:** a migration não preenche aviso, consentimento, snapshot ou código em registros anteriores. Campos nulos representam ausência de evidência, não consentimento presumido. Contatos antigos não geram notificação bilateral retroativa. Apresentações antigas exigem confirmação explícita no próximo ato de escolha.

**Barreira operacional:** antes de remover qualquer coluna, o down 014 verifica todos os dados novos e também `contacts.selection_key` e Outboxes sem inbound, incompatíveis com downs históricos 010/012. Se presentes, aborta com `P0014 / BILATERAL_ROLLBACK_BLOCKED`, sem remover/transformar nada. Sem arquivo auxiliar, shadow table, inbound fictício ou reenfileiramento. Usar roll-forward ou restauração integral de backup; não apagar dados para forçar downgrade. Somente ambientes compatíveis admitem rollback completo 014 → 008. CI prova os dois cenários separadamente e repete integrações após reaplicar.

O modelo sustenta busca, matching, conversas, Inbox/Outbox e seleção idempotente. Assinaturas, autenticação profissional e o ciclo completo de atendimento ainda exigem implementação.

## Entidades

- `customers`: pessoas que solicitam serviços. O telefone em formato E.164 será a futura chave de identificação no WhatsApp.
- `service_categories`: agrupamentos amplos do catálogo, como Casa e Manutenção.
- `services`: serviços pesquisáveis pertencentes a uma categoria, como Eletricista.
- `service_aliases`: formas alternativas normalizadas de descrever um serviço. O catálogo inicial não precisa preenchê-las ainda.
- `professionals`: perfis dos prestadores, incluindo estado operacional e disponibilidade declarada.
- `professional_services`: vínculo entre profissional e serviço, com preço em centavos e o modo de precificação.
- `professional_service_areas`: pontos centrais e raios, em metros, das áreas em que um profissional atende.
- `search_requests`: a solicitação original do cliente. `raw_text` é imutável em intenção e preserva o texto informado.
- `matches`: lista ordenada de candidatos de uma solicitação. `rank_position` preserva a ordem apresentada; `shown_at` é preenchido somente quando a mensagem outbound associada é confirmada como enviada, e `selected_at` indicará sua escolha. A leitura interna de seleção consulta somente posições com `shown_at` preenchido e lista candidatos pendentes por `rank_position`, sem alterar esses campos.
- `channel_outbound_message_matches`: associação idempotente entre uma intenção outbound e os matches que ela apresenta. O vínculo é criado com a intenção, mas `shown_at` só é preenchido após sua confirmação válida como enviada. A migration 011 torna `match_id` único nessa tabela, reservando cada profissional para uma única apresentação.
- `channel_outbound_messages.next_attempt_at`: agenda opcional da próxima tentativa de transporte. A migration 016 cria um índice parcial para mensagens `pending` elegíveis; `NULL` significa elegível imediatamente. O down 016 é reversível apenas quando não há valores preenchidos e bloqueia com `P0016 / OUTBOUND_RETRY_ROLLBACK_BLOCKED` para evitar perda de dados.
- `channel_outbound_messages.attempt_count` e `last_error_code`: contador incrementado no claim e último erro controlado do transporte. A política central usa no máximo cinco tentativas, com backoff de 30/60/120/240/480 segundos; a quinta falha permanece `failed`/dead-letter e não volta à fila.
- `contacts`: registro do interesse de um cliente por um profissional para uma solicitação. `selection_key`, quando preenchida, identifica de forma única uma tentativa lógica de seleção e permite recuperar o resultado após replay sem duplicar o contato.
- `reviews`: avaliação vinculada a um contato real, com uma avaliação por contato.

## Relacionamentos

```text
service_categories 1 ── N services 1 ── N service_aliases
professionals      N ── N services (professional_services)
professionals      1 ── N professional_service_areas
customers          1 ── N search_requests
search_requests    1 ── N matches N ── 1 professionals
search_requests    1 ── N contacts N ── 1 professionals
contacts           1 ── 0..1 reviews
```

Os pedidos podem continuar existindo sem cliente ou serviço associado, usando `ON DELETE SET NULL`; isso preserva histórico. Dados de relacionamento ou históricos críticos usam `RESTRICT`, evitando remoções acidentais. A única exclusão em cascata é `service_aliases` ao remover seu serviço, pois aliases não têm significado sem ele.

## Seleção pendente

`search_conversations` pode aguardar `location`, `service` ou `selection`. Uma conversa ativa em `selection` referencia obrigatoriamente o `search_request` que originou sua lista de `matches`; as demais conversas ativas ainda não têm esse vínculo. O fluxo da Inbox seleciona somente um match exibido, com posição válida e ainda não selecionado, concluindo atomicamente conversa, match, busca e `contact`.

O matching persiste um pool de até 20 `matches` por busca, com rank absoluto. A primeira resposta contém até 3; novas apresentações só podem reservar ranks até 6. Candidatos 7–20 ficam para auditoria, não entram em `hasMore` e não podem ser escolhidos sem `shown_at`. Contagem do pool não significa exposição. A reserva de página serializa pela linha de `search_requests` e pelo índice único de `channel_outbound_message_matches.match_id`; não há nova migration nesta etapa.

`matches.score_breakdown` preserva a política `fair-v1` e seus sinais: disponibilidade, distância/banda, verificação, reputação bayesiana/banda, quantidade de avaliações elegíveis, indicador de ausência de histórico, exposições em 7 dias, contatos em 7 dias, repetição do cliente em 30 dias e carga ponderada. Não guarda PII. `score` permanece nulo; `rank_position` é a decisão final lexicográfica e permanece estável na paginação.

A migration 013 cria somente índices de suporte às consultas de sinais em `matches`, `contacts` e `reviews`; seu rollback remove esses três índices e não altera registros de negócio. O fluxo de criação/moderação de avaliações e o domínio de assinaturas continuam pendentes: ler avaliações válidas existentes não implementa essas jornadas.

## Localização e busca futura

PostGIS armazena `center` e `location` como `GEOGRAPHY(Point, 4326)`, o que permite calcular distância em metros e testar se uma localização está dentro do raio de atendimento. Os índices GiST tornam essas consultas geoespaciais escaláveis.

As extensões `pg_trgm` e `unaccent` preparam a busca tolerante a erros de digitação, capitalização e acentos. `service_aliases.normalized_alias` tem índice GIN com `gin_trgm_ops`; a normalização e o motor de busca serão implementados em outra etapa.

## Preços e integridade

Valores monetários usam inteiros em centavos, nunca `FLOAT`. A restrição de `professional_services` exige valores coerentes para cada modo de preço: orçamento sem valor, fixo/a partir de com valor inicial, ou faixa com limites ordenados. UUIDs são gerados pelo PostgreSQL com `gen_random_uuid()` da extensão `pgcrypto`.
# Migration 015 — resposta de oportunidade e retomada

- `contacts.status`: requested = aguardando; accepted = aceita; declined = recusada.
- `opportunity_response_events`: um evento append-only por contato, com profissional,
  inbound, estados anterior/novo, origem, versão e timestamp; sem duplicar texto bruto.
- Outbox: finalidades professional_reply/customer_contact_update, referência ao evento
  e chave de negócio. A confirmação por ID/lease permanece idempotente.
- Inbox: response_outbound_id referencia a confirmação original inclusive em outra
  entrega da mesma decisão; status processed e resposta são persistidos atomicamente.
- Conversas: resume_slot preserva o slot e resume_code identifica a busca suspensa; usa status completed sem
  disputar o índice parcial de uma única conversa ativa. Expiração original é mantida.
- Um contato recusado não bloqueia outro contato da mesma busca, mas seu histórico,
  snapshot e selected_at permanecem; uma retomada não inventa uma nova oportunidade.
- Down bloqueia com P0015 diante de dados incompatíveis, sem apagar eventos/PII.
# Adição 019 — Inbox recuperável

`channel_inbound_messages`: `recovery_state`, `attempt_count`, `total_attempts`,
`next_attempt_at`, `lease_expires_at`, `quarantined_at`, `recovery_reason`,
`recovered_at`, `context_fingerprint`. Estado operacional separado do status
histórico; nenhuma entrada é falsamente marcada como concluída para liberar FIFO.
`channel_inbound_recovery_events`: ação/razão/data, chave idempotente, operador
declarado e hash opcional do conflito; FK RESTRICT e updates proibidos. Sem
cópia de telefone/texto/token. Índices de elegibilidade e ordem por telefone.
Down P0019 protege dados incompatíveis. [Detalhes](INBOX_RECOVERY.md).
