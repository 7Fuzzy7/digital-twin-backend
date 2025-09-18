import { Router } from 'express';
import { dataSchema } from '../schemas';
import { wsBroadcast } from '../server';

const router = Router();

router.post('/', (req, res) => {
  const { error, value } = dataSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  // Armazene/registre aqui se desejar (ex.: RingBuffer)
  wsBroadcast(value);
  res.status(204).end();
});

export default router;
