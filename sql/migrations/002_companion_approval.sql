-- ============================================================
--  Migration 002: Sistema de aprovação de acompanhantes
--  Execute no SQL Editor do Supabase
-- ============================================================

CREATE TYPE companion_status AS ENUM ('pending', 'approved', 'rejected');

ALTER TABLE companion_profiles
  ADD COLUMN IF NOT EXISTS status companion_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS profile_photo_url text,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Acompanhantes já verificados passam direto para approved
UPDATE companion_profiles SET status = 'approved' WHERE verified = true;

-- Atualiza função de busca para usar status = 'approved'
CREATE OR REPLACE FUNCTION search_companions(
  p_lat         float,
  p_lng         float,
  p_day         integer,
  p_start_time  time,
  p_duration_h  float
)
RETURNS TABLE (
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
LANGUAGE sql
STABLE
AS $$
  SELECT
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
    )::float AS distance_km
  FROM companion_profiles cp
  WHERE
    cp.status = 'approved'
    AND cp.is_online = true
    AND cp.location IS NOT NULL
    AND st_dwithin(
      cp.location::geography,
      st_point(p_lng, p_lat)::geography,
      cp.radius_km * 1000
    )
    AND EXISTS (
      SELECT 1
      FROM availability a
      WHERE a.companion_id = cp.id
        AND a.is_active     = true
        AND a.day_of_week   = p_day
        AND a.start_time   <= p_start_time
        AND a.end_time     >= (p_start_time + (p_duration_h || ' hours')::interval)::time
    )
    AND NOT EXISTS (
      SELECT 1
      FROM service_requests sr
      WHERE sr.companion_id = cp.id
        AND sr.status NOT IN ('cancelled', 'completed')
        AND sr.scheduled_at <= (now() + (p_duration_h || ' hours')::interval)
    )
  ORDER BY distance_km ASC, cp.avg_rating DESC;
$$;
