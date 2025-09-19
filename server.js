
require('dotenv').config();
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const client = require('prom-client');
const { WebSocketServer, WebSocket } = require('ws');

const envSchema = Joi.object({
  PORT: Joi.number().integer().min(1).max(65535).default(3000),
  WS_PATH: Joi.string().pattern(/^\//).default('/ws'),
  CORS_ORIGIN: Joi.string().default('*'),
  THRESHOLD_TOP_MS: Joi.number().min(0).default(1000),
  THRESHOLD_BASE_MS: Joi.number().min(0).default(1000),
}).unknown(true);
const { value: ENV, error: envError } = envSchema.validate(process.env);
if (envError) { console.error('Invalid .env:', envError.message); process.exit(1); }

const { PORT, WS_PATH, CORS_ORIGIN } = ENV;
const THRESHOLD_TOP_MS = Number(ENV.THRESHOLD_TOP_MS);
const THRESHOLD_BASE_MS = Number(ENV.THRESHOLD_BASE_MS);

let ideal = {};
try { ideal = JSON.parse(fs.readFileSync('./ideal.json','utf8')); } catch {}

function pickIdeal(topic, event) {
  const byTopic = ideal[topic] || {};
  return byTopic[event] || null;
}

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
const deviationMs = new client.Gauge({ name:'dt_deviation_ms', help:'Desvio (ms) por evento e tópico', labelNames:['event','topic'] });
const outOfSpecTotal = new client.Counter({ name:'dt_out_of_spec_total', help:'Qtd fora de especificação', labelNames:['event','topic'] });
const lastVRms = new client.Gauge({ name:'dt_last_v_rms_g', help:'Último RMS de vibração (g)', labelNames:['event','topic'] });
const lastVPeak = new client.Gauge({ name:'dt_last_v_peak_g', help:'Último pico de vibração (g)', labelNames:['event','topic'] });

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors(CORS_ORIGIN==='*'?{origin:'*'}:{origin:CORS_ORIGIN.split(',').map(s=>s.trim())}));
app.use(express.json({ limit:'256kb' }));
morgan.token('rid', () => Math.random().toString(36).slice(2,8));
app.use(morgan(':method :url :status :res[content-length] - :response-time ms rid=:rid'));
app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));
app.use(express.static('public'));

const RING_MAX = 2000;
const ring = [];
let lastData = null;

const dataSchema = Joi.object({
  topic: Joi.string().required(),
  payload: Joi.object({
    event: Joi.string().valid('top','base').required(),
    t_ms: Joi.number().min(0).required(),
    v_rms_g: Joi.number().min(0).optional(),
    v_peak_g: Joi.number().min(0).optional()
  }).unknown(true).required()
});

function pushEvent(ev){ if(ring.length>=RING_MAX) ring.shift(); ring.push(ev); }

function ingest(value){
  lastData = value; pushEvent(value);
  try{
    const evt = value?.payload?.event || 'unknown';
    const topic = value?.topic || 'unknown';
    const tms = Number(value?.payload?.t_ms);
    const vrms = Number(value?.payload?.v_rms_g);
    const vpk  = Number(value?.payload?.v_peak_g);

    eventsTotal.inc({event:String(evt), topic:String(topic)});
    lastEventTs.set(Math.floor(Date.now()/1000));
    if(!Number.isNaN(tms)){
      if(evt==='top') lastTopMs.set(tms);
      if(evt==='base') lastBaseMs.set(tms);
    }
    if(!Number.isNaN(vrms)) lastVRms.set({event:String(evt), topic:String(topic)}, vrms);
    if(!Number.isNaN(vpk))  lastVPeak.set({event:String(evt), topic:String(topic)}, vpk);

    const spec = pickIdeal(topic, evt);
    if(spec && Number.isFinite(tms)){
      const dev = tms - Number(spec.t_ms);
      const inSpec = Math.abs(dev) <= Number(spec.tolerance_ms);
      deviationMs.set({event:String(evt), topic:String(topic)}, dev);
      if(!inSpec) outOfSpecTotal.inc({event:String(evt), topic:String(topic)});
      value.analysis = { ideal_ms:Number(spec.t_ms), tolerance_ms:Number(spec.tolerance_ms), deviation_ms:dev, in_spec:inSpec };
    }
  }catch(e){}
  broadcast(value);
}

app.get('/health', (_req,res)=>res.send('ok'));
app.get('/metrics', async (_req,res)=>{ res.set('Content-Type', client.register.contentType); res.send(await client.register.metrics()); });
app.post('/data', (req,res)=>{
  const { error, value } = dataSchema.validate(req.body);
  if(error) return res.status(400).json({ error: error.message });
  ingest(value); res.status(204).end();
});
app.get('/data/last', (_req,res)=>res.json(lastData||{}));
app.get('/data/events', (req,res)=>{ const limit = Math.max(1, Math.min(2000, Number(req.query.limit)||200)); res.json(ring.slice(-limit)); });
app.get('/ideal', (_req,res)=>res.json(ideal));
app.put('/ideal', (req,res)=>{ ideal = req.body || {}; fs.writeFileSync('./ideal.json', JSON.stringify(ideal,null,2)); res.status(204).end(); });

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: WS_PATH });
function broadcast(obj){ const msg = JSON.stringify(obj); for(const ws of wss.clients){ if(ws.readyState===WebSocket.OPEN) ws.send(msg); }}

wss.on('connection',(ws)=>{
  wsConnections.inc(); ws.isAlive=true;
  ws.on('pong',()=>ws.isAlive=true);
  ws.on('close',()=>wsConnections.dec());
  if(lastData) ws.send(JSON.stringify(lastData));
  ws.on('message',(buf)=>{
    try{
      const parsed = JSON.parse(buf.toString('utf8'));
      const { error, value } = dataSchema.validate(parsed);
      if(error){ ws.send(JSON.stringify({type:'error', message:error.message})); return; }
      ingest(value);
    }catch(e){ ws.send(JSON.stringify({type:'error', message:e?.message || 'invalid_message'})); }
  });
});

const hb=setInterval(()=>{ for(const ws of wss.clients){ if(!ws.isAlive){ ws.terminate(); continue;} ws.isAlive=false; ws.ping(); } }, 30000);
server.listen(PORT, ()=>console.log(`🚀 HTTP+WS on :${PORT} (ws ${WS_PATH})`));
function shutdown(sig){ console.log(`\\n${sig} received, shutting down...`); clearInterval(hb); try{ wss.close(); }catch{}; server.close(()=>process.exit(0)); setTimeout(()=>process.exit(0), 5000).unref(); }
process.on('SIGINT', ()=>shutdown('SIGINT')); process.on('SIGTERM', ()=>shutdown('SIGTERM'));
