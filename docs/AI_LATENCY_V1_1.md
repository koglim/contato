# AI Latency v1.1 — interpretação e cortesia segura

Esta branch não altera modelo, prompt, schema, limite de saída, reasoning effort, timeout ou cache no runtime. Não adiciona nem altera ENV. O controlador continua a decidir e persistir antes dos efeitos de domínio; a autoridade IBGE/Pelias continua a validar a cidade.

## Cortesia no caminho determinístico

Somente os sufixos terminais `por favor` e `por gentileza` são removidos para testar a gramática de pedido direto. O prefixo vazio (`serviço em cidade`) só é aceito quando uma dessas cortesias realmente foi removida: `eletricista em Cuiabá por favor` pode entrar no fast path; `eletricista em Cuiabá` sozinho mantém o comportamento anterior e segue para interpretação. A proposta leva a cidade limpa ao controlador; o extrator compartilhado não foi alterado. Uma mensagem com `hoje`, `amanhã`, `agora`, `urgente` ou `mesmo`, inclusive antes de uma cortesia terminal, continua na interpretação adaptativa. Isso não descarta informação temporal nem tenta identificar cidades por uma lista lexical.

`pnpm --filter @contatocerto/api eval:latency --summary` mede a elegibilidade sintética, não a latência fim a fim. O corpus atual tem 32 casos, dos quais 12 são elegíveis ao fast path.

## Comparador isolado de interpretação

`pnpm --filter @contatocerto/api eval:interpretation-budget --self-check` valida cinco fixtures sintéticas sem nenhuma chamada ao modelo: typo, necessidade semântica, pergunta informativa, negação e correção de localização com contexto, baseada em `readiness-12` da B2.

Uma avaliação real exige autorização específica, a chave já existente disponível de forma segura, e o teto exato de 15 chamadas:

`pnpm --filter @contatocerto/api eval:interpretation-budget --authorize-paid-evaluation --model=gpt-5-mini-2025-08-07 --max-calls=15`

O comparador faz as mesmas cinco entradas para cada variante: configuração atual (sem `reasoning.effort` explícito), `minimal` e `low`. A ordem é intercalada e fixa: caso 1 `current → minimal → low`; caso 2 `minimal → low → current`; caso 3 `low → current → minimal`; caso 4 `current → low → minimal`; caso 5 `low → minimal → current`. A autoverificação imprime somente IDs, variantes e posições dessa sequência, sem chamadas pagas. Mantém o snapshot, as instruções, o schema estruturado, `max_output_tokens=900`, `store=false`, timeout de 20 s e zero retries. Não toca na Inbox, no banco, no WhatsApp ou no runtime. Cada linha registra `execution_order`, validade estrutural, concordância semântica com o controlador e os rótulos sintéticos, duração, tokens de entrada/cache/saída/raciocínio/total, status e motivo de incompletude. O resumo por variante usa contagem, mediana e mínimo/máximo da duração, não p95. Não imprime mensagens, prompts, respostas, segredos ou corpos de erro. Um HTTP 400 em `low` deve ser diagnosticado como possível incompatibilidade, não tratado como resultado de qualidade.

Os cinco casos são apenas uma triagem; 5/5 não substitui avaliação representativa, repetição estatística nem revisão humana. A intercalação reduz viés de ordem/aquecimento, mas não isola completamente efeitos de cache ou variação temporal. A comparação entre variantes não autoriza alterar reasoning effort em produção.

## Cache observado e investigação

No turno real relatado em produção para “Cuiabá por favor”, `conversation_ai_usage` indicou `input_tokens=1011` e `cached_input_tokens=0` em uma chamada de interpretação. Isso é uma observação única, não prova de que cache esteja indisponível. O tamanho em tokens do prefixo reutilizável — instruções e schema renderizados antes da entrada variável — ainda não foi medido; o total de 1011 tokens da requisição não é esse tamanho. O comparador registra `cached_input_tokens` por variante para procurar reutilização, mas não configura `prompt_cache_key` nem força cache.

A [documentação oficial de prompt caching da OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching) explica que modelos anteriores ao GPT-5.6 usam caching implícito, com comprimento mínimo e pontos de cache dependentes do modelo/configuração; `cached_tokens` é arredondado em múltiplos de 128. Ela também documenta `prompt_cache_key` estável para otimizar o roteamento de requisições com prefixo reutilizável nesses modelos. Assim, a chave é uma opção documentada para o snapshot atual, mas só deve ser avaliada depois de medir se o prefixo efetivo é elegível e se há reutilização suficiente. Nenhuma ENV `OPENAI_PROMPT_CACHE_KEY` foi criada.

## Estado do modelo

A [página oficial do GPT-5 Mini](https://developers.openai.com/api/docs/models/gpt-5-mini) marca `gpt-5-mini-2025-08-07` como deprecated. A [página de deprecações](https://developers.openai.com/api/docs/deprecations) informa desligamento previsto em 11/12/2026. Isso exige uma comparação controlada futura com um modelo atual de baixa latência; não é uma migração neste PR. Fast path, esforço de raciocínio e migração de modelo devem permanecer decisões separadas.

Nenhuma configuração do EasyPanel é necessária nesta branch. `OPENAI_REASONING_EFFORT` e `OPENAI_PROMPT_CACHE_KEY` não foram criadas; `CONVERSATION_AI_ENABLED`, `OPENAI_CONVERSATION_MODEL`, `OPENAI_CONVERSATION_TIMEOUT_MS` e `OPENAI_API_KEY` não foram alteradas.
