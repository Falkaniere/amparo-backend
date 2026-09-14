jest.mock('../../utils/firebase', () => ({
  verifyIdToken: jest.fn(),
  isFirebaseConfigured: jest.fn(() => true),
}));

const { verifyIdToken } = require('../../utils/firebase');
const adminAuth = require('../../middleware/adminAuth');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('adminAuth middleware', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
    verifyIdToken.mockReset();
    process.env.ADMIN_EMAILS = 'admin@amparo.com';
  });

  describe('x-admin-key (fallback)', () => {
    it('returns 401 when no credentials are provided', async () => {
      const req = { headers: {} };
      const res = makeRes();
      await adminAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Acesso não autorizado.' });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when x-admin-key is wrong', async () => {
      const req = { headers: { 'x-admin-key': 'wrong-key' } };
      const res = makeRes();
      await adminAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() when x-admin-key matches ADMIN_SECRET', async () => {
      const req = { headers: { 'x-admin-key': process.env.ADMIN_SECRET } };
      const res = makeRes();
      await adminAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('Firebase ID token', () => {
    it('calls next() for a valid token of an allowed admin', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'abc', email: 'admin@amparo.com' });
      const req = { headers: { authorization: 'Bearer valid-token' } };
      const res = makeRes();
      await adminAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.adminUser).toEqual({ uid: 'abc', email: 'admin@amparo.com' });
      expect(res.status).not.toHaveBeenCalled();
    });

    it('is case-insensitive on the allowed email', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'abc', email: 'Admin@Amparo.com' });
      const req = { headers: { authorization: 'Bearer valid-token' } };
      const res = makeRes();
      await adminAuth(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('returns 401 for a valid token whose email is not allowed', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'xyz', email: 'someone@else.com' });
      const req = { headers: { authorization: 'Bearer valid-token' } };
      const res = makeRes();
      await adminAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when the token is invalid/expired', async () => {
      verifyIdToken.mockRejectedValue(new Error('token expired'));
      const req = { headers: { authorization: 'Bearer bad-token' } };
      const res = makeRes();
      await adminAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when no admin emails are configured', async () => {
      process.env.ADMIN_EMAILS = '';
      verifyIdToken.mockResolvedValue({ uid: 'abc', email: 'admin@amparo.com' });
      const req = { headers: { authorization: 'Bearer valid-token' } };
      const res = makeRes();
      await adminAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
