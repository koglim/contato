# Jornadas do Produto (Product Journeys)

Este documento descreve as jornadas dos atores do ecossistema do **ContatoCerto**, detalhando a experiência de ponta a ponta e diferenciando com precisão o **Comportamento Atual (CURRENT)** da **Direção Futura (TARGET)**.

---

## 1. Jornada do Cliente (Customer Journey)

O cliente interage exclusivamente pelo canal conversacional (WhatsApp), sem precisar baixar aplicativos ou realizar cadastros prévios.

```mermaid
flowchart TD
    C1["1. Envio da Mensagem Informal\n(Texto ou Áudio via WhatsApp)"] --> C2["2. Resolução de Necessidade e Local\n(Identificação do serviço e cidade/UF)"]
    C2 --> C3["3. Apresentação das Opções\n(Lista de até 3 profissionais com dados factuais)"]
    C3 --> C4{"Dúvidas / Comparação?"}
    C4 -- "Sim" --> C5["Esclarecimento Factual\n(IA/motor responde sem inventar preços/prazos)"]
    C5 --> C3
    C4 -- "Não" --> C6["4. Seleção do Profissional\n(Por número, nome ou declaração direta)"]
    C6 --> C7["5. Conexão Bilateral e Compartilhamento\n(Recebimento mútuo dos telefones)"]
    C7 --> C8["6. Negociação e Execução do Serviço\n(Contato direto no WhatsApp)"]
    C8 --> C9["7. Conclusão e Confirmação\n(Comando concluído / confirmar com CC-XXXXXXXX)"]
    C9 --> C10["8. Avaliação de Satisfação (Futuro)\n(Feedback estruturado para o ranking)"]
```

### Etapas Detalhadas

#### 1. Entrada e Interpretação
* **CURRENT:** O cliente envia uma mensagem inicial em linguagem natural (áudio ou texto) descrevendo seu problema (ex.: *"meu chuveiro queimou e preciso de um eletricista em Sinop"*). O sistema processa o áudio via transcrição e resolve o serviço contra o catálogo oficial e a cidade contra a base IBGE em memória.
* **TARGET:** Suporte a inputs de localização geográfica direta via WhatsApp (Live Location ou pino de mapa) e retenção inteligente com confirmação da última localização (*"É para Sinop - MT novamente?"*).

#### 2. Esclarecimento e Desambiguação
* Se faltar o serviço ou a localização, o assistente faz uma pergunta natural e objetiva. Se houver mais de um município homônimo (ex.: *Belém - PA* vs *Belém - PB*), o sistema solicita a confirmação do estado.

#### 3. Apresentação e Comparação
* O sistema apresenta até 3 profissionais elegíveis por página (com limite total de até 6 profissionais por busca).
* **CURRENT:** O cliente recebe uma mensagem estruturada com nome, especialidade e indicadores factuais disponíveis. O cliente pode escolher por número da opção (ex.: `1`) ou pelo nome do profissional.
* **TARGET (Conversation Intelligence v2):** O cliente poderá fazer perguntas comparativas factuais sobre os profissionais apresentados (ex.: *"Qual deles atende mais perto do centro?"*). O assistente responderá com base estritamente em dados reais cadastrados, sem nunca inventar estimativas de preço, prazos de garantia ou disponibilidade que não existam no sistema.

#### 4. Seleção e Consentimento do Cliente para Compartilhamento Bilateral
* Ao escolher um profissional, o cliente autoriza o compartilhamento do seu número de WhatsApp com o prestador selecionado.
* **CURRENT:** A transação gera um registro `contacts` e envia o resumo ao cliente com o telefone do profissional e o código público `CC-XXXXXXXX`.
* **TARGET (Connection Lifecycle v2):**
  $$\text{Participação elegível do profissional} + \text{Seleção ativa do cliente} + \text{Consentimento informado do cliente para compartilhamento bilateral dos contatos} = \mathbf{CONEX\tilde{A}O\ ESTABELECIDA}$$
  Não há dependência de um segundo aceite mandatório pelo profissional para a conexão ser considerada real e ativa.

#### 5. Execução do Serviço no Mundo Real
* O cliente e o profissional negociam livremente pelo WhatsApp prazos, orçamentos, visitas técnicas e pagamentos. A plataforma não interfere na transação financeira do serviço.

#### 6. Conclusão e Confirmação
* **CURRENT:** Qualquer uma das partes pode declarar a conclusão do atendimento enviando `concluído CC-XXXXXXXX`. A contraparte (cliente ou profissional) pode confirmar com `confirmar CC-XXXXXXXX` ou contestar com `contestar CC-XXXXXXXX`. O parser atual exige obrigatoriamente o código público `CC-XXXXXXXX`.
* **TARGET:** Resolução contextual proativa que convide o cliente a confirmar se o serviço foi realizado sem exigir a digitação do código quando houver apenas um atendimento ativo na conversa.

