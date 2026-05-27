jest.mock('../../utils/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
    rpc: jest.fn(),
  },
  supabaseAdmin: {},
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
const { supabase } = require('../../utils/supabase');
const companionsRoutes = require('../../routes/companions');

const app = express();
app.use(express.json());
app.use('/companions', companionsRoutes);

describe('GET /companions/available', () => {
  it('returns 400 when all required params are missing', async () => {
    const res = await request(app).get('/companions/available');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/obrigatórios/);
  });

  it('returns 400 when only lat/lng are provided', async () => {
    const res = await request(app)
      .get('/companions/available')
      .query({ lat: '-23.5', lng: '-46.6' });
    expect(res.status).toBe(400);
  });

  it('returns companion list on success', async () => {
    supabase.rpc.mockResolvedValue({ data: [{ id: 'c1', name: 'João' }], error: null });
    const res = await request(app)
      .get('/companions/available')
      .query({ lat: '-23.5', lng: '-46.6', date: '2024-01-15', start_time: '09:00', duration_hours: '2' });
    expect(res.status).toBe(200);
    expect(res.body.companions).toHaveLength(1);
  });

  it('returns empty array when no companions found', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });
    const res = await request(app)
      .get('/companions/available')
      .query({ lat: '-23.5', lng: '-46.6', date: '2024-01-15', start_time: '09:00' });
    expect(res.status).toBe(200);
    expect(res.body.companions).toEqual([]);
  });
});

describe('GET /companions/:id', () => {
  it('returns 404 when companion not found', async () => {
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
    });
    const res = await request(app).get('/companions/non-existent-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Acompanhante não encontrado.');
  });

  it('returns companion data and reviews on success', async () => {
    const mockCompanion = {
      id: 'c1', user_id: 'u1',
      companion_skills: [], availability: [], documents: [],
    };
    supabase.from.mockImplementation((table) => {
      if (table === 'companion_profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: mockCompanion, error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [{ score: 5, comment: 'Ótimo!' }], error: null }),
      };
    });
    const res = await request(app).get('/companions/c1');
    expect(res.status).toBe(200);
    expect(res.body.companion).toMatchObject({ id: 'c1' });
    expect(res.body.reviews).toHaveLength(1);
  });
});
