"""
phishing_demo.py — Citadel Hackathon Phishing Simulation Backend

Provides:
  POST /api/phishing/demo/log    — receives harvested credentials from fake portal
  GET  /api/phishing/demo/status — returns current demo state
  POST /api/phishing/demo/reset  — resets for re-runs
  WS   /api/phishing/demo/ws     — real-time credential stream to Hacker Terminal

All data is stored in-memory only. Nothing is written to DB.
This module exists solely for controlled hackathon demonstration purposes.
"""

import asyncio
import json
import time
from typing import List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

router = APIRouter()

# ── In-memory demo state ───────────────────────────────────────────────────────
_demo_state = {
    "phase": "waiting",           # waiting | credentials_captured | attack_detected | blocked
    "captured_at": None,
    "events": [],                 # list of terminal event dicts
}

# Active WebSocket connections (Hacker Terminal panels)
_ws_connections: List[WebSocket] = []


# ── Models ─────────────────────────────────────────────────────────────────────
class PhishingLogPayload(BaseModel):
    username: str
    password: str
    user_agent: str = "Unknown"
    dwell_times: List[float] = []
    flight_times: List[float] = []
    avg_dwell_ms: float = 0.0
    avg_flight_ms: float = 0.0
    typing_speed_cps: float = 0.0
    clipboard_paste_detected: bool = False
    session_id: str = ""


# ── WebSocket broadcast helper ─────────────────────────────────────────────────
async def _broadcast(event: dict):
    """Broadcast an event to all connected Hacker Terminal WebSocket clients."""
    dead = []
    for ws in _ws_connections:
        try:
            await ws.send_text(json.dumps(event))
        except Exception:
            dead.append(ws)
    for ws in dead:
        _ws_connections.remove(ws)


# ── Endpoints ──────────────────────────────────────────────────────────────────
@router.post("/log")
async def log_phishing_credentials(payload: PhishingLogPayload):
    """
    Called by the phishing portal (PhishingSimPage) when the victim submits
    the fake login form. Stores credentials in-memory and broadcasts to the
    Hacker Terminal via WebSocket.
    """
    ts = time.strftime("%H:%M:%S", time.localtime())

    # The plaintext password never leaves this function: only a masked form
    # (first char + bullets + length) is stored or broadcast.
    pw = payload.password
    masked_password = (pw[0] + "●" * max(len(pw) - 1, 1) + f"  ({len(pw)} chars)") if pw else "(empty)"

    # Classify typing pattern
    typing_profile = "NORMAL"
    if payload.avg_dwell_ms > 220:
        typing_profile = "ELDERLY / SLOW"
    elif payload.avg_dwell_ms < 80:
        typing_profile = "BOT / RAPID"

    # Build terminal events
    events = [
        {"type": "HEADER",   "ts": ts, "msg": "🔴  CREDENTIAL CAPTURE ACTIVE"},
        {"type": "CRED",     "ts": ts, "field": "username",       "value": payload.username},
        {"type": "CRED",     "ts": ts, "field": "password",       "value": masked_password},
        {"type": "META",     "ts": ts, "field": "user_agent",     "value": payload.user_agent[:60]},
        {"type": "BIO",      "ts": ts, "field": "avg_dwell_ms",   "value": f"{payload.avg_dwell_ms:.1f} ms"},
        {"type": "BIO",      "ts": ts, "field": "avg_flight_ms",  "value": f"{payload.avg_flight_ms:.1f} ms"},
        {"type": "BIO",      "ts": ts, "field": "typing_speed",   "value": f"{payload.typing_speed_cps:.2f} chars/sec"},
        {"type": "BIO",      "ts": ts, "field": "typing_profile", "value": typing_profile},
        {"type": "BIO",      "ts": ts, "field": "clipboard_paste","value": "⚠️  YES — credentials pasted" if payload.clipboard_paste_detected else "No"},
        {"type": "STATUS",   "ts": ts, "msg": "📡  SENDING TO C2 SERVER..."},
        {"type": "SUCCESS",  "ts": ts, "msg": "✅  CREDENTIALS EXFILTRATED"},
    ]

    _demo_state["phase"] = "credentials_captured"
    _demo_state["captured_at"] = ts
    _demo_state["events"] = events

    # Stream events to Hacker Terminal with dramatic delays
    async def _stream():
        for i, ev in enumerate(events):
            await asyncio.sleep(0.25 if i < 3 else 0.15)
            await _broadcast(ev)

    asyncio.create_task(_stream())

    return {"status": "logged", "phase": "credentials_captured"}


@router.post("/attack-detected")
async def notify_attack_detected():
    """
    Called by the real ZipPay portal when Citadel fires HARD_BLOCK
    on the attacker's login attempt with stolen credentials.
    """
    ts = time.strftime("%H:%M:%S", time.localtime())
    
    events = [
        {"type": "SEPARATOR", "ts": ts, "msg": "─" * 48},
        {"type": "ATTACK",    "ts": ts, "msg": "⚡  ATTACKER LOGIN ATTEMPT DETECTED"},
        {"type": "DETECTION", "ts": ts, "field": "imei_match",     "value": "❌  MISMATCH — Unknown Device"},
        {"type": "DETECTION", "ts": ts, "field": "typing_match",   "value": "❌  ANOMALY — Typing ≠ Enrolled Baseline"},
        {"type": "DETECTION", "ts": ts, "field": "passport_match", "value": "❌  PASSPORT MISMATCH"},
        {"type": "DETECTION", "ts": ts, "field": "risk_score",     "value": "92 / 100  🔴"},
        {"type": "BLOCK",     "ts": ts, "msg": "⛔  HARD_BLOCK ISSUED — LOGIN DENIED"},
        {"type": "ALERT",     "ts": ts, "msg": "📨  ALERT SENT TO REGISTERED USER: Change your credentials NOW"},
    ]

    _demo_state["phase"] = "blocked"
    _demo_state["events"].extend(events)

    async def _stream():
        for i, ev in enumerate(events):
            await asyncio.sleep(0.3 if i == 0 else 0.2)
            await _broadcast(ev)

    asyncio.create_task(_stream())
    
    return {"status": "attack_detected", "phase": "blocked"}


@router.get("/status")
async def get_demo_status():
    """Returns current demo phase and event count."""
    return {
        "phase": _demo_state["phase"],
        "event_count": len(_demo_state["events"]),
        "captured_at": _demo_state["captured_at"],
    }


@router.post("/reset")
async def reset_demo():
    """Resets all demo state for re-runs."""
    _demo_state["phase"] = "waiting"
    _demo_state["captured_at"] = None
    _demo_state["events"] = []

    await _broadcast({"type": "RESET", "ts": time.strftime("%H:%M:%S", time.localtime()), "msg": "🔄  DEMO RESET — READY FOR NEXT RUN"})
    return {"status": "reset"}


@router.websocket("/ws")
async def phishing_demo_ws(websocket: WebSocket):
    """
    WebSocket endpoint consumed by the Hacker Terminal panel in PhishingDemoPage.
    Keeps connection alive; receives broadcast events from log/attack-detected endpoints.
    """
    await websocket.accept()
    _ws_connections.append(websocket)
    
    # Send connection confirmation
    await websocket.send_text(json.dumps({
        "type": "CONNECTED",
        "ts": time.strftime("%H:%M:%S", time.localtime()),
        "msg": "🖥️  HACKER TERMINAL CONNECTED — Listening for credential events...",
    }))

    try:
        while True:
            # Keep alive — client may send pings
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "PONG"}))
    except WebSocketDisconnect:
        if websocket in _ws_connections:
            _ws_connections.remove(websocket)
