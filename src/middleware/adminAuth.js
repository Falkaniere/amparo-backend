function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Acesso não autorizado.' });
  }
  next();
}

module.exports = adminAuth;
