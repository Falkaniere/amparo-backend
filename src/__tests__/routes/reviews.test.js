jest.mock('../../utils/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

const request = require('supertest');
const express = require('express');
const { supabase, supabaseAdmin } = require('../../utils/supabase');
const reviewsRoutes = require('../../routes/reviews');

const app = express();
app.use(express.json());
app.use('/reviews', reviewsRoutes);

function makeSelectChain(statusValue) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: { status: statusValue }, error: null }),
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
