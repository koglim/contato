# Roadmap do ContatoCerto

Este documento define o planejamento estruturado de evolução do **ContatoCerto**. Para manter o foco e a estabilidade técnica, o roadmap é organizado em horizontes de prioridade sem datas arbitrárias de calendário.

---

# DONE

Funcionalidades totalmente concluídas, integradas ao branch `main` e validadas por suítes de testes automatizados:

* **Núcleo de Busca e Catálogo:** Resolução de serviços com tolerância fonética/fuzzy, malha geográfica de municípios brasileiros (IBGE) via PostGIS e fallback Pelias/HeiGIT.
* **Algoritmo de Matching e Ranking:** Algoritmo justo (*fair-v1*), pool de até 20 profissionais elegíveis, apresentação em blocos de 3 e limite máximo de 6 profissionais por busca.
* **Contato Bilateral e Consentimento:** Transação atômica que registra o contato (`contacts`), captura snapshot dos dados cadastrais e gera o código público `CC-XXXXXXXX` mediante consentimento mútuo de telefone.
* **Durabilidade de Mensageria (Inbox & Outbox):** Fila de entrada e saída com controle de leases transacionais, proteção contra crash de workers, expurgo sanitizado, deduplicação idempotente e quarentena de conflitos.
* **Motor Conversacional Híbrido (B2):** Arquitetura para processamento de áudio/texto com memória estruturada de hipóteses e slots contextuais.
* **Identidade Individual do Profissional (PRs #10 a #13):** Separação de contas (`accounts`) e profissionais (`professionals`), autenticação sem senha (OTP de 6 dígitos via e-mail com salt/pepper), autocadastro e reivindicação de perfis legados.
* **Elegibilidade de Profissionais:** Máquina de estados de governança cadastral (`draft`, `pending`, `active`, `suspended`, `inactive`) e vinculação a categorias/cidades.
* **Assinaturas e Entitlements Neutros (PR #14):** Modelagem de planos e assinaturas de profissionais (Migration 025). Lock atômico de concorrência (`FOR UPDATE OF professionals`) garantindo que apenas assinantes ativos recebam novos contatos.
* **Conclusão e Confirmação de Atendimentos (PR #15):** Registro de encerramento do serviço (`concluído CC-XXXXXXXX`), confirmação afirmativa do cliente (`confirmar CC-XXXXXXXX`) e contestação (`contestar CC-XXXXXXXX`) isolados de contexto de busca.
* **Painel Web do Profissional (`/dashboard`):** Aplicação Next.js com BFF, autenticação via cookie assinado, edição de dados cadastrais e histórico de serviços.

---

# NOW

Iniciativas ativas e imediatas para o ciclo atual de desenvolvimento:

1. **Ciclo de Conexão v2 ([ADR-004](decisions/ADR-004-connection-lifecycle-v2-direction.md)):**
   * Ajustar a semântica do domínio para que a seleção do cliente com consentimento bilateral represente **conexão imediatamente estabelecida**.
   * Remover o aceite obrigatório do profissional do caminho crítico da entrega e do ciclo de vida do contato.
   * Adaptar mensagens do WhatsApp para refletir a oportunidade já conectada e tratar a recusa profissional apenas como sinal declaratório de indisponibilidade.
2. **Conversation Intelligence / Seleção v2:**
   * Permitir perguntas comparativas e esclarecimentos factuais entre os profissionais apresentados sem quebrar o fluxo de escolha.
   * Auditoria formal de consumo de tokens, tamanho de prompts, latência e fast paths determinísticos.
3. **Localização v2 (Fundação de Entrada):**
   * Suporte a mensagens de localização nativa do WhatsApp (pino geográfico / mapa) e retenção inteligente da última localização com confirmação explícita (*"É para Sinop - MT novamente?"*).
4. **Reconciliação n8n / Evolution / Workflows Versionados:**
   * Atualizar os fluxos instalados no ambiente remoto (EasyPanel) a partir dos arquivos versionados em `workflows/n8n/`, habilitando o envio de desafios de autenticação (`professional_auth_challenge`).
5. **Sincronização Contínua da Documentação:**
   * Manter a disciplina de atualizar a documentação canônica a cada PR com alteração funcional ou arquitetural.

---

# NEXT

Funcionalidades planejadas para a sequência imediata após a conclusão do bloco NOW:

* **Avaliações e Reputação (Reviews & Ratings):** Coleta estruturada de notas e depoimentos após a confirmação bilateral da conclusão, com ponderação no algoritmo de ranking.
* **Telemetria e Analytics do Funil:** Instrumentação e produto de visualização de métricas de conversão ao longo do funil (*candidate → match → shown → selected → connection → completion*).
* **Painel Web do Profissional v2:** Expansão do `/dashboard` com métricas visuais de exposição, taxa de seleção, histórico financeiro de assinatura e status de reputação.
* **Painel Administrativo para Operadores:** Interface para auditoria de quarentena da Inbox, moderação de perfis e suporte ao cliente.
* **Homologação Completa de Transporte:** Bateria de testes de ponta a ponta com instâncias reais de WhatsApp e múltiplos números sob tráfego concorrente.
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
