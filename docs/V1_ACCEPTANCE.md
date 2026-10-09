# Matriz de aceite V1 — estabilização e B2

> [!NOTE]
> **Matriz Histórica de Aceite V1:** Este documento registra a matriz de critérios de aceitação formal utilizada durante a estabilização da V1 original.
> Para o estado atual do sistema e roadmap de evolução, consulte [docs/README.md](README.md), [CURRENT_STATE.md](CURRENT_STATE.md) e [ROADMAP.md](ROADMAP.md).

IDs do plano fornecido por Ricardo. **Aprovado (automatizado)** significa teste
do escopo descrito, não homologação de n8n/WhatsApp nem aprovação comercial.
**Parcial** identifica prova disponível e critério restante. **Não executado**
não pode ser tratado como aprovado. Não há casos conscientemente ignorados para
deixar o CI verde. SHAs/execuções estão em [V1_EXECUTION.md](V1_EXECUTION.md).

Evidências: testes `apps/api/src`, integrações reais em `apps/api/integration`,
testes `apps/web/lib` e contratos/exports em `workflows/n8n`. Transporte externo
dos testes é simulado; PostgreSQL/PostGIS é real e descartável no CI.

| ID | Cenário | Estado e evidência/pendência |
| --- | --- | --- |
| T01 | Serviço e cidade juntos | Aprovado no controlador/Inbox B2.2, inclusive pedidos interrogativos; speech_act diferencia informação/hipótese/recusa; modelo real pendente |
| T02 | Falta serviço/cidade | Aprovado automatizado: slots independentes e pergunta somente sobre o campo faltante; revisão humana da redação pendente |
| T03 | Aspas/emoji/multiline | Aprovado no contrato puro de transporte; homologação do gateway pendente |
| T04 | Texto/resposta citada | Parcial: normalização testada; gateway instalado não executado |
| T05 | Áudio/limites/falhas | Implementação020: eventos/avisos duráveis, transcrição persistida, lease, TTL, quarentena e Shared; mocks e PostgreSQL no CI. Áudio/motor reais pendentes, ver TRANSPORT_DURABILITY.md |
| T06 | Próprio/grupo/evento inválido | Parcial: normalizador ignora; integração no webhook pendente |
| T07 | Autenticidade do webhook | Gateway inativo usa JWT HS256 nativo compatível com tags 2.3.7/1.123.21; claims/envelope testados; prova criptográfica no motor/rede real pendente. JWT não assina o body |
| T08 | Replay do inbound | Aprovado automatizado: Inbox, contato/Outbox únicos e conteúdo persistido |
| T09 | ID com payload conflitante | Conflito sem sobrescrita, quarentena/auditoria e FIFO bloqueado até disposição; evidência 019 em INBOX_RECOVERY.md |
| T10 | Fila vazia | Aprovado automatizado: 204 na API e gate não autoriza transporte |
| T11 | Claim já enviado | Aprovado automatizado: sent sem payload de novo envio e gate encerra |
| T12 | Dois consumidores | Aprovado automatizado: claims concorrentes PostgreSQL; n8n real pendente |
| T13 | Falha e recuperação | Parcial: retry/backoff real e contrato de rejeição; provider real pendente |
| T14 | Quinto erro/abandono | Aprovado automatizado: limite terminal por ID e fila, sem sexta lease |
| T15 | Confirmação HTTP perdida | Parcial: recibo e repetição sem transporte provados; crash externo exige homologação/reconciliação |
| T16 | Token/resultado conflitante | Aprovado automatizado: mutação rejeitada, recibos/timestamps preservados |
| T17 | Ordenação por destinatário | Parcial: FIFO das notificações independentes; respostas inline preservam exceção de consentimento |
| T18 | Pergunta de contexto obsoleto | Aprovado em produção real: resposta determinística explícita ("Essa lista de profissionais expirou...") com zero mutações de domínio/negócio (zero contatos criados, zero novas buscas, zero matches selecionados, zero notificações) e outbound status=sent (Evolution ID 3EB0341F401FF10E9E72E8, zero holds) quando o cliente seleciona a partir de lista expirada (busca de 2026-10-01 UTC, ensaio executado em 2026-10-02 UTC na conversa d65c8a4a-06d3-484f-b94a-0d3806ce99bf). A garantia de 0 chamadas de IA (interpretação/composição) e 0 geocodificações é comprovada pela suíte de testes automatizados de integração, que cobre a matriz ampla (numéricos, ordinais, nomes, dúvidas de preço/distância, comandos de ver mais, precedência de contexto ativo, profissional histórico inativo, replay idempotente e recovery); o ensaio de produção real validou o caminho concreto de seleção numérica ("2") |
| T19 | Pool/páginas/teto | Aprovado automatizado na suíte existente de ranking/paginação |
| T20 | Página retida/terminal | Parcial: reserva/concorrência e disposição auditada de holds implementadas; política de obsolescência e fechamento de páginas terminais ainda exige definição/homologação |
| T21 | Escolha antes de aviso enviado | Aprovado automatizado: shown_at e consentimento exigidos |
| T22 | Escolhas concorrentes | Aprovado automatizado: mesma transação e selectionKey |
| T23 | Suspensão após apresentação | Aprovado PostgreSQL: primeira seleção também revalida e não cria contato |
| T24 | Serviço/cobertura/entitlement | Parcial: serviço/catálogo/cobertura testados; entitlement ainda ausente |
| T25 | Entrega bilateral | Aprovado em produção real (Golden E2E #2, 2026-10-01): seleção do cliente via Gateway (957450), contato CC-XKVLBBTF estabelecido imediatamente como shared sem aceite prévio, confirmação ao cliente (Shared Delivery 957451, Evolution ID 3EB0D8866D13B8800C9199) e notificação ao profissional (Dispatcher 957460 / Shared Delivery 957461, Evolution ID 3EB0B8E7A96BFA9E134B92) com status=sent no transporte e zero holds |
| T26 | Aceite/recusa concorrentes | Aprovado automatizado no domínio; entrega real pendente |
| T27 | Profissional/código alheio | Aprovado automatizado no domínio |
| T28 | Pessoa em dois papéis | Aprovado automatizado no roteamento existente |
| T29 | Recusa com outra busca | Aprovado em produção real (2026-10-01 e 2026-10-09): (1) Subfluxo de mesma busca homologado em 2026-10-01; (2) Ramo completo de preservação/retomada com outra busca ativa homologado em produção real em 2026-10-09 (CC-3SXZCVE8 e CC-N6BXRNT8), com Busca B preservada como ativa durante recusa, troca atômica de contexto na retomada com Busca B suspensa em location e Busca A reativada em selection, exactly-once, e zero holds (ver docs/launch-readiness/02-t29-real-e2e-closeout.md) |
| T30 | OTP e limite de tentativas | Aprovado automatizado (PR #11, Migration 022: desafios OTP passwordless, rate limit, TTL e expiração segura) |
| T31 | Duas contas no painel | Aprovado automatizado (PRs #10–#13: contas de usuário isoladas, sessões e vínculo via memberships) |
| T32 | Revogação/troca de telefone | Parcial: troca bloqueada no autosserviço; identidade com auditoria em professional_membership_events |
| T33 | Autoativação administrativa | Aprovado no handler real do BFF com dependências simuladas: status/identidade rejeitados antes do proxy |
| T34 | Conclusão/contestação | Aprovado em produção real (2026-10-01): (1) Declaração e confirmação bilateral homologadas no Golden E2E #2 (CC-XKVLBBTF), com contact=completed, completion=confirmed e zero holds; (2) Contestação pelo cliente homologada em produção real (CC-HMRKEW65, completion 9d24efd9-82bf-4f2e-a67d-e72cf70dc09d, evento declarado 59915c03-b55d-45ff-b6fc-3a482eae1f5c, evento contestado 6a9571b8-816b-4244-af46-1eb51f9cbe7b), com completion.state=contested, contact.status=shared e todos os 4 outbounds com status=sent no transporte e zero holds |
| T35 | Avaliação elegível/única | Próxima etapa (PR #16: Reviews & Ratings v1; condicionado a contact completion) |
| T36 | Moderação auditada | Não implementado |
| T37 | Pagamento fora de ordem | Congelado: gateways de pagamento suspensos por decisão de produto |
| T38 | Entitlement/trial/legado | Aprovado automatizado (PR #14, Migration 025: planos de assinatura e entitlements marketplace_access; billing congelado) |
| T39 | Browser/teclado/mobile | Não executado nesta rodada; testes de BFF não substituem browser E2E |
| T40 | Opt-out/janela de canal | Não executado; modalidade e política operacional pendentes |
| T41 | Anonimização/retenção | Parcial: logs sanitizados; política de expurgo/dados imutáveis pendente |
| T42 | Backup/restauração | Não executado; runbook sem alegação de ensaio realizado |
| T43 | Carga/providers lentos | Parcial: testes de corrida/leases; carga e SLOs não medidos |
| T44 | Migrations/rollback | CI ampliado até 026: P0026 e proteções anteriores (P0025, P0024, P0023, P0022, P0020, etc.), down compatível 026–008, reaplicação 008–026 e rodada completa PostgreSQL |
| T45 | Regionalismos/abreviações | Corpus B2 inclui casos sintéticos; execução com propostas simuladas não mede compreensão real |
| T46 | Problema sem profissão | Aprovado automatizado: hipótese ligada ao catálogo real, confirmação antes da promoção; modelo real pendente |
| T47 | Dados fora de ordem | Teste PostgreSQL B2 de cidade antes do serviço; preservação de slots e no_matches |
| T48 | Correção de contexto | Aprovado Inbox/PostgreSQL: correção de serviço e cidade, nova busca, outro slot/histórico preservados; geocoder simulado |
| T49 | FAQ no meio da busca | Aprovado: custo/catálogo/interrupção preservam busca e hipóteses, não compõem pergunta desnecessária; replay sem IA |
| T50 | Rajada durante processamento | Recuperação autônoma implementada: FIFO/data+ID, fencing, backoff/limite, quarentena/admin e export inativo; integrações reais e evidências em INBOX_RECOVERY.md. Motor n8n, carga e acionamento real ainda não homologados |
| T51 | Paráfrases de comandos | Número/nome/comandos exatos reutilizam controlador existente, sem IA; paráfrases sensíveis não reconhecidas pedem esclarecimento |
| T52 | Negação/hipótese/citação | Regressões determinísticas + corpus adversarial; recusa não equivale a descrição de defeito negado; avaliação real pendente |
| T53 | Prompt injection contextual | Schema/evidência/catálogo, limites e ações restritas testados; resistência semântica universal não comprovada |
| T54 | Redação com fatos críticos | Plano de pergunta/target compartilhado, composeQuestion testado e traces para revisão; preço/contato/opções/consentimento determinísticos; fidelidade semântica real pendente |
| T55 | IA lenta/indisponível | Interpretação e composição: timeout/saída inválida/indisponibilidade/quota/fallback e memória preservada; nenhuma chamada externa real |
| T56 | Replay depois de geração | Aprovado PostgreSQL: proposta, pergunta e fallback persistidos antes dos efeitos, rollback forçado e retry sem regeneração |
| T57 | Fora do escopo/suporte | Redirecionamento ao marketplace preserva estado; entendimento real de intenções ainda não avaliado |
| T58 | Local ambíguo | Geocoder conserva decisão de ambiguidade; controlador não inventa UF/coordenadas; redação/geocoder reais pendentes |
| T59 | Comparar modelos/prompts | 300 congelados + 18 readiness, interpretação/composição e hashes; proposta nano/mini, custo e limites em B2_HOMOLOGATION_PLAN.md; comparação real NÃO executada |
| T60 | Naturalidade contextual | NÃO comprovada: traces de entrada/contexto/interpretação/decisão/resposta preparados para revisão humana; modelo real e Inbox real ponta a ponta ainda requerem homologação |

Nenhuma parte simulada acima autoriza lançamento comercial ou alteração automática
de fluxos em produção. Não há assinatura, identidade individual ou avaliações
prontas para usuários finais neste checkpoint.

Checkpoint transporte: gateway/dispatcher disputam a mesma Outbox em teste
PostgreSQL; hold impede retry mesmo após lease expirada. Exports sem secrets e
sem gravação de dados de execução. Compatibilidade estática por tag e matriz dos
32 casos em [TRANSPORT_HOMOLOGATION.md](TRANSPORT_HOMOLOGATION.md). Simulação
de grafo não é motor n8n. Aviso de áudio direto foi substituído pela admissão durável020 e Shared Delivery;
isso não comprova exactly-once externo. Nenhum envio real realizado.


## Checkpoint 020 — durabilidade de áudio e intervenção

Implementação e critérios de aceite em [TRANSPORT_DURABILITY.md](TRANSPORT_DURABILITY.md).
Nova migration020; áudio/aviso antes do ACK, resultado persistido, leases/quarentena,
retenção, disposição auditada e diagnóstico agregado. CI inclui PostgreSQL real,
rollback protegido/compatível020–008 e reaplicação até020. Serviços externos
simulados; versões fixadas e exports inativos. Nenhuma variável/credential nova.
Publicação futura: todas as migrations pendentes (017–020 quando aplicável) antes
da API; depois cinco workflows ainda inativos e homologação autorizada. B2 off.
Não houve deploy/merge/envio/avaliação paga. V1 comercial continua incompleta.

## Evidência cumulativa — 2026-09-10

[CUMULATIVE_REVIEW.md](CUMULATIVE_REVIEW.md) consolida a revisão contra main,
correções e gates operacionais. Código `137feeb56bbe5b39f57250ac85f8137215ae56ce`,
[CI success](https://github.com/koglim/contato/actions/runs/34514506480):
311 API + 12 web + 40 workflows, 150 PostgreSQL antes e depois da reaplicação,
migrations até 020, B2 300 + 18 simulados. Novas regressões provam que resultado
ou expurgo de áudio não contornam quarentena/encerramento da Inbox. Nenhum item
de homologação real acima foi promovido a aprovado por consequência desses mocks.

---

## Validação em Produção — Golden E2E #2 (2026-10-01)

Em 2026-10-01, o fluxo happy-path ponta a ponta do marketplace foi validado em ambiente real de produção contra a Evolution API `v2.3.7`, n8n `v1.123.21` e ContatoCerto API (`contatocerto-api` @ `909ab53853a5df2f5da2795ff86a653041fc7863`):

1. **Busca e Apresentação:** Inbound `Contato Certo:3A4C00420AE15018A405` via Gateway (Execução 957356), resposta de 3 opções com status=sent via Shared Delivery (Execução 957357, Evolution ID `3EB033290A4CC069A552D0`).
2. **Seleção Bilateral (T25):** Inbound "2" `Contato Certo:3ACC301E46EF43654338` via Gateway (Execução 957450), contato `35c4ab81-fb23-4562-bb96-a09258546f31` estabelecido diretamente como `shared` (`CC-XKVLBBTF`). Confirmação ao cliente (Execução 957451, Evolution ID `3EB0D8866D13B8800C9199`) e notificação ao profissional (Dispatcher Execução 957460 / Shared Delivery Execução 957461, Evolution ID `3EB0B8E7A96BFA9E134B92`) observadas com status=sent no transporte e zero holds.
3. **Ciclo de Conclusão Bilateral (T34 — Declaração e Confirmação):**
   - Declaração pelo profissional via Gateway (Execução 972785, `Contato Certo:A54F9E724C150127401A9C8F595E34AD`), resposta de registro ao profissional (Execução 972786, Evolution ID `3EB0597FA10F48B3059293`) e prompt de confirmação ao cliente (Dispatcher Execução 972791 / Shared Delivery Execução 972794, Evolution ID `3EB07DAC2F01B9EE979CE6`).
   - Confirmação pelo cliente via Gateway (Execução 973235, `Contato Certo:3A8C35510FB1F1913F20`), resposta final ao cliente (Execução 973236, Evolution ID `3EB0D18D9F44920DA0E700`) e notificação final de encerramento ao profissional (Dispatcher Execução 973240 / Shared Delivery Execução 973243, Evolution ID `3EB0C8A8F5BDE736DD95D1`).
4. **Resultado da Homologação:** 7/7 outbounds observados no Golden E2E #2 ficaram com `status: sent`, `provider_message_id` persistido, `contact_completed=true`, `completion_confirmed=true`, 0 transport holds gerados e integridade total de identidade (sem criação de clientes duplicados após correção no PR #24).

---

## Validação em Produção — Edge Flows: Indisponibilidade (T29) e Contestação (T34) (2026-10-01)

Também em 2026-10-01, foram executados ensaios autorizados em produção real para os fluxos de exceção/borda do marketplace:

1. **Indisponibilidade Profissional e Segunda Seleção na Mesma Busca (Subfluxo de mesma busca de T29):**
   - **Busca:** Search request `5f95b215-2e79-4bd9-9217-12f38af8f7f7`, conversa `f444c327-fb07-4d7b-a3dd-ef8bda3286a5`.
   - **Primeiro Contato (Farol):** Contato `d85e04ba-850f-487e-8cbf-f3e8e6703350` (`CC-PT89QEVJ`). Declaração de indisponibilidade via inbound `233fa962-b22c-4eb5-9e78-342607454363` (`unavailability_declared`). Registrado evento imutável `db1716e6-2198-4a81-8b4a-5471a8f53c08`. Notificação ao cliente (Evolution ID `3EB0FD05F2E627D1ADF900`) e resposta ao profissional (Evolution ID `3EB06B006337332801CBF1`) observadas com status=sent no transporte e zero holds.
   - **Reabertura de Busca:** `search_request.status` reaberto para `matched`, `conversation.status` mantido `active` com `pending_slot=selection` e 0 transport holds. Contato do primeiro profissional preservado no status `shared`.
   - **Segunda Escolha (Julia):** Inbound de seleção `1a4dd56b-ab7a-4b1a-94f2-eb2db1072a31` gerou segundo contato `cc13a85c-e79f-469c-8519-c43316bf437c` (`CC-HMRKEW65`) no status `shared` na mesma busca. Resposta de seleção ao cliente (Evolution ID `3EB0F257061714E96418E6`) e notificação inicial à profissional (Evolution ID `3EB015831CCA09F6E1CF1C`) observadas com status=sent no transporte e zero holds. Busca finalizada como `selected` e conversa como `completed`. O ramo adicional de T29 tratando de preservação/retomada com outra busca ativa foi homologado em produção real em 2026-10-09 (ver item 4 abaixo e [`docs/launch-readiness/02-t29-real-e2e-closeout.md`](launch-readiness/02-t29-real-e2e-closeout.md)).
2. **Contestação Bilateral de Conclusão de Serviço (T34):**
   - **Contato:** `cc13a85c-e79f-469c-8519-c43316bf437c` (`CC-HMRKEW65`).
   - **Declaração do Profissional:** Evento `59915c03-b55d-45ff-b6fc-3a482eae1f5c` criou agregado de conclusão `9d24efd9-82bf-4f2e-a67d-e72cf70dc09d` (`pending_confirmation`). Prompt ao cliente (Outbound `02a05352-27bb-4fd1-9bf0-b6ffb6b5642f`, Evolution ID `3EB0684D55715F234C2460`) e resposta ao profissional (Outbound `74f7f047-008d-4342-8a5e-dd30ed240a66`, Evolution ID `3EB04DB9CAE74E1FB85A02`) observados com status=sent no transporte.
   - **Contestação pelo Cliente:** Evento `6a9571b8-816b-4244-af46-1eb51f9cbe7b` registrou contestação do cliente, promovendo `completion.state=contested`, preservando `contact.status=shared`, `confirmed_at=null` e preenchendo `contested_at`. Notificação de contestação ao profissional (Outbound `77188dbf-40de-4ab6-9aa4-660b78f1425d`, Evolution ID `3EB0DB236CAC0299155F86`) e resposta ao cliente (Outbound `e71bb54b-aac3-498d-9332-332feb5b1f32`, Evolution ID `3EB0DE3F82BED016915D03`) observadas com status=sent no transporte.
   - **Totais de Conclusão:** 1 declaração profissional, 1 contestação cliente, 0 confirmações, 0 holds de transporte.
3. **Revalidação em Produção — Contexto Obsoleto / Seleção Expirada (T18):**
   - **Data e Horários:** Contexto de busca expirada originado em 2026-10-01 UTC; ensaio real de revalidação executado em 2026-10-02 UTC (inbound recebido em `2026-10-02T02:38:20.742Z`, outbound enviado em `2026-10-02T02:38:21.744Z`).
   - **Runtime em Produção:** `contatocerto-api` @ `69bbf770026e72caacb69bd4b3d7ba5d6bf3f9b0`.
   - **Contexto de Busca Expirada:** `search_request_id: 81ace3cf-b8c8-434f-a0d4-a9837e663431`, `conversation_id: d65c8a4a-06d3-484f-b94a-0d3806ce99bf` (TTL de 30 minutos esgotado; sem conversa de busca ativa aberta no momento do teste).
   - **Lista Apresentada Historicamente:** 1. Julia, 2. Farol, 3. Richard.
   - **Inbound do Cliente:** Mensagem "2" recebida via inbound `ca42f314-2ed0-49ca-8960-8c03285bc9c7` (Provider message ID `Contato Certo:3ADBCBBB4F159D366BEB`).
   - **Processamento:** Roteado para rota contextual (`route=contextual`, `status=information`), finalizado com `status=processed`, `error_code=null`, `recovery_state=active`.
   - **Resposta Determinística Enviada:** *"Essa lista de profissionais expirou. Envie uma nova mensagem com o serviço e a cidade para eu buscar opções atualizadas."*
   - **Outbound:** Mensagem `02979644-88d5-4976-a3e6-509b5807e035` (`purpose=customer_reply`), Evolution Provider Message ID `3EB0341F401FF10E9E72E8`, `status=sent`, `delivery_hold_reason=null`.
   - **Verificação de Domínio e Invariantes em Produção:**
     - `contacts_created = 0`
     - `searches_created = 0`
     - `expired_matches_selected = 0`
     - `professional_notifications_created = 0`
     - `transport_hold = null`
     - `T18_REAL_PRODUCTION_FINAL = PASS`
   - **Escopo e Atribuição de Evidências:**
     - **Testes Automatizados / Integração:** Comprovam a garantia estrita de **0 chamadas de interpretação por IA**, **0 chamadas de composição por IA** e **0 chamadas ao geocodificador** via fast-path em código, além de cobrirem a matriz ampla de variações de T18 (seleção numérica, ordinais, seleção por nome, dúvidas de preço/distância/detalhes, comandos de ver mais, precedência de contexto ativo, profissional histórico inativo/suspenso, replay idempotente e recovery sem side-effects).
     - **Ensaio Real de Produção:** Validou com precisão a resposta determinística esperada no canal WhatsApp para o caminho concreto de seleção numérica ("2") após expiração do TTL de 30 minutos, com `status=sent`, `provider_message_id` persistido, zero holds e zero mutações de domínio/negócio.
4. **Preservação e Retomada com Outra Busca Ativa (T29 Completo — 2026-10-09):**
   - **Data do Ensaio:** 2026-10-09 (Tentativa #2 realizada em produção real).
   - **Busca A:** `450ba090-ffc0-4e16-903c-e81dae33bbfc` (`CC-3SXZCVE8`), profissional Richard (`3a4c8330-a68e-4b18-b70e-3700330c0413`), contato `a6cc997d-89e2-462a-b7de-eec2dfc24e9c` (`shared`).
   - **Busca B:** `2da79047-f0cd-4c5a-b1f6-51b6c392e2bd` iniciada após a seleção de Richard, quando a conversa da Busca A já estava `completed`, o Contato A permanecia `shared` e a Busca A ainda estava dentro do TTL; Busca B tornou-se a única conversa ativa em `pending_slot=location`.
   - **Recusa do Profissional:** Richard declarou indisponibilidade via clique em botão ("Não consigo atender"), consumindo token `d5bf1e85-8940-415c-8143-5851628c65c1` e registrando evento único `0584c353-94af-4269-a0c8-4463bfb5daa5`. A Busca B permaneceu intacta e ativa. O cliente foi notificado com instrução explícita de retomar Busca A (`retomar CC-3SXZCVE8`).
   - **Retomada pelo Cliente:** Cliente enviou `retomar CC-3SXZCVE8` via WhatsApp (`c3ba57e6-63b8-42a7-ba30-bda98dc757b8`). Contextos foram trocados atomicamente: Busca B suspensa com `resume_slot=location` e `resume_code=CC-N6BXRNT8`; Busca A reativada com `status=active` e `pending_slot=selection`. Cliente notificado via outbound `9c6507a6-dbe1-4894-a02b-689030e92177` (`status=sent`).
   - **Resultado:** 12/12 invariantes aprovados, zero contatos duplicados, exatamente uma conversa ativa após troca, `T29_REAL_E2E_RESULT=PASS` ([`docs/launch-readiness/02-t29-real-e2e-closeout.md`](launch-readiness/02-t29-real-e2e-closeout.md)).



