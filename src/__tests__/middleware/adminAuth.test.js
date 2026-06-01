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
  });

  it('returns 401 when x-admin-key header is missing', () => {
    const req = { headers: {} };
    const res = makeRes();
    adminAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Acesso não autorizado.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when x-admin-key is wrong', () => {
    const req = { headers: { 'x-admin-key': 'wrong-key' } };
    const res = makeRes();
    adminAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when x-admin-key matches ADMIN_SECRET', () => {
    const req = { headers: { 'x-admin-key': process.env.ADMIN_SECRET } };
    const res = makeRes();
    adminAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
