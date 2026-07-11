# 🔍 Amparo Backend — Relatório de Auditoria

Auditoria de **performance, arquitetura, clean code/clean architecture, bugs,
qualidade de testes e padronização de imports**.

> **Escopo:** este repositório é o **backend** (Node.js + Express + Supabase). A
> auditoria original pedia também pontos de **React Native**; como o app mobile
> não vive aqui, os itens de RN não se aplicam. Todo o restante (queries,
> chamadas de API, arquitetura, bugs, aliases, testes) foi coberto.

**Baseline:** 53 testes passando → **67 testes passando**, ESLint verde, app
sobe sem erros.

---

## 1. Correções aplicadas ✅

### 1.1 Padronização de imports com aliases (pedido explícito)
- Adicionado o campo `imports` no `package.json` (subpath imports nativos do
  Node) e `moduleNameMapper` no `jest.config.js`.
- Todos os `require('../../…')` internos viraram `#middleware/*`, `#routes/*`,
  `#services/*`, `#utils/*` — em **todo o `src/`, incluindo os testes**.

### 1.2 Rota duplicada / código morto (bug) — `profiles.js`
- `PUT /profile/companion/photo` estava **declarada duas vezes**. No Express, a
  segunda declaração nunca era alcançada (dead code). Removida a duplicata e
  mantida a versão que retorna `profile_photo_url`, incorporando o fallback de
  extensão (`|| 'jpg'`).

### 1.3 Endpoint de diagnóstico exposto (segurança) — `admin.js`
- Removido `GET /admin/debug` ("diagnóstico temporário"), que vazava informação
  interna (buckets de Storage, listagem de usuários, estrutura de tabelas).

### 1.4 Validação de entrada em `POST /requests` (bug financeiro)
- Sem validação, `duration_hours` ausente gerava `hourly_rate × undefined = NaN`
  e persistia valores financeiros `NaN` no banco; um `type` inválido causava
  erro cru do Postgres.
- Adicionadas validações de `type` (enum), `scheduled_at` (data válida),
  `origin_address` e `duration_hours > 0`, com mensagens amigáveis. O cálculo
  passou a usar o número já normalizado.

### 1.5 Falhas de autorização (segurança) — reviews, messages, payments
Escritas que usam `supabaseAdmin` **ignoram o RLS**, então dependem de checagem
em código — que estava **ausente**. Qualquer usuário autenticado podia agir
sobre recursos de terceiros. Corrigido:
- **`POST /reviews`** — exige que o autor tenha **participado** do serviço
  (família ou acompanhante) e valida `score` como inteiro 1–5 (antes um `score`
  ausente passava, pois `undefined < 1` é `false`).
- **`GET/POST /messages`** — só **participantes** do serviço leem/escrevem
  (helper `isParticipant`).
- **`POST /payments/create`** — só a **família dona** da solicitação inicia o
  pagamento; a leitura passou a usar `supabaseAdmin` + checagem de posse
  (evita depender do RLS para uma operação crítica).

### 1.6 Rate limiter atingindo o webhook (confiabilidade) — `index.js`
- O `express-rate-limit` global (100 req/min) também limitava
  `/payments/webhook`. Sob pico, o Pagar.me poderia receber `429` e **perder
  confirmações de pagamento**. Adicionado `skip` para essa rota.

### 1.7 Erro ignorado no cadastro de família — `auth.js`
- `POST /auth/register` (family) não checava o erro do insert em
  `family_profiles` (o ramo companion checava). Agora ambos retornam erro
  consistente.

### 1.8 Ferramental de qualidade
- **ESLint estava quebrado**: o script `lint` não rodava (ESLint 9 exige
  `eslint.config.js`, inexistente). Adicionada uma *flat config* para
  Node/CommonJS + Jest e a dev-dependency `@eslint/js`. `yarn lint` agora passa.
- Removidos imports/variáveis não usados detectados pelo lint
  (`requireRole` em `requests.js`, `type` em `companions.js`, catches vazios em
  `admin.js`).

### 1.9 Qualidade de testes / falsos positivos
- **Falso positivo corrigido:** o bloco *"Platform fee calculation"* em
  `requests.test.js` **reimplementava a aritmética inline** e nunca chamava a
  rota — passaria mesmo com a lógica financeira quebrada. Substituído por testes
  que exercitam o **handler real** de `POST /requests`, capturando o payload
  efetivamente enviado ao `insert` e validando os valores (além de cobrir
  validações e acompanhante não verificado).
- **Novos testes** para arquivos que não tinham nenhum:
  `services/notifications.test.js` (5 casos) e `routes/messages.test.js`
  (autorização + validação).
