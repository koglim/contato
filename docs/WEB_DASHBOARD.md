# Painel web do profissional

O painel temporário está em `/dashboard` e usa a API interna existente por meio de Route Handlers do Next.js. O navegador nunca recebe `INTERNAL_API_KEY` nem chama a API diretamente.

## Configuração

Defina no ambiente do web:

- `CONTATOCERTO_API_URL`: URL interna da API, por exemplo `http://contatocerto-api:3333` no EasyPanel;
- `INTERNAL_API_KEY`: a mesma chave configurada na API;
- `DASHBOARD_PROFESSIONAL_ID`: UUID do profissional de demonstração;
- `DASHBOARD_DEMO_PASSWORD`: senha temporária de acesso ao painel.
- `DASHBOARD_SESSION_SECRET`: segredo longo e aleatório usado para assinar a sessão temporária.

Em desenvolvimento local, use `http://localhost:3333` para a URL da API. Após a senha correta, o servidor grava um cookie HttpOnly com um token HMAC SHA-256, contendo somente a expiração. A assinatura é verificada em cada acesso ao painel e BFF; tokens adulterados ou expirados não autenticam. O cookie usa `path=/` para acompanhar tanto `/dashboard` quanto `/api/dashboard`, `Secure` em produção e `SameSite=Lax`. Isso continua sendo acesso temporário, não o sistema de autenticação definitivo.
