require('dotenv').config();
const fs=require('fs'); const http=require('http'); const express=require('express'); const cors=require('cors'); const helmet=require('helmet');
const morgan=require('morgan'); const rateLimit=require('express-rate-limit'); const Joi=require('joi'); const client=require('prom-client'); const {WebSocketServer,WebSocket}=require('ws');
const ENV={PORT:process.env.PORT||3000,WS_PATH:process.env.WS_PATH||'/ws'}; let ideal={}; try{ideal=JSON.parse(fs.readFileSync('./ideal.json','utf8'));}catch{}
function pickIdeal(topic,event){const by=ideal[topic]||{};return by[event]||null;}
client.collectDefaultMetrics({prefix:'dt_',timeout:5000});
const eventsTotal=new client.Counter({name:'dt_events_total',help:'Total events',labelNames:['event','topic']});
const lastEventTs=new client.Gauge({name:'dt_last_event_timestamp_seconds',help:'last event ts'});
const lastTopMs=new client.Gauge({name:'dt_last_top_ms',help:'last top ms'});
const lastBaseMs=new client.Gauge({name:'dt_last_base_ms',help:'last base ms'});
const thresholdTopMs=new client.Gauge({name:'dt_threshold_top_ms',help:'ideal top ms'}); thresholdTopMs.set(880);
const thresholdBaseMs=new client.Gauge({name:'dt_threshold_base_ms',help:'ideal base ms'}); thresholdBaseMs.set(830);
const deviationMs=new client.Gauge({name:'dt_deviation_ms',help:'deviation',labelNames:['event','topic']});
const outOfSpecTotal=new client.Counter({name:'dt_out_of_spec_total',help:'out of spec',labelNames:['event','topic']});
const lastVRms=new client.Gauge({name:'dt_last_v_rms_g',help:'RMS vib',labelNames:['event','topic']});
const app=express(); app.use(helmet()); app.use(cors({origin:'*'})); app.use(express.json({limit:'256kb'})); app.use(morgan('tiny')); app.use(rateLimit({windowMs:60000,max:300})); app.use(express.static('public'));
const schema=Joi.object({topic:Joi.string().required(),payload:Joi.object({event:Joi.string().valid('top','base').required(),t_ms:Joi.number().min(0).required(),v_rms_g:Joi.number().min(0)}).unknown(true).required()});
let last=null; const ring=[]; function push(e){if(ring.length>2000)ring.shift(); ring.push(e);}
function ingest(v){ last=v; push(v); const evt=v?.payload?.event||'unknown'; const topic=v?.topic||'press/cycle'; const t=Number(v?.payload?.t_ms); const vr=Number(v?.payload?.v_rms_g);
  eventsTotal.inc({event:String(evt),topic:String(topic)}); lastEventTs.set(Math.floor(Date.now()/1000));
  if(evt==='top'&&!Number.isNaN(t))lastTopMs.set(t); if(evt==='base'&&!Number.isNaN(t))lastBaseMs.set(t);
  if(!Number.isNaN(vr)) lastVRms.set({event:String(evt),topic:String(topic)}, vr);
  const spec=pickIdeal(topic,evt); if(spec&&Number.isFinite(t)){const dev=t-Number(spec.t_ms); const inSpec=Math.abs(dev)<=Number(spec.tolerance_ms); deviationMs.set({event:String(evt),topic:String(topic)},dev); if(!inSpec) outOfSpecTotal.inc({event:String(evt),topic:String(topic)}); v.analysis={ideal_ms:Number(spec.t_ms),tolerance_ms:Number(spec.tolerance_ms),deviation_ms:dev,in_spec:inSpec};}
  broadcast(v);
}
app.get('/metrics',async(_q,res)=>{res.set('Content-Type',client.register.contentType);res.send(await client.register.metrics());});
app.get('/health',(_q,res)=>res.send('ok'));
app.post('/data',(req,res)=>{const {error,value}=schema.validate(req.body); if(error) return res.status(400).json({error:error.message}); ingest(value); res.status(204).end();});
const server=http.createServer(app); const wss=new WebSocketServer({server,path:ENV.WS_PATH}); function broadcast(o){const m=JSON.stringify(o); for(const ws of wss.clients){ if(ws.readyState===WebSocket.OPEN) ws.send(m);}}
server.listen(ENV.PORT,()=>console.log('HTTP+WS :'+ENV.PORT));