const { supabase } = require('../utils/supabase');

// Valida o JWT do Supabase e injeta req.user
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação ausente.' });
  }

  const token = authHeader.replace('Bearer ', '');

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }

  req.user = data.user;
  req.token = token;
  next();
}

// Middleware para garantir que o usuário tem role específico
function requireRole(...roles) {
  return (req, res, next) => {
    const userRole = req.user?.user_metadata?.role;
    if (!roles.includes(userRole)) {
      return res.status(403).json({
        error: `Acesso restrito para: ${roles.join(', ')}.`
      });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
