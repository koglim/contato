# Painel web do profissional

O painel temporário está em `/dashboard` e usa a API interna existente por meio de Route Handlers do Next.js. O navegador nunca recebe `INTERNAL_API_KEY` nem chama a API diretamente.

## Configuração

Defina no ambiente do web:

- `CONTATOCERTO_API_URL`: URL interna da API, por exemplo `http://contatocerto-api:3333` no EasyPanel;
- `INTERNAL_API_KEY`: a mesma chave configurada na API;
- `DASHBOARD_PROFESSIONAL_ID`: UUID do profissional de demonstração;
- `DASHBOARD_DEMO_PASSWORD`: senha temporária de acesso ao painel.

Em desenvolvimento local, use `http://localhost:3333` para a URL da API. A senha gera apenas um cookie HttpOnly de demonstração; não é o sistema de autenticação definitivo.
