const express = require('express');
const router  = express.Router();
const { supabase, supabaseAdmin } = require('../utils/supabase');
const { authMiddleware } = require('../middleware/auth');

// ─── GET /messages/:request_id ──────────────────────────────
router.get('/:request_id', authMiddleware, async (req, res, next) => {
  try {
    const { data, error } = await supabase
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
