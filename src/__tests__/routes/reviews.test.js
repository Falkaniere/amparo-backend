jest.mock('#utils/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock('#middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { id: 'user-123' };
    req.supabase = require('#utils/supabase').supabase;
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

const request = require('supertest');
const express = require('express');
const { supabase, supabaseAdmin } = require('#utils/supabase');
const reviewsRoutes = require('#routes/reviews');

const app = express();
app.use(express.json());
app.use('/reviews', reviewsRoutes);

// authMiddleware mock injeta req.user = { id: 'user-123' }, então o autor
// precisa aparecer como participante do serviço para passar na verificação.
function makeSelectChain(statusValue, reviewerId = 'user-123') {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: {
        status: statusValue,
        family_profiles: { user_id: reviewerId },
        companion_profiles: { user_id: 'companion-user' },
      },
      error: null,
    }),
  };
}

describe('POST /reviews — score validation', () => {
  it('returns 400 when score is 0', async () => {
    const res = await request(app).post('/reviews').send({
      request_id: 'r1', reviewee_id: 'u2', score: 0,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Score deve ser entre 1 e 5.');
  });

  it('returns 400 when score is 6', async () => {
    const res = await request(app).post('/reviews').send({
      request_id: 'r1', reviewee_id: 'u2', score: 6,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Score deve ser entre 1 e 5.');
  });

  it('accepts score of 1 (minimum)', async () => {
    supabase.from.mockReturnValue(makeSelectChain('completed'));
    supabaseAdmin.from.mockReturnValue({
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'rev-1', score: 1 }, error: null }),
    });
    const res = await request(app).post('/reviews').send({
      request_id: 'r1', reviewee_id: 'u2', score: 1,
    });
    expect(res.status).toBe(201);
  });

  it('accepts score of 5 (maximum)', async () => {
    supabase.from.mockReturnValue(makeSelectChain('completed'));
    supabaseAdmin.from.mockReturnValue({
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'rev-2', score: 5 }, error: null }),
    });
    const res = await request(app).post('/reviews').send({
      request_id: 'r1', reviewee_id: 'u2', score: 5,
    });
    expect(res.status).toBe(201);
  });
});

describe('POST /reviews — service status validation', () => {
  it('returns 400 when service is not completed', async () => {
    supabase.from.mockReturnValue(makeSelectChain('pending'));
    const res = await request(app).post('/reviews').send({
      request_id: 'r1', reviewee_id: 'u2', score: 5,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Só é possível avaliar serviços concluídos.');
  });

  it('returns 400 when service is in_progress', async () => {
    supabase.from.mockReturnValue(makeSelectChain('in_progress'));
    const res = await request(app).post('/reviews').send({
      request_id: 'r1', reviewee_id: 'u2', score: 4,
    });
    expect(res.status).toBe(400);
  });

  it('returns 201 when review is created for a completed service', async () => {
    const mockReview = { id: 'rev-3', score: 5, request_id: 'r1', reviewer_id: 'user-123' };
    supabase.from.mockReturnValue(makeSelectChain('completed'));
    supabaseAdmin.from.mockReturnValue({
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: mockReview, error: null }),
    });
    const res = await request(app).post('/reviews').send({
      request_id: 'r1', reviewee_id: 'u2', score: 5, comment: 'Excellent!',
    });
    expect(res.status).toBe(201);
    expect(res.body.review).toMatchObject({ id: 'rev-3', score: 5 });
  });
});

describe('POST /reviews — authorization', () => {
  it('returns 403 when the author did not take part in the service', async () => {
    // Nenhum dos participantes é 'user-123' (autor autenticado no mock).
    supabase.from.mockReturnValue(makeSelectChain('completed', 'someone-else'));
    const insert = jest.fn().mockReturnThis();
    supabaseAdmin.from.mockReturnValue({
      insert,
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'rev-x' }, error: null }),
    });
    const res = await request(app).post('/reviews').send({
      request_id: 'r1', reviewee_id: 'u2', score: 5,
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Você não participou deste serviço.');
    // Garante que a review NÃO foi inserida (evita falso positivo).
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns 400 when score is missing entirely', async () => {
    const res = await request(app).post('/reviews').send({
      request_id: 'r1', reviewee_id: 'u2',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Score deve ser entre 1 e 5.');
  });
});
