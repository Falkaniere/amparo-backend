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
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('#services/notifications', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const express = require('express');
const { supabase, supabaseAdmin } = require('#utils/supabase');
const requestsRoutes = require('#routes/requests');

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

// Estes testes exercitam o handler REAL de POST /requests (não recalculam a
// aritmética por fora), capturando o payload realmente enviado ao insert.
// Assim, se a lógica financeira da rota quebrar, o teste falha de verdade.
describe('POST /requests — cálculo financeiro (handler real)', () => {
  function setupMocks({ hourlyRate = 100, verified = true } = {}) {
    let insertedPayload = null;
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'family_profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { id: 'fam-1' }, error: null }),
        };
      }
      if (table === 'companion_profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { id: 'comp-1', hourly_rate: hourlyRate, verified, is_online: true, push_token: null },
            error: null,
          }),
        };
      }
      // service_requests insert
      return {
        insert: jest.fn().mockImplementation((payload) => {
          insertedPayload = payload;
          return {
            select: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: { id: 'req-1', ...payload }, error: null }),
          };
        }),
      };
    });
    return () => insertedPayload;
  }

  const baseBody = {
    type: 'medical', scheduled_at: '2099-01-15T09:00:00Z', duration_hours: 2,
    origin_address: 'Rua X, 123', companion_id: 'comp-1',
  };

  it('computes a 10% fee for an integer hourly rate', async () => {
    const getPayload = setupMocks({ hourlyRate: 100 });
    const res = await request(app).post('/requests').send(baseBody);
    expect(res.status).toBe(201);
    const payload = getPayload();
    expect(payload.service_amount).toBe(200);
    expect(payload.platform_fee).toBe(20);
    expect(payload.total_amount).toBe(220);
    expect(payload.companion_amount).toBe(180);
  });

  it('computes a 10% fee for a decimal hourly rate', async () => {
    const getPayload = setupMocks({ hourlyRate: 75.5 });
    const res = await request(app).post('/requests').send({ ...baseBody, duration_hours: 3 });
    expect(res.status).toBe(201);
    const payload = getPayload();
    expect(payload.service_amount).toBe(226.5);
    expect(payload.platform_fee).toBe(22.65);
    expect(payload.total_amount).toBe(249.15);
  });

  it('rejects an invalid service type', async () => {
    setupMocks();
    const res = await request(app).post('/requests').send({ ...baseBody, type: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Tipo de serviço inválido.');
  });

  it('rejects a non-positive duration (evita valores financeiros NaN)', async () => {
    setupMocks();
    const res = await request(app).post('/requests').send({ ...baseBody, duration_hours: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Duração (em horas) inválida.');
  });

  it('rejects an unverified companion', async () => {
    setupMocks({ verified: false });
    const res = await request(app).post('/requests').send(baseBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Acompanhante não verificado.');
  });
});
