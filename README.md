# Digital Twin Backend (TS) — Metrics + Chart

## Dev
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
- GET `/metrics` (Prometheus)
- Static: `/debug.html`, `/chart.html`

## Prometheus scrape example (prometheus.yml)
```yaml
scrape_configs:
  - job_name: 'digital-twin-backend'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: /metrics
```
