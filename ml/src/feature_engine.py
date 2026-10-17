"""
Feature extraction from raw Citadel signal bundles.
Produces a 40-dimensional feature vector for the ML pipeline.
"""
import logging

import numpy as np
from typing import Any

logger = logging.getLogger(__name__)

FEATURE_DIM = 40

# Hard cap on events processed per type to prevent DoS via huge bundles.
# Callers should also truncate in main.py; this is a defensive backstop for
# any direct callers of the pipeline.
MAX_EVENTS_PER_TYPE = 5000


def _mean(v: list) -> float:
    return float(np.mean(v)) if v else 0.0


def _std(v: list) -> float:
    return float(np.std(v)) if len(v) > 1 else 0.0


def _get(bundle: dict, snake: str, camel: str) -> list:
    return bundle.get(snake) or bundle.get(camel) or []


def _cap_events(events: list, label: str) -> list:
    """Keep only the most recent MAX_EVENTS_PER_TYPE events; log truncation."""
    if not isinstance(events, list):
        return events if isinstance(events, list) else []
    if len(events) > MAX_EVENTS_PER_TYPE:
        logger.warning(
            "extract_features: truncating %s from %d to %d events (most recent kept)",
            label, len(events), MAX_EVENTS_PER_TYPE,
        )
        return events[-MAX_EVENTS_PER_TYPE:]
    return events


