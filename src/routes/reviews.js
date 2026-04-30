const express = require('express');
const router  = express.Router();
const { supabase, supabaseAdmin } = require('../utils/supabase');
const { authMiddleware } = require('../middleware/auth');

// ─── POST /reviews ──────────────────────────────────────────
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { id: userId } = req.user;
    const { request_id, reviewee_id, score, tags, comment, tip_amount } = req.body;

    if (score < 1 || score > 5) {
      return res.status(400).json({ error: 'Score deve ser entre 1 e 5.' });
    }

    // Valida que o serviço está concluído
    const { data: request } = await supabase
      .from('service_requests')
      .select('status')
      .eq('id', request_id)
      .single();

    if (request?.status !== 'completed') {
      return res.status(400).json({ error: 'Só é possível avaliar serviços concluídos.' });
    }

    const { data, error } = await supabaseAdmin
      .from('reviews')
      .insert({ request_id, reviewer_id: userId, reviewee_id, score, tags, comment, tip_amount: tip_amount || 0 })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.status(201).json({ review: data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
