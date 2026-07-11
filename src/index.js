require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes         = require('#routes/auth');
const profileRoutes      = require('#routes/profiles');
const companionRoutes    = require('#routes/companions');
const requestRoutes      = require('#routes/requests');
const paymentRoutes      = require('#routes/payments');
const reviewRoutes       = require('#routes/reviews');
const messageRoutes      = require('#routes/messages');
const adminRoutes        = require('#routes/admin');
const adminAuth          = require('#middleware/adminAuth');

const app = express();

// ─── Segurança ──────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*' }));

// ─── Rate limiting ──────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  // Webhooks de pagamento não podem ser limitados: perderíamos confirmações.
  skip: (req) => req.path === '/payments/webhook',
  message: { error: 'Muitas requisições. Tente novamente em 1 minuto.' }
});
app.use(limiter);

// ─── Webhook do Pagar.me precisa de raw body ────────────
app.use('/payments/webhook', express.raw({ type: 'application/json' }));

// ─── Body parsing ───────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Health check ───────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'amparo-backend', version: '1.0.0' });
});

// ─── Rotas ──────────────────────────────────────────────
app.use('/auth',       authRoutes);
app.use('/profile',    profileRoutes);
app.use('/companions', companionRoutes);
app.use('/requests',   requestRoutes);
app.use('/payments',   paymentRoutes);
app.use('/reviews',    reviewRoutes);
app.use('/messages',   messageRoutes);
app.use('/admin',      adminAuth, adminRoutes);

// ─── 404 ────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// ─── Error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Erro interno do servidor.'
  });
});

// ─── Start ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌿 Amparo backend rodando na porta ${PORT} [${process.env.NODE_ENV}]`);
});

module.exports = app;
