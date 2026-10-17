"""
Citadel — Anti-Spoofing & Telemetry Replay Resistance
=========================================================

Two independent defences against synthetic / replayed telemetry:

  A. Replay resistance (STRONG, standard crypto)
     The server issues a single-use `nonce` (+ ephemeral session key) per
     evaluation. The client must return HMAC-SHA256(session_key, nonce || bundle_hash).
     The server verifies the MAC and *consumes* the nonce. A captured-and-replayed
     bundle fails because its nonce is already spent; a tampered bundle fails the
     MAC. This is deterministic and demoable.

  B. Micro-tremor frequency analysis (HEURISTIC, presented honestly)
     Human pointer motion carries involuntary physiological jitter; scripted
     GAN / spline trajectories are unnaturally smooth. We FFT the movement
     signal and measure the energy fraction in the tremor band vs the total.
     IMPORTANT: this is a *calibrated heuristic*, not a certified biometric —
     browser pointer sampling (~60 Hz, irregular) cannot cleanly resolve a true
     physiological 8–12 Hz tremor, so the band and thresholds are tuned on our
     own human-vs-synthetic data. It contributes to, but never solely decides,
     the verdict. Insufficient/low-rate samples return a NEUTRAL result.

Both functions are pure and side-effect free (nonce storage lives in the API
layer via Redis), which keeps them unit-testable without infrastructure.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Optional, Sequence

import numpy as np

logger = logging.getLogger(__name__)

# Tremor band and human energy-ratio window, calibrated on our data.
TREMOR_LOW_HZ = 8.0
TREMOR_HIGH_HZ = 12.0
HUMAN_RATIO_MIN = 0.035
HUMAN_RATIO_MAX = 0.42
MIN_SAMPLES = 32


# ── B. Micro-tremor FFT ───────────────────────────────────────────────────────

def verify_micro_tremor_fft(
    sensor_values: Sequence[float],
    sensor_timestamps: Optional[Sequence[float]] = None,
    assumed_rate_hz: float = 100.0,
) -> dict:
    """Return a micro-tremor verdict for a 1-D motion signal.

    sensor_values      : e.g. per-event mouse dx (or speed) samples.
    sensor_timestamps  : optional epoch-ms timestamps; if given, the true mean
                         sampling rate is derived from them instead of assumed.
    assumed_rate_hz    : fallback sampling rate when timestamps are absent.

    verdict keys: is_human(bool|None), tremor_ratio(float), confidence(float),
    reason(str), sampling_rate_hz(float). is_human=None means NEUTRAL (not enough
    signal to judge) — callers must treat NEUTRAL as "no evidence", not "bot".
    """
    n = len(sensor_values)
    if n < MIN_SAMPLES:
        return {
            "is_human": None,
            "tremor_ratio": 0.0,
            "confidence": 0.0,
            "reason": "INSUFFICIENT_SAMPLES",
            "sampling_rate_hz": 0.0,
        }

    signal = np.asarray(sensor_values, dtype=float)
    signal = signal - np.mean(signal)  # detrend (remove DC)
    if not np.any(signal):
        return {
            "is_human": None,
            "tremor_ratio": 0.0,
            "confidence": 0.0,
            "reason": "FLAT_SIGNAL",
            "sampling_rate_hz": 0.0,
        }

    # Derive the real sampling rate from timestamps when available.
    rate = assumed_rate_hz
    if sensor_timestamps is not None and len(sensor_timestamps) == n:
        ts = np.asarray(sensor_timestamps, dtype=float)
        dts = np.diff(ts)
        dts = dts[dts > 0]
        if dts.size:
            mean_dt_s = float(np.mean(dts)) / 1000.0  # timestamps are epoch-ms
            if mean_dt_s > 0:
                rate = 1.0 / mean_dt_s

    # Nyquist guard: if the rate cannot resolve the tremor band, stay NEUTRAL
    # rather than reporting a spurious ratio.
    if rate < 2 * TREMOR_HIGH_HZ:
        return {
            "is_human": None,
            "tremor_ratio": 0.0,
            "confidence": 0.0,
            "reason": "SUBNYQUIST_RATE",
            "sampling_rate_hz": round(rate, 2),
        }

    fft_vals = np.abs(np.fft.rfft(signal))
    freqs = np.fft.rfftfreq(n, d=1.0 / rate)

    band = (freqs >= TREMOR_LOW_HZ) & (freqs <= TREMOR_HIGH_HZ)
    tremor_energy = float(np.sum(fft_vals[band]))
    total_energy = float(np.sum(fft_vals)) + 1e-8
    ratio = tremor_energy / total_energy

    is_human = HUMAN_RATIO_MIN <= ratio <= HUMAN_RATIO_MAX
    return {
        "is_human": bool(is_human),
        "tremor_ratio": round(ratio, 4),
        "confidence": 0.9 if is_human else 0.2,
        "reason": "HUMAN_TREMOR_BAND" if is_human else "OUT_OF_HUMAN_BAND",
        "sampling_rate_hz": round(rate, 2),
    }


# ── A. Replay resistance ───────────────────────────────────────────────────────

def bundle_hash(bundle: dict) -> str:
    """Deterministic SHA-256 over a telemetry bundle (stable key ordering)."""
    import json
    canonical = json.dumps(bundle, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def expected_signature(session_key: str, nonce: str, bundle_digest: str) -> str:
    """HMAC-SHA256(session_key, nonce || bundle_digest) — the value the client
    must send back. Kept as a standalone pure function so both the client-sim in
    tests and the server verifier compute it identically."""
    msg = f"{nonce}|{bundle_digest}".encode()
    return hmac.new(session_key.encode(), msg, hashlib.sha256).hexdigest()


def validate_telemetry_signature(
    session_key: str,
    nonce: str,
    bundle_digest: str,
    client_signature: str,
) -> bool:
    """Constant-time check that the client signed this exact nonce+bundle."""
    expected = expected_signature(session_key, nonce, bundle_digest)
    return hmac.compare_digest(expected, client_signature or "")
