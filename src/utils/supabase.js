const { createClient } = require('@supabase/supabase-js');

// Cliente público — respeita RLS (usado nas rotas normais)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

// Cliente admin — bypass RLS (usado apenas em operações internas como webhooks)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

module.exports = { supabase, supabaseAdmin };
