const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { supabase, supabaseAdmin } = require('../utils/supabase');
const { authMiddleware } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── GET /profile/me ────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const { id: userId, user_metadata } = req.user;
    const role = user_metadata?.role;

    const table = role === 'family' ? 'family_profiles' : 'companion_profiles';
    const select = role === 'companion'
      ? '*, companion_skills(*), availability(*), documents(*)'
      : '*';

    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq('user_id', userId)
      .single();

    if (error) return res.status(404).json({ error: 'Perfil não encontrado.' });

    res.json({ profile: data, role });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /profile/me ────────────────────────────────────────
router.put('/me', authMiddleware, async (req, res, next) => {
  try {
    const { id: userId, user_metadata } = req.user;
    const role = user_metadata?.role;
    const table = role === 'family' ? 'family_profiles' : 'companion_profiles';

    const allowedFamily     = ['elder_name', 'elder_notes', 'address', 'city', 'state'];
    const allowedCompanion  = ['bio', 'hourly_rate', 'radius_km', 'city', 'state', 'years_exp', 'push_token'];
    const allowed = role === 'family' ? allowedFamily : allowedCompanion;

    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const { data, error } = await supabase
      .from(table)
      .update(updates)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ profile: data });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /profile/companion/availability ────────────────────
router.put('/companion/availability', authMiddleware, async (req, res, next) => {
  try {
    const { id: userId } = req.user;
    const { slots } = req.body;
    // slots: [{ day_of_week: 1, start_time: '08:00', end_time: '18:00', is_active: true }]

    const { data: companion } = await supabase
      .from('companion_profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (!companion) return res.status(404).json({ error: 'Perfil de acompanhante não encontrado.' });

    // Remove slots antigos e recria
    await supabaseAdmin.from('availability').delete().eq('companion_id', companion.id);

    const newSlots = slots.map(s => ({ ...s, companion_id: companion.id }));
    const { error } = await supabaseAdmin.from('availability').insert(newSlots);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: 'Disponibilidade atualizada.' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /profile/companion/documents ──────────────────────
// Upload de documento para Supabase Storage
router.post('/companion/documents', authMiddleware, upload.single('file'), async (req, res, next) => {
  try {
    const { id: userId } = req.user;
    const { type } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'Arquivo não enviado.' });

    const validTypes = ['rg_cnh', 'background_check', 'certificate'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Tipo de documento inválido.' });
    }

    const { data: companion } = await supabase
      .from('companion_profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (!companion) return res.status(404).json({ error: 'Perfil não encontrado.' });

    // Upload para Storage (bucket privado)
    const ext = file.originalname.split('.').pop();
    const path = `documents/${companion.id}/${type}_${Date.now()}.${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('companion-docs')
      .upload(path, file.buffer, { contentType: file.mimetype });

    if (uploadError) return res.status(500).json({ error: 'Erro no upload do arquivo.' });

    // Salva referência no banco
    const { data: doc, error: dbError } = await supabaseAdmin
      .from('documents')
      .upsert({ companion_id: companion.id, type, storage_url: path }, { onConflict: 'companion_id,type' })
      .select()
      .single();

    if (dbError) return res.status(400).json({ error: dbError.message });

    res.status(201).json({ document: doc });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /profile/companion/online ──────────────────────────
// Toggle disponível/indisponível
router.put('/companion/online', authMiddleware, async (req, res, next) => {
  try {
    const { id: userId } = req.user;
    const { is_online } = req.body;

    const { data, error } = await supabase
      .from('companion_profiles')
      .update({ is_online })
      .eq('user_id', userId)
      .select('id, is_online')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ is_online: data.is_online });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
