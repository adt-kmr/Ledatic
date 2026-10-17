"""
Balabit mouse-dynamics loader for the CNN-LSTM session model (Pipeline B).

Raw: ml/data/balabit_mouse/
  training_files/userN/session_*   — legitimate sessions (label 0)
  test_files/userN/session_*       — evaluated against public_labels.csv
  public_labels.csv                — filename,is_illegal (411 legit / 405 illegal)

Session CSV columns: record timestamp, client timestamp, button, state, x, y

We slice each session into fixed-length windows and derive a 4-dim per-step
vector matching feature_engine.build_mouse_sequence:
  [x_norm, y_norm, velocity_norm, is_click]

Output mouse_subset.npz:
  windows     : (N, WIN, 4) float32
  labels      : (N,)  int8   (0 legit / 1 illegal)
  session_ids : (N,)  int32  (group id → use GroupKFold so windows of one
                              session never straddle train/test)

Run:  python ml/src/datasets/mouse.py
"""
from __future__ import annotations

import csv
import logging
from pathlib import Path

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("mouse")

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
ROOT = DATA_DIR / "balabit_mouse"
OUT = DATA_DIR / "mouse_subset.npz"

WIN = 64
STRIDE = 32
MAX_WINDOWS_PER_SESSION = 40   # cap so big sessions don't dominate
SCREEN = 1920.0                # normalisation constant for x/y


def _read_session(path: Path) -> np.ndarray | None:
    """Return (n, 3) array of [client_t, x, y] + click flag as (n,4): [t,x,y,click]."""
    rows = []
    with open(path, newline="") as f:
        r = csv.reader(f)
        next(r, None)
        for row in r:
            if len(row) < 6:
                continue
            try:
                t = float(row[1]); x = float(row[4]); y = float(row[5])
            except ValueError:
                continue
            click = 1.0 if row[3] in ("Pressed", "Down") else 0.0
            rows.append((t, x, y, click))
    return np.array(rows, dtype=np.float64) if len(rows) >= WIN else None


def _windows(raw: np.ndarray) -> np.ndarray:
    """raw (n,4)=[t,x,y,click] → (w, WIN, 4)=[x_norm,y_norm,vel_norm,click]."""
    t, x, y, click = raw[:, 0], raw[:, 1], raw[:, 2], raw[:, 3]
    dt = np.diff(t, prepend=t[0]); dt[dt <= 0] = 1e-3
    vel = np.sqrt(np.diff(x, prepend=x[0]) ** 2 + np.diff(y, prepend=y[0]) ** 2) / dt
    feat = np.stack([
        np.clip(x / SCREEN, 0, 1),
        np.clip(y / SCREEN, 0, 1),
        np.clip(vel / 5.0, 0, 1),
        click,
    ], axis=1).astype(np.float32)

    out = []
    for start in range(0, len(feat) - WIN + 1, STRIDE):
        out.append(feat[start:start + WIN])
        if len(out) >= MAX_WINDOWS_PER_SESSION:
            break
    return np.stack(out) if out else np.empty((0, WIN, 4), np.float32)


def build() -> None:
    labels_map: dict[str, int] = {}
    with open(ROOT / "public_labels.csv") as f:
        for row in csv.DictReader(f):
            labels_map[row["filename"]] = int(row["is_illegal"])

    windows, labels, sess_ids = [], [], []
    sid = 0

    def add(path: Path, label: int):
        nonlocal sid
        raw = _read_session(path)
        if raw is None:
            return
        w = _windows(raw)
        if len(w):
            windows.append(w)
            labels.append(np.full(len(w), label, dtype=np.int8))
            sess_ids.append(np.full(len(w), sid, dtype=np.int32))
            sid += 1

    # training_files = all legitimate
    for sess in sorted(ROOT.glob("training_files/*/session_*")):
        add(sess, 0)
    # test_files = labelled by public_labels
    n_lab = 0
    for sess in sorted(ROOT.glob("test_files/*/session_*")):
        if sess.name in labels_map:
            add(sess, labels_map[sess.name]); n_lab += 1

    W = np.concatenate(windows); L = np.concatenate(labels); G = np.concatenate(sess_ids)
    np.savez_compressed(OUT, windows=W, labels=L, session_ids=G)
    logger.info("Saved %s — %d windows from %d sessions (%d labelled test), %.1f MB | legit %d / illegal %d",
                OUT.name, len(W), sid, n_lab, OUT.stat().st_size / 1e6,
                int((L == 0).sum()), int((L == 1).sum()))


if __name__ == "__main__":
    build()
