-- ============================================================
--  Migration 003: CPF do acompanhante
--  Garante a coluna `cpf` e sua unicidade em bases já existentes.
--  Execute no SQL Editor do Supabase.
-- ============================================================

ALTER TABLE companion_profiles
  ADD COLUMN IF NOT EXISTS cpf text;

CREATE UNIQUE INDEX IF NOT EXISTS companion_profiles_cpf_key
  ON companion_profiles (cpf);
