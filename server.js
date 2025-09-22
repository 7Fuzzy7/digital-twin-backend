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

const ENV = {
  PORT: Number(process.env.PORT || 3000),
  WS_PATH: process.env.WS_PATH || '/ws',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
};

let ideal = {};
try { ideal = JSON.parse(fs.readFileSync('./ideal.json','utf8')); } catch {}

function pickIdeal(topic, event) {
  const byTopic = ideal[topic] || {};
  return byTopic[event] || null;
}

// Metrics
client.collectDefaultMetrics({ prefix: 'dt_', timeout: 5000 });
const eventsTotal = new client.Counter({ name:'dt_events_total', help:'Total de eventos', labelNames:['event','topic'] });
const wsConnections = new client.Gauge({ name:'dt_ws_connections', help:'WS ativos' });
const lastEventTs  = new client.Gauge({ name:'dt_last_event_timestamp_seconds', help:'Unix ts do último evento' });
const lastTopMs    = new client.Gauge({ name:'dt_last_top_ms', help:'Último t_ms top' });
const lastBaseMs   = new client.Gauge({ name:'dt_last_base_ms', help:'Último t_ms base' });
const thresholdTop = new client.Gauge({ name:'dt_threshold_top_ms', help:'Alvo top (ms)' });
const thresholdBase= new client.Gauge({ name:'dt_threshold_base_ms', help:'Alvo base (ms)' });
const deviationMs  = new client.Gauge({ name:'dt_deviation_ms', help:'Desvio do ideal (ms)', labelNames:['event','topic'] });
const outOfSpec    = new client.Counter({ name:'dt_out_of_spec_total', help:'Fora da faixa', labelNames:['event','topic'] });
const lastVRms     = new client.Gauge({ name:'dt_last_v_rms_g', help:'RMS vib (g)', labelNames:['event','topic'] });
const lastVPeak    = new client.Gauge({ name:'dt_last_v_peak_g', help:'Pico vib (g)', labelNames:['event','topic'] });

if (ideal['press/cycle']?.top?.t_ms)   thresholdTop.set(ideal['press/cycle'].top.t_ms);
if (ideal['press/cycle']?.base?.t_ms)  thresholdBase.set(ideal['press/cycle'].base.t_ms);

// App
const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors(ENV.CORS_ORIGIN==='*'?{origin:'*'}:{origin:ENV.CORS_ORIGIN.split(',').map(s=>s.trim())}));
app.use(express.json({ limit:'256kb' }));
app.use(morgan('tiny'));
app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders:true, legacyHeaders:false }));
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
  const evt = value?.payload?.event || 'unknown';
  const topic = value?.topic || 'unknown';
  const tms = Number(value?.payload?.t_ms);
  const vr  = Number(value?.payload?.v_rms_g);
  const vp  = Number(value?.payload?.v_peak_g);

  eventsTotal.inc({event:String(evt), topic:String(topic)});
  lastEventTs.set(Math.floor(Date.now()/1000));
  if(!Number.isNaN(tms)){
    if(evt==='top') lastTopMs.set(tms);
    if(evt==='base') lastBaseMs.set(tms);
  }
  if(!Number.isNaN(vr)) lastVRms.set({event:String(evt), topic:String(topic)}, vr);
  if(!Number.isNaN(vp)) lastVPeak.set({event:String(evt), topic:String(topic)}, vp);

  const spec = pickIdeal(topic, evt);
  if(spec && Number.isFinite(tms)){
    const dev = tms - Number(spec.t_ms);
    const inSpec = Math.abs(dev) <= Number(spec.tolerance_ms);
    deviationMs.set({event:String(evt), topic:String(topic)}, dev);
    if(!inSpec) outOfSpec.inc({event:String(evt), topic:String(topic)});
    value.analysis = { ideal_ms:Number(spec.t_ms), tolerance_ms:Number(spec.tolerance_ms), deviation_ms:dev, in_spec:inSpec };
  }
  broadcast(value);
}

// routes
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
app.put('/ideal', (req,res)=>{ ideal = req.body || {}; fs.writeFileSync('./ideal.json', JSON.stringify(ideal,null,2)); 
  if (ideal['press/cycle']?.top?.t_ms)   thresholdTop.set(ideal['press/cycle'].top.t_ms);
  if (ideal['press/cycle']?.base?.t_ms)  thresholdBase.set(ideal['press/cycle'].base.t_ms);
  res.status(204).end(); });

// ws
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: ENV.WS_PATH });
function broadcast(obj){ const msg = JSON.stringify(obj); for(const ws of wss.clients){ if(ws.readyState===WebSocket.OPEN) ws.send(msg);}}
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
setInterval(()=>{ for(const ws of wss.clients){ if(!ws.isAlive){ ws.terminate(); continue; } ws.isAlive=false; ws.ping(); } }, 30000);

server.listen(ENV.PORT, ()=> console.log(`🚀 HTTP+WS on :${ENV.PORT} (ws ${ENV.WS_PATH})`));
