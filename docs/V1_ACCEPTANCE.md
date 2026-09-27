# Matriz de aceite V1 — estabilização e B2

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
| T18 | Pergunta de contexto obsoleto | Não implementado; precisa regra por finalidade, sem descartar contato bilateral pelo TTL |
| T19 | Pool/páginas/teto | Aprovado automatizado na suíte existente de ranking/paginação |
| T20 | Página retida/terminal | Parcial: reserva/concorrência e disposição auditada de holds implementadas; política de obsolescência e fechamento de páginas terminais ainda exige definição/homologação |
| T21 | Escolha antes de aviso enviado | Aprovado automatizado: shown_at e consentimento exigidos |
| T22 | Escolhas concorrentes | Aprovado automatizado: mesma transação e selectionKey |
| T23 | Suspensão após apresentação | Aprovado PostgreSQL: primeira seleção também revalida e não cria contato |
| T24 | Serviço/cobertura/entitlement | Parcial: serviço/catálogo/cobertura testados; entitlement ainda ausente |
| T25 | Entrega bilateral | Parcial: API real + contrato do consumidor testados sem webhook profissional; WhatsApp real pendente |
| T26 | Aceite/recusa concorrentes | Aprovado automatizado no domínio; entrega real pendente |
| T27 | Profissional/código alheio | Aprovado automatizado no domínio |
| T28 | Pessoa em dois papéis | Aprovado automatizado no roteamento existente |
| T29 | Recusa com outra busca | Aprovado automatizado: preservação, retomada explícita e concorrência |
| T30 | OTP e limite de tentativas | Aprovado automatizado (PR #11, Migration 022: desafios OTP passwordless, rate limit, TTL e expiração segura) |
| T31 | Duas contas no painel | Aprovado automatizado (PRs #10–#13: contas de usuário isoladas, sessões e vínculo via memberships) |
| T32 | Revogação/troca de telefone | Parcial: troca bloqueada no autosserviço; identidade com auditoria em professional_membership_events |
| T33 | Autoativação administrativa | Aprovado no handler real do BFF com dependências simuladas: status/identidade rejeitados antes do proxy |
| T34 | Conclusão/contestação | Aprovado automatizado (PR #15, Migration 026: declaração bilateral, confirmação, contestação, serialização em contacts.id e P0026) |
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
