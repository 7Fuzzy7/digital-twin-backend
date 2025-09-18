import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import dataRouter from './routes/data';

const app = express();

app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '256kb' }));
app.use(morgan('dev'));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

app.use('/data', dataRouter);

app.get('/health', (_req, res) => res.send('ok'));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

export default app;