- Testes de `reviews` atualizados para cobrir a nova verificação de
  participação, **com asserção explícita de que a review não é inserida** quando
  o autor não participou (guarda contra falso positivo).

---

## 2. Recomendações — **não** aplicadas automaticamente ⚠️

Itens de maior impacto que envolvem infraestrutura/DB ou risco de regressão em
produção. Documentados aqui para decisão do time.

### 2.1 🔴 ALTA — JWT do usuário não é propagado ao Supabase (RLS efetivamente nula nas leituras)
O cliente `supabase` é criado **uma vez** com a *anon key* e **nunca recebe o
token do usuário**. Logo, as policies baseadas em `auth.uid()` enxergam
`auth.uid()` como `NULL`. Consequências:
- Leituras protegidas por RLS (ex.: `/profile/me`, `/requests/family`,
  `family_profiles`) tendem a **retornar vazio** — ou, se o RLS estiver
  desabilitado no banco de produção, a **proteção não existe** e qualquer um
  lê tudo via anon.

**Correção recomendada:** criar um cliente Supabase **por request**, com o token
do usuário, e usá-lo nas leituras/escritas que devem respeitar o RLS:

```js
// utils/supabase.js
function getUserClient(token) {
  return createClient(URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
// middleware/auth.js → req.supabase = getUserClient(token);
```

Isso exige revisar rotas e mocks de teste; por tocar o comportamento de acesso
e não poder ser validado contra a infra real aqui, ficou como recomendação.

### 2.2 🔴 ALTA — Webhook do Pagar.me sem verificação de assinatura
`POST /payments/webhook` **confia em qualquer POST**. Um atacante pode enviar
`{"type":"charge.paid","data":{"id":...}}` e marcar pagamentos como pagos.
**Recomendado:** validar a assinatura/segredo do webhook (HMAC ou Basic auth
configurado no painel do Pagar.me) antes de processar. Não implementado por não
haver como testar contra o gateway real sem arriscar rejeitar eventos legítimos.
(A exclusão do rate limiter — item 1.6 — já foi feita.)

### 2.3 🟠 MÉDIA — Bug lógico na RPC `search_companions` (conflito de horário)
A cláusula que evita acompanhante com serviço no mesmo horário compara
`sr.scheduled_at <= (now() + duration)` — usa **`now()`** em vez da **data/hora
solicitada** (`p_day`/`p_start_time`). Resultado: o filtro de conflito não
reflete o slot pedido (pode ocultar ou liberar acompanhantes incorretamente).
Correção pertence ao SQL (`sql/functions.sql` + migration), fora do código Node.

### 2.4 🟠 MÉDIA — Notificações para a família são código morto
Em `PATCH /requests/:id/status`, `familyToken` é sempre `null` (comentário
"buscar push_token da família se necessário"), e **`family_profiles` não tem
coluna `push_token`**. Logo, os eventos `accepted`/`checked_in`/`completed`
**nunca** notificam a família. Recomendado: adicionar `push_token` a
`family_profiles` e buscá-lo, ou remover o mapa morto para não induzir a erro.

### 2.5 🟡 BAIXA — Performance: N+1 no painel admin
`GET /admin/companions` chama `buildCompanionPayload` por acompanhante, e cada
chamada faz `getUserById` + `createSignedUrl` (foto) + query de documentos +
`createSignedUrl` por documento — sequencialmente. Para listas grandes, são
muitas chamadas. Aceitável para um painel interno; se crescer, considerar
`auth.admin.listUsers` em lote e assinar URLs em paralelo.

### 2.6 🟡 BAIXA — Outros
- **CORS `origin: '*'`** — avaliar restringir às origens do app/painel.
- **`/auth/role`** — insere perfil sem verificar duplicidade nem atualizar
  `user_metadata.role`.
- **`PUT /profile/me`** — se `role` for indefinido, cai no ramo companion por
  padrão (o `else` implícito). Validar `role` explicitamente.
- **`payments.js`** e **`profiles.js`** ainda não têm testes unitários dedicados
  (fluxos com Storage/gateway). Recomendado cobrir os caminhos de erro.

---

## 3. Resumo

| Categoria | Aplicado | Recomendado |
|-----------|:--------:|:-----------:|
| Aliases de import | ✅ | — |
| Bugs (dead code, validação, NaN financeiro) | ✅ (1.2, 1.4, 1.7) | 2.3, 2.4 |
| Segurança / autorização | ✅ (1.3, 1.5, 1.6) | 2.1, 2.2, 2.6 |
| Clean code / ferramental | ✅ (1.8) | 2.6 |
| Testes (falso positivo + cobertura) | ✅ (1.9) | 2.6 |
| Performance | — | 2.5 |
