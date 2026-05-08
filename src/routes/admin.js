const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../utils/supabase');

async function buildCompanionPayload(companion) {
  let userInfo = { name: null, email: null, phone: null };
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(companion.user_id);
    if (data?.user) {
      userInfo.email = data.user.email;
      userInfo.phone = data.user.phone;
      userInfo.name = data.user.user_metadata?.full_name || data.user.user_metadata?.name || null;
    }
  } catch (_) {}

  let profile_photo_signed_url = null;
  if (companion.profile_photo_url) {
    try {
      const { data: signed } = await supabaseAdmin.storage
        .from('companion-photos')
        .createSignedUrl(companion.profile_photo_url, 3600);
      profile_photo_signed_url = signed?.signedUrl || null;
    } catch (_) {}
  }

  const { data: docs } = await supabaseAdmin
    .from('documents')
    .select('type, storage_url')
    .eq('companion_id', companion.id);

  const documents = [];
  for (const doc of docs || []) {
    if (!doc.storage_url) continue;
    try {
      const { data: signedDoc } = await supabaseAdmin.storage
        .from('companion-docs')
        .createSignedUrl(doc.storage_url, 3600);
      if (signedDoc?.signedUrl) {
        documents.push({ type: doc.type, signed_url: signedDoc.signedUrl });
      }
    } catch (_) {}
  }

  return {
    id: companion.id,
    user_id: companion.user_id,
    status: companion.status,
    rejection_reason: companion.rejection_reason,
    created_at: companion.created_at,
    profile_photo_signed_url,
    documents,
    ...userInfo,
  };
}

// GET /admin/debug — diagnóstico temporário
router.get('/debug', async (req, res) => {
  const steps = [];

  // 1. Query sem filtro de status
  try {
    const { data, error } = await supabaseAdmin
      .from('companion_profiles')
      .select('id, user_id, status')
      .limit(1);
    steps.push({ step: 'query_companion_profiles', ok: !error, error: error?.message, count: data?.length });
  } catch (e) {
    steps.push({ step: 'query_companion_profiles', ok: false, error: e.message });
  }

  // 2. Query com filtro de status
  try {
    const { data, error } = await supabaseAdmin
      .from('companion_profiles')
      .select('id')
      .eq('status', 'pending')
      .limit(1);
    steps.push({ step: 'query_status_pending', ok: !error, error: error?.message, count: data?.length });
  } catch (e) {
    steps.push({ step: 'query_status_pending', ok: false, error: e.message });
  }

  // 3. Testar Storage bucket companion-photos
  try {
    const { data, error } = await supabaseAdmin.storage.from('companion-photos').list('', { limit: 1 });
    steps.push({ step: 'storage_companion_photos', ok: !error, error: error?.message });
  } catch (e) {
    steps.push({ step: 'storage_companion_photos', ok: false, error: e.message });
  }

  // 4. Testar Storage bucket companion-docs
  try {
    const { data, error } = await supabaseAdmin.storage.from('companion-docs').list('', { limit: 1 });
    steps.push({ step: 'storage_companion_docs', ok: !error, error: error?.message });
  } catch (e) {
    steps.push({ step: 'storage_companion_docs', ok: false, error: e.message });
  }

  // 5. Testar auth admin
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
    steps.push({ step: 'auth_admin_listUsers', ok: !error, error: error?.message });
  } catch (e) {
    steps.push({ step: 'auth_admin_listUsers', ok: false, error: e.message });
  }

  res.json({ steps });
});

// GET /admin/companions?status=pending|rejected|approved
router.get('/companions', async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const validStatuses = ['pending', 'approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }

    const { data: companions, error } = await supabaseAdmin
      .from('companion_profiles')
      .select('id, user_id, status, rejection_reason, profile_photo_url, created_at')
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    const result = await Promise.all((companions || []).map(buildCompanionPayload));
    res.json({ companions: result });
  } catch (err) {
    next(err);
  }
});

// GET /admin/companions/:id
router.get('/companions/:id', async (req, res, next) => {
  try {
    const { data: companion, error } = await supabaseAdmin
      .from('companion_profiles')
      .select('id, user_id, status, rejection_reason, profile_photo_url, created_at')
      .eq('id', req.params.id)
      .single();

    if (error || !companion) return res.status(404).json({ error: 'Acompanhante não encontrado.' });

    const result = await buildCompanionPayload(companion);
    res.json({ companion: result });
  } catch (err) {
    next(err);
  }
});

// POST /admin/companions/:id/approve
router.post('/companions/:id/approve', async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('companion_profiles')
      .update({ status: 'approved', verified: true, rejection_reason: null })
      .eq('id', req.params.id);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: 'Acompanhante aprovado.' });
  } catch (err) {
    next(err);
  }
});

// POST /admin/companions/:id/reject
router.post('/companions/:id/reject', async (req, res, next) => {
  try {
    const { rejection_reason } = req.body;

    const { error } = await supabaseAdmin
      .from('companion_profiles')
      .update({ status: 'rejected', verified: false, rejection_reason: rejection_reason || null })
      .eq('id', req.params.id);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: 'Acompanhante reprovado.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
