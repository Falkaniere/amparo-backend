-- ============================================================
--  Função: search_companions
--  Busca acompanhantes verificados, online, disponíveis
--  na data/horário solicitados e dentro do raio configurado
--  Execute no SQL Editor do Supabase após o schema.sql
-- ============================================================

create or replace function search_companions(
  p_lat         float,
  p_lng         float,
  p_day         integer,    -- dia da semana (0=Dom, 6=Sáb)
  p_start_time  time,
  p_duration_h  float
)
returns table (
  id              uuid,
  user_id         uuid,
  bio             text,
  hourly_rate     numeric,
  radius_km       integer,
  avg_rating      numeric,
  total_services  integer,
  years_exp       integer,
  is_online       boolean,
  distance_km     float
)
language sql
stable
as $$
  select
    cp.id,
    cp.user_id,
    cp.bio,
    cp.hourly_rate,
    cp.radius_km,
    cp.avg_rating,
    cp.total_services,
    cp.years_exp,
    cp.is_online,
    round(
      (st_distance(
        cp.location::geography,
        st_point(p_lng, p_lat)::geography
      ) / 1000)::numeric,
      1
    )::float as distance_km
  from companion_profiles cp
  where
    cp.verified = true
    and cp.is_online = true
    and cp.location is not null
    -- dentro do raio configurado pelo acompanhante
    and st_dwithin(
      cp.location::geography,
      st_point(p_lng, p_lat)::geography,
      cp.radius_km * 1000
    )
    -- disponível no dia e horário solicitados
    and exists (
      select 1
      from availability a
      where a.companion_id = cp.id
        and a.is_active     = true
        and a.day_of_week   = p_day
        and a.start_time   <= p_start_time
        and a.end_time     >= (p_start_time + (p_duration_h || ' hours')::interval)::time
    )
    -- não tem serviço ativo no mesmo horário
    and not exists (
      select 1
      from service_requests sr
      where sr.companion_id = cp.id
        and sr.status not in ('cancelled', 'completed')
        and sr.scheduled_at <= (now() + (p_duration_h || ' hours')::interval)
    )
  order by distance_km asc, cp.avg_rating desc;
$$;
