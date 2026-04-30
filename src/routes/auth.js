const express = require('express');
const router  = express.Router();
const { supabase, supabaseAdmin } = require('../utils/supabase');

// ─── POST /auth/register ────────────────────────────────────
// Cria usuário (family ou companion)
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, phone, role } = req.body;

    if (!['family', 'companion'].includes(role)) {
      return res.status(400).json({ error: 'Role deve ser family ou companion.' });
    }

    // Cria o usuário no Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, phone, role }
      }
    });

    if (error) return res.status(400).json({ error: error.message });

    const userId = data.user.id;

    // Cria o perfil correspondente na tabela correta
    if (role === 'family') {
      await supabaseAdmin.from('family_profiles').insert({ user_id: userId });
    } else {
      await supabaseAdmin.from('companion_profiles').insert({ user_id: userId });
    }

    res.status(201).json({
      message: 'Conta criada com sucesso. Verifique seu e-mail.',
      user: { id: userId, email, role }
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/login ───────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });

    res.json({
      access_token:  data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in:    data.session.expires_in,
      user: {
        id:    data.user.id,
        email: data.user.email,
        name:  data.user.user_metadata?.name,
        role:  data.user.user_metadata?.role
      }
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/refresh ─────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    const { data, error } = await supabase.auth.refreshSession({ refresh_token });

    if (error) return res.status(401).json({ error: 'Refresh token inválido.' });

    res.json({
      access_token:  data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in:    data.session.expires_in
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/otp/send ────────────────────────────────────
// Envia OTP via SMS para verificação de telefone
router.post('/otp/send', async (req, res, next) => {
  try {
    const { phone } = req.body;

    const { error } = await supabase.auth.signInWithOtp({ phone });

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: 'Código enviado por SMS.' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/otp/verify ──────────────────────────────────
router.post('/otp/verify', async (req, res, next) => {
  try {
    const { phone, token } = req.body;

    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms'
    });

    if (error) return res.status(400).json({ error: 'Código inválido ou expirado.' });

    res.json({
      message: 'Telefone verificado com sucesso.',
      access_token: data.session?.access_token
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
