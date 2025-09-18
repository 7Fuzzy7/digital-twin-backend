import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import app from './app';
import { config } from './config';
import { events } from './store';
import { dataSchema } from './schemas';

let lastData: unknown = null;

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: config.wsPath });

function broadcast(obj: unknown) {
  const msg = JSON.stringify(obj);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

export function ingest(value: unknown) {
  lastData = value;
  events.push(value);
  broadcast(value);
}

export function getLast() {
  return lastData;
}

wss.on('connection', (ws: WebSocket) => {
  (ws as any).isAlive = true;
  ws.on('pong', () => ((ws as any).isAlive = true));

  // envia último estado ao conectar
  if (lastData) ws.send(JSON.stringify(lastData));

  // aceitar frames JSON vindos de produtores (ex.: Python)
  ws.on('message', (buf: Buffer) => {
    try {
      const raw = buf.toString('utf8');
      const parsed = JSON.parse(raw);
      const { error, value } = dataSchema.validate(parsed);
      if (error) {
        ws.send(JSON.stringify({ type: 'error', message: error.message }));
        return;
      }
      ingest(value);
    } catch (e: any) {
      ws.send(JSON.stringify({ type: 'error', message: e?.message ?? 'invalid_message' }));
    }
  });
});

// Heartbeat para remover conexões mortas
setInterval(() => {
  for (const ws of wss.clients) {
    const client = ws as any;
    if (!client.isAlive) { ws.terminate(); continue; }
    client.isAlive = false;
    ws.ping();
  }
}, 30_000);

server.listen(config.port, () => {
  console.log(`🚀 HTTP + WS running on :${config.port} (path ${config.wsPath})`);
});
