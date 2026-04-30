const express = require('express');
const router  = express.Router();
const { supabase } = require('../utils/supabase');
const { authMiddleware } = require('../middleware/auth');

// ─── GET /companions/available ──────────────────────────────
// Busca acompanhantes disponíveis por data, horário e localização
router.get('/available', authMiddleware, async (req, res, next) => {
  try {
    const {
      lat, lng,           // localização da família
      date,               // ex: '2026-04-29'
      start_time,         // ex: '14:00'
      duration_hours,     // ex: 3
      type                // service_type
    } = req.query;

    if (!lat || !lng || !date || !start_time) {
      return res.status(400).json({ error: 'lat, lng, date e start_time são obrigatórios.' });
    }

    // Dia da semana (0=Dom ... 6=Sáb)
    const dayOfWeek = new Date(date).getDay();

    // Busca acompanhantes verificados, online e dentro do raio,
    // com disponibilidade no dia e horário solicitados
    const { data, error } = await supabase.rpc('search_companions', {
      p_lat:          parseFloat(lat),
      p_lng:          parseFloat(lng),
      p_day:          dayOfWeek,
      p_start_time:   start_time,
      p_duration_h:   parseFloat(duration_hours || 1)
    });

    if (error) return res.status(400).json({ error: error.message });

    res.json({ companions: data || [] });
  } catch (err) {
    next(err);
  }
});

// ─── GET /companions/:id ────────────────────────────────────
// Perfil público de um acompanhante
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('companion_profiles')
      .select('*, companion_skills(*), availability(*), documents(type, verified_at)')
      .eq('id', req.params.id)
      .eq('verified', true)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Acompanhante não encontrado.' });

    // Busca as últimas 5 avaliações
    const { data: reviews } = await supabase
      .from('reviews')
      .select('score, tags, comment, created_at, reviewer_id')
      .eq('reviewee_id', data.user_id)
      .order('created_at', { ascending: false })
      .limit(5);

    res.json({ companion: data, reviews: reviews || [] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
