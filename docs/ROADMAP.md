# Roadmap do ContatoCerto

Este documento define o planejamento estruturado de evolução do **ContatoCerto**. Para manter o foco e a estabilidade técnica, o roadmap é organizado em horizontes de prioridade sem datas arbitrárias de calendário.

---

# DONE

Funcionalidades totalmente concluídas, integradas ao branch `main` e validadas por suítes de testes automatizados:

* **Núcleo de Busca e Catálogo:** Resolução determinística de serviços com tolerância fonética/fuzzy, resolução em memória de municípios brasileiros (IBGE), cobertura geográfica espacial e cálculo de raio via PostGIS (`ST_DWithin`) e fallback Pelias/HeiGIT.
* **Algoritmo de Matching e Ranking:** Algoritmo justo (*fair-v1*), pool de até 20 profissionais elegíveis, apresentação em blocos de 3 e limite máximo de 6 profissionais por busca.
* **Contato Bilateral e Consentimento:** Transação atômica que registra o contato (`contacts`), captura snapshot dos dados cadastrais e gera o código público `CC-XXXXXXXX` mediante seleção e consentimento informado do cliente para o compartilhamento bilateral de contatos.
* **Durabilidade de Mensageria (Tabelas de Fila):** Tabelas `channel_inbound_messages` e `channel_outbound_messages` com controle de leases transacionais, proteção contra crash de workers, expurgo sanitizado, deduplicação idempotente e quarentena de conflitos.
* **Motor Conversacional Híbrido (B2):** Arquitetura para processamento de áudio/texto com memória estruturada de hipóteses e slots contextuais.
* **Identidade Individual do Profissional (PRs #10 a #13):** Separação de contas (`accounts`) e profissionais (`professionals`), autenticação sem senha (OTP de 6 dígitos via WhatsApp com TTL de 5 minutos e HMAC via `PROFESSIONAL_AUTH_PEPPER`), autocadastro e reivindicação de perfis legados.
* **Governança de Status Profissional:** Enum `professional_status` com estados estritos (`'draft'`, `'active'`, `'suspended'`), vínculo a categorias e áreas de atendimento.
* **Assinaturas e Entitlements Neutros (PR #14):** Modelagem de planos e assinaturas de profissionais (Migration 025). Lock atômico de concorrência (`FOR UPDATE OF professionals`) garantindo que apenas assinantes ativos no modo `account_managed` recebam novos contatos (perfis `legacy_unmanaged` provisoriamente isentos).
* **Conclusão e Confirmação de Atendimentos (PR #15):** Registro de encerramento do serviço (`concluído CC-XXXXXXXX`) por qualquer das partes, confirmação (`confirmar CC-XXXXXXXX`) ou contestação (`contestar CC-XXXXXXXX`) pela contraparte com código obrigatório no parser atual, isolados de contexto de busca.
* **Ciclo de Conexão Bilateral v2 (PR #17 — Migration 027):** Conexão imediata no status `shared` mediante seleção e consentimento informado do cliente, eliminação do segundo aceite obrigatório do profissional, telemetria imutável de indisponibilidade via `professional_unavailability_events` (P0027), suporte a múltiplas conexões por busca via índice `(search_request_id, professional_id)` e elegibilidade direta para conclusão a partir de `shared`.
* **Inteligência de Conversa e Seleção v2 (PR #18):** Interação natural na etapa de seleção ("me fale mais do João", "qual o mais perto?", "qual o mais barato?", "compara os dois", "tem mais opções?"), barreira estrita de segurança pergunta vs seleção (ADR-002), apresentadores determinísticos com 0 chamada de composição à IA, fast paths determinísticos com 0 chamadas de IA e comandos de conclusão/confirmação/contestação com código-livre ou código público com resolução inteligente de múltiplos contatos.
* **Painel Web do Profissional (`/dashboard`):** Aplicação Next.js com BFF, autenticação via cookie assinado, edição de dados cadastrais (telefone em modo somente-leitura), serviços, áreas de atendimento e disponibilidade.

---

# NOW

Iniciativas ativas e imediatas para o ciclo atual de desenvolvimento:

0. **Launch Readiness / Homologação (FASE ATIVA):**
   * Checkpoint A & A.2 de auditoria da realidade atual e runtime remoto concluído em 2026-09-28 ([`docs/launch-readiness/00-current-reality-audit.md`](launch-readiness/00-current-reality-audit.md)).
   * Próximos passos operacionais: confirmar pareamento WhatsApp no Evolution, checar tag/commit no EasyPanel para certificar `b9e48582`, e reimportar `shared-delivery.json` no n8n antes de habilitar OTP.
1. **Localização v2 (Fundação de Entrada):**
   * Suporte a mensagens de localização nativa do WhatsApp (pino geográfico / mapa) e retenção inteligente da última localização com confirmação explícita (*"É para Sinop - MT novamente?"*).
3. **Reconciliação n8n / Evolution / Workflows Versionados:**
   * Atualizar os fluxos instalados no ambiente remoto (EasyPanel) a partir dos arquivos versionados em `workflows/n8n/`, habilitando o envio de desafios de autenticação (`professional_auth_challenge`).
4. **Sincronização Contínua da Documentação:**
   * Manter a disciplina de atualizar a documentação canônica a cada PR com alteração funcional ou arquitetural.

---

# NEXT

Funcionalidades planejadas para a sequência imediata após a conclusão do bloco NOW:

* **Avaliações e Reputação (Reviews & Ratings):** Coleta estruturada de notas e depoimentos após a confirmação bilateral da conclusão, com ponderação no algoritmo de ranking.
* **Telemetria e Analytics do Funil:** Instrumentação e produto de visualização de métricas de conversão ao longo do funil (*candidate → match → shown → selected → bilateral connection → completion*).
* **Painel Web do Profissional v2:** Expansão do `/dashboard` com tela visual de atendimentos, métricas de exposição, taxa de seleção, histórico financeiro de assinatura e status de reputação.
* **Painel Administrativo para Operadores:** Interface para auditoria de quarentena da Inbox, moderação de perfis e suporte ao cliente.
* **Homologação Formal de Transporte de Lançamento:** Embora testes manuais com WhatsApp real tenham sido reportados pelo operador, a homologação formal de ponta a ponta da esteira de lançamento sob carga concorrente e múltiplos números permanece pendente.
* **Automação de Testes E2E Web:** Cobertura de fluxos do painel via Playwright.
* **Endurecimento de Confiabilidade:** Estratégias de backup/restore testadas, tolerância a particionamento de rede e observabilidade aprimorada com tracing distribuído.

---

# GROWTH

Ideias e alavancas de crescimento orgânico e viral do marketplace (para futura validação comercial):

* **Programa de Indicação entre Profissionais (Member Get Member):** Convite de colegas com link rastreável e bonificação de dias em plano de assinatura.
* **Perfil Público Compartilhável:** Página web indexável (SEO) do profissional com botão direto para contratação conversacional.
* **Loops de Recontratação:** Gatilhos para recontratar o mesmo profissional em serviços periódicos (ex.: limpeza de ar-condicionado a cada 6 meses).
* **Indicação pelo Cliente:** Ao final de um serviço bem avaliado, link para o cliente compartilhar o ContatoCerto com amigos no WhatsApp.
* *Nota de Dependência:* Todas as mecânicas de incentivo dependem da futura estratégia comercial e da descongelação das regras de faturamento.

---

# FROZEN

Itens formalmente congelados e expressamente **proibidos de implementação** no momento ([ADR-003](decisions/ADR-003-billing-provider-decision-frozen.md)):

* **Seleção e Integração de Gateways de Pagamento:** Stripe, Mercado Pago, Asaas, Pagar.me, etc.
* **Telas e Fluxos de Checkout:** Cobrança de cartão de crédito, débito ou emissão automatizada de chaves Pix para pagamento de planos.
* **Webhooks Financeiros e Reconciliação:** Tratamento de notificações de chargeback, inadimplência e conciliação bancária.
* **Mecânicas de Cupons e Descontos Monetários:** Promoções que afetem diretamente o faturamento.
* **Recompensas Financeiras em Dinheiro:** Premiações monetárias por indicação.

---

# PARKING LOT

Ideias e melhorias identificadas para reavaliação futura sem bloqueio do lançamento atual:

* **Follow-up Automático de Inatividade:** Mensagem delicada para clientes que pararam no meio da busca sem escolher.
* **Saudação Personalizada para Usuários Recorrentes:** Reconhecimento do histórico prévio do cliente na primeira mensagem.
* **Lembretes Inteligentes:** Alertas prévios para agendamentos combinados com o profissional.
* **Navegação Completa por Categorias:** Link externo para consultar o mapa integral de serviços atendidos.
* **Recomendações Suplementares:** Apresentação de uma nova página de opções caso o cliente rejeite explicitamente os 3 primeiros nomes sem precisar reiniciar a busca.
* **Envio de Documentos e Verificação de Identidade (KYC):** Upload de certificados, diplomas e antecedentes para selo de verificação no painel.
* **Portfólio com Fotos:** Galeria de imagens de trabalhos anteriores no perfil do profissional.