---

## 2. Jornada do Profissional (Professional Journey)

O profissional possui dois canais de interação: o WhatsApp (para notificações operacionais imediatas) e o Painel Web (para gestão e governança).

```mermaid
flowchart TD
    P1["1. Cadastro e Elegibilidade\n(Autocadastro web ou claim de perfil legado)"] --> P2["2. Assinatura Ativa (Entitlements)\n(Habilitação para receber novos leads no ranking)"]
    P2 --> P3["3. Recebimento da Oportunidade no WhatsApp\n(Dados do cliente, telefone, serviço e local seguro)"]
    P3 --> P4{"Disponibilidade Imediata?"}
    P4 -- "Disponível" --> P5["Contato Direto com o Cliente\n(Conversa no WhatsApp e fechamento)"]
    P4 -- "Indisponível" --> P6["Declaração Opcional de Indisponibilidade\n(Aviso à plataforma de que não poderá atender)"]
    P5 --> P7["Conclusão do Atendimento\n(Envio de comando concluído CC-... via WhatsApp)"]
    P7 --> P8["Gestão no Painel Web\n(Acompanhamento de perfil e cobertura)"]
```

### Etapas Detalhadas

#### 1. Autocadastro e Gestão de Perfil
* O profissional acessa o portal web (`/dashboard`), solicita um código de acesso OTP de 6 dígitos via WhatsApp e faz login sem senha.
* Configura seu nome profissional, bio, categorias de serviço atendidas e municípios de cobertura.
* **Telefone em Modo Somente-Leitura (CURRENT):** O telefone de contato (`phone_e164`) não pode ser alterado por conta própria no painel web, demandando verificação pela equipe administrativa.

#### 2. Assinatura e Participação no Marketplace
* Para profissionais gerenciados por conta (`account_managed`), é necessária uma assinatura ativa no sistema para receber novas oportunidades. Perfis legados não reivindicados (`legacy_unmanaged`) estão temporariamente isentos pela política de transição.
* **Regra Fundamental:** O profissional **não paga por lead**. Ele tem previsibilidade total de custo através do plano de assinatura.

#### 3. Recebimento de Oportunidades (Notificação no WhatsApp)
* Quando um cliente seleciona o profissional, o sistema despacha imediatamente uma mensagem via Outbox para o WhatsApp do profissional.
* **Modelo da Mensagem (TARGET):**
  > *"Olá, [Nome]! Um cliente selecionou você no ContatoCerto para o serviço de [Eletricista].*
  > *Resumo da necessidade: [Troca de disjuntor].*
  > *Localização: [Contexto seguro de localização disponível, ex.: Sinop - MT].*
  > *Telefone do cliente: [+55 66 99999-9999].*
  > *Por favor, entre em contato com o cliente o mais breve possível para alinhar o atendimento.*
  > *(Caso você esteja impossibilitado de atender neste momento, responda 'indisponível')".*

#### 4. Postura sobre Aceite vs. Conexão (CURRENT vs. TARGET)
* **CURRENT:** O banco de dados e a API ainda registram transições baseadas em estados legados como `accepted` ou `declined` no enum `contact_status` (`'requested'`, `'shared'`, `'accepted'`, `'declined'`, `'completed'`, `'cancelled'`).
* **TARGET (ADR-004):** A conexão **já existe** no momento do envio. O profissional não precisa acessar o painel nem enviar comandos de confirmação para poder conversar com o cliente. O comando de recusa/indisponibilidade serve apenas como sinal declaratório de cortesia e telemetria operacional.

#### 5. Conclusão de Serviço
* **CURRENT:** Concluído o trabalho, o profissional pode sinalizar a finalização enviando `concluído CC-XXXXXXXX` via WhatsApp.
* **TARGET:** Gerenciamento visual de atendimentos e conclusão diretamente pela interface do Painel Web v2.

---

## 3. Jornada do Operador / Administrador (Future Operator Journey)

Destinada aos mantenedores da plataforma para monitoramento, segurança e governança.

* **Auditoria de Mensageria:** Acompanhamento da saúde das filas através de endpoints agregados como `GET /internal/channel/inbound/queue-status`, sem exposição de dados pessoais nos logs.
* **Gestão de Quarentena:** Resolução de mensagens retidas na tabela `channel_inbound_messages` devido a conflitos de concorrência ou falhas de transporte.
* **Gestão de Catálogo e Mapeamento:** Ajuste de sinônimos de serviços e calibragem de limites de busca espacial.
* **Governança de Assinaturas:** Concessão, renovação ou encerramento manual de assinaturas profissionais enquanto os gateways de pagamento automatizados permanecem congelados.
