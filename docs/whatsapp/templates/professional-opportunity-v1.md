# Template Meta UTILITY: Oportunidade para Profissional (v1)

* **Nome do Template:** `contato_certo_nova_solicitacao_v1`
* **Categoria Meta:** `UTILITY`
* **Idioma:** `pt_BR`
* **Status Meta:** Template submetido à Meta (`POST /template/create/contato-certo-oficial`), Meta ID `1752613799170635`. A ativação operacional exige status APPROVED.

---

## 1. Contexto e Motivação

Quando um cliente escolhe um profissional na plataforma ContatoCerto, o sistema notifica o profissional sobre a oportunidade. Como este envio é de iniciativa da empresa (*business-initiated*) e na maioria dos casos o profissional não enviou uma mensagem nas últimas 24 horas, o WhatsApp Cloud API rejeita mensagens livres de texto ou botões comuns (`interactive: button_group`), exigindo o envio de um template pré-registrado.

Este documento especifica o template de utilidade e seu mapeamento transacional estrito com a autoridade de domínio do ContatoCerto.

---

## 2. Conteúdo e Componentes

### 2.1 Corpo da Mensagem (Body)

```text
Olá! Um cliente solicitou seu contato no ContatoCerto:

Nome: {{1}}
Região: {{2}}
Serviço: {{3}}
Detalhes: {{4}}

Se não puder atender agora, use o botão abaixo para liberar o cliente para outro profissional.
```

* **Variável `{{1}}`:** "Cliente".
* **Variável `{{2}}`:** Região ou cidade / UF da busca (ex.: "Sinop / MT").
* **Variável `{{3}}`:** Nome do serviço solicitado (ex.: "Eletricista").
* **Variável `{{4}}`:** Detalhes determinísticos da solicitação contendo resumo da necessidade, telefone do cliente e referência pública (ex.: `"Troca de tomada. Telefone do cliente: +55... Ref.: CC-XXXXXXXX"`).

### 2.2 Botões de Resposta Rápida (Quick Reply Buttons)

O template possui exatamente 2 botões de resposta rápida:

1. **Botão 0:**
   * **Texto visível:** `Concluído`
   * **Payload dinâmico:** `ia_<completion_token>` (48 caracteres hexadecimais de alta entropia gerados pelo `ActionTokenService`).
2. **Botão 1:**
   * **Texto visível:** `Não consigo atender`
   * **Payload dinâmico:** `ia_<unavailability_token>` (48 caracteres hexadecimais de alta entropia gerados pelo `ActionTokenService`).

---

## 3. Preservação da Autoridade de Domínio

1. **O texto do botão jamais se torna autoridade:**
   O texto exibido nos botões ("Concluído", "Não consigo atender") serve unicamente para orientação visual do usuário humano no cliente WhatsApp.
2. **Entrega e Captura do Token:**
   * No envio, o n8n Shared Delivery envia o componente de botões com os `ia_<opaque>` tokens gerados no payload de cada quick reply button.
   * Quando o profissional toca em um dos botões, o webhook do Meta Cloud API encapsula a resposta contendo o `payload` associado ao botão.
   * A Evolution API normaliza este evento preservando `message.button.payload` (PR #6 em `evolution-api-contatocerto`).
   * O n8n Gateway extrai `message.button.payload` como `inbound.interactive_action_id` e o despacha para o endpoint `/internal/channel/inbox`.
   * O `InteractiveActionService` resolve atomicamente o token opaco no banco de dados, validando o número de telefone do emissor, validade temporal e tipo de ação, executando a transação de domínio de forma determinística.
3. **Ausência de Payload:**
   Caso um evento de clique de botão seja recebido sem payload válido (`message.button` sem `payload`), o sistema rejeita/ignora com `unsupported_interactive_reply`, nunca caindo para matching solto de texto.

---

## 4. Configuração Operacional

* **Transação de Emissão:** `bilateral-contact.transaction.ts`
* **Variável de Controle:** `PROFESSIONAL_OPPORTUNITY_TRANSPORT=buttons|template`
* **Nome do Template:** `WHATSAPP_PROFESSIONAL_OPPORTUNITY_TEMPLATE_NAME=contato_certo_nova_solicitacao_v1`
* **Idioma do Template:** `WHATSAPP_PROFESSIONAL_OPPORTUNITY_TEMPLATE_LANGUAGE=pt_BR`
