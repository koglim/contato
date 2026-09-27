# Regras de Negócio e Princípios Canônicos (Product Rules)

Este documento estabelece as regras de negócio, limites operacionais e princípios de governança do **ContatoCerto**. Qualquer alteração de código ou expansão de arquitetura deve obedecer estritamente a estas diretrizes.

---

## 1. Limites de Autoridade da Inteligência Artificial (AI Boundaries)

A Inteligência Artificial (LLMs) desempenha um papel fundamental de tradução de intenção, enriquecimento de linguagem e experiência conversacional fluida, mas opera sob **limites estritos de autoridade** ([ADR-002](decisions/ADR-002-ai-interpretation-vs-deterministic-domain-authority.md)):

### ✅ O que a IA PODE Fazer:
* Interpretar a intenção do usuário a partir de textos informais ou áudios transcritos.
* Identificar termos candidatos a serviços do catálogo e menções a cidades/estados.
* Formular respostas empáticas, esclarecimentos e perguntas de desambiguação em linguagem natural.
* Explicar atributos factuais cadastrados dos profissionais apresentados.

### 🚫 O que a IA NUNCA PODE Fazer (Privilégio Exclusivo do Domínio Determinístico):
* **Identidade e Posse de Telefone:** A IA não autentica quem é o usuário nem valida posse de número E.164.
* **Consentimento de Compartilhamento:** A IA não infere consentimento implícito; o consentimento exige uma ação transacional auditada.
* **Mutação de Ranking e Seleção:** A IA não escolhe quem vence a busca nem altera posições de ranking arbitrariamente.
* **Criação e Conclusão de Contatos:** A IA não gera registros de `contacts` nem altera status de atendimentos sem comandos validados pelo motor de regras determinístico.
* **Assinaturas e Finanças:** A IA não concede planos, isenções ou altera direitos de acesso (*entitlements*).

---

## 2. Experiência do Cliente: Linguagem Natural em Primeiro Lugar

* **Sem Fricção Técnica:** O cliente nunca deve ser forçado a decorar termos técnicos de categorias, preencher IDs ou navegar por comandos rígidos quando o texto natural for claro.
* **Interpretação Contextual Flexível:** O sistema deve aceitar comandos por número da opção (`"1"`), pelo primeiro nome do profissional (`"quero falar com o Carlos"`) ou por indicações contextuais claras (`"o primeiro da lista"`).

---

## 3. Código Público de Contato (`CC-XXXXXXXX`)

