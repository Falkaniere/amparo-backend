const { verifyIdToken } = require('../utils/firebase');

// Lista de e-mails autorizados a acessar o painel admin.
// Apenas usuários do Firebase cujo e-mail esteja nesta lista têm acesso —
// isso evita que qualquer conta do projeto Firebase entre no painel.
function allowedAdminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedAdmin(email) {
  if (!email) return false;
  const list = allowedAdminEmails();
  if (list.length === 0) return false;
  return list.includes(email.toLowerCase());
}

// Autenticação do painel amparo-admin.
//
// Aceita dois métodos:
//  1. Firebase ID token via `Authorization: Bearer <token>` (login por e-mail/senha
//     criado direto no Firebase) — preferencial.
//  2. `x-admin-key` igual ao ADMIN_SECRET — fallback de compatibilidade.
async function adminAuth(req, res, next) {
  const unauthorized = () =>
    res.status(401).json({ error: 'Acesso não autorizado.' });

  // 1. Fallback por chave compartilhada (caminho síncrono)
  const adminKey = req.headers['x-admin-key'];
  if (adminKey && process.env.ADMIN_SECRET && adminKey === process.env.ADMIN_SECRET) {
    return next();
  }

  // 2. Firebase ID token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    try {
      const decoded = await verifyIdToken(token);
      if (decoded && isAllowedAdmin(decoded.email)) {
        req.adminUser = { uid: decoded.uid, email: decoded.email };
        return next();
      }
    } catch (_) {
      // token inválido/expirado — cai no 401 abaixo
    }
    return unauthorized();
  }

  return unauthorized();
}

module.exports = adminAuth;
module.exports.isAllowedAdmin = isAllowedAdmin;
