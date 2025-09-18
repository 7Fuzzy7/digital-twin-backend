require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const client = require('prom-client');
const { WebSocketServer, WebSocket } = require('ws');

// ---- Env validation ----
const envSchema = Joi.object({
  PORT: Joi.number().integer().min(1).max(65535).default(3000),
  WS_PATH: Joi.string().pattern(/^\//).default('/ws'),
  CORS_ORIGIN: Joi.string().default('*'),
  THRESHOLD_TOP_MS: Joi.number().min(0).default(1000),
  THRESHOLD_BASE_MS: Joi.number().min(0).default(1000),
}).unknown(true);
const { value: ENV, error: envError } = envSchema.validate(process.env);
if (envError) {
  console.error('Invalid .env:', envError.message);
  process.exit(1);
}

const PORT = ENV.PORT;
const WS_PATH = ENV.WS_PATH;
const CORS_ORIGIN = ENV.CORS_ORIGIN;
const THRESHOLD_TOP_MS = Number(ENV.THRESHOLD_TOP_MS);
const THRESHOLD_BASE_MS = Number(ENV.THRESHOLD_BASE_MS);

// ---- Prometheus metrics ----
client.collectDefaultMetrics({ prefix: 'dt_', timeout: 5000 });
const eventsTotal = new client.Counter({ name:'dt_events_total', help:'Total ingested events', labelNames:['event','topic'] });
const wsConnections = new client.Gauge({ name:'dt_ws_connections', help:'Active WS connections' });
const lastEventTs = new client.Gauge({ name:'dt_last_event_timestamp_seconds', help:'Unix ts of last event' });
const lastTopMs = new client.Gauge({ name:'dt_last_top_ms', help:'Latest t_ms observed for event=top' });
const lastBaseMs = new client.Gauge({ name:'dt_last_base_ms', help:'Latest t_ms observed for event=base' });
const thresholdTopMs = new client.Gauge({ name:'dt_threshold_top_ms', help:'Configured threshold (ms) for top' });
const thresholdBaseMs = new client.Gauge({ name:'dt_threshold_base_ms', help:'Configured threshold (ms) for base' });
thresholdTopMs.set(THRESHOLD_TOP_MS);
thresholdBaseMs.set(THRESHOLD_BASE_MS);

// ---- App ----
const app = express();
app.disable('x-powered-by');
app.use(helmet());
const corsOpt = CORS_ORIGIN === '*' ? { origin: '*' } : { origin: CORS_ORIGIN.split(',').map(s => s.trim()) };
app.use(cors(corsOpt));
app.use(express.json({ limit: '256kb' }));
morgan.token('rid', () => Math.random().toString(36).slice(2,8));
app.use(morgan(':method :url :status :res[content-length] - :response-time ms rid=:rid'));
app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));
app.use(express.static('public'));

// ---- Data buffer/state ----
const RING_MAX = 2000;
const ring = [];
let lastData = null;

const dataSchema = Joi.object({
  topic: Joi.string().required(),
  payload: Joi.object({
    event: Joi.string().valid('top','base').optional(),
    t_ms: Joi.number().min(0).optional()
  }).required()
});

function pushEvent(ev) {
  if (ring.length >= RING_MAX) ring.shift();
  ring.push(ev);
}

function ingest(value) {
  lastData = value;
  pushEvent(value);
  try {
    const evt = (value && value.payload && value.payload.event) || 'unknown';
    const topic = (value && value.topic) || 'unknown';
    eventsTotal.inc({ event: String(evt), topic: String(topic) });
    lastEventTs.set(Math.floor(Date.now()/1000));
    const tms = Number(value && value.payload && value.payload.t_ms);
    if (!Number.isNaN(tms)) {
      if (evt === 'top') lastTopMs.set(tms);
      if (evt === 'base') lastBaseMs.set(tms);
    }
  } catch {}
  broadcast(value);
}

// ---- Routes ----
app.get('/health', (_req, res) => res.send('ok'));
app.get('/ready', (_req, res) => res.send('ok')); // readiness simples

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.send(await client.register.metrics());
});

app.post('/data', (req, res) => {
  const { error, value } = dataSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  ingest(value);
  res.status(204).end();
});

app.get('/data/last', (_req, res) => res.json(lastData || {}));

app.get('/data/events', (req, res) => {
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 200));
  res.json(ring.slice(-limit));
});

// ---- Server + WS ----
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: WS_PATH });

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

wss.on('connection', (ws) => {
  wsConnections.inc();
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('close', () => wsConnections.dec());

  if (lastData) ws.send(JSON.stringify(lastData));

  ws.on('message', (buf) => {
    try {
      const parsed = JSON.parse(buf.toString('utf8'));
      const { error, value } = dataSchema.validate(parsed);
      if (error) {
        ws.send(JSON.stringify({ type:'error', message: error.message }));
        return;
      }
      ingest(value);
    } catch (e) {
      ws.send(JSON.stringify({ type:'error', message: e?.message || 'invalid_message' }));
    }
  });
});

// WS heartbeat
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30_000);

server.listen(PORT, () => {
  console.log(`🚀 HTTP+WS on :${PORT} (ws path ${WS_PATH})`);
});

// ---- Graceful shutdown ----
function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  clearInterval(heartbeat);
  try { wss.close(); } catch {}
  server.close(err => {
    if (err) { console.error('HTTP close error:', err); process.exit(1); }
    setTimeout(() => process.exit(0), 200).unref();
  });
  // Force-exit safety after 5s
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
