// server.js
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const app = express();
app.use(cors());
app.use(express.json());

let lastData = null; // guarda último dado

// Endpoint opcional: receber do ESP por HTTP
app.post("/data", (req, res) => {
  lastData = req.body;
  console.log("Novo dado (HTTP):", lastData);
  broadcast(lastData);
  res.sendStatus(200);
});

const PORT = 3000;
const server = app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});

// WebSocket
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  console.log("Cliente conectado no WS");

  // Se já temos dado, manda o último
  if (lastData) ws.send(JSON.stringify(lastData));

  // Agora também ACEITAMOS mensagens entrantes de clientes WS (ex.: ESP32)
  ws.on("message", (buf) => {
    try {
      const msg = JSON.parse(buf.toString());
      // esperamos { topic: "...", payload: {...} }
      if (msg && msg.topic && typeof msg.payload !== "undefined") {
        lastData = msg;
        console.log("Novo dado (WS):", lastData);
        broadcast(lastData); // reenvia a TODOS (dashboards)
      }
    } catch (e) {
      console.warn("WS mensagem inválida:", e.message);
    }
  });
});

// util: envia pra todos WS conectados
function broadcast(obj) {
  const s = JSON.stringify(obj);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(s);
  });
}

// health endpoints
app.get("/health", (req,res) => res.send("ok"));
app.get("/last",   (req,res) => res.json(lastData || {}));
