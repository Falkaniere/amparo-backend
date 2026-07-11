jest.mock('#utils/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
  },
  getUserClient: jest.fn(() => ({ from: jest.fn() })),
}));

const { supabase, getUserClient } = require('#utils/supabase');
const { authMiddleware, requireRole } = require('#middleware/auth');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('authMiddleware', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const req = { headers: {} };
    const res = makeRes();
    await authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token de autenticação ausente.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when header does not start with Bearer', async () => {
    const req = { headers: { authorization: 'Basic token' } };
    const res = makeRes();
    await authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when supabase returns an error', async () => {
    supabase.auth.getUser.mockResolvedValue({ data: null, error: { message: 'invalid' } });
    const req = { headers: { authorization: 'Bearer invalid-token' } };
    const res = makeRes();
    await authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token inválido ou expirado.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.user and calls next() for a valid token', async () => {
    const mockUser = { id: 'user-123', email: 'test@test.com', user_metadata: { role: 'family' } };
    supabase.auth.getUser.mockResolvedValue({ data: { user: mockUser }, error: null });
    const req = { headers: { authorization: 'Bearer valid-token' } };
    const res = makeRes();
    await authMiddleware(req, res, next);
    expect(req.user).toEqual(mockUser);
    expect(req.token).toBe('valid-token');
    // Cliente com o JWT do usuário é criado e injetado para respeitar o RLS.
    expect(getUserClient).toHaveBeenCalledWith('valid-token');
    expect(req.supabase).toBeDefined();
    expect(next).toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
  });

  it('calls next() when user role matches', () => {
    const req = { user: { user_metadata: { role: 'family' } } };
    requireRole('family')(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when user role does not match', () => {
    const req = { user: { user_metadata: { role: 'family' } } };
    const res = makeRes();
    requireRole('companion')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts multiple allowed roles', () => {
    const req = { user: { user_metadata: { role: 'companion' } } };
    requireRole('family', 'companion')(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when no role in metadata', () => {
    const req = { user: { user_metadata: {} } };
    const res = makeRes();
    requireRole('family')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
