"""WebSocket -> SQLite consumer (PRO pack)."""
import os, asyncio, json, sqlite3
from datetime import datetime
import websockets

WS_URL = os.getenv("WS_URL", "ws://localhost:3000/ws")
DB_PATH = os.getenv("DB_PATH", "twin_events.sqlite")
TABLE = os.getenv("TABLE_NAME", "events")

DDL = f"""
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS {TABLE}(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_iso TEXT NOT NULL,
  topic TEXT,
  event TEXT,
  t_ms REAL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_{TABLE}_ts ON {TABLE}(ts_iso);
CREATE INDEX IF NOT EXISTS idx_{TABLE}_event ON {TABLE}(event);
CREATE INDEX IF NOT EXISTS idx_{TABLE}_topic ON {TABLE}(topic);
"""

def ensure_db():
  con = sqlite3.connect(DB_PATH)
  try:
    for stmt in DDL.split(';'):
      s = stmt.strip()
      if s: con.execute(s)
    con.commit()
  finally:
    con.close()

def parse_row(obj):
  topic = (obj or {}).get("topic")
  payload = (obj or {}).get("payload") or {}
  event = payload.get("event")
  t_ms = payload.get("t_ms")
  return (
    datetime.utcnow().isoformat(timespec="seconds") + "Z",
    topic, event, t_ms, json.dumps(obj, ensure_ascii=False)
  )

async def main():
  ensure_db()
  print(f"[i] connecting {WS_URL}, db={DB_PATH}")
  async for ws in websockets.connect(WS_URL, ping_interval=20, ping_timeout=20):
    try:
      async for msg in ws:
        try:
          obj = json.loads(msg)
          row = parse_row(obj)
          with sqlite3.connect(DB_PATH) as con:
            con.execute(f"INSERT INTO {TABLE}(ts_iso,topic,event,t_ms,raw_json) VALUES(?,?,?,?,?)", row)
          print("[+]", row[:4])
        except Exception as e:
          print("[!] err:", e)
    except Exception as e:
      print("[!] ws err:", e)

if __name__ == "__main__":
  asyncio.run(main())
