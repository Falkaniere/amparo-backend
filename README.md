# 🌿 Amparo — Backend

API REST para o app Amparo. Node.js + Express + Supabase.

## Stack

- **Runtime**: Node.js 18+
- **Framework**: Express 4
- **Banco**: Supabase (PostgreSQL + Auth + Storage + Realtime)
- **Pagamento**: Pagar.me
- **Push**: Expo Push API
- **Deploy**: Railway

---

## Setup local

### 1. Clone e instale dependências

```bash
git clone https://github.com/seu-usuario/amparo-backend
cd amparo-backend
npm install
```

### 2. Configure variáveis de ambiente

```bash
cp .env.example .env
# edite o .env com suas chaves
```

### 3. Configure o Supabase

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Vá em **SQL Editor** e execute em ordem:
   - `sql/schema.sql` — cria todas as tabelas, índices e RLS
   - `sql/functions.sql` — cria a função de busca geográfica
3. Em **Storage**, crie um bucket privado chamado `companion-docs`
4. Copie a **URL**, **anon key** e **service role key** para o `.env`

### 4. Rode o servidor

```bash
npm run dev   # desenvolvimento (nodemon)
npm start     # produção
```

Acesse: `http://localhost:3000/health`

---

## Estrutura de pastas

```
src/
  index.js              # Entry point, middlewares globais
  middleware/
    auth.js             # JWT middleware + requireRole
  routes/
    auth.js             # /auth/* — registro, login, OTP
    profiles.js         # /profile/* — perfis, docs, disponibilidade
    companions.js       # /companions/* — busca e perfil público
    requests.js         # /requests/* — solicitações de serviço
    payments.js         # /payments/* — Pagar.me + webhook
    reviews.js          # /reviews   — avaliações
    messages.js         # /messages  — chat
  services/
    notifications.js    # Expo Push API
  utils/
    supabase.js         # Clientes Supabase (público + admin)
sql/
  schema.sql            # Schema completo do banco
  functions.sql         # Funções PostgreSQL (busca geográfica)
```

---

## Endpoints principais

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | /auth/register | — | Criar conta |
| POST | /auth/login | — | Login → JWT |
| POST | /auth/refresh | — | Renovar token |
| GET | /profile/me | ✓ | Meu perfil |
| PUT | /profile/me | ✓ | Editar perfil |
| PUT | /profile/companion/availability | ✓ | Disponibilidade |
| POST | /profile/companion/documents | ✓ | Upload documento |
| PUT | /profile/companion/online | ✓ | Toggle online |
| GET | /companions/available | ✓ | Busca por localização |
| GET | /companions/:id | ✓ | Perfil público |
| POST | /requests | ✓ | Criar solicitação |
| GET | /requests/family | ✓ | Histórico família |
| GET | /requests/companion | ✓ | Histórico acompanhante |
| PATCH | /requests/:id/status | ✓ | Atualizar status |
| POST | /requests/:id/location | ✓ | Enviar GPS |
| POST | /payments/create | ✓ | Criar cobrança |
| POST | /payments/webhook | webhook | Confirmação Pagar.me |
| GET | /payments/:id/status | ✓ | Status pagamento |
| POST | /reviews | ✓ | Avaliar serviço |
| GET | /messages/:request_id | ✓ | Histórico chat |
| POST | /messages | ✓ | Enviar mensagem |

---

## Deploy (Railway)

```bash
# Instale a CLI do Railway
npm install -g @railway/cli

railway login
railway init
railway up

# Configure as variáveis de ambiente no painel do Railway
# (copie tudo do .env.example)
```

---

## Realtime (Supabase)

O tracking em tempo real é feito diretamente pelo **app mobile via SDK do Supabase**, sem passar pelo backend:

```javascript
// No app (React Native)
const channel = supabase
  .channel(`request:${requestId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'location_updates',
    filter: `request_id=eq.${requestId}`
  }, (payload) => {
    // atualiza mapa com nova posição
    updateMapPin(payload.new.lat, payload.new.lng);
  })
  .subscribe();
```
