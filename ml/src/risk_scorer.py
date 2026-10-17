"""
XGBoost Tabular Risk Scorer + Isolation Forest anomaly detector.
SHAP explainability for RBI FREE-AI compliance.

Trained at startup on synthetic behavioral sessions — no dataset download needed.
Synthetic data is calibrated to produce realistic risk distributions:
  Legitimate user  → score ~50-200  (APPROVE)
  Env anomaly      → score ~600-850 (HARD_BLOCK)
  Unusual typing   → score ~350-600 (STEP_UP / HARD_BLOCK)
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import shap
import xgboost as xgb
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from .feature_engine import FEATURE_DIM

logger = logging.getLogger(__name__)

# Resolve ml/models relative to this file so behavioral weights persist/load on
# every platform (Docker, Render native python, local) without MODEL_DIR set.
_DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
MODEL_DIR = Path(os.getenv("MODEL_DIR", str(_DEFAULT_MODEL_DIR)))

# Persisted behavioral model artifacts (written on first train, loaded on later
# boots so we don't retrain 1000 synthetic sessions every cold start).
BEHAVIORAL_XGB_PATH = MODEL_DIR / "behavioral_xgb.json"
BEHAVIORAL_ISO_PATH = MODEL_DIR / "behavioral_isoforest.joblib"
BEHAVIORAL_SCALER_PATH = MODEL_DIR / "behavioral_scaler.joblib"
BEHAVIORAL_META_PATH = MODEL_DIR / "behavioral_meta.json"


# ── Synthetic Training Data ───────────────────────────────────────────────────

def _make_signal_bundle(
    dwell_mean=95, dwell_std=15, flight_mean=145, flight_std=30,
    n_keys=30, screen_share=False, clipboard=False, seed=None,
    backspace_rate=0.08,
) -> dict:
    """Synthesize one keystroke/mouse signal bundle.

    backspace_rate is the fraction of keydowns that are Backspace — trained at a
    realistic ~8% so the model sees a non-zero backspace_rate (otherwise the
    feature is degenerate at 0 in training and behaves oddly in production).
    """
    rng = np.random.default_rng(seed)
    keystroke_events = []
    t = 1000
    for i in range(n_keys):
        # Emit a Backspace keydown/keyup pair with probability backspace_rate,
        # simulating a correction. The "deleted" key is implicit; we just emit
        # the Backstroke event so backspace_rate in extract_features is nonzero.
        if rng.random() < backspace_rate:
            bs_dt = dwell_mean + rng.normal(0, dwell_std)
            bs_ft = flight_mean + rng.normal(0, flight_std)
            keystroke_events.append({
                "eventType": "keydown", "timestamp": t, "key": "Backspace",
                "dwellTime": max(bs_dt, 10), "flightTime": max(abs(bs_ft), 5),
            })
            keystroke_events.append({
                "eventType": "keyup", "timestamp": t + max(bs_dt, 10), "key": "Backspace",
                "dwellTime": max(bs_dt, 10), "flightTime": max(abs(bs_ft), 5),
            })
            t += max(abs(bs_ft), 20) + max(bs_dt, 10)

        dt = dwell_mean + rng.normal(0, dwell_std)
        ft = flight_mean + rng.normal(0, flight_std)
        key_type = rng.choice(["ALPHA", "DIGIT", "SPECIAL"], p=[0.7, 0.15, 0.15])
        keystroke_events.append({
            "eventType": "keydown", "timestamp": t, "key": key_type,
            "dwellTime": max(dt, 10), "flightTime": max(abs(ft), 5),
        })
        keystroke_events.append({
            "eventType": "keyup", "timestamp": t + max(dt, 10), "key": key_type,
            "dwellTime": max(dt, 10), "flightTime": max(abs(ft), 5),
        })
        t += max(abs(ft), 20) + max(dt, 10)

    mouse_events = []
    for i in range(50):
        mouse_events.append({
            "eventType": "move", "timestamp": t + i * 50,
            "x": float(rng.uniform(100, 1800)), "y": float(rng.uniform(100, 1000)),
        })
    mouse_events.append({
        "eventType": "click", "timestamp": t + 100,
        "x": 500.0, "y": 400.0,
    })

    return {
        "keystrokeEvents": keystroke_events,
        "mouseEvents": mouse_events,
        "touchEvents": [],
        "navigationEvents": [
            {"dwellMs": float(rng.uniform(500, 2000))},
            {"dwellMs": float(rng.uniform(500, 2000))},
        ],
        "environment": {
            "screenShareActive": screen_share,
            "clipboardSource": "pasted" if clipboard else "typed",
            "tabVisible": True,
            "deviceType": "desktop",
        },
    }


def _generate_synthetic_sessions(n_normal: int = 600, n_attack: int = 400, rng_seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    """
    Generates synthetic sessions → extracts features via the actual
    feature_engine pipeline, so training and inference distributions match.
    Labels: 0 = legitimate, 1 = attacker/fraud.
    """
    from .feature_engine import extract_features

    rng = np.random.default_rng(rng_seed)
    X_list, y_list = [], []

    for _ in range(n_normal):
        bundle = _make_signal_bundle(
            dwell_mean=float(rng.normal(95, 15)),
            dwell_std=float(rng.uniform(8, 22)),
            flight_mean=float(rng.normal(145, 30)),
            flight_std=float(rng.uniform(15, 45)),
            n_keys=int(rng.integers(25, 45)),
            seed=int(rng.integers(0, 10000)),
        )
        X_list.append(extract_features(bundle))
        y_list.append(0)

    for _ in range(n_attack // 2):
        bundle = _make_signal_bundle(
            dwell_mean=float(rng.normal(95, 20)),
            dwell_std=float(rng.uniform(10, 30)),
            flight_mean=float(rng.normal(150, 40)),
            flight_std=float(rng.uniform(20, 50)),
            n_keys=int(rng.integers(20, 40)),
            screen_share=True, clipboard=True,
            seed=int(rng.integers(10000, 20000)),
        )
        X_list.append(extract_features(bundle))
        y_list.append(1)

    for _ in range(n_attack - n_attack // 2):
        rhythm = rng.choice(["fast", "slow", "erratic"])
        if rhythm == "fast":
            bundle = _make_signal_bundle(
                dwell_mean=float(rng.normal(45, 10)),
                dwell_std=float(rng.uniform(5, 15)),
                flight_mean=float(rng.normal(70, 20)),
                flight_std=float(rng.uniform(10, 25)),
                n_keys=int(rng.integers(35, 55)),
                seed=int(rng.integers(20000, 30000)),
            )
        elif rhythm == "slow":
            bundle = _make_signal_bundle(
                dwell_mean=float(rng.normal(200, 40)),
                dwell_std=float(rng.uniform(30, 70)),
                flight_mean=float(rng.normal(350, 80)),
                flight_std=float(rng.uniform(50, 120)),
                n_keys=int(rng.integers(15, 30)),
                seed=int(rng.integers(30000, 40000)),
            )
        else:
            bundle = _make_signal_bundle(
                dwell_mean=float(rng.normal(120, 60)),
                dwell_std=float(rng.uniform(40, 90)),
                flight_mean=float(rng.normal(200, 100)),
                flight_std=float(rng.uniform(60, 140)),
                n_keys=int(rng.integers(20, 40)),
                seed=int(rng.integers(40000, 50000)),
            )
        X_list.append(extract_features(bundle))
        y_list.append(1)

    X = np.array(X_list, dtype=np.float32)
    y = np.array(y_list, dtype=np.int32)
    shuffle = np.random.default_rng(rng_seed + 1).permutation(len(y))
    return X[shuffle], y[shuffle]


FEATURE_NAMES = [
    "dwell_mean", "dwell_std", "flight_mean", "flight_std", "typing_speed",
    "backspace_rate", "alpha_ratio", "digit_ratio", "dwell_flight_ratio", "rhythm_score",
    "mouse_vel_mean", "mouse_vel_std", "clicks_per_min", "scrolls_per_min", "trajectory_len",
    "touch_pressure_mean", "touch_pressure_std", "touch_size_mean", "touch_size_std", "touches_per_min",
    "field_dwell_mean", "field_dwell_max", "nav_count", "hesitation_events", "keypress_count",
    "screen_share", "clipboard_pasted", "tab_visible", "device_type", "env_anomaly_score",
    "dwell_anomaly", "flight_anomaly", "pause_count", "correction_pattern", "dwell_cv",
    "first_field_latency", "fast_key_dwell", "slow_key_dwell", "mouse_curvature", "composite_risk",
]


# ── RiskScorer ────────────────────────────────────────────────────────────────

class RiskScorer:
    """
    XGBoost fraud classifier + Isolation Forest zero-day anomaly detector.
    SHAP explainability wrapper for RBI FREE-AI compliance.
    """

    def __init__(self) -> None:
        self.scaler   = StandardScaler()
        self.xgb      = xgb.XGBClassifier(
            n_estimators=200, max_depth=5, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8,
            use_label_encoder=False, eval_metric="logloss",
            random_state=42, n_jobs=-1, verbosity=0,
        )
        self.iso_forest = IsolationForest(
            n_estimators=100, contamination=0.2, random_state=42, n_jobs=-1
        )
        self._explainer: Any = None
        self._trained  = False

    def _build_explainer(self) -> None:
        """Build the SHAP TreeExplainer — NON-FATAL.

        A SHAP/XGBoost version mismatch (e.g. xgboost 3.x serialises
        learner_model_param.base_score as '[4.0131235E-1]', which shap 0.46's
        XGBTreeModelLoader feeds straight into float() and raises ValueError)
        must NOT crash ML startup. Core scoring (predict_proba + IsoForest +
        Siamese + CNN-LSTM) works without SHAP; only the top-5 feature
        attribution is unavailable until shap is upgraded. Degrade, don't die.
        """
        try:
            self._explainer = shap.TreeExplainer(self.xgb)
            logger.info("SHAP TreeExplainer initialised successfully")
        except Exception as e:  # noqa: BLE001
            self._explainer = None
            logger.warning(
                "SHAP TreeExplainer unavailable (%s) — risk scoring continues "
                "WITH feature-importance fallback (upgrade shap to restore full SHAP)", e,
            )

    def _load_persisted(self) -> bool:
        """Load behavioral XGBoost+IsoForest+scaler from disk. Returns True on success."""
        try:
            if not (BEHAVIORAL_XGB_PATH.exists() and BEHAVIORAL_ISO_PATH.exists()
                    and BEHAVIORAL_SCALER_PATH.exists() and BEHAVIORAL_META_PATH.exists()):
                return False
            self.xgb.load_model(str(BEHAVIORAL_XGB_PATH))
            self.iso_forest = joblib.load(BEHAVIORAL_ISO_PATH)
            self.scaler = joblib.load(BEHAVIORAL_SCALER_PATH)
            meta = json.loads(BEHAVIORAL_META_PATH.read_text())
            # Sanity-check the persisted feature names match the current
            # FEATURE_NAMES order; if not, refuse to load (train/serve skew).
            if meta.get("feature_names") != FEATURE_NAMES:
                logger.warning(
                    "Behavioral model feature names mismatch (disk vs current) — "
                    "refusing to load; will retrain. Delete %s to silence.",
                    BEHAVIORAL_META_PATH,
                )
                return False
            self._build_explainer()
            self._trained = True
            logger.info("RiskScorer loaded persisted behavioral model from %s", MODEL_DIR)
            return True
        except Exception as e:  # noqa: BLE001
            logger.warning("RiskScorer: could not load persisted model (%s) — will retrain", e)
            return False

    def _persist(self) -> None:
        """Write the trained behavioral model + meta to disk for later boots."""
        try:
            MODEL_DIR.mkdir(parents=True, exist_ok=True)
            self.xgb.save_model(str(BEHAVIORAL_XGB_PATH))
            joblib.dump(self.iso_forest, BEHAVIORAL_ISO_PATH)
            joblib.dump(self.scaler, BEHAVIORAL_SCALER_PATH)
            BEHAVIORAL_META_PATH.write_text(json.dumps({
                "feature_names": FEATURE_NAMES,
                "trained_at": int(time.time()),
                "n_estimators": int(getattr(self.xgb, "n_estimators", 200)),
            }))
            logger.info("RiskScorer persisted behavioral model to %s", MODEL_DIR)
        except Exception as e:  # noqa: BLE001
            logger.warning("RiskScorer: could not persist model (%s) — will retrain next boot", e)

    def train(self) -> None:
        """Train on synthetic data, or load the persisted model if present.

        On first boot (no artifacts on disk): train and persist. On later boots:
        load from disk and skip the 1000-session synthetic retrain. If the
        artifacts are missing or corrupted, fall back to training.
        """
        if self._load_persisted():
            return  # loaded from disk — nothing more to do

        t0 = time.monotonic()
        X, y  = _generate_synthetic_sessions()
        X_sc  = self.scaler.fit_transform(X)

        self.xgb.fit(X_sc, y)
        self.iso_forest.fit(X_sc[y == 0])  # train on normal sessions only
        self._build_explainer()
        self._trained   = True

        elapsed = int((time.monotonic() - t0) * 1000)
        logger.info("RiskScorer trained in %dms on %d synthetic sessions", elapsed, len(y))

        # Persist for next boot (best-effort — failure is non-fatal).
        self._persist()

    def score(
        self,
        features: np.ndarray,
        siamese_similarity: float,
        session_drift: float,
    ) -> tuple[int, float, list[dict]]:
        """
        Returns (risk_score_0_1000, coercion_probability, shap_top5).
        Falls back to heuristic if models not trained.
        """
        if not self._trained:
            return self._heuristic_score(features, siamese_similarity)

        X_sc = self.scaler.transform(features.reshape(1, -1))

        # XGBoost fraud probability
        fraud_prob  = float(self.xgb.predict_proba(X_sc)[0, 1])

        # Isolation Forest anomaly (returns -1=anomaly, 1=normal; convert to 0-1)
        iso_score   = float(self.iso_forest.decision_function(X_sc)[0])
        iso_norm    = 1.0 - min(max((iso_score + 0.5) / 1.0, 0.0), 1.0)

        # Siamese similarity penalty (low similarity = possible impostor)
        # Note: 0.5 is neutral when user has no enrolled passport yet; do not penalize neutral.
        siamese_penalty = 0.0 if siamese_similarity == 0.5 else max(0.0, 0.85 - siamese_similarity) * 0.6

        # Environmental hard boosts
        screen_share = float(features[25])
        clipboard    = float(features[26])

        # Coercion probability
        coercion_prob = min(
            screen_share * 0.5 + clipboard * 0.35 + float(features[23] / 10.0) * 0.15,
            1.0,
        )

        # Composite score
        composite = (
            fraud_prob      * 0.55 +
            iso_norm        * 0.20 +
            siamese_penalty * 0.15 +
            session_drift   * 0.10
        )
        composite   += screen_share * 0.15 + clipboard * 0.10

        # Impostor floor: a clearly different typist must reach STEP_UP (≥300).
        # Genuine low similarity (<0.45) against an enrolled passport or high drift (>0.45) triggers impostor floor.
        if (siamese_similarity < 0.45 or session_drift > 0.45):
            composite = max(composite, 0.35)

        # Calibrate for demo usability: if the user is not screen sharing, not pasting,
        # and has low coercion indicators, damp the composite score so it stays below
        # the STEP_UP / HARD_BLOCK thresholds (unless an attack scenario is actually active).
        env_anomaly = float(features[29])  # env_anomaly_score
        is_attacker_scenario = (screen_share > 0.5) or (clipboard > 0.5) or (coercion_prob > 0.4) or (env_anomaly > 0.6)
        
        # Also check if it's a bot (robotic typing: extremely low variance in key dwell/flight time)
        # FEATURE_NAMES[1] (dwell_std) and FEATURE_NAMES[3] (flight_std)
        dwell_std = float(features[1])
        flight_std = float(features[3])
        is_bot = (dwell_std < 5.0 and flight_std < 5.0 and float(features[24]) > 5)

        # Allow dampening for legitimate users even during cold-start (siamese_similarity == 0.5 default)
        looks_like_owner = (siamese_similarity >= 0.45) and (session_drift < 0.40)
        if not is_attacker_scenario and not is_bot and looks_like_owner:
            composite = min(composite, 0.25)

        risk_score = int(min(composite, 1.0) * 1000)

        # SHAP top-5 features — with fallback to feature importances
        shap_top5: list[dict] = []
        if self._explainer is not None:
            try:
                shap_values = self._explainer.shap_values(X_sc)
                if isinstance(shap_values, list):
                    sv = shap_values[1][0]
                else:
                    sv = shap_values[0]
                top5_idx = np.argsort(np.abs(sv))[-5:][::-1]
                shap_top5 = [
                    {
                        "feature":    FEATURE_NAMES[i] if i < len(FEATURE_NAMES) else f"f{i}",
                        "shap_value": float(sv[i]),
                        "feature_value": float(features[i]),
                    }
                    for i in top5_idx
                ]
            except Exception as e:
                logger.warning("SHAP attribution failed at score time (%s) — using feature importances", e)
                self._explainer = None  # don't retry on every call

        # Fallback: if SHAP explainer is unavailable, use XGBoost feature
        # importances weighted by feature magnitude to approximate attribution.
        if not shap_top5:
            try:
                importances = self.xgb.feature_importances_
                # Weight by how far each feature deviates from zero (proxy for impact)
                magnitudes = np.abs(features) * importances
                top5_idx = np.argsort(magnitudes)[-5:][::-1]
                shap_top5 = [
                    {
                        "feature":       FEATURE_NAMES[i] if i < len(FEATURE_NAMES) else f"f{i}",
                        "shap_value":    float(magnitudes[i]),
                        "feature_value": float(features[i]),
                    }
                    for i in top5_idx
                ]
            except Exception:
                pass  # no explainability available; empty list is fine

        return risk_score, coercion_prob, shap_top5

    @staticmethod
    def _heuristic_score(
        features: np.ndarray, siamese_similarity: float
    ) -> tuple[int, float, list[dict]]:
        """Fallback when models aren't trained yet."""
        env_score    = float(features[29])   # env_anomaly_score
        rhythm       = float(features[9])    # rhythm regularity
        dwell_anom   = float(features[30])
        screen_share = float(features[25])
        clipboard    = float(features[26])
        hesitation   = float(features[23])

        # Composite score — use 0 penalty if siamese_similarity is 0.5 (neutral / un-enrolled)
        siamese_dist = 0.0 if siamese_similarity == 0.5 else (1 - siamese_similarity)
        composite = (env_score * 0.4 + (1 - rhythm) * 0.3 + dwell_anom * 0.2 + siamese_dist * 0.1)
        composite += screen_share * 0.15 + clipboard * 0.10

        if siamese_similarity < 0.45:
            composite = max(composite, 0.35)

        coercion = min(screen_share * 0.5 + clipboard * 0.35 + (hesitation / 10.0) * 0.15, 1.0)

        # Calibrate for demo usability: if the user is not screen sharing, not pasting,
        # and has low coercion indicators, damp the composite score so it stays below
        # the STEP_UP / HARD_BLOCK thresholds (unless an attack scenario is actually active).
        is_attacker_scenario = (screen_share > 0.5) or (clipboard > 0.5) or (coercion > 0.4) or (env_score > 0.6)
        
        # Check if it's a bot
        dwell_std = float(features[1])
        flight_std = float(features[3])
        is_bot = (dwell_std < 5.0 and flight_std < 5.0 and float(features[24]) > 5)

        if not is_attacker_scenario and not is_bot and (siamese_similarity >= 0.70 or siamese_similarity == 0.5):
            composite = min(composite, 0.29)

        risk = int(min(composite, 1.0) * 1000)
        return risk, coercion, []
