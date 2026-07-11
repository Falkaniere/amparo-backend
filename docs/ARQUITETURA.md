# 🌿 Amparo — Arquitetura do Backend

Documentação técnica da API do Amparo — plataforma que conecta **famílias** a
**acompanhantes** para idosos (consultas médicas, tarefas, passeios), com
pagamento, avaliação, chat e rastreamento em tempo real.

> **Nota sobre o app mobile:** este repositório é **somente o backend**
> (Node.js + Express + Supabase). O aplicativo é um **React Native / Expo**
> separado. Onde relevante, este documento descreve o contrato entre as duas
> pontas (mobile ↔ backend), mas o código do app não vive aqui.

---

## 1. Stack e decisões de arquitetura

| Camada | Tecnologia | Papel |
|--------|-----------|-------|
| Runtime | Node.js ≥ 18 | Execução |
| HTTP | Express 4 | Roteamento, middlewares |
| Banco / Auth / Storage / Realtime | **Supabase** (PostgreSQL + GoTrue + Storage + Realtime) | Persistência, autenticação JWT, arquivos, tempo real |
| Geolocalização | PostGIS | Busca por raio/distância |
| Pagamentos | Pagar.me (API v5) | PIX e cartão, com *split* para o acompanhante |
| Push | Expo Push API | Notificações no app |
| Deploy | Railway (nixpacks) | Hospedagem, health check em `/health` |

### Estilo arquitetural

O backend é uma **API REST em camadas finas**, deliberadamente enxuta, que
delega o máximo possível ao Supabase:

```
Cliente (app RN / painel admin)
        │  HTTPS + JWT (Bearer) ou x-admin-key
        ▼
┌──────────────────────────────────────────────┐
│  Express (src/index.js)                        │
│  helmet · cors · rate-limit · body parsing     │
├──────────────────────────────────────────────┤
│  Middlewares  → auth (JWT) / adminAuth (chave) │
│  Rotas        → controllers finos por domínio  │
│  Services     → integrações externas (Expo)    │
│  Utils        → clientes Supabase              │
└───────────────┬───────────────┬────────────────┘
                │               │
   req.supabase (JWT do usuário)  supabaseAdmin (service role)
     · respeita RLS               · ignora RLS (webhooks/admin/storage)
                │               │
                ▼               ▼
        ┌───────────────────────────────┐
        │ Supabase / PostgreSQL          │
        │  • RLS (auth.uid())            │
        │  • Triggers (rating, updated_at)│
        │  • RPC search_companions (PostGIS)│
        │  • Storage (fotos, documentos) │
        └───────────────────────────────┘
                │
                └──► Pagar.me (charges + webhook)
                └──► Expo (push)
```

**Princípios observados:**

- **Clientes Supabase** (`src/utils/supabase.js`):
  - `supabase` — *anon key*, singleton. Usado só para operações **sem usuário
    logado** (fluxos de `auth.*`: login, registro, refresh, OTP).
  - `getUserClient(token)` → **`req.supabase`** — cliente criado **por
    requisição** com o JWT do usuário no header `Authorization`. É este que faz
    o **RLS** enxergar `auth.uid()`. `authMiddleware` o injeta em `req.supabase`,
    e todas as leituras/escritas *user-scoped* passam por ele.
  - `supabaseAdmin` — *service role key*, **ignora RLS**. Reservado a operações
    privilegiadas: webhooks, painel admin, Storage, `auth.admin` e escritas em
    que a autorização é verificada **em código** (ex.: posse da solicitação).
- **Controllers finos**: cada rota valida a entrada, chama o Supabase/serviço e
  formata a resposta. Não há camada de repositório/serviço de domínio separada —
  a "regra de negócio" mora nas rotas e nas *policies*/triggers do banco.
- **Autorização híbrida**: parte via RLS (policies em `sql/schema.sql`), parte
  via checagens explícitas de posse nas rotas que usam `supabaseAdmin`.

---

## 2. Estrutura de pastas

