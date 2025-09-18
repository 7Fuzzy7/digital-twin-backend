import { Router } from 'express';
import { dataSchema } from '../schemas';
import { ingest, getLast } from '../server';
import { events } from '../store';

const router = Router();

// Produzir dados via HTTP
router.post('/', (req, res) => {
  const { error, value } = dataSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  ingest(value);
  res.status(204).end();
});

// Último estado
router.get('/last', (_req, res) => {
  res.json(getLast() ?? {});
});

// Histórico com limite
router.get('/events', (req, res) => {
  const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 200));
  res.json(events.tail(limit));
});

export default router;
