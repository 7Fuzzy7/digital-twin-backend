"""
WebSocket consumer that listens to the Digital Twin backend and appends
incoming JSON messages to a CSV file.

Usage:
    pip install websockets python-dotenv
    python ws_consumer_to_csv.py
Env:
    WS_URL  (default: ws://localhost:3000/ws)
    CSV_PATH (default: data.csv)
"""
import os
import asyncio
import json
import csv
from datetime import datetime
from pathlib import Path

import websockets
from dotenv import load_dotenv

load_dotenv()

WS_URL = os.getenv("WS_URL", "ws://localhost:3000/ws")
CSV_PATH = os.getenv("CSV_PATH", "data.csv")

# You can customize these keys according to your payload schema
# We'll try to flatten common fields (topic, payload.event, payload.t_ms)
FIELDS = ["ts_iso", "topic", "event", "t_ms", "raw_json"]

def ensure_csv(path: str):
    p = Path(path)
    if not p.exists():
        with p.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDS)
            writer.writeheader()

def parse_row(obj: dict):
    topic = obj.get("topic")
    payload = obj.get("payload") or {}
    event = payload.get("event")
    t_ms = payload.get("t_ms")
    return {
        "ts_iso": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "topic": topic,
        "event": event,
        "t_ms": t_ms,
        "raw_json": json.dumps(obj, ensure_ascii=False),
    }

async def main():
    ensure_csv(CSV_PATH)
    print(f"[i] Connecting to {WS_URL}, writing CSV -> {CSV_PATH}")
    async for ws in websockets.connect(WS_URL, ping_interval=20, ping_timeout=20):
        try:
            print("[i] Connected")
            async for msg in ws:
                try:
                    obj = json.loads(msg)
                    row = parse_row(obj)
                    with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
                        writer = csv.DictWriter(f, fieldnames=FIELDS)
                        writer.writerow(row)
                    print(f"[+] {row['ts_iso']} topic={row['topic']} event={row['event']} t_ms={row['t_ms']}")
                except Exception as e:
                    print(f"[!] Error processing message: {e}")
        except (websockets.ConnectionClosed, websockets.ConnectionClosedOK):
            print("[!] Connection closed, reconnecting...")
            await asyncio.sleep(1)
        except Exception as e:
            print(f"[!] WS error: {e}, reconnecting in 2s...")
            await asyncio.sleep(2)

if __name__ == "__main__":
    asyncio.run(main())
