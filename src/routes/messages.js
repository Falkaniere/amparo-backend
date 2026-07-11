const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('#utils/supabase');
const { authMiddleware } = require('#middleware/auth');

// Verifica se o usuário é participante (família ou acompanhante) do serviço.
async function isParticipant(requestId, userId) {
  const { data } = await supabaseAdmin
    .from('service_requests')
    .select('family_profiles(user_id), companion_profiles(user_id)')
    .eq('id', requestId)
    .single();

  if (!data) return false;
  return [
    data.family_profiles?.user_id,
    data.companion_profiles?.user_id,
  ].includes(userId);
}

// ─── GET /messages/:request_id ──────────────────────────────
router.get('/:request_id', authMiddleware, async (req, res, next) => {
  try {
    if (!(await isParticipant(req.params.request_id, req.user.id))) {
      return res.status(403).json({ error: 'Acesso negado a esta conversa.' });
    }

    const { data, error } = await req.supabase
      .from('messages')
      .select('*')
      .eq('request_id', req.params.request_id)
      .order('created_at', { ascending: true });

    if (error) return res.status(400).json({ error: error.message });

    res.json({ messages: data });
  } catch (err) {
    next(err);
  }
});

// ─── POST /messages ─────────────────────────────────────────
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { id: userId } = req.user;
    const { request_id, content } = req.body;

    if (!content?.trim()) {
      return res.status(400).json({ error: 'Mensagem não pode estar vazia.' });
    }

    if (!(await isParticipant(request_id, userId))) {
      return res.status(403).json({ error: 'Acesso negado a esta conversa.' });
    }

    const { data, error } = await supabaseAdmin
      .from('messages')
      .insert({ request_id, sender_id: userId, content: content.trim() })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.status(201).json({ message: data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
