"""
Session forensics for the FIU admin panel.

Given a flagged session, produce an explainable "why" bundle from REAL stored
data only:
  • SHAP  — the model's feature attributions (risk_events.shap_explanation)
  • features — behavioural summary computed from the session's raw keystroke/
    mouse events (dwell, flight, backspace rate, duration)
  • baseline — the median of those same features across the customer's OWN past
    APPROVED sessions (their "normal")
  • delta — session-vs-baseline, so an analyst sees exactly which behaviour
    deviated
  • timeline — a capped keystroke timeline for visual replay

Stored keydown events carry a timestamp; keyup events carry dwellTime — so all
features are derived from genuine capture, nothing synthesised.
"""
from __future__ import annotations

import statistics
from typing import Optional

_NUMERIC_FEATURES = (
    "mean_dwell_ms", "std_dwell_ms", "mean_flight_ms",
    "std_flight_ms", "backspace_rate", "duration_s",
)


def _stats(xs: list[float]) -> tuple[Optional[float], Optional[float]]:
    if not xs:
        return None, None
    mean = sum(xs) / len(xs)
    std = statistics.pstdev(xs) if len(xs) > 1 else 0.0
    return round(mean, 1), round(std, 1)


def compute_features(bundle: dict) -> dict:
    """Behavioural summary of one session's raw signal bundle (all real capture)."""
    ks = bundle.get("keystroke_events") or bundle.get("keystrokeEvents") or []
    keydowns = [e for e in ks if e.get("eventType") == "keydown"]
    keyups = [e for e in ks if e.get("eventType") == "keyup"]

    dwell = [float(e["dwellTime"]) for e in keyups
             if isinstance(e.get("dwellTime"), (int, float))]
    kd_ts = [float(e["timestamp"]) for e in keydowns
             if isinstance(e.get("timestamp"), (int, float))]
    # Flight = gap between consecutive keydowns; drop non-positive and >5s pauses
    # (tab-outs) so they don't distort the mean.
    flights = [b - a for a, b in zip(kd_ts, kd_ts[1:]) if 0 < (b - a) < 5000]

    n_kd = len(keydowns)
    backspace = sum(1 for e in keydowns if e.get("key") == "Backspace")
    mean_dwell, std_dwell = _stats(dwell)
    mean_flight, std_flight = _stats(flights)
    duration = round((kd_ts[-1] - kd_ts[0]) / 1000.0, 1) if len(kd_ts) > 1 else 0.0

    return {
        "keystrokes": n_kd,
        "mouse_events": len(bundle.get("mouse_events") or bundle.get("mouseEvents") or []),
        "mean_dwell_ms": mean_dwell,
        "std_dwell_ms": std_dwell,
        "mean_flight_ms": mean_flight,
        "std_flight_ms": std_flight,
        "backspace_rate": round(backspace / n_kd, 3) if n_kd else 0.0,
        "duration_s": duration,
    }


def baseline_from(sessions_bundles: list[dict]) -> Optional[dict]:
    """Median of each numeric feature across the customer's past APPROVED sessions."""
    feats = [compute_features(b) for b in sessions_bundles]
    feats = [f for f in feats if f["keystrokes"] > 0]
    if not feats:
        return None
    out: dict = {}
    for k in _NUMERIC_FEATURES:
        vals = [f[k] for f in feats if isinstance(f.get(k), (int, float))]
        out[k] = round(statistics.median(vals), 1) if vals else None
    out["sessions"] = len(feats)
    return out


def diff(session_feats: dict, baseline: Optional[dict]) -> list[dict]:
    """Per-feature session-vs-baseline delta the analyst can scan."""
    rows = []
    for k in _NUMERIC_FEATURES:
        sv = session_feats.get(k)
        bv = baseline.get(k) if baseline else None
        delta_pct = None
        if isinstance(sv, (int, float)) and isinstance(bv, (int, float)) and bv:
            delta_pct = round((sv - bv) / abs(bv) * 100, 0)
        rows.append({"feature": k, "session": sv, "baseline": bv, "delta_pct": delta_pct})
    return rows


def timeline(bundle: dict, cap: int = 60) -> list[dict]:
    """Capped keydown timeline (relative ms) for visual replay."""
    ks = bundle.get("keystroke_events") or bundle.get("keystrokeEvents") or []
    kd = [e for e in ks if e.get("eventType") == "keydown"
          and isinstance(e.get("timestamp"), (int, float))][:cap]
    if not kd:
        return []
    t0 = kd[0]["timestamp"]
    return [{"t_ms": round(e["timestamp"] - t0), "key": e.get("key", "?")} for e in kd]
