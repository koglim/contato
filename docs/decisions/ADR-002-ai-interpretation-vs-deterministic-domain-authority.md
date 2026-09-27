# ADR-002: Limites entre Interpretação por IA e Autoridade de Domínio Determinística

* **Status:** ACCEPTED
* **Data:** 2026-09-27
* **Decisores:** Engenharia e Produto ContatoCerto

---

## Contexto

O ContatoCerto integra modelos de linguagem de grande porte (LLMs via OpenAI) para proporcionar uma experiência de atendimento conversacional humanizada pelo WhatsApp. No entanto, sistemas baseados em LLMs são probabilísticos e sujeitos a alucinações, variações de saída e potenciais brechas de injeção de prompt.

Em um marketplace transacional, operações críticas como cobrança, autenticação, elegibilidade, cálculo de distâncias, concessão de consentimento e criação de contatos exigem garantias formais de consistência, idempotência e auditabilidade jurídica.

## Decisão

Estabelecer uma divisão estrita de responsabilidades entre a camada de interpretação de IA e o núcleo determinístico da aplicação:

1. **Escopo da Inteligência Artificial (Interpretação e Fluidez):**
   * A IA atua exclusivamente na extração de intenções, mapeamento de termos livres para serviços do catálogo, extração de menções de localização geográfica e composição de respostas amigáveis.
   * A IA pode responder dúvidas explicativas com base exclusiva em dados factuais já persistidos no banco de dados.
2. **Escopo Exclusivo do Domínio Determinístico (Regras e Autoridade):**
   * **Identidade e Autorização:** Autenticação de contas, tokens OTP e validação de propriedade de telefone são puramente determinísticos.
   * **Consentimento:** O consentimento para compartilhamento de dados é obtido por meio de ações de seleção registradas e auditadas em transações SQL.
   * **Matching e Ranking:** O cálculo de elegibilidade, filtros de raio espacial PostGIS e ordenação de profissionais são imunes a julgamentos probabilísticos da IA.
   * **Mutação de Contatos e Assinaturas:** Apenas a API e o PostgreSQL realizam inserts/updates nas tabelas `contacts`, `contact_completions` e `professional_subscriptions`.
   * **Fast Paths Determinísticos:** Sempre que o usuário responder com números (`"1"`, `"2"`), palavras-chave de comando (`"concluído"`, `"cancelar"`) ou confirmações unívocas, o processamento ocorre por código determinístico, sem acionar a LLM.

## Consequências

* **Positivas:**
  * Protege a integridade financeira, de dados e de privacidade do marketplace contra alucinações da IA.
  * Reduz drasticamente o consumo de tokens e a latência de ponta a ponta ao adotar caminhos determinísticos sempre que possível.
  * Facilita a escrita de testes unitários e de integração com cobertura de 100% nas regras críticas de negócio.
* **Negativas / Compromissos:**
  * Requer manutenção de estruturas de estado conversacional intermediárias (`search_conversations`) no banco de dados para conciliar o fluxo conversacional com o domínio transacional.
