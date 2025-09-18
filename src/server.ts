import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import app from './app';
import { config } from './config';
import { events } from './store';
import { dataSchema } from './schemas';
import { eventsTotal, wsConnections, lastEventTimestamp, lastTopMs, lastBaseMs } from './metrics';

let lastData: any = null;
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: config.wsPath });

function broadcast(obj: unknown) {
  const msg = JSON.stringify(obj);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

export function ingest(value: any) {
  lastData = value;
  events.push(value);
  try {
    const evt = value?.payload?.event ?? 'unknown';
    const topic = value?.topic ?? 'unknown';
    eventsTotal.inc({ event: String(evt), topic: String(topic) });
    lastEventTimestamp.set(Math.floor(Date.now()/1000));
  } catch {}
  broadcast(value);
}
export function getLast(){ return lastData; }

wss.on('connection', (ws: WebSocket) => {
  wsConnections.inc();
  (ws as any).isAlive = true;
  ws.on('pong', () => ((ws as any).isAlive = true));
  ws.on('close', () => wsConnections.dec());

  if (lastData) ws.send(JSON.stringify(lastData));

  ws.on('message', (buf: Buffer) => {
    try {
      const parsed = JSON.parse(buf.toString('utf8'));
      const { error, value } = dataSchema.validate(parsed);
      if (error) { ws.send(JSON.stringify({ type:'error', message: error.message })); return; }
      ingest(value);
    } catch (e:any) {
      ws.send(JSON.stringify({ type:'error', message: e?.message ?? 'invalid_message' }));
    }
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    const client = ws as any;
    if (!client.isAlive) { ws.terminate(); continue; }
    client.isAlive = false; ws.ping();
  }
}, 30000);

server.listen(config.port, () => { console.log(`🚀 HTTP + WS running on :${config.port} (path ${config.wsPath})`); });
