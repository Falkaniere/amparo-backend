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

// Cliente por requisição, com o JWT do usuário no header Authorization.
// É este cliente que faz o RLS enxergar auth.uid() = id do usuário logado —
// sem ele, todas as leituras rodam como anônimas e as policies negam/retornam
// vazio. Usado nas leituras/escritas que devem respeitar o RLS.
function getUserClient(token) {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

module.exports = { supabase, supabaseAdmin, getUserClient };
