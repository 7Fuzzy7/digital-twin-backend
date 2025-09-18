# Digital Twin Backend (TypeScript + Debug Client)

## Rodar em desenvolvimento
```bash
npm i
cp .env.example .env
npm run dev
```

- HTTP: `GET /health` -> `ok`
- WS: `ws://localhost:3000/ws`
- Enviar dados:
```bash
curl -X POST http://localhost:3000/data   -H "Content-Type: application/json"   -d '{"topic":"press/cycle","payload":{"event":"top","t_ms":1234}}'
```

## Endpoints úteis
- `GET /data/last` → último estado
- `GET /data/events?limit=200` → histórico recente
- Abrir `http://localhost:3000/debug.html` para testar WS/HTTP no navegador

## Integração com Python (twin_cycle.py)
### WebSocket (recomendado)
```python
import os, asyncio, json, websockets
WS_URL = os.getenv("WS_URL", "ws://localhost:3000/ws")

async def main():
    async with websockets.connect(WS_URL, ping_interval=20, ping_timeout=20) as ws:
        msg = {"topic": "press/cycle", "payload": {"event": "top", "t_ms": 1234}}
        await ws.send(json.dumps(msg))

asyncio.run(main())
```

### HTTP (alternativa)
```bash
curl -X POST http://localhost:3000/data   -H "Content-Type: application/json"   -d '{"topic":"press/cycle","payload":{"event":"top","t_ms":1234}}'
```
