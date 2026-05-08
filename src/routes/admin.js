const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../utils/supabase');
const adminAuth = require('../middleware/adminAuth');

router.use(adminAuth);

async function buildCompanionPayload(cp) {
  const [userResult, docsResult] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(cp.user_id),
    supabaseAdmin
      .from('documents')
      .select('storage_url')
      .eq('companion_id', cp.id)
      .eq('type', 'rg_cnh')
      .maybeSingle(),
  ]);

  const user = userResult.data?.user;

  let profilePhotoUrl = null;
  if (cp.profile_photo_url) {
    const { data: signed } = await supabaseAdmin.storage
      .from('companion-photos')
      .createSignedUrl(cp.profile_photo_url, 3600);
    profilePhotoUrl = signed?.signedUrl || null;
  }

  let documentUrl = null;
  if (docsResult.data?.storage_url) {
    const { data: signed } = await supabaseAdmin.storage
      .from('companion-docs')
      .createSignedUrl(docsResult.data.storage_url, 3600);
    documentUrl = signed?.signedUrl || null;
  }

  return {
    id: cp.id,
    user_id: cp.user_id,
    status: cp.status,
    rejection_reason: cp.rejection_reason,
    created_at: cp.created_at,
    profile_photo_url: profilePhotoUrl,
    document_url: documentUrl,
    user: {
      name:  user?.user_metadata?.full_name || user?.user_metadata?.name || null,
      email: user?.email || null,
      phone: user?.user_metadata?.phone || user?.phone || null,
    },
  };
}

// ─── GET /admin/companions ─────────────────────────────────
router.get('/companions', async (req, res, next) => {
  try {
    const { status = 'pending' } = req.query;
    if (!['pending', 'rejected', 'approved'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }

    const { data: companions, error } = await supabaseAdmin
      .from('companion_profiles')
      .select('id, user_id, profile_photo_url, status, rejection_reason, created_at')
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    const enriched = await Promise.all(companions.map(buildCompanionPayload));
    res.json({ companions: enriched });
  } catch (err) {
    next(err);
  }
});

// ─── GET /admin/companions/:id ─────────────────────────────
router.get('/companions/:id', async (req, res, next) => {
  try {
    const { data: cp, error } = await supabaseAdmin
      .from('companion_profiles')
      .select('id, user_id, profile_photo_url, status, rejection_reason, created_at')
      .eq('id', req.params.id)
      .single();

    if (error || !cp) return res.status(404).json({ error: 'Acompanhante não encontrado.' });

    res.json({ companion: await buildCompanionPayload(cp) });
  } catch (err) {
    next(err);
  }
});

// ─── POST /admin/companions/:id/approve ───────────────────
router.post('/companions/:id/approve', async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('companion_profiles')
      .update({ status: 'approved', verified: true, rejection_reason: null })
      .eq('id', req.params.id);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Acompanhante aprovado com sucesso.' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /admin/companions/:id/reject ────────────────────
router.post('/companions/:id/reject', async (req, res, next) => {
  try {
    const { reason } = req.body;
    const { error } = await supabaseAdmin
      .from('companion_profiles')
      .update({ status: 'rejected', verified: false, rejection_reason: reason || null })
      .eq('id', req.params.id);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Acompanhante reprovado.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
