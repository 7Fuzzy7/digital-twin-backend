import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import app from './app';
import { config } from './config';

let lastData: unknown = null;

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: config.wsPath });

function broadcast(obj: unknown) {
  const msg = JSON.stringify(obj);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

wss.on('connection', (ws: WebSocket) => {
  (ws as any).isAlive = true;
  ws.on('pong', () => ((ws as any).isAlive = true));
  if (lastData) ws.send(JSON.stringify(lastData));
});

setInterval(() => {
  for (const ws of wss.clients) {
    const client = ws as any;
    if (!client.isAlive) { ws.terminate(); continue; }
    client.isAlive = false;
    ws.ping();
  }
}, 30_000);

// Exporte broadcast para ser usado nas rotas
export function wsBroadcast(data: unknown) {
  lastData = data;
  broadcast(data);
}

server.listen(config.port, () => {
  console.log(`🚀 HTTP + WS rodando na porta ${config.port} (path ${config.wsPath})`);
});
