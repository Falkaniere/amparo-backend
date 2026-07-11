const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { supabaseAdmin } = require('#utils/supabase');
const { authMiddleware } = require('#middleware/auth');
const { sendPushNotification } = require('#services/notifications');

const PAGARME_URL = 'https://api.pagar.me/core/v5';
const pagarmeAuth = () => ({
  headers: {
    'Authorization': `Basic ${Buffer.from(process.env.PAGARME_API_KEY + ':').toString('base64')}`,
    'Content-Type':  'application/json'
  }
});

// ─── POST /payments/create ──────────────────────────────────
router.post('/create', authMiddleware, async (req, res, next) => {
  try {
    const { request_id, method } = req.body; // method: 'pix' | 'credit_card'

    const { data: request } = await supabaseAdmin
      .from('service_requests')
      .select('*, family_profiles(user_id), companion_profiles(pagarme_recipient_id)')
      .eq('id', request_id)
      .single();

    if (!request) return res.status(404).json({ error: 'Solicitação não encontrada.' });

    // Apenas a família dona da solicitação pode iniciar o pagamento.
    if (request.family_profiles?.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Acesso negado a esta solicitação.' });
    }

    if (request.status !== 'pending') return res.status(400).json({ error: 'Solicitação não está pendente.' });

    const amountCents = Math.round(request.total_amount * 100);
    const companionAmountCents = Math.round(request.companion_amount * 100);

    // Monta payload para o Pagar.me
    const payload = {
      amount: amountCents,
      currency: 'BRL',
      payment_method: method === 'pix' ? 'pix' : 'credit_card',
      metadata: { request_id, platform: 'amparo' },
      split: request.companion_profiles?.pagarme_recipient_id ? [
        {
          recipient_id: process.env.PAGARME_PLATFORM_RECIPIENT_ID,
          amount: amountCents - companionAmountCents, // taxa da plataforma
          type: 'flat'
        },
        {
          recipient_id: request.companion_profiles.pagarme_recipient_id,
          amount: companionAmountCents,
          type: 'flat'
        }
      ] : []
    };

    if (method === 'pix') {
      payload.pix = { expires_in: 3600 }; // 1 hora para pagar
    }

    const { data: charge } = await axios.post(
      `${PAGARME_URL}/charges`,
      payload,
      pagarmeAuth()
    );

    // Salva pagamento no banco
    const paymentData = {
      request_id,
      gateway_id: charge.id,
      method,
      status:     'pending',
      amount:     request.total_amount
    };

    if (method === 'pix') {
      paymentData.pix_qr_code     = charge.last_transaction?.qr_code;
      paymentData.pix_qr_code_url = charge.last_transaction?.qr_code_url;
      paymentData.pix_expires_at  = new Date(Date.now() + 3600 * 1000).toISOString();
    }

    const { data: payment, error } = await supabaseAdmin
      .from('payments')
      .insert(paymentData)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.status(201).json({ payment });
  } catch (err) {
    next(err);
  }
});

// ─── POST /payments/webhook ─────────────────────────────────
// Recebe confirmação de pagamento do Pagar.me
router.post('/webhook', async (req, res, next) => {
  try {
    const event = JSON.parse(req.body.toString());

    if (event.type === 'charge.paid') {
      const gatewayId = event.data.id;

      // Busca o pagamento pelo ID do gateway
      const { data: payment } = await supabaseAdmin
        .from('payments')
        .select('*, service_requests(*, companion_profiles(push_token))')
        .eq('gateway_id', gatewayId)
        .single();

      if (!payment) return res.status(200).json({ ok: true }); // ignora se não encontrar

      // Atualiza pagamento para pago
      await supabaseAdmin
        .from('payments')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', payment.id);

      // Notifica acompanhante que o pedido está confirmado e pago
      const pushToken = payment.service_requests?.companion_profiles?.push_token;
      if (pushToken) {
        await sendPushNotification(pushToken, {
          title: '💰 Pagamento confirmado!',
          body:  'O pagamento foi aprovado. O pedido está confirmado.',
          data:  { request_id: payment.request_id }
        });
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});

// ─── GET /payments/:id/status ───────────────────────────────
router.get('/:id/status', authMiddleware, async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('payments')
      .select('id, status, method, amount, paid_at, pix_qr_code_url, pix_expires_at')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Pagamento não encontrado.' });

    res.json({ payment: data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
