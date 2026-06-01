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

jest.mock('../../services/notifications', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const express = require('express');
const { supabase, supabaseAdmin } = require('../../utils/supabase');
const requestsRoutes = require('../../routes/requests');

const app = express();
app.use(express.json());
app.use('/requests', requestsRoutes);

function mockFetchRequest(status) {
  supabase.from.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: {
        id: 'req-1',
        status,
        family_profiles: { user_id: 'family-user' },
        companion_profiles: { user_id: 'companion-user', push_token: null },
      },
      error: null,
    }),
  });
}

function mockAdminUpdate(newStatus) {
  supabaseAdmin.from.mockReturnValue({
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: { id: 'req-1', status: newStatus },
      error: null,
    }),
  });
}

describe('PATCH /requests/:id/status — invalid transitions', () => {
  it('rejects pending → completed', async () => {
    mockFetchRequest('pending');
    const res = await request(app).patch('/requests/req-1/status').send({ status: 'completed' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Transição inválida/);
  });

  it('rejects completed → cancelled', async () => {
    mockFetchRequest('completed');
    const res = await request(app).patch('/requests/req-1/status').send({ status: 'cancelled' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Transição inválida/);
  });

  it('rejects in_progress → pending', async () => {
    mockFetchRequest('in_progress');
    const res = await request(app).patch('/requests/req-1/status').send({ status: 'pending' });
    expect(res.status).toBe(400);
  });

  it('rejects cancelled → accepted', async () => {
    mockFetchRequest('cancelled');
    const res = await request(app).patch('/requests/req-1/status').send({ status: 'accepted' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /requests/:id/status — valid transitions', () => {
  it('allows pending → accepted', async () => {
    mockFetchRequest('pending');
    mockAdminUpdate('accepted');
    const res = await request(app).patch('/requests/req-1/status').send({ status: 'accepted' });
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('accepted');
  });

  it('allows pending → cancelled', async () => {
    mockFetchRequest('pending');
    mockAdminUpdate('cancelled');
    const res = await request(app)
      .patch('/requests/req-1/status')
      .send({ status: 'cancelled', cancel_reason: 'Changed plans' });
    expect(res.status).toBe(200);
  });

  it('allows accepted → checked_in', async () => {
    mockFetchRequest('accepted');
    mockAdminUpdate('checked_in');
    const res = await request(app).patch('/requests/req-1/status').send({ status: 'checked_in' });
    expect(res.status).toBe(200);
  });

  it('allows checked_in → in_progress', async () => {
    mockFetchRequest('checked_in');
    mockAdminUpdate('in_progress');
    const res = await request(app).patch('/requests/req-1/status').send({ status: 'in_progress' });
    expect(res.status).toBe(200);
  });

  it('allows in_progress → completed', async () => {
    mockFetchRequest('in_progress');
    mockAdminUpdate('completed');
    const res = await request(app).patch('/requests/req-1/status').send({ status: 'completed' });
    expect(res.status).toBe(200);
  });
});

describe('PATCH /requests/:id/status — not found', () => {
  it('returns 404 when request does not exist', async () => {
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
    const res = await request(app).patch('/requests/non-existent/status').send({ status: 'accepted' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Solicitação não encontrada.');
  });
});

describe('Platform fee calculation', () => {
  it('computes 10% fee correctly for integer hourly rates', () => {
    const FEE = parseFloat(process.env.PLATFORM_FEE_PERCENT || '10') / 100;
    const serviceAmount = parseFloat((100 * 2).toFixed(2));
    const platformFee = parseFloat((serviceAmount * FEE).toFixed(2));
    const totalAmount = parseFloat((serviceAmount + platformFee).toFixed(2));
    const companionAmount = parseFloat((serviceAmount * (1 - FEE)).toFixed(2));
    expect(serviceAmount).toBe(200);
    expect(platformFee).toBe(20);
    expect(totalAmount).toBe(220);
    expect(companionAmount).toBe(180);
  });

  it('computes 10% fee correctly for decimal hourly rates', () => {
    const FEE = 0.10;
    const serviceAmount = parseFloat((75.5 * 3).toFixed(2));
    const platformFee = parseFloat((serviceAmount * FEE).toFixed(2));
    const totalAmount = parseFloat((serviceAmount + platformFee).toFixed(2));
    expect(serviceAmount).toBe(226.5);
    expect(platformFee).toBe(22.65);
    expect(totalAmount).toBe(249.15);
  });

  it('companion receives (1 - FEE) of service amount', () => {
    const FEE = 0.10;
    const serviceAmount = 100;
    const companionAmount = parseFloat((serviceAmount * (1 - FEE)).toFixed(2));
    expect(companionAmount).toBe(90);
  });
});