```
amparo-backend/
├── src/
│   ├── index.js                 # Entry point: middlewares globais, montagem das rotas, 404 e error handler
│   ├── middleware/
│   │   ├── auth.js              # authMiddleware (valida JWT, injeta req.user e req.supabase) + requireRole(...)
│   │   └── adminAuth.js         # Valida o header x-admin-key contra ADMIN_SECRET
│   ├── routes/
│   │   ├── auth.js             # /auth/*      — registro, login, Google, OTP, refresh, role
│   │   ├── profiles.js        # /profile/*   — perfil, foto, documentos, disponibilidade, CPF, online
│   │   ├── companions.js      # /companions/*— busca geográfica e perfil público
│   │   ├── requests.js        # /requests/*  — CRUD de solicitações + máquina de estados + GPS
│   │   ├── payments.js        # /payments/*  — cobrança Pagar.me + webhook + status
│   │   ├── reviews.js         # /reviews     — avaliações (com verificação de participação)
│   │   ├── messages.js        # /messages    — chat por solicitação (com verificação de participação)
│   │   └── admin.js           # /admin/*     — moderação de acompanhantes (aprovar/reprovar)
│   ├── services/
│   │   └── notifications.js    # Integração com a Expo Push API
│   ├── utils/
│   │   └── supabase.js         # Clientes supabase (anon) / supabaseAdmin (service role) / getUserClient(token)
│   └── __tests__/              # Testes unitários (Jest + Supertest), espelham a árvore de src/
│       ├── health.test.js
│       ├── middleware/         # auth.test.js, adminAuth.test.js
│       ├── routes/             # auth, companions, requests, reviews, messages
│       └── services/           # notifications.test.js
├── sql/
│   ├── schema.sql              # Tabelas, enums, índices, triggers e policies RLS
│   ├── functions.sql           # RPC search_companions (PostGIS)
│   └── migrations/
│       ├── 002_companion_approval.sql  # Coluna status (pending/approved/rejected) + foto + rejeição
│       └── 003_companion_cpf.sql       # Coluna cpf + índice único
├── docs/
│   ├── ARQUITETURA.md          # (este arquivo)
│   └── AUDITORIA.md            # Relatório da auditoria: achados, correções e recomendações
├── eslint.config.js            # Config flat do ESLint 9
├── jest.config.js              # Config do Jest + moduleNameMapper (aliases)
├── jest.setup.js               # Variáveis de ambiente para o ambiente de teste
├── railway.toml                # Deploy (builder, startCommand, health check)
├── .env.example                # Modelo das variáveis de ambiente
└── package.json                # Scripts, dependências e imports (aliases de path)
```

### Aliases de import (subpath imports)

Todos os imports internos usam **aliases** em vez de caminhos relativos, via o
campo `imports` do `package.json` (subpath imports nativos do Node) e o
`moduleNameMapper` do Jest:

| Alias | Resolve para |
|-------|--------------|
| `#middleware/*` | `./src/middleware/*.js` |
| `#routes/*` | `./src/routes/*.js` |
| `#services/*` | `./src/services/*.js` |
| `#utils/*` | `./src/utils/*.js` |

```js
// antes
const { authMiddleware } = require('../../middleware/auth');
// depois
const { authMiddleware } = require('#middleware/auth');
```

---

## 3. Modelo de dados (resumo)

Definido em `sql/schema.sql`. Chaves e relações principais:

- **family_profiles** (1—1 com `auth.users`) — dados do idoso e endereço.
- **companion_profiles** (1—1 com `auth.users`) — bio, `hourly_rate`, `radius_km`,
  `location` (PostGIS), `cpf` (único), `status` (`pending`/`approved`/`rejected`),
  `verified`, `is_online`, `avg_rating`, `pagarme_recipient_id`, `push_token`.
- **availability** (N por acompanhante) — janelas por `day_of_week` + horário.
- **companion_skills**, **documents** (RG/CNH, antecedentes, certificados).
- **service_requests** (tabela central) — liga família e acompanhante, guarda o
  *snapshot* financeiro (`hourly_rate`, `service_amount`, `platform_fee`,
  `total_amount`, `companion_amount`), status e timestamps de check-in/out.
- **payments** (1—1 com solicitação) — `gateway_id`, `method`, `status`, dados PIX.
- **reviews** (única por `request_id`+`reviewer_id`) — `score` 1–5, tags, gorjeta.
- **messages** — chat por solicitação.
- **location_updates** — pontos de GPS durante o serviço.

**Triggers:** `update_companion_rating` recalcula `avg_rating`/`total_services`
após cada review; `set_updated_at` mantém `updated_at`.

**RPC:** `search_companions(lat, lng, day, start_time, duration_h)` retorna
acompanhantes aprovados, online, dentro do raio e disponíveis, ordenados por
distância e nota — tudo em PostGIS, no banco.

---

## 4. APIs — referência detalhada

Autenticação:
- **JWT** — a maioria das rotas exige `Authorization: Bearer <access_token>`
  (validado por `authMiddleware`, que injeta `req.user`).
- **Admin** — as rotas `/admin/*` exigem o header `x-admin-key: <ADMIN_SECRET>`.
- **Webhook** — `/payments/webhook` é público (chamado pelo Pagar.me) e recebe
  *raw body*.

Respostas de erro seguem o formato `{ "error": "mensagem" }`.

### 4.1 `/auth` — autenticação (`src/routes/auth.js`)

