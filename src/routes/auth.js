const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../utils/supabase');
const { authMiddleware } = require('../middleware/auth');

// ─── POST /auth/register ────────────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, phone, role } = req.body;

    if (!['family', 'companion'].includes(role)) {
      return res
        .status(400)
        .json({ error: 'Role deve ser family ou companion.' });
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, phone, role } },
    });

    if (error) return res.status(400).json({ error: error.message });

    const userId = data.user.id;

    if (role === 'family') {
      await supabaseAdmin.from('family_profiles').insert({ user_id: userId });
    } else {
      await supabaseAdmin
        .from('companion_profiles')
        .insert({ user_id: userId });
    }

    res.status(201).json({
      message: 'Conta criada com sucesso. Verifique seu e-mail.',
      user: { id: userId, email, role },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/login ────────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error)
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });

    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.name,
        role: data.user.user_metadata?.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/google ───────────────────────────────────────────────────────
// Recebe o authorization code do expo-auth-session (PKCE flow),
// troca pelo id_token no Google e autentica via Supabase.
// ─── POST /auth/google ──────────────────────────────────────
router.post('/google', async (req, res, next) => {
  try {
    const { code, codeVerifier, redirectUri } = req.body;
    if (!code || !redirectUri)
      return res
        .status(400)
        .json({ error: 'Parâmetros obrigatórios: code e redirectUri.' });

    const params = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    if (codeVerifier) params.set('code_verifier', codeVerifier);

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.id_token)
      return res.status(401).json({ error: 'Falha ao autenticar com Google.' });

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: tokenData.id_token,
    });
    if (error) return res.status(401).json({ error: error.message });

    const { user, session } = data;
    const [{ data: fp }, { data: cp }] = await Promise.all([
      supabaseAdmin
        .from('family_profiles')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabaseAdmin
        .from('companion_profiles')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    res.json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      user: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.user_metadata?.name || null,
        role: fp ? 'family' : cp ? 'companion' : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/role ────────────────────────────────────────
router.post('/role', authMiddleware, async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!['family', 'companion'].includes(role))
      return res
        .status(400)
        .json({ error: 'Role deve ser family ou companion.' });

    const table = role === 'family' ? 'family_profiles' : 'companion_profiles';
    await supabaseAdmin.from(table).insert({ user_id: req.user.id });
    res.json({ role });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/refresh ──────────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token,
    });

    if (error)
      return res.status(401).json({ error: 'Refresh token inválido.' });

    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/otp/send ─────────────────────────────────────────────────────
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

// ─── POST /auth/otp/verify ───────────────────────────────────────────────────
router.post('/otp/verify', async (req, res, next) => {
  try {
    const { phone, token } = req.body;

    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    });

    if (error)
      return res.status(400).json({ error: 'Código inválido ou expirado.' });

    res.json({
      message: 'Telefone verificado com sucesso.',
      access_token: data.session?.access_token,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
