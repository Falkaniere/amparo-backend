const request = require('supertest');
const express = require('express');

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'amparo-backend', version: '1.0.0' });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

describe('GET /health', () => {
  it('returns 200 with service info', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      service: 'amparo-backend',
      version: '1.0.0',
    });
  });
});

describe('404 handler', () => {
  it('returns 404 for unmatched routes', async () => {
    const res = await request(app).get('/unknown-xyz');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Rota não encontrada.');
  });
});