def extract_features(signal_bundle: dict[str, Any]) -> np.ndarray:
    """
    Returns a (40,) float32 feature vector from a raw signal bundle.

    Feature layout:
      [0-9]   Keystroke dynamics
      [10-14] Mouse dynamics
      [15-19] Touch dynamics
      [20-24] Navigation dynamics
      [25-29] Environment signals
      [30-39] Derived / temporal features
    """
    ks  = _cap_events(_get(signal_bundle, "keystroke_events",  "keystrokeEvents"), "keystrokeEvents")
    ms  = _cap_events(_get(signal_bundle, "mouse_events",       "mouseEvents"),    "mouseEvents")
    ts  = _cap_events(_get(signal_bundle, "touch_events",       "touchEvents"),    "touchEvents")
    nav = _get(signal_bundle, "navigation_events",  "navigationEvents")
    env = signal_bundle.get("environment") or {}

    f = np.zeros(FEATURE_DIM, dtype=np.float32)

    # ── Keystroke [0-9] ──────────────────────────────────────────────
    keydowns = [e for e in ks if e.get("eventType") == "keydown"]
    keyups   = [e for e in ks if e.get("eventType") == "keyup"]

    dwell_times  = [e["dwellTime"]  for e in keyups if (e.get("dwellTime")  or 0) > 0]
    flight_times = [e["flightTime"] for e in keyups if (e.get("flightTime") or 0) > 0]

    f[0] = _mean(dwell_times)
    f[1] = _std(dwell_times)
    f[2] = _mean(flight_times)
    f[3] = _std(flight_times)

    if len(keydowns) >= 2:
        ts_vals    = [e.get("timestamp", 0) for e in keydowns]
        dur_s      = (max(ts_vals) - min(ts_vals)) / 1000 + 1e-3
        f[4]       = len(keydowns) / dur_s          # chars/sec

    backspaces = sum(1 for e in ks if e.get("key") == "Backspace")
    f[5] = backspaces / max(len(keydowns), 1)       # backspace rate

    alpha = sum(1 for e in keydowns if e.get("key") == "ALPHA")
    digit = sum(1 for e in keydowns if e.get("key") == "DIGIT")
    total = max(len(keydowns), 1)
    f[6] = alpha / total                            # alpha ratio
    f[7] = digit / total                            # digit ratio

    f[8] = f[0] / (f[2] + 1e-6)                    # dwell/flight ratio
    f[9] = max(0.0, 1.0 - f[1] / (f[0] + 1e-6))   # rhythm regularity (high = consistent)

    # ── Mouse [10-14] ────────────────────────────────────────────────
    moves   = [e for e in ms if e.get("eventType") == "move"]
    clicks  = [e for e in ms if e.get("eventType") == "click"]
    scrolls = [e for e in ms if e.get("eventType") == "scroll"]

    session_s = 1.0
    if moves:
        ts_vals   = [e.get("timestamp", 0) for e in moves]
        session_s = (max(ts_vals) - min(ts_vals)) / 1000 + 1.0

    if len(moves) >= 2:
        vels = []
        for i in range(1, min(len(moves), 200)):
            dx = moves[i].get("x", 0) - moves[i-1].get("x", 0)
            dy = moves[i].get("y", 0) - moves[i-1].get("y", 0)
            dt = moves[i].get("timestamp", 0) - moves[i-1].get("timestamp", 0)
            if dt > 0:
                vels.append(np.sqrt(dx**2 + dy**2) / dt)
        f[10] = _mean(vels)
        f[11] = _std(vels)

    f[12] = len(clicks)  / session_s * 60  # clicks/min
    f[13] = len(scrolls) / session_s * 60  # scrolls/min

    if len(moves) >= 2:
        f[14] = float(sum(
            np.sqrt((moves[i].get("x",0)-moves[i-1].get("x",0))**2 +
                    (moves[i].get("y",0)-moves[i-1].get("y",0))**2)
            for i in range(1, min(len(moves), 100))
        ))

    # ── Touch [15-19] ────────────────────────────────────────────────
    pressures = [e.get("pressure", 0.0) for e in ts if e.get("pressure") is not None]
    sizes     = [e.get("touchSize", 0.0) for e in ts if e.get("touchSize") is not None]
    f[15] = _mean(pressures)
    f[16] = _std(pressures)
    f[17] = _mean(sizes)
    f[18] = _std(sizes)
    f[19] = len(ts) / session_s * 60  # touches/min

    # ── Navigation [20-24] ───────────────────────────────────────────
    dwell_ms = [e.get("dwellMs", 0) for e in nav if (e.get("dwellMs") or 0) > 0]
    f[20] = _mean(dwell_ms)
    f[21] = float(max(dwell_ms)) if dwell_ms else 0.0
    f[22] = float(len(nav))

    if len(flight_times) >= 4:
        mean_ft   = np.mean(flight_times)
        std_ft    = np.std(flight_times)
        threshold = mean_ft + 3 * std_ft
        f[23]     = float(sum(1 for ft in flight_times if ft > threshold))

    f[24] = float(len(keydowns))  # total keypress count

    # ── Environment [25-29] ──────────────────────────────────────────
    f[25] = 1.0 if env.get("screenShareActive", False) else 0.0
    f[26] = 1.0 if env.get("clipboardSource") == "pasted" else 0.0
    f[27] = 1.0 if env.get("tabVisible", True)           else 0.0
    f[28] = {"desktop": 0.0, "mobile": 1.0, "tablet": 2.0}.get(
        env.get("deviceType", "desktop"), 0.0
    )
    f[29] = f[25] * 0.5 + f[26] * 0.3 + (1.0 - f[27]) * 0.2  # env anomaly score

    # ── Derived / Temporal [30-39] ───────────────────────────────────
    # Missing keystroke data → neutral (0.0), NOT max anomaly: an empty/pre-login
    # session must not look maximally suspicious.
    f[30] = abs(f[0] - 100.0) / 100.0 if f[0] > 0 else 0.0   # dwell anomaly vs 100ms norm
    f[31] = abs(f[2] - 150.0) / 150.0 if f[2] > 0 else 0.0   # flight anomaly vs 150ms norm

    if keydowns:
        ts_vals = sorted(e.get("timestamp", 0) for e in keydowns)
        f[32]   = float(sum(1 for i in range(1, len(ts_vals))
                            if ts_vals[i] - ts_vals[i-1] > 1000))   # pause count

    f[33] = f[5]  # correction pattern (mirrors backspace rate)

    if f[0] > 0:
        f[34] = min(f[1] / (f[0] + 1e-6), 5.0) / 5.0   # dwell CV, normalised

    if nav and (nav[0].get("dwellMs") or 0) > 0:
        f[35] = min(nav[0]["dwellMs"] / 10_000.0, 1.0)  # first-field latency

    if len(dwell_times) >= 10:
        median_d  = float(np.median(dwell_times))
        fast_keys = [d for d in dwell_times if d < median_d]
        slow_keys = [d for d in dwell_times if d >= median_d]
        f[36]     = _mean(fast_keys)
        f[37]     = _mean(slow_keys)

    if len(moves) >= 3:
        dir_changes = 0
        for i in range(1, min(len(moves) - 1, 100)):
            dx1 = moves[i].get("x",0) - moves[i-1].get("x",0)
            dy1 = moves[i].get("y",0) - moves[i-1].get("y",0)
            dx2 = moves[i+1].get("x",0) - moves[i].get("x",0)
            dy2 = moves[i+1].get("y",0) - moves[i].get("y",0)
            m1  = np.sqrt(dx1**2 + dy1**2)
            m2  = np.sqrt(dx2**2 + dy2**2)
            if m1 > 0 and m2 > 0 and (dx1*dx2 + dy1*dy2) / (m1 * m2) < 0:
                dir_changes += 1
        f[38] = dir_changes / max(len(moves), 1)  # curvature / direction-change rate

    f[39] = f[29] * 0.5 + (1.0 - f[9]) * 0.3 + f[30] * 0.2  # composite risk proxy

    return f


