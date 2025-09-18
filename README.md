# Digital Twin Backend (JS) — pronto pra produção leve

## Rodar
```bash
npm i
cp .env.example .env
npm run dev
```

Endpoints:
- WS: `ws://localhost:3000/ws`
- GET `/health`
- GET `/data/last`
- GET `/data/events?limit=200`
- POST `/data`
- GET `/metrics` (Prometheus)

Front:
- `http://localhost:3000/debug.html`
- `http://localhost:3000/chart.html` (duas séries + thresholds)

## .env
```env
PORT=3000
WS_PATH=/ws
CORS_ORIGIN=*
THRESHOLD_TOP_MS=1000
THRESHOLD_BASE_MS=1000
```
