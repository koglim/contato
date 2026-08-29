# Modelo de dados

Esta primeira versão representa o núcleo persistente do marketplace, sem implementar busca, ranking, autenticação ou canais de comunicação.

## Entidades

- `customers`: pessoas que solicitam serviços. O telefone em formato E.164 será a futura chave de identificação no WhatsApp.
- `service_categories`: agrupamentos amplos do catálogo, como Casa e Manutenção.
- `services`: serviços pesquisáveis pertencentes a uma categoria, como Eletricista.
- `service_aliases`: formas alternativas normalizadas de descrever um serviço. O catálogo inicial não precisa preenchê-las ainda.
- `professionals`: perfis dos prestadores, incluindo estado operacional e disponibilidade declarada.
- `professional_services`: vínculo entre profissional e serviço, com preço em centavos e o modo de precificação.
- `professional_service_areas`: pontos centrais e raios, em metros, das áreas em que um profissional atende.
- `search_requests`: a solicitação original do cliente. `raw_text` é imutável em intenção e preserva o texto informado.
- `matches`: profissionais que, no futuro, serão apresentados para uma solicitação, com posição, score e detalhamento opcional.
- `contacts`: registro do interesse de um cliente por um profissional para uma solicitação.
- `reviews`: avaliação vinculada a um contato real, com uma avaliação por contato.

## Relacionamentos

```text
service_categories 1 ── N services 1 ── N service_aliases
professionals      N ── N services (professional_services)
professionals      1 ── N professional_service_areas
customers          1 ── N search_requests
search_requests    1 ── N matches N ── 1 professionals
search_requests    1 ── N contacts N ── 1 professionals
contacts           1 ── 0..1 reviews
```

Os pedidos podem continuar existindo sem cliente ou serviço associado, usando `ON DELETE SET NULL`; isso preserva histórico. Dados de relacionamento ou históricos críticos usam `RESTRICT`, evitando remoções acidentais. A única exclusão em cascata é `service_aliases` ao remover seu serviço, pois aliases não têm significado sem ele.

## Localização e busca futura

PostGIS armazena `center` e `location` como `GEOGRAPHY(Point, 4326)`, o que permite calcular distância em metros e testar se uma localização está dentro do raio de atendimento. Os índices GiST tornam essas consultas geoespaciais escaláveis.

As extensões `pg_trgm` e `unaccent` preparam a busca tolerante a erros de digitação, capitalização e acentos. `service_aliases.normalized_alias` tem índice GIN com `gin_trgm_ops`; a normalização e o motor de busca serão implementados em outra etapa.

## Preços e integridade

Valores monetários usam inteiros em centavos, nunca `FLOAT`. A restrição de `professional_services` exige valores coerentes para cada modo de preço: orçamento sem valor, fixo/a partir de com valor inicial, ou faixa com limites ordenados. UUIDs são gerados pelo PostgreSQL com `gen_random_uuid()` da extensão `pgcrypto`.