def build_keystroke_sequence(signal_bundle: dict[str, Any], max_len: int = 128) -> np.ndarray:
    """
    Builds a (seq_len, 6) float32 array for the BehaveFormer transformer.
    Each row: [dwell_norm, flight_norm, key_type, position_norm, interval_norm, cum_time_norm]
    Returns shape (min(actual_len, max_len), 6).  Returns zeros if <2 events.
    """
    ks     = _get(signal_bundle, "keystroke_events", "keystrokeEvents")
    keyups = [e for e in ks if e.get("eventType") == "keyup"][:max_len]

    if len(keyups) < 2:
        return np.zeros((2, 6), dtype=np.float32)

    seq   = np.zeros((len(keyups), 6), dtype=np.float32)
    t0    = keyups[0].get("timestamp", 0)
    total = (keyups[-1].get("timestamp", 0) - t0) + 1e-3

    for i, e in enumerate(keyups):
        key = e.get("key", "")
        seq[i, 0] = min(e.get("dwellTime",  0) / 500.0, 1.0)   # dwell, normalised to 500ms
        seq[i, 1] = min(e.get("flightTime", 0) / 500.0, 1.0)   # flight, normalised
        seq[i, 2] = {"ALPHA": 0.0, "DIGIT": 0.33, "SPECIAL": 0.67}.get(key, 1.0)  # key type
        seq[i, 3] = i / len(keyups)                              # position in sequence
        if i > 0:
            dt         = (e.get("timestamp", 0) - keyups[i-1].get("timestamp", 0))
            seq[i, 4]  = min(dt / 1000.0, 1.0)                  # interval from previous key
        seq[i, 5] = (e.get("timestamp", 0) - t0) / total        # cumulative time

    return seq


def build_mouse_sequence(signal_bundle: dict[str, Any], max_len: int = 64) -> np.ndarray:
    """
    Builds a (seq_len, 4) float32 array for CNN-LSTM.
    Each row: [x_norm, y_norm, velocity_norm, event_type_encoded]

    Normalization matches Balabit training (mouse.py):
      x_norm = x / 1920.0  (screen width constant)
      y_norm = y / 1920.0  (same constant — matches training data)
      vel_norm = velocity / 5.0, clipped to [0,1]
    """
    SCREEN = 1920.0
    ms     = _get(signal_bundle, "mouse_events", "mouseEvents")
    moves  = [e for e in ms if e.get("eventType") in ("move", "click")][:max_len]

    if len(moves) < 2:
        return np.zeros((2, 4), dtype=np.float32)

    seq   = np.zeros((len(moves), 4), dtype=np.float32)
    for i, e in enumerate(moves):
        seq[i, 0] = min(e.get("x", 0) / SCREEN, 1.0)
        seq[i, 1] = min(e.get("y", 0) / SCREEN, 1.0)
        if i > 0:
            dx        = e.get("x",0) - moves[i-1].get("x",0)
            dy        = e.get("y",0) - moves[i-1].get("y",0)
            dt        = e.get("timestamp",0) - moves[i-1].get("timestamp",0)
            vel       = np.sqrt(dx**2 + dy**2) / (dt + 1e-6)
            seq[i, 2] = min(vel / 5.0, 1.0)
        seq[i, 3] = 1.0 if e.get("eventType") == "click" else 0.0

    return seq
