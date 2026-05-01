const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { supabase, supabaseAdmin } = require('../utils/supabase');

// ─── POST /auth/register ────────────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, phone, role } = req.body;

    if (!['family', 'companion'].includes(role)) {
      return res.status(400).json({ error: 'Role deve ser family ou companion.' });
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, phone, role } }
    });

    if (error) return res.status(400).json({ error: error.message });

    const userId = data.user.id;

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

// ─── POST /auth/login ────────────────────────────────────────────────────────
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

// ─── POST /auth/google ───────────────────────────────────────────────────────
// Recebe o authorization code do expo-auth-session (PKCE flow),
// troca pelo id_token no Google e autentica via Supabase.
router.post('/google', async (req, res, next) => {
  try {
    const { code, codeVerifier, redirectUri } = req.body;

    if (!code || !redirectUri) {
      return res.status(400).json({ error: 'code e redirectUri são obrigatórios.' });
    }

    // Troca o authorization code pelo id_token no Google
    const tokenResponse = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
        ...(codeVerifier && { code_verifier: codeVerifier }),
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const id_token = tokenResponse.data?.id_token;

    if (!id_token) {
      return res.status(502).json({ error: 'Falha ao obter id_token do Google.' });
    }

    // Autentica no Supabase com o id_token do Google
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: id_token,
    });

    if (error) return res.status(401).json({ error: error.message });

    const user = data.user;

    // Detecta primeiro acesso verificando se já existe perfil
    const [{ data: familyProfile }, { data: companionProfile }] = await Promise.all([
      supabaseAdmin.from('family_profiles').select('user_id').eq('user_id', user.id).maybeSingle(),
      supabaseAdmin.from('companion_profiles').select('user_id').eq('user_id', user.id).maybeSingle(),
    ]);

    const isNewUser = !familyProfile && !companionProfile;

    res.json({
      access_token:  data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in:    data.session.expires_in,
      is_new_user:   isNewUser,
      user: {
        id:         user.id,
        email:      user.email,
        name:       user.user_metadata?.full_name || user.user_metadata?.name || null,
        role:       user.user_metadata?.role || null,
        avatar_url: user.user_metadata?.avatar_url || null,
      },
    });
  } catch (err) {
    if (err.response?.data) {
      return res.status(502).json({
        error: 'Erro na troca de token com o Google.',
        detail: err.response.data.error_description || err.response.data.error,
      });
    }
    next(err);
  }
});

// ─── POST /auth/role ─────────────────────────────────────────────────────────
// Define o role do usuário após primeiro login social (chamado pela role-select screen)
router.post('/role', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autenticação ausente.' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await supabase.auth.getUser(token);

    if (userError || !userData?.user) {
      return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }

    const { role } = req.body;
    if (!['family', 'companion'].includes(role)) {
      return res.status(400).json({ error: 'Role deve ser family ou companion.' });
    }

    const user = userData.user;

    // Verifica se já tem perfil (evita duplicata)
    const [{ data: familyProfile }, { data: companionProfile }] = await Promise.all([
      supabaseAdmin.from('family_profiles').select('user_id').eq('user_id', user.id).maybeSingle(),
      supabaseAdmin.from('companion_profiles').select('user_id').eq('user_id', user.id).maybeSingle(),
    ]);

    if (familyProfile || companionProfile) {
      return res.status(409).json({ error: 'Perfil já configurado.' });
    }

    const name = user.user_metadata?.full_name || user.user_metadata?.name || null;

    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...user.user_metadata, role, name },
    });

    if (role === 'family') {
      await supabaseAdmin.from('family_profiles').insert({ user_id: user.id });
    } else {
      await supabaseAdmin.from('companion_profiles').insert({ user_id: user.id });
    }

    res.json({ role });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/refresh ──────────────────────────────────────────────────────
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