* **Finalidade Canônica:** O código público (ex.: `CC-AB12CD34`) é uma chave durável de referência bilateral para auditoria, rastreabilidade e **desambiguação**.
* **Comportamento Atual (CURRENT):** O parser determinístico atual de conclusão, confirmação e contestação (PR #15) exige estritamente a presença do código público `CC-XXXXXXXX` na mensagem recebida.
* **Direção Futura de UX (TARGET):** No âmbito do Conversation Intelligence v2, o código não deve ser exigido do usuário quando houver contexto suficiente e unívoco na conversa (ex.: quando existir apenas um atendimento ativo). Caso haja múltiplos atendimentos simultâneos, o código continua atuando como ferramenta definitiva de desempate.

---

## 4. Papel do Painel Web do Profissional (`/dashboard`)

* **Superfície de Gestão:** O painel web é uma ferramenta de apoio para gestão de perfil, serviços atendidos, áreas geográficas de cobertura e disponibilidade.
* **Telefone Protegido:** No painel atual, o telefone é somente-leitura (`readOnly`) para prevenir mutações arbitrárias de identidade sem verificação.
* **Não-Bloqueante:** O profissional **nunca** deve ser obrigado a acessar o painel para receber um lead, visualizar o telefone de um cliente que o escolheu ou iniciar o atendimento. O canal primário e operacional de entrega é o WhatsApp.

---

## 5. Taxonomia da Verdade da Informação (Information Truth Classification)

Para evitar fraudes, distorções de reputação e falsas expectativas de clientes, o ContatoCerto classifica rigorosamente a natureza de qualquer dado manipulado na plataforma:

| Categoria de Dado | Definição | Exemplo no Sistema | Grau de Confiança |
| :--- | :--- | :--- | :---: |
| **1. Fato Observado pela Plataforma** | Evento registrado diretamente pela infraestrutura e auditado via log/banco. | Timestamp de envio na Outbox (`channel_outbound_messages`), contagem de apresentações (`shown_at`). | **Absoluto** |
| **2. Fato Bilateralmente Confirmado** | Informação validada mutuamente por ambas as partes independentes. | Cliente e profissional confirmam a conclusão do mesmo atendimento (`state = 'confirmed'` em `contact_completions`). | **Altíssimo** |
| **3. Estado Derivado Determinístico** | Cálculo reproduzível derivado de regras de negócio estritas sobre fatos observados. | Distância espacial PostGIS entre o raio do profissional e as coordenadas da busca. | **Altíssimo** |
| **4. Fato Declarado pelo Cliente** | Afirmação unilateral do contratante sobre o mundo real. | Cliente declara que o serviço foi concluído. | **Subjetivo / Declaratório** |
| **5. Fato Declarado pelo Profissional** | Afirmação unilateral do prestador sobre si ou sobre o serviço. | Profissional sinaliza que está indisponível ou afirma que concluiu o trabalho. | **Subjetivo / Declaratório** |

> [!IMPORTANT]
> **Invariante de Governança de Dados:**
> Futuros algoritmos de ranking, incentivos, penalidades ou reputação **nunca devem tratar declarações unilaterais do profissional como verdades absolutas**. A auto-declaração de indisponibilidade ou conclusão é apenas uma declaração de intenção sujeita a confirmação da contraparte ou telemetria objetiva da plataforma.

---

## 6. Neutralidade de Recomendação e Apresentação Factual

* **Regras Estritas de Apresentação:** Os profissionais exibidos em uma busca são determinados exclusivamente pelo algoritmo de matching geográfico e catálogo aprovado.
* **Vedada a Fabricação de Dados de Profissionais:** Ao apresentar opções ou esclarecer dúvidas conversacionais do cliente, o sistema **está expressamente proibido de inventar**:
  * Preços médios, tabelas de valores ou estimativas de orçamento;
  * Prazos de garantia que o profissional não declarou explicitamente;
  * Horários específicos de atendimento ou disponibilidade em tempo real sem integração comprovada;
  * Níveis de satisfação ou selos que não possuam lastro factual comprovado no banco de dados.

---

## 7. Assinaturas e Acesso a Novas Oportunidades

* **Direitos de Acesso (*Entitlements*):** Para profissionais sob gerenciamento individual (`management_mode = 'account_managed'`), a assinatura ativa é condição obrigatória para participação no pool de matching. Perfis legados não reivindicados (`management_mode = 'legacy_unmanaged'`) permanecem temporariamente isentos sob a política de transição.
* **Proteção a Contatos Históricos:** Se a assinatura de um profissional expirar ou for revogada:
  * Ele é imediatamente removido de novas buscas de clientes.
  * **Seus contatos anteriores legítimos permanecem válidos e acessíveis.** O profissional mantém o direito de consultar e concluir os atendimentos já conectados no passado.

---

## 8. Congelamento Financeiro e Gateways de Pagamento

* Conforme registrado em [ADR-003](decisions/ADR-003-billing-provider-decision-frozen.md), o ContatoCerto mantém congelada qualquer integração com intermediadores financeiros (Stripe, Mercado Pago, Asaas, etc.).
* Não há fluxos de checkout, geração de faturas nem cobranças automáticas no momento. Os planos e status são atribuídos administrativamente no domínio da aplicação.

---

## 9. Sistema de Avaliações e Reputação (Reviews)

* O ciclo de avaliações, notas e comentários após a conclusão de serviços encontra-se planejado para as próximas etapas de engenharia, mas **não está implementado no código atual** em `main`.
* O sistema atual suporta o ciclo de conclusão e confirmação factual ([PR #15](CONTACT_COMPLETION_CONFIRMATION.md)), servindo como base estrutural para a futura camada de reputação.

---

## 10. Ciclo de Conexão Bilateral v2 e Ausência de Segundo Aceite Obrigatório

* **Equação Canônica da Conexão:**
  $$\text{Participação elegível do profissional} + \text{Seleção ativa do cliente} + \text{Consentimento informado do cliente para compartilhamento bilateral dos contatos} = \mathbf{CONEX\tilde{A}O\ ESTABELECIDA}$$
* **Conexão Imediata em `shared`:** Após a seleção ativa e consentimento informado do cliente, o contato bilateral é persistido diretamente como `status = 'shared'`. Ambos os lados recebem os dados telefônicos recíprocos imediatamente via WhatsApp.
* **Inexistência de Segundo Aceite Obrigatório:** O profissional não precisa aceitar ou aprovar o lead para que a oportunidade exista formalmente. Frases como "aceito" ou "posso atender" atuam estritamente como reconhecimento de cortesia da plataforma, sem mutação transacional do status.
* **Declaração Unilateral de Indisponibilidade:** Mensagens de recusa ("não consigo", "recuso", etc.) geram registro imutável em `professional_unavailability_events` (protegido por gatilho com código de erro `P0027`), mantêm o contato no status `shared`, reativam a busca original para que o cliente selecione outro profissional e notificam o cliente via Outbox.
* **Múltiplas Conexões por Busca:** O índice único `(search_request_id, professional_id)` garante que o mesmo profissional não receba conexões duplicadas para a mesma busca, enquanto permite conexões subsequentes legítimas com outros profissionais caso o primeiro declare indisponibilidade.
* **Elegibilidade para Conclusão:** Qualquer contato no status `shared` é diretamente elegível para o ciclo de conclusão bilateral de serviço, independentemente de confirmações prévias do prestador.
