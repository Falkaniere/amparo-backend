-- ============================================================
--  AMPARO — Schema do banco de dados
--  Execute este arquivo no SQL Editor do Supabase
--  Versão: 1.0.0
-- ============================================================

-- ─── Extensões ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "postgis"; -- geolocalização

-- ─── Enum: role do usuário ───────────────────────────────────
create type user_role as enum ('family', 'companion', 'admin');

-- ─── Enum: status do serviço ────────────────────────────────
create type service_status as enum (
  'pending',      -- aguardando acompanhante aceitar
  'accepted',     -- acompanhante aceitou
  'checked_in',   -- check-in realizado no local de saída
  'in_progress',  -- serviço em andamento
  'completed',    -- check-out feito, pagamento liberado
  'cancelled'     -- cancelado por qualquer parte
);

-- ─── Enum: status do pagamento ──────────────────────────────
create type payment_status as enum (
  'pending',      -- aguardando pagamento
  'paid',         -- pago com sucesso
  'released',     -- repasse ao acompanhante realizado
  'refunded',     -- estornado
  'failed'        -- falha no pagamento
);

-- ─── Enum: tipo de serviço ──────────────────────────────────
create type service_type as enum (
  'medical',      -- consulta médica / exames
  'errand',       -- farmácia / banco / mercado
  'walk',         -- passeio / parque
  'other'         -- personalizado
);

-- ─── Enum: tipo de documento ────────────────────────────────
create type document_type as enum ('rg_cnh', 'background_check', 'certificate');

-- ============================================================
--  TABELAS
-- ============================================================

-- ─── Perfis de família ──────────────────────────────────────
create table family_profiles (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  elder_name      text,                        -- nome do idoso
  elder_notes     text,                        -- observações sobre o idoso
  address         text,
  city            text default 'Rio de Janeiro',
  state           text default 'RJ',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique(user_id)
);

-- ─── Perfis de acompanhante ─────────────────────────────────
create table companion_profiles (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  bio             text,
  cpf             text unique,
  hourly_rate     numeric(8,2) not null default 35.00,
  radius_km       integer not null default 5,
  city            text default 'Rio de Janeiro',
  state           text default 'RJ',
  location        geography(Point, 4326),      -- ponto geográfico atual
  verified        boolean default false,       -- aprovado pela equipe Amparo
  is_online       boolean default false,       -- toggle disponível
  avg_rating      numeric(3,2) default 0,
  total_services  integer default 0,
  years_exp       integer default 0,
  pagarme_recipient_id text,                   -- ID do recebedor no Pagar.me
  push_token      text,                        -- token Expo para notificações
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique(user_id)
);

-- ─── Disponibilidade dos acompanhantes ──────────────────────
create table availability (
  id              uuid primary key default uuid_generate_v4(),
  companion_id    uuid not null references companion_profiles(id) on delete cascade,
  day_of_week     integer not null check (day_of_week between 0 and 6), -- 0=Dom, 6=Sáb
  start_time      time not null,
  end_time        time not null,
  is_active       boolean default true,
  created_at      timestamptz default now()
);

-- ─── Especialidades do acompanhante ─────────────────────────
create table companion_skills (
  id              uuid primary key default uuid_generate_v4(),
  companion_id    uuid not null references companion_profiles(id) on delete cascade,
  skill           text not null  -- ex: 'Consultas médicas', 'Idosos', 'Cadeirante'
);

-- ─── Documentos enviados pelo acompanhante ──────────────────
create table documents (
  id              uuid primary key default uuid_generate_v4(),
  companion_id    uuid not null references companion_profiles(id) on delete cascade,
  type            document_type not null,
  storage_url     text not null,
  verified_at     timestamptz,
  created_at      timestamptz default now()
);

