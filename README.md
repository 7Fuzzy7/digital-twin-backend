# Digital Twin Backend — main fixed
Tudo pronto com métricas, validação, vibração opcional e stack de observabilidade.

## Rodar sem Docker
npm i
cp .env.example .env
npm run dev

## Stack completa (Docker)
docker compose -f ops/docker-compose.yml up -d --build

URLs:
- Backend:   http://localhost:3000/health  |  /metrics
- Prometheus: http://localhost:9090
- Grafana:    http://localhost:3001 (admin/admin)
