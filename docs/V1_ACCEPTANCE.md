# Matriz de aceite V1 — checkpoint de estabilização

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
| T01 | Serviço e cidade juntos | Parcial: fluxo determinístico existente; interpretação B2 pendente |
| T02 | Falta serviço/cidade | Parcial: conversas existentes; redação contextual pendente |
| T03 | Aspas/emoji/multiline | Aprovado no contrato puro de transporte; homologação do gateway pendente |
| T04 | Texto/resposta citada | Parcial: normalização testada; gateway instalado não executado |
| T05 | Áudio/limites/falhas | Não executado; falta export/versão do gateway e transporte de mídia |
| T06 | Próprio/grupo/evento inválido | Parcial: normalizador ignora; integração no webhook pendente |
| T07 | Autenticidade do webhook | Não executado; chave interna da API não autentica origem Evolution |
| T08 | Replay do inbound | Aprovado automatizado: Inbox, contato/Outbox únicos e conteúdo persistido |
| T09 | ID com payload conflitante | Aprovado automatizado: conflito sem sobrescrita |
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
| T20 | Página retida/terminal | Parcial: reserva/concorrência preservadas; recuperação administrativa auditada pendente |
| T21 | Escolha antes de aviso enviado | Aprovado automatizado: shown_at e consentimento exigidos |
| T22 | Escolhas concorrentes | Aprovado automatizado: mesma transação e selectionKey |
| T23 | Suspensão após apresentação | Aprovado PostgreSQL: primeira seleção também revalida e não cria contato |
| T24 | Serviço/cobertura/entitlement | Parcial: serviço/catálogo/cobertura testados; entitlement ainda ausente |
| T25 | Entrega bilateral | Parcial: API real + contrato do consumidor testados sem webhook profissional; WhatsApp real pendente |
| T26 | Aceite/recusa concorrentes | Aprovado automatizado no domínio; entrega real pendente |
| T27 | Profissional/código alheio | Aprovado automatizado no domínio |
| T28 | Pessoa em dois papéis | Aprovado automatizado no roteamento existente |
| T29 | Recusa com outra busca | Aprovado automatizado: preservação, retomada explícita e concorrência |
| T30 | OTP e limite de tentativas | Não implementado |
| T31 | Duas contas no painel | Não implementado; profissional demonstrativo fixo |
| T32 | Revogação/troca de telefone | Parcial: troca bloqueada no autosserviço; identidade/revalidação pendentes |
| T33 | Autoativação administrativa | Aprovado no handler real do BFF com dependências simuladas: status/identidade rejeitados antes do proxy |
| T34 | Conclusão/contestação | Não implementado como jornada |
| T35 | Avaliação elegível/única | Não implementado como jornada |
| T36 | Moderação auditada | Não implementado |
| T37 | Pagamento fora de ordem | Não implementado; fornecedor não escolhido |
| T38 | Entitlement/trial/legado | Não implementado |
| T39 | Browser/teclado/mobile | Não executado nesta rodada; testes de BFF não substituem browser E2E |
| T40 | Opt-out/janela de canal | Não executado; modalidade e política operacional pendentes |
| T41 | Anonimização/retenção | Parcial: logs sanitizados; política de expurgo/dados imutáveis pendente |
| T42 | Backup/restauração | Não executado; runbook sem alegação de ensaio realizado |
| T43 | Carga/providers lentos | Parcial: testes de corrida/leases; carga e SLOs não medidos |
| T44 | Migrations/rollback | Aprovado no CI até 017, protegido com fingerprints, down compatível e reaplicação |
| T45 | Regionalismos/abreviações | Não executado como avaliação B2 |
| T46 | Problema sem profissão | Parcial: aliases/fallback atuais; sem compreensão contextual B2 |
| T47 | Dados fora de ordem | Não executado como B2 |
| T48 | Correção de contexto | Não implementado como B2 |
| T49 | FAQ no meio da busca | Não implementado |
| T50 | Rajada durante processamento | Parcial: leases/conflitos; fila contextual de entradas pendente |
| T51 | Paráfrases de comandos | Parcial: resolvedores determinísticos atuais; B2 pendente |
| T52 | Negação/hipótese/citação | Parcial: regressões de seleção existentes; avaliação semântica B2 pendente |
| T53 | Prompt injection contextual | Não executado como B2; nenhuma nova IA ativada nesta rodada |
| T54 | Redação com fatos críticos | Parcial: presenter determinístico preservado; geração contextual pendente |
| T55 | IA lenta/indisponível | Parcial: fallback atual testado; controlador B2 pendente |
| T56 | Replay depois de geração | Parcial: texto da Outbox persistido; decisão B2 ainda não existe |
| T57 | Fora do escopo/suporte | Não implementado como B2 |
| T58 | Local ambíguo | Parcial: resolução conservadora existente; avaliação B2 pendente |
| T59 | Comparar modelos/prompts | Não executado; dataset 300 e avaliação autorizada pendentes |
| T60 | Naturalidade contextual | Não executado; requer implementação B2 e revisão humana |

Nenhuma parte simulada acima autoriza lançamento comercial ou alteração automática
de fluxos em produção. Não há assinatura, identidade individual ou avaliações
prontas para usuários finais neste checkpoint.