-- ─── Solicitações de serviço (tabela central) ───────────────
create table service_requests (
  id                  uuid primary key default uuid_generate_v4(),
  family_id           uuid not null references family_profiles(id),
  companion_id        uuid references companion_profiles(id),
  type                service_type not null,
  status              service_status not null default 'pending',
  scheduled_at        timestamptz not null,
  duration_hours      numeric(4,1) not null,
  origin_address      text not null,
  origin_lat          numeric(10,7),
  origin_lng          numeric(10,7),
  destination_address text,
  notes               text,                   -- observações da família
  hourly_rate         numeric(8,2) not null,  -- snapshot da taxa no momento
  service_amount      numeric(8,2) not null,  -- hourly_rate × duration_hours
  platform_fee        numeric(8,2) not null,  -- 10% do service_amount
  total_amount        numeric(8,2) not null,  -- service_amount + platform_fee
  companion_amount    numeric(8,2) not null,  -- 90% do service_amount
  checkin_at          timestamptz,
  checkout_at         timestamptz,
  cancelled_by        uuid references auth.users(id),
  cancel_reason       text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- ─── Pagamentos ─────────────────────────────────────────────
create table payments (
  id                  uuid primary key default uuid_generate_v4(),
  request_id          uuid not null references service_requests(id) on delete cascade,
  gateway_id          text,                   -- ID da transação no Pagar.me
  method              text,                   -- 'pix' | 'credit_card'
  status              payment_status not null default 'pending',
  amount              numeric(8,2) not null,
  pix_qr_code         text,                   -- QR code base64
  pix_qr_code_url     text,                   -- URL do QR
  pix_expires_at      timestamptz,
  paid_at             timestamptz,
  released_at         timestamptz,            -- quando o repasse foi feito
  created_at          timestamptz default now(),
  unique(request_id)
);

-- ─── Avaliações ─────────────────────────────────────────────
create table reviews (
  id              uuid primary key default uuid_generate_v4(),
  request_id      uuid not null references service_requests(id) on delete cascade,
  reviewer_id     uuid not null references auth.users(id),
  reviewee_id     uuid not null references auth.users(id),
  score           integer not null check (score between 1 and 5),
  tags            text[],                     -- ['Pontualidade', 'Atenção', ...]
  comment         text,
  tip_amount      numeric(6,2) default 0,
  created_at      timestamptz default now(),
  unique(request_id, reviewer_id)
);

-- ─── Mensagens (chat por solicitação) ───────────────────────
create table messages (
  id              uuid primary key default uuid_generate_v4(),
  request_id      uuid not null references service_requests(id) on delete cascade,
  sender_id       uuid not null references auth.users(id),
  content         text not null,
  read_at         timestamptz,
  created_at      timestamptz default now()
);

-- ─── Localização em tempo real do acompanhante ──────────────
create table location_updates (
  id              uuid primary key default uuid_generate_v4(),
  request_id      uuid not null references service_requests(id) on delete cascade,
  companion_id    uuid not null references companion_profiles(id),
  lat             numeric(10,7) not null,
  lng             numeric(10,7) not null,
  created_at      timestamptz default now()
);

-- ============================================================
--  ÍNDICES
-- ============================================================

create index idx_companion_profiles_location   on companion_profiles using gist(location);
create index idx_companion_profiles_online     on companion_profiles(is_online, verified);
create index idx_service_requests_family       on service_requests(family_id);
create index idx_service_requests_companion    on service_requests(companion_id);
create index idx_service_requests_status       on service_requests(status);
create index idx_service_requests_scheduled    on service_requests(scheduled_at);
create index idx_availability_companion        on availability(companion_id, day_of_week);
create index idx_messages_request             on messages(request_id, created_at);
create index idx_location_updates_request     on location_updates(request_id, created_at desc);
create index idx_reviews_reviewee             on reviews(reviewee_id);

-- ============================================================
--  FUNÇÕES UTILITÁRIAS
-- ============================================================

-- Recalcula avg_rating do acompanhante após nova review
create or replace function update_companion_rating()
returns trigger as $$
begin
  update companion_profiles
  set
    avg_rating = (
      select round(avg(score)::numeric, 2)
      from reviews r
      join service_requests sr on sr.id = r.request_id
      join companion_profiles cp on cp.user_id = r.reviewee_id
      where cp.id = (
        select id from companion_profiles where user_id = new.reviewee_id
      )
    ),
    total_services = (
      select count(*)
      from service_requests sr
      join companion_profiles cp on cp.id = sr.companion_id
      where cp.user_id = new.reviewee_id
        and sr.status = 'completed'
    )
  where user_id = new.reviewee_id;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_update_companion_rating
  after insert on reviews
  for each row execute function update_companion_rating();

-- Atualiza updated_at automaticamente
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_family_profiles_updated_at
  before update on family_profiles
  for each row execute function set_updated_at();

create trigger trg_companion_profiles_updated_at
  before update on companion_profiles
  for each row execute function set_updated_at();

create trigger trg_service_requests_updated_at
  before update on service_requests
  for each row execute function set_updated_at();

-- ============================================================
--  ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Habilita RLS em todas as tabelas
alter table family_profiles     enable row level security;
alter table companion_profiles  enable row level security;
alter table availability        enable row level security;
alter table companion_skills    enable row level security;
alter table documents           enable row level security;
alter table service_requests    enable row level security;
alter table payments            enable row level security;
alter table reviews             enable row level security;
alter table messages            enable row level security;
alter table location_updates    enable row level security;

-- family_profiles: usuário só vê e edita o próprio perfil
create policy "family: lê próprio perfil"
  on family_profiles for select
  using (auth.uid() = user_id);

create policy "family: edita próprio perfil"
  on family_profiles for update
  using (auth.uid() = user_id);

create policy "family: cria próprio perfil"
  on family_profiles for insert
  with check (auth.uid() = user_id);

-- companion_profiles: próprio perfil + leitura pública para busca
create policy "companion: lê próprio perfil"
  on companion_profiles for select
  using (auth.uid() = user_id);

create policy "companion: perfil público verificado"
  on companion_profiles for select
  using (verified = true);

create policy "companion: edita próprio perfil"
  on companion_profiles for update
  using (auth.uid() = user_id);

create policy "companion: cria próprio perfil"
  on companion_profiles for insert
  with check (auth.uid() = user_id);

-- service_requests: família e acompanhante envolvidos lêem/editam
create policy "requests: família acessa os próprios"
  on service_requests for all
  using (
    family_id in (
      select id from family_profiles where user_id = auth.uid()
    )
  );

create policy "requests: acompanhante acessa os próprios"
  on service_requests for all
  using (
    companion_id in (
      select id from companion_profiles where user_id = auth.uid()
    )
  );

create policy "requests: acompanhante vê pedidos pending"
  on service_requests for select
  using (status = 'pending');

-- messages: só participantes do serviço
create policy "messages: participantes lêem"
  on messages for select
  using (
    request_id in (
      select id from service_requests sr
      where
        sr.family_id in (select id from family_profiles where user_id = auth.uid())
        or sr.companion_id in (select id from companion_profiles where user_id = auth.uid())
    )
  );

create policy "messages: participantes enviam"
  on messages for insert
  with check (
    auth.uid() = sender_id
    and request_id in (
      select id from service_requests sr
      where
        sr.family_id in (select id from family_profiles where user_id = auth.uid())
        or sr.companion_id in (select id from companion_profiles where user_id = auth.uid())
    )
  );

-- reviews: autor lê e cria
create policy "reviews: autor cria"
  on reviews for insert
  with check (auth.uid() = reviewer_id);

create policy "reviews: leitura pública"
  on reviews for select
  using (true);

-- location_updates: leitura por família do serviço ativo
create policy "location: família do serviço lê"
  on location_updates for select
  using (
    request_id in (
      select id from service_requests sr
      where sr.family_id in (select id from family_profiles where user_id = auth.uid())
    )
  );

create policy "location: acompanhante insere"
  on location_updates for insert
  with check (
    companion_id in (select id from companion_profiles where user_id = auth.uid())
  );
