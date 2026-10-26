require('dotenv').config();
const express = require('express');
const path = require('path');
const { seed } = require('./seed');
const { errorHandler } = require('./errors');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, ai_configured: Boolean(process.env.ANTHROPIC_API_KEY) }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/books', require('./routes/books'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/events', require('./routes/events'));
app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.originalUrl}` } }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(errorHandler);

if (require.main === module) {
  if (seed()) console.log('Database seeded from data/bookleaf_sample_data.json');
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`BookLeaf portal on http://localhost:${port} (AI ${process.env.ANTHROPIC_API_KEY ? 'enabled' : 'DISABLED: fallbacks only'})`));
}
module.exports = app;