| Método | Rota | Auth | Corpo / Query | Descrição |
|--------|------|------|---------------|-----------|
| POST | `/auth/register` | — | `name, email, password, phone, role, cpf?` | Cria conta no GoTrue e o perfil (`family_profiles` ou `companion_profiles`). `role` ∈ {family, companion}. `cpf` obrigatório e válido (11 dígitos) para companion; `409` se CPF duplicado. |
| POST | `/auth/login` | — | `email, password` | Login por senha → `access_token`, `refresh_token`, `expires_in`, `user`. |
| POST | `/auth/google` | — | `idToken` | Recebe o idToken do `@react-native-google-signin`. O Supabase valida contra o Google. Retorna sessão + `role` derivada de qual perfil existe. |
| POST | `/auth/role` | JWT | `role` | Cria o perfil para um usuário que ainda não escolheu papel. |
| POST | `/auth/refresh` | — | `refresh_token` | Renova a sessão. |
| POST | `/auth/otp/send` | — | `phone` | Dispara OTP por SMS. |
| POST | `/auth/otp/verify` | — | `phone, token` | Verifica o código SMS. |

### 4.2 `/profile` — perfis (`src/routes/profiles.js`)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/profile/me` | JWT | Retorna o perfil do usuário conforme o `role`. Para companion, embute skills, disponibilidade e documentos, e gera *signed URL* da foto. |
| PUT | `/profile/me` | JWT | Atualiza campos permitidos (lista branca distinta para family e companion). |
| PUT | `/profile/companion/photo` | JWT + `multipart/form-data` (`file`) | Upload da foto de perfil no bucket `companion-photos`. |
| PUT | `/profile/companion/availability` | JWT | Substitui todas as janelas de disponibilidade (`slots`). |
| POST | `/profile/companion/documents` | JWT + `multipart` | Upload de documento (`type` ∈ rg_cnh/background_check/certificate) para `companion-docs`. |
| PUT | `/profile/companion/cpf` | JWT | Define/atualiza o CPF (valida 11 dígitos; `409` se duplicado). |
| PUT | `/profile/companion/online` | JWT | Liga/desliga o status online. |

> Limite de upload: 10 MB (`multer` em memória).

### 4.3 `/companions` — descoberta (`src/routes/companions.js`)

| Método | Rota | Auth | Query | Descrição |
|--------|------|------|-------|-----------|
| GET | `/companions/available` | JWT | `lat, lng, date, start_time, duration_hours?` | Chama a RPC `search_companions`. `date` → dia da semana. |
| GET | `/companions/:id` | JWT | — | Perfil público de um acompanhante **aprovado** + últimas 5 avaliações. |

### 4.4 `/requests` — solicitações (`src/routes/requests.js`)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/requests` | JWT | Família cria a solicitação. **Valida** `type`, `scheduled_at`, `origin_address`, `duration_hours > 0` e `companion_id`. Calcula o *snapshot* financeiro e notifica o acompanhante via push. |
| GET | `/requests/family` | JWT | Histórico da família autenticada. |
| GET | `/requests/companion` | JWT | Histórico do acompanhante autenticado. |
| GET | `/requests/:id` | JWT | Detalhe de uma solicitação. |
| PATCH | `/requests/:id/status` | JWT | Máquina de estados (ver abaixo); grava timestamps e dispara push. |
| POST | `/requests/:id/location` | JWT | Acompanhante envia ponto de GPS; atualiza `location_updates` e a posição atual. |

**Máquina de estados** (transições válidas):

```
pending ──► accepted ──► checked_in ──► in_progress ──► completed
   │            │
   └──► cancelled ◄──┘
(completed e cancelled são terminais)
```

Cálculo financeiro (com `PLATFORM_FEE_PERCENT`, default 10%):

```
service_amount   = hourly_rate × duration_hours
platform_fee     = service_amount × FEE
total_amount     = service_amount + platform_fee   (cobrado da família)
companion_amount = service_amount × (1 − FEE)       (repassado ao acompanhante)
```

### 4.5 `/payments` — pagamentos (`src/routes/payments.js`)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/payments/create` | JWT | Cria a cobrança no Pagar.me (`pix` ou `credit_card`) com *split* para o acompanhante. **Verifica** que a solicitação pertence à família autenticada e está `pending`. |
| POST | `/payments/webhook` | Pagar.me (raw body) | Em `charge.paid`, marca o pagamento como pago e notifica o acompanhante. |
| GET | `/payments/:id/status` | JWT | Status do pagamento. |

### 4.6 `/reviews` — avaliações (`src/routes/reviews.js`)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/reviews` | JWT | Cria avaliação. **Valida** `score` inteiro 1–5, exige serviço `completed` e que **o autor tenha participado** do serviço. |

