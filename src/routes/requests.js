const express = require('express');
const router  = express.Router();
const { supabase, supabaseAdmin } = require('../utils/supabase');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { sendPushNotification } = require('../services/notifications');

const FEE = parseFloat(process.env.PLATFORM_FEE_PERCENT || 10) / 100;

// ─── POST /requests ─────────────────────────────────────────
// Família cria uma solicitação de serviço
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { id: userId } = req.user;
    const {
      type, scheduled_at, duration_hours,
      origin_address, origin_lat, origin_lng,
      destination_address, companion_id, notes
    } = req.body;

    if (!companion_id) {
      return res.status(400).json({ error: 'Selecione um acompanhante para a solicitação.' });
    }

    // Busca o perfil da família
    const { data: family } = await supabaseAdmin
      .from('family_profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (!family) return res.status(403).json({ error: 'Perfil de família não encontrado.' });

    // Busca taxa do acompanhante escolhido
    const { data: companion } = await supabaseAdmin
      .from('companion_profiles')
      .select('id, hourly_rate, push_token, verified, is_online')
      .eq('id', companion_id)
      .single();

    if (!companion) return res.status(404).json({ error: 'Acompanhante não encontrado.' });
    if (!companion.verified) return res.status(400).json({ error: 'Acompanhante não verificado.' });

    // Cálculo financeiro
    const service_amount  = parseFloat((companion.hourly_rate * duration_hours).toFixed(2));
    const platform_fee    = parseFloat((service_amount * FEE).toFixed(2));
    const total_amount    = parseFloat((service_amount + platform_fee).toFixed(2));
    const companion_amount = parseFloat((service_amount * (1 - FEE)).toFixed(2));

    const { data: request, error } = await supabaseAdmin
      .from('service_requests')
      .insert({
        family_id: family.id,
        companion_id: companion.id,
        type,
        scheduled_at,
        duration_hours,
        origin_address,
        origin_lat,
        origin_lng,
        destination_address,
        notes,
        hourly_rate: companion.hourly_rate,
        service_amount,
        platform_fee,
        total_amount,
        companion_amount,
        status: 'pending'
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Notifica o acompanhante
    if (companion.push_token) {
      await sendPushNotification(companion.push_token, {
        title: '🌿 Novo pedido no Amparo!',
        body: `Consulta médica em ${origin_address}. Toque para ver detalhes.`,
        data: { request_id: request.id, screen: 'RequestDetail' }
      });
    }

    res.status(201).json({ request });
  } catch (err) {
    next(err);
  }
});

// ─── GET /requests/family ───────────────────────────────────
// Histórico de pedidos da família autenticada
router.get('/family', authMiddleware, async (req, res, next) => {
  try {
    const { id: userId } = req.user;

    const { data: family } = await supabase
      .from('family_profiles').select('id').eq('user_id', userId).single();

    const { data, error } = await supabase
      .from('service_requests')
      .select('*, companion_profiles(id, user_id, avg_rating, total_services)')
      .eq('family_id', family.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    res.json({ requests: data });
  } catch (err) {
    next(err);
  }
});

// ─── GET /requests/companion ────────────────────────────────
// Histórico de pedidos do acompanhante autenticado
router.get('/companion', authMiddleware, async (req, res, next) => {
  try {
    const { id: userId } = req.user;

    const { data: companion } = await supabase
      .from('companion_profiles').select('id').eq('user_id', userId).single();

    const { data, error } = await supabase
      .from('service_requests')
      .select('*, family_profiles(id, elder_name)')
      .eq('companion_id', companion.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    res.json({ requests: data });
  } catch (err) {
    next(err);
  }
});

// ─── GET /requests/:id ──────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('service_requests')
      .select('*, family_profiles(*), companion_profiles(*)')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Solicitação não encontrada.' });

    res.json({ request: data });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /requests/:id/status ─────────────────────────────
// Máquina de estados do serviço
router.patch('/:id/status', authMiddleware, async (req, res, next) => {
  try {
    const { id: userId } = req.user;
    const { status, cancel_reason } = req.body;

    const { data: request } = await supabase
      .from('service_requests')
      .select('*, family_profiles(user_id), companion_profiles(user_id, push_token)')
      .eq('id', req.params.id)
      .single();

    if (!request) return res.status(404).json({ error: 'Solicitação não encontrada.' });

    // Valida transições permitidas
    const transitions = {
      pending:     ['accepted', 'cancelled'],
      accepted:    ['checked_in', 'cancelled'],
      checked_in:  ['in_progress'],
      in_progress: ['completed'],
      completed:   [],
      cancelled:   []
    };

    if (!transitions[request.status]?.includes(status)) {
      return res.status(400).json({
        error: `Transição inválida: ${request.status} → ${status}`
      });
    }

    const updates = { status };
    if (status === 'checked_in')  updates.checkin_at  = new Date().toISOString();
    if (status === 'completed')   updates.checkout_at = new Date().toISOString();
    if (status === 'cancelled') {
      updates.cancelled_by  = userId;
      updates.cancel_reason = cancel_reason || null;
    }

    const { data: updated, error } = await supabaseAdmin
      .from('service_requests')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Notificações conforme transição
    const familyToken    = null; // buscar push_token da família se necessário
    const companionToken = request.companion_profiles?.push_token;

    const notifMap = {
      accepted:    { token: familyToken,    title: '✅ Pedido confirmado!', body: 'Seu acompanhante aceitou o pedido.' },
      checked_in:  { token: familyToken,    title: '📍 Serviço iniciado', body: 'O acompanhante fez check-in.' },
      completed:   { token: familyToken,    title: '🎉 Serviço concluído', body: 'Avalie sua experiência com o Amparo!' },
      cancelled:   { token: companionToken, title: '❌ Pedido cancelado', body: cancel_reason || 'O pedido foi cancelado.' }
    };

    const notif = notifMap[status];
    if (notif?.token) {
      await sendPushNotification(notif.token, { title: notif.title, body: notif.body, data: { request_id: req.params.id } });
    }

    res.json({ request: updated });
  } catch (err) {
    next(err);
  }
});

// ─── POST /requests/:id/location ────────────────────────────
// Acompanhante envia atualização de GPS durante o serviço
router.post('/:id/location', authMiddleware, async (req, res, next) => {
  try {
    const { id: userId } = req.user;
    const { lat, lng } = req.body;

    const { data: companion } = await supabase
      .from('companion_profiles').select('id').eq('user_id', userId).single();

    await supabaseAdmin.from('location_updates').insert({
      request_id:   req.params.id,
      companion_id: companion.id,
      lat,
      lng
    });

    // Atualiza localização atual do acompanhante
    await supabaseAdmin
      .from('companion_profiles')
      .update({ location: `POINT(${lng} ${lat})` })
      .eq('id', companion.id);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
