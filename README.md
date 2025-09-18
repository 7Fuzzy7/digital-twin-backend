# Digital Twin Backend — PRO Pack (JS)

Melhorias:
- ✅ Env validation (Joi) com defaults seguros
- ✅ CORS whitelist (CSV) ou `*`
- ✅ Buffer 2000 eventos + histórico `/data/events`
- ✅ Métricas Prometheus (`/metrics`) + thresholds
- ✅ WS heartbeat + graceful shutdown (SIGINT/SIGTERM)
- ✅ Endpoints `health` e `ready` para probes
- ✅ Dockerfile e `docker-compose.yml` com Prometheus + Grafana (dashboard e datasource provisionados)

## Rodar local
```bash
npm i
cp .env.example .env
npm run dev
```

## Docker (tudo junto: backend + Prometheus + Grafana)
```bash
docker compose -f ops/docker-compose.yml up -d --build
```
- Backend: http://localhost:3000
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (user: admin / pass: admin)

## .env
```env
PORT=3000
WS_PATH=/ws
CORS_ORIGIN=*
THRESHOLD_TOP_MS=1000
THRESHOLD_BASE_MS=1000
```
