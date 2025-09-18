# Digital Twin Backend (TypeScript Starter)

## Rodar em desenvolvimento
```bash
npm i
cp .env.example .env
npm run dev
```

- HTTP: `GET /health` -> `ok`
- Enviar dados: `POST /data` (JSON: `{ topic, payload }`)
- WebSocket: conectar em `ws://localhost:3000/ws`

## Build e produção
```bash
npm run build
npm start
```
