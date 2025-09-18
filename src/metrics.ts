import client from 'prom-client';
const collectDefault = client.collectDefaultMetrics;
collectDefault({ prefix: 'dt_', timeout: 5000 });
export const eventsTotal = new client.Counter({ name:'dt_events_total', help:'Total number of ingested events', labelNames:['event','topic'] });
export const wsConnections = new client.Gauge({ name:'dt_ws_connections', help:'Current number of active WebSocket connections' });
export const lastEventTimestamp = new client.Gauge({ name:'dt_last_event_timestamp_seconds', help:'Unix timestamp (seconds) when the last event was ingested' });
export const register = client.register;

const THRESHOLD_TOP_MS = Number(process.env.THRESHOLD_TOP_MS ?? 1000);
const THRESHOLD_BASE_MS = Number(process.env.THRESHOLD_BASE_MS ?? 1000);

export const lastTopMs = new client.Gauge({ name:'dt_last_top_ms', help:'Latest t_ms observed for event=top' });
export const lastBaseMs = new client.Gauge({ name:'dt_last_base_ms', help:'Latest t_ms observed for event=base' });
export const thresholdTopMs = new client.Gauge({ name:'dt_threshold_top_ms', help:'Configured threshold (ms) for event=top' });
export const thresholdBaseMs = new client.Gauge({ name:'dt_threshold_base_ms', help:'Configured threshold (ms) for event=base' });
thresholdTopMs.set(THRESHOLD_TOP_MS);
thresholdBaseMs.set(THRESHOLD_BASE_MS);
