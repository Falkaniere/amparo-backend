const express = require('express');
const router  = express.Router();
const { supabase, supabaseAdmin } = require('#utils/supabase');
const { authMiddleware } = require('#middleware/auth');

// ─── POST /reviews ──────────────────────────────────────────
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { id: userId } = req.user;
    const { request_id, reviewee_id, score, tags, comment, tip_amount } = req.body;

    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return res.status(400).json({ error: 'Score deve ser entre 1 e 5.' });
    }

    if (!request_id || !reviewee_id) {
      return res.status(400).json({ error: 'request_id e reviewee_id são obrigatórios.' });
    }

    // Valida que o serviço está concluído e que o autor participou dele
    const { data: request } = await supabase
      .from('service_requests')
      .select('status, family_profiles(user_id), companion_profiles(user_id)')
      .eq('id', request_id)
      .single();

    if (request?.status !== 'completed') {
      return res.status(400).json({ error: 'Só é possível avaliar serviços concluídos.' });
    }

    const participantes = [
      request.family_profiles?.user_id,
      request.companion_profiles?.user_id,
    ];
    if (!participantes.includes(userId)) {
      return res.status(403).json({ error: 'Você não participou deste serviço.' });
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
