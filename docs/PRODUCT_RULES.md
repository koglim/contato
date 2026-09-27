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
* **Regra de Uso na UX:** O código `CC-...` é exibido em todas as notificações formais de contato, mas **não deve ser exigido do cliente** quando houver contexto suficiente na conversa (ex.: se o cliente só possui um atendimento ativo, um simples *"já terminei o serviço"* deve ser tratado contextualmente sem obrigá-lo a copiar e colar o código). Quando houver ambiguidade (múltiplos atendimentos concorrentes), o código serve como ferramenta definitiva de desempate.

---

## 4. Papel do Painel Web do Profissional (`/dashboard`)

* **Superfície de Gestão:** O painel web é uma ferramenta de apoio para consulta de histórico, edição de dados cadastrais, visualização de áreas de cobertura e gestão de perfil.
* **Não-Bloqueante:** O profissional **nunca** deve ser obrigado a acessar o painel para receber um lead, visualizar o telefone de um cliente que o escolheu ou iniciar o atendimento. O canal primário e operacional de entrega é o WhatsApp.

---

## 5. Taxonomia da Verdade da Informação (Information Truth Classification)

Para evitar fraudes, distorções de reputação e falsas expectativas de clientes, o ContatoCerto classifica rigorosamente a natureza de qualquer dado manipulado na plataforma:

| Categoria de Dado | Definição | Exemplo no Sistema | Grau de Confiança |
| :--- | :--- | :--- | :---: |
| **1. Fato Observado pela Plataforma** | Evento registrado diretamente pela infraestrutura e auditado via log/banco. | Timestamp de envio da Outbox, número de vezes que o perfil foi exibido (`shown_at`). | **Absoluto** |
| **2. Fato Bilateralmente Confirmado** | Informação validada mutuamente por ambas as partes independentes. | Cliente e profissional confirmam a conclusão do mesmo atendimento (`completed_confirmed`). | **Altíssimo** |
| **3. Estado Derivado Determinístico** | Cálculo reproduzível derivado de regras de negócio estritas sobre fatos observados. | Distância espacial PostGIS entre o profissional e o município da busca. | **Altíssimo** |
| **4. Fato Declarado pelo Cliente** | Afirmação unilateral do contratante sobre o mundo real. | Cliente afirma que o serviço foi concluído satisfatoriamente. | **Subjetivo / Declaratório** |
| **5. Fato Declarado pelo Profissional** | Afirmação unilateral do prestador sobre si ou sobre o serviço. | Profissional clica em "não tenho disponibilidade" ou afirma que concluiu o trabalho. | **Subjetivo / Declaratório** |

> [!IMPORTANT]
> **Invariante de Governança de Dados:**
> Futuros algoritmos de ranking, incentivos, penalidades ou reputação **nunca devem tratar declarações unilaterais do profissional como verdades absolutas**. A auto-declaração de indisponibilidade ou conclusão é apenas uma declaração de intenção sujeita a confirmação do cliente ou telemetria objetiva da plataforma.

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

* **Direitos de Acesso (*Entitlements*):** A assinatura ativa de um profissional é a condição necessária para que seu perfil participe do pool de matching e seja exibido para novos clientes.
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
