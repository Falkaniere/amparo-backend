jest.mock('#utils/supabase', () => ({
  supabase: {
    auth: {
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signInWithIdToken: jest.fn(),
      refreshSession: jest.fn(),
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
      getUser: jest.fn(),
    },
  },
  supabaseAdmin: {
    from: jest.fn(() => ({
      insert: jest.fn().mockResolvedValue({ error: null }),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

const request = require('supertest');
const express = require('express');
const { supabase } = require('#utils/supabase');
const authRoutes = require('#routes/auth');

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);

describe('POST /auth/register', () => {
  it('returns 400 when role is invalid', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'Test', email: 'test@test.com', password: '123456', phone: '11999999999', role: 'admin',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Role deve ser family ou companion.');
  });

  it('returns 400 when supabase signUp fails', async () => {
    supabase.auth.signUp.mockResolvedValue({ data: null, error: { message: 'Email already in use' } });
    const res = await request(app).post('/auth/register').send({
      name: 'Test', email: 'test@test.com', password: '123456', phone: '11999999999', role: 'family',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Email already in use');
  });

  it('returns 201 on successful family registration', async () => {
    supabase.auth.signUp.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });
    const res = await request(app).post('/auth/register').send({
      name: 'Alice', email: 'alice@test.com', password: '123456', phone: '11999999999', role: 'family',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ id: 'user-123', email: 'alice@test.com', role: 'family' });
    expect(res.body.message).toContain('Conta criada');
  });

  it('returns 400 when companion registers without a valid CPF', async () => {
    supabase.auth.signUp.mockResolvedValue({
      data: { user: { id: 'user-456' } },
      error: null,
    });
    const res = await request(app).post('/auth/register').send({
      name: 'Bob', email: 'bob@test.com', password: '123456', phone: '11999999999', role: 'companion',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CPF inválido.');
  });

  it('returns 201 on successful companion registration', async () => {
    supabase.auth.signUp.mockResolvedValue({
      data: { user: { id: 'user-456' } },
      error: null,
    });
    const res = await request(app).post('/auth/register').send({
      name: 'Bob', email: 'bob@test.com', password: '123456', phone: '11999999999', role: 'companion',
      cpf: '12345678901',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ id: 'user-456', role: 'companion' });
  });
});

describe('POST /auth/login', () => {
  it('returns 401 when credentials are wrong', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: 'Invalid credentials' },
    });
    const res = await request(app).post('/auth/login').send({ email: 'bad@test.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('E-mail ou senha incorretos.');
  });

  it('returns tokens and user info on successful login', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: {
        session: { access_token: 'acc', refresh_token: 'ref', expires_in: 3600 },
        user: { id: 'u1', email: 'test@test.com', user_metadata: { name: 'Test', role: 'family' } },
      },
      error: null,
    });
    const res = await request(app).post('/auth/login').send({ email: 'test@test.com', password: 'correct' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      access_token: 'acc',
      user: { email: 'test@test.com', role: 'family' },
    });
  });
});

describe('POST /auth/google', () => {
  it('returns 400 when idToken is missing', async () => {
    const res = await request(app).post('/auth/google').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Parâmetro obrigatório: idToken.');
  });

  it('returns 401 when Supabase rejects the idToken', async () => {
    supabase.auth.signInWithIdToken.mockResolvedValue({
      data: null,
      error: { message: 'Token inválido.' },
    });
    const res = await request(app).post('/auth/google').send({ idToken: 'bad-token' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Token inválido.');
  });

  it('returns session and user with null role for new users', async () => {
    supabase.auth.signInWithIdToken.mockResolvedValue({
      data: {
        session: { access_token: 'g-acc', refresh_token: 'g-ref', expires_in: 3600 },
        user: { id: 'g-user-1', email: 'google@test.com', user_metadata: { full_name: 'Google User' } },
      },
      error: null,
    });
    const res = await request(app).post('/auth/google').send({ idToken: 'valid-id-token' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      access_token: 'g-acc',
      user: { id: 'g-user-1', email: 'google@test.com', name: 'Google User', role: null },
    });
  });
});

describe('POST /auth/refresh', () => {
  it('returns 401 when refresh token is invalid', async () => {
    supabase.auth.refreshSession.mockResolvedValue({ data: null, error: { message: 'invalid' } });
    const res = await request(app).post('/auth/refresh').send({ refresh_token: 'bad' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Refresh token inválido.');
  });

  it('returns new tokens on success', async () => {
    supabase.auth.refreshSession.mockResolvedValue({
      data: { session: { access_token: 'new-acc', refresh_token: 'new-ref', expires_in: 3600 } },
      error: null,
    });
    const res = await request(app).post('/auth/refresh').send({ refresh_token: 'valid-refresh' });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBe('new-acc');
    expect(res.body.refresh_token).toBe('new-ref');
  });
});

describe('POST /auth/otp/send', () => {
  it('returns 400 when OTP send fails', async () => {
    supabase.auth.signInWithOtp.mockResolvedValue({ error: { message: 'SMS error' } });
    const res = await request(app).post('/auth/otp/send').send({ phone: '+5511999999999' });
    expect(res.status).toBe(400);
  });

  it('returns 200 with message on success', async () => {
    supabase.auth.signInWithOtp.mockResolvedValue({ error: null });
    const res = await request(app).post('/auth/otp/send').send({ phone: '+5511999999999' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Código enviado por SMS.');
  });
});