### 4.7 `/messages` — chat (`src/routes/messages.js`)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/messages/:request_id` | JWT | Lista as mensagens. **Só participantes** do serviço têm acesso. |
| POST | `/messages` | JWT | Envia mensagem. **Só participantes**; conteúdo não pode ser vazio. |

### 4.8 `/admin` — moderação (`src/routes/admin.js`)

Todas exigem `x-admin-key`.

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/admin/companions?status=` | Lista acompanhantes por status, com *signed URLs* de foto/documentos e dados do usuário. |
| GET | `/admin/companions/:id` | Detalhe de um acompanhante. |
| POST | `/admin/companions/:id/approve` | Aprova (status=approved, verified=true). |
| POST | `/admin/companions/:id/reject` | Reprova (status=rejected, com motivo). |

### 4.9 Chamadas a serviços externos

| Serviço | Onde | O quê |
|---------|------|-------|
| **Supabase Auth (GoTrue)** | `auth.js`, `middleware/auth.js` | `signUp`, `signInWithPassword`, `signInWithIdToken`, `refreshSession`, `signInWithOtp`, `verifyOtp`, `getUser`, `auth.admin.getUserById/listUsers`. |
| **Supabase DB** | todas as rotas | `.from().select/insert/update/delete`, `.rpc('search_companions')`. |
| **Supabase Storage** | `profiles.js`, `admin.js` | `upload`, `createSignedUrl` nos buckets `companion-photos` e `companion-docs`. |
| **Pagar.me** | `payments.js` | `POST /core/v5/charges` (Basic auth) + recebimento de webhook. |
| **Expo Push** | `services/notifications.js` | `POST https://exp.host/--/api/v2/push/send` (Bearer `EXPO_ACCESS_TOKEN`). |

---

## 5. Fluxo ponta a ponta (mobile ↔ backend)

### 5.1 Onboarding e autenticação

```
App (RN)                         Backend                       Supabase
  │  POST /auth/register  ─────────►│  auth.signUp + insert perfil ──►│
  │◄────────── 201 (verifique email) │◄───────────────────────────────│
  │  POST /auth/login    ──────────►│  auth.signInWithPassword ──────►│
  │◄──── access_token + refresh ────│◄───────────────────────────────│
  │  (guarda tokens; envia Bearer em toda request)
```

O Google Sign-In segue caminho equivalente via `POST /auth/google` (idToken
nativo). O app renova o token com `POST /auth/refresh` quando `expires_in`
se aproxima.

### 5.2 Descoberta → solicitação → pagamento

```
Família (RN)                         Backend                    Externos
  │ GET /companions/available ──────►│ rpc search_companions (PostGIS)
  │◄──── lista ordenada por distância │
  │ GET /companions/:id  ───────────►│ perfil + reviews
  │ POST /requests (companion_id) ──►│ valida + snapshot financeiro
  │                                  │ push ──────────────► Expo ──► App do acompanhante
  │◄──── 201 { request }             │
  │ POST /payments/create ──────────►│ cria charge ─────► Pagar.me
  │◄──── 201 { payment (PIX/cartão) }│
                                     │◄── webhook charge.paid ── Pagar.me
                                     │ marca pago + push ──► Expo ──► App do acompanhante
```

### 5.3 Execução do serviço (máquina de estados + tempo real)

```
Acompanhante (RN)                    Backend                     Supabase
  │ PATCH /requests/:id/status accepted ─►│ valida transição + push
  │ PATCH ... checked_in ───────────────►│ grava checkin_at
  │ POST /requests/:id/location (lat,lng)►│ insere location_updates
  │                                       │        │
Família (RN) ── Supabase Realtime ◄───────┘        │  (INSERT em location_updates)
  │  (subscribe direto no SDK, sem passar pelo backend — ver README)
  │ PATCH ... in_progress → completed ──►│ grava checkout_at + push
  │ POST /reviews ──────────────────────►│ valida participação + trigger recalcula avg_rating
```

O **rastreamento em tempo real** e o **chat** podem ser consumidos pelo app
diretamente via **Supabase Realtime** (canais `postgres_changes`), sem
polling no backend — o backend apenas grava os dados (respeitando as policies
RLS). Ver exemplo no `README.md`.

---

## 6. Como rodar

```bash
yarn install
cp .env.example .env      # preencha as chaves
yarn dev                  # nodemon
yarn test                 # jest (67 testes)
yarn test:coverage        # cobertura
yarn lint                 # eslint 9 (flat config)
```

Health check: `GET /health` → `{ status: 'ok', ... }`.

Variáveis de ambiente: ver `.env.example` (Supabase, Pagar.me, Expo, Google,
`ADMIN_SECRET`, `PLATFORM_FEE_PERCENT`).
