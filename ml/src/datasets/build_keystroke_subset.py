"""
Carve a small, quality-filtered keystroke subset from the 18GB Aalto 136M
dataset → a single compact `keystroke_subset.npz` (~200-400MB) that we
actually train on. The 18GB raw stays untouched on disk.

Raw format (ml/data/Keystrokes/files/{user}_keystrokes.txt, tab-separated):
  PARTICIPANT_ID  TEST_SECTION_ID  SENTENCE  USER_INPUT  KEYSTROKE_ID
  PRESS_TIME  RELEASE_TIME  LETTER  KEYCODE          (times in ms)

For each kept session we build a (MAX_LEN, 6) sequence matching
feature_engine.build_keystroke_sequence so training and inference agree:
  [dwell, flight, key_type, position, interval, cum_time]   (all normalised)

Quality filters (drop noisy data so the model learns real rhythm):
  - user must have >= SESSIONS_PER_USER valid sessions
  - session must have >= MIN_KEYS keystrokes
  - session dropped if most dwell times are non-positive or implausible

Output npz:
  sequences : (N_users, SESSIONS_PER_USER, MAX_LEN, 6) float32
  lengths   : (N_users, SESSIONS_PER_USER) int16   (real key count, pre-pad)
  user_ids  : (N_users,) int64

Run:  python ml/src/datasets/build_keystroke_subset.py [--users 10000]
"""
from __future__ import annotations

import argparse
import logging
import random
import time
from pathlib import Path

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("build_keystroke_subset")

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
RAW_DIR = DATA_DIR / "Keystrokes" / "files"
OUT = DATA_DIR / "keystroke_subset.npz"

SESSIONS_PER_USER = 15
MAX_LEN = 48
MIN_KEYS = 20
SEED = 42


def _key_type(letter: str) -> float:
    if len(letter) == 1 and letter.isalpha():
        return 0.0
    if len(letter) == 1 and letter.isdigit():
        return 0.33
    return 0.67


def _parse_user(path: Path) -> dict[int, list[tuple[int, int, str]]]:
    """Return {session_id: [(press, release, letter), ...]} for one user file."""
    sessions: dict[int, list[tuple[int, int, str]]] = {}
    with open(path, encoding="utf-8", errors="ignore") as f:
        next(f, None)  # header
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 9:
                continue
            try:
                sess = int(parts[1])
                press = int(parts[5])
                release = int(parts[6])
            except ValueError:
                continue
            sessions.setdefault(sess, []).append((press, release, parts[7]))
    return sessions


def _build_sequence(events: list[tuple[int, int, str]]) -> np.ndarray | None:
    """events sorted by press time → (n, 6) normalised array, or None if bad."""
    events = sorted(events, key=lambda e: e[0])
    presses = np.array([e[0] for e in events], dtype=np.float64)
    releases = np.array([e[1] for e in events], dtype=np.float64)
    dwell = releases - presses

    # quality: most dwell times must be sane (0 < d < 5000 ms)
    sane = (dwell > 0) & (dwell < 5000)
    if sane.mean() < 0.6:
        return None

    n = len(events)
    seq = np.zeros((n, 6), dtype=np.float32)
    total = (presses[-1] - presses[0]) + 1e-3
    for i, (p, r, letter) in enumerate(events):
        seq[i, 0] = min(max(r - p, 0) / 500.0, 1.0)                 # dwell
        if i > 0:
            seq[i, 1] = min(max(p - releases[i - 1], -500) / 500.0, 1.0)  # flight
            seq[i, 4] = min((p - presses[i - 1]) / 1000.0, 1.0)    # interval
        seq[i, 2] = _key_type(letter)                              # key type
        seq[i, 3] = i / n                                          # position
        seq[i, 5] = (p - presses[0]) / total                      # cum time
    return seq


def _pad(seq: np.ndarray) -> np.ndarray:
    out = np.zeros((MAX_LEN, 6), dtype=np.float32)
    n = min(len(seq), MAX_LEN)
    out[:n] = seq[:n]
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--users", type=int, default=10000)
    args = ap.parse_args()

    t0 = time.monotonic()
    all_files = sorted(RAW_DIR.glob("*_keystrokes.txt"))
    logger.info("Found %d raw user files; targeting %d quality users", len(all_files), args.users)
    random.Random(SEED).shuffle(all_files)

    seqs, lens, uids = [], [], []
    scanned = 0
    for path in all_files:
        if len(uids) >= args.users:
            break
        scanned += 1
        try:
            sessions = _parse_user(path)
        except Exception:
            continue

        good = []
        for sess_id, events in sessions.items():
            if len(events) < MIN_KEYS:
                continue
            s = _build_sequence(events)
            if s is not None:
                good.append((len(s), _pad(s)))
            if len(good) >= SESSIONS_PER_USER:
                break

        if len(good) < SESSIONS_PER_USER:
            continue

        good = good[:SESSIONS_PER_USER]
        seqs.append(np.stack([g[1] for g in good]))
        lens.append([min(g[0], MAX_LEN) for g in good])
        uids.append(int(path.stem.split("_")[0]))

        if len(uids) % 1000 == 0:
            logger.info("kept %d / scanned %d users (%.0fs)", len(uids), scanned, time.monotonic() - t0)

    sequences = np.stack(seqs).astype(np.float32)
    lengths = np.array(lens, dtype=np.int16)
    user_ids = np.array(uids, dtype=np.int64)

    np.savez_compressed(OUT, sequences=sequences, lengths=lengths, user_ids=user_ids)
    size_mb = OUT.stat().st_size / 1e6
    logger.info("Saved %s — %d users x %d sessions x %d keys, %.1f MB (scanned %d, %.0fs)",
                OUT.name, *sequences.shape[:2], MAX_LEN, size_mb, scanned, time.monotonic() - t0)


if __name__ == "__main__":
    main()
