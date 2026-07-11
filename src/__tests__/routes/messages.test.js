jest.mock('#utils/supabase', () => ({
  supabase: { from: jest.fn() },
  supabaseAdmin: { from: jest.fn() },
}));

jest.mock('#middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

const request = require('supertest');
const express = require('express');
const { supabase, supabaseAdmin } = require('#utils/supabase');
const messagesRoutes = require('#routes/messages');

const app = express();
app.use(express.json());
app.use('/messages', messagesRoutes);

// Mock do lookup de participantes (service_requests) usado por isParticipant.
function mockParticipants({ familyUser = null, companionUser = null, found = true } = {}) {
  supabaseAdmin.from.mockImplementation((table) => {
    if (table === 'service_requests') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: found
            ? { family_profiles: { user_id: familyUser }, companion_profiles: { user_id: companionUser } }
            : null,
          error: null,
        }),
      };
    }
    // insert em messages
    return {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: 'msg-1', sender_id: 'user-123', content: 'oi' },
        error: null,
      }),
    };
  });
}

describe('POST /messages — validação', () => {
  it('returns 400 when content is empty', async () => {
    const res = await request(app).post('/messages').send({ request_id: 'r1', content: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Mensagem não pode estar vazia.');
  });
});

describe('POST /messages — autorização', () => {
  it('returns 403 when the sender is not a participant', async () => {
    mockParticipants({ familyUser: 'other', companionUser: 'another' });
    const res = await request(app).post('/messages').send({ request_id: 'r1', content: 'oi' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Acesso negado a esta conversa.');
  });

  it('creates the message when the sender is a participant', async () => {
    mockParticipants({ familyUser: 'user-123' });
    const res = await request(app).post('/messages').send({ request_id: 'r1', content: 'oi' });
    expect(res.status).toBe(201);
    expect(res.body.message).toMatchObject({ id: 'msg-1' });
  });
});

describe('GET /messages/:request_id — autorização', () => {
  it('returns 403 when the reader is not a participant', async () => {
    mockParticipants({ familyUser: 'other' });
    const res = await request(app).get('/messages/r1');
    expect(res.status).toBe(403);
  });

  it('returns the messages when the reader is a participant', async () => {
    mockParticipants({ companionUser: 'user-123' });
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [{ id: 'm1', content: 'oi' }], error: null }),
    });
    const res = await request(app).get('/messages/r1');
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
  });
});
