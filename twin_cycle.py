import asyncio, json, time, statistics
import websockets

# ======= CONFIG =======
WS_URL = "ws://172.20.10.4:3000"

IDEAL_CYCLE_S   = 2.9               # ideal do ciclo (s)
TOLERANCE_MS    = 100                # banda de aceitação
WINDOW_N        = 20                # janela p/ médias (ciclos)
HEARTBEAT_MS    = 1000              # heartbeat (ms)

IDEAL_MS        = int(IDEAL_CYCLE_S * 1000)
PRIME_DROP_FIRST = True             # descarta o 1º ciclo válido
MAX_CYCLE_MS     = int(IDEAL_MS * 3)  # descarta ciclos muito longos

# ======= ESTADO =======
state = {
    "prev_top": None,               # último TOP visto
    "prev_base": None,              # último BASE visto
    "cycles": [],                   # {t_top_start_ms, t_base_ms, t_top_end_ms, ...} ou versão BASE-anchored
    "seq": 0,
    "primed": (not PRIME_DROP_FIRST)
}

def push_cycle_top(t1, t2, t3):
    """Ciclo ancorado em TOP: TOP(t1) -> BASE(t2) -> TOP(t3)"""
    adv = t2 - t1
    ret = t3 - t2
    cyc = t3 - t1
    return {
        "t_top_start_ms": t1, "t_base_ms": t2, "t_top_end_ms": t3,
        "t_avanco_ms": adv, "t_retorno_ms": ret, "t_ciclo_ms": cyc,
        "host_ms": int(time.time()*1000)
    }

def push_cycle_base(t1, t2, t3):
    """Ciclo ancorado em BASE: BASE(t1) -> TOP(t2) -> BASE(t3)"""
    # aqui "avanço" é o trecho até alcançar o oposto do ponto de partida
    adv = t2 - t1         # BASE -> TOP
    ret = t3 - t2         # TOP  -> BASE
    cyc = t3 - t1
    return {
        "t_base_start_ms": t1, "t_top_ms": t2, "t_base_end_ms": t3,
        "t_avanco_ms": adv, "t_retorno_ms": ret, "t_ciclo_ms": cyc,
        "host_ms": int(time.time()*1000)
    }

def add_cycle(c):
    state["cycles"].append(c)
    if len(state["cycles"]) > 500:
        state["cycles"].pop(0)

def window_stats(key):
    arr = [c[key] for c in state["cycles"][-WINDOW_N:] if c.get(key) is not None]
    if not arr: return None
    return {
        "avg": sum(arr)/len(arr),
        "p95": statistics.quantiles(arr, n=20)[18] if len(arr) >= 2 else arr[0],
        "min": min(arr), "max": max(arr), "n": len(arr)
    }

def cpm_instant(cycle_ms):
    return 60000.0 / cycle_ms if cycle_ms and cycle_ms > 0 else 0.0

def cpm_window():
    arr = [c["t_ciclo_ms"] for c in state["cycles"][-WINDOW_N:] if c.get("t_ciclo_ms")]
    if not arr: return 0.0
    avg_ms = sum(arr)/len(arr)
    return cpm_instant(avg_ms)

def build_twin_state(last_cycle=None):
    payload = {
        "ideal_cycle_ms": IDEAL_MS,
        "tolerance_ms": TOLERANCE_MS,
        "window_n": WINDOW_N,
        "cpm_window": round(cpm_window(), 1),
        "cycle_seq": state["seq"]
    }
    if last_cycle and last_cycle.get("t_ciclo_ms") is not None:
        cyc = last_cycle["t_ciclo_ms"]; err = cyc - IDEAL_MS
        payload.update({
            "observed_cycle_ms": cyc,
            "error_ms": err,
            "error_pct": round(100.0 * err / IDEAL_MS, 2),
            "pass": abs(err) <= TOLERANCE_MS,
            "cpm_instant": round(cpm_instant(cyc), 1),
            # tentativa de preencher campos “canônicos”:
            "t_avanco_ms": last_cycle.get("t_avanco_ms"),
            "t_retorno_ms": last_cycle.get("t_retorno_ms")
        })
    st = window_stats("t_ciclo_ms")
    if st:
        payload.update({
            "cycle_avg_ms": int(st["avg"]), "cycle_p95_ms": int(st["p95"]),
            "cycle_min_ms": int(st["min"]), "cycle_max_ms": int(st["max"])
        })
    return {"topic":"twin/state", "payload": payload}

def valid_cycle_ms(ms):
    return 0 < ms <= MAX_CYCLE_MS

async def run():
    print(f"[twin] conectando em {WS_URL} ...")
    async with websockets.connect(WS_URL) as ws:
        print("[twin] WS conectado")
        last_hb = 0
        # publica config inicial
        await ws.send(json.dumps({"topic":"twin/config",
                                  "payload":{"ideal_cycle_ms": IDEAL_MS,
                                             "tolerance_ms": TOLERANCE_MS,
                                             "window_n": WINDOW_N}}))
        while True:
            # heartbeat com stats (mesmo sem ciclo)
            now = int(time.time()*1000)
            if now - last_hb >= HEARTBEAT_MS:
                await ws.send(json.dumps(build_twin_state()))
                last_hb = now

            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=0.02)
            except asyncio.TimeoutError:
                continue

            try:
                data = json.loads(msg)
            except Exception:
                continue

            if data.get("topic") != "cycle/events":
                continue

            ev  = data.get("payload", {}).get("event")
            tms = data.get("payload", {}).get("t_ms")
            if ev not in ("top","base") or not isinstance(tms, (int, float)):
                continue
            tms = int(tms)

            # ======== LÓGICA SIMÉTRICA ========
            if ev == "top":
                # Fechamento TOP->BASE->TOP se houver BASE depois do último TOP
                if state["prev_top"] is not None and state["prev_base"] is not None and state["prev_base"] > state["prev_top"]:
                    t1, t2, t3 = state["prev_top"], state["prev_base"], tms
                    cyc = t3 - t1
                    if valid_cycle_ms(cyc):
                        if not state["primed"]:
                            state["primed"] = True
                            print("[twin] primed (TOP-anchored): 1º ciclo descartado")
                        else:
                            c = push_cycle_top(t1, t2, t3); add_cycle(c)
                            state["seq"] += 1
                            await ws.send(json.dumps(build_twin_state(c)))
                # atualiza último TOP visto
                state["prev_top"] = tms

            elif ev == "base":
                # Fechamento BASE->TOP->BASE se houver TOP depois do último BASE
                if state["prev_base"] is not None and state["prev_top"] is not None and state["prev_top"] > state["prev_base"]:
                    t1, t2, t3 = state["prev_base"], state["prev_top"], tms
                    cyc = t3 - t1
                    if valid_cycle_ms(cyc):
                        if not state["primed"]:
                            state["primed"] = True
                            print("[twin] primed (BASE-anchored): 1º ciclo descartado")
                        else:
                            c = push_cycle_base(t1, t2, t3); add_cycle(c)
                            state["seq"] += 1
                            await ws.send(json.dumps(build_twin_state(c)))
                # atualiza último BASE visto
                state["prev_base"] = tms

asyncio.run(run())
