"""
Keystroke subset loader for BehaveFormer + Siamese training (Pipeline A).

Loads the compact `keystroke_subset.npz` produced by build_keystroke_subset.py
and provides the data plumbing the Colab notebook needs:

  - load_subset()        : sequences / lengths / user_ids
  - open_set_split()     : disjoint train/val/test USER indices (honest EER)
  - sample_triplets()    : (anchor, positive, negative) batches for triplet loss
  - enrollment_pairs()   : 3-shot gallery vs probe genuine/impostor pairs for eval

Open-set is critical: test users are NEVER seen in training, so the reported
EER reflects generalisation to new people — the honest biometric protocol.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
SUBSET = DATA_DIR / "keystroke_subset.npz"
ENROLL_SHOTS = 3  # mirrors the product's 3-shot enrollment


def load_subset(path: Path | None = None) -> dict[str, np.ndarray]:
    """Returns sequences (U,S,L,6), lengths (U,S), user_ids (U,)."""
    npz = np.load(path or SUBSET)
    return {"sequences": npz["sequences"], "lengths": npz["lengths"], "user_ids": npz["user_ids"]}


def open_set_split(
    n_users: int, train_frac: float = 0.70, val_frac: float = 0.15, seed: int = 42
) -> dict[str, np.ndarray]:
    """Disjoint user-index splits. Test users never appear in train/val."""
    rng = np.random.default_rng(seed)
    perm = rng.permutation(n_users)
    n_tr = int(n_users * train_frac)
    n_va = int(n_users * (train_frac + val_frac))
    return {"train": perm[:n_tr], "val": perm[n_tr:n_va], "test": perm[n_va:]}


def sample_triplets(
    sequences: np.ndarray, user_idx: np.ndarray, batch: int = 128, seed: int = 0
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Build a triplet batch from the given users.
    anchor & positive = two different sessions of the same user;
    negative = a session from a different user.
    Returns three (batch, L, 6) arrays.
    """
    rng = np.random.default_rng(seed)
    S = sequences.shape[1]
    a, p, n = [], [], []
    for _ in range(batch):
        u = rng.choice(user_idx)
        s1, s2 = rng.choice(S, size=2, replace=False)
        v = rng.choice(user_idx[user_idx != u])
        sn = rng.integers(S)
        a.append(sequences[u, s1]); p.append(sequences[u, s2]); n.append(sequences[v, sn])
    return np.stack(a), np.stack(p), np.stack(n)


def enrollment_pairs(
    embeddings: np.ndarray, user_idx: np.ndarray, n_impostor: int = 5, seed: int = 0
) -> tuple[np.ndarray, np.ndarray]:
    """
    Build genuine + impostor similarity-evaluation pairs from per-session
    embeddings, using the 3-shot enrollment protocol.

    embeddings : (U, S, D) BehaveFormer/Siamese embeddings for these users.
    For each user: first ENROLL_SHOTS sessions = gallery (mean = passport),
    remaining sessions = probes.
      - genuine pair  : (passport, own probe)        → label 0 (same person)
      - impostor pair : (passport, other-user probe) → label 1 (different)

    Returns (scores_index, labels) — actually returns the cosine scores and
    labels ready for eval.metrics.eer().
    """
    rng = np.random.default_rng(seed)
    scores, labels = [], []
    galleries = {int(u): embeddings[u, :ENROLL_SHOTS].mean(0) for u in user_idx}
    for u in galleries:
        g = galleries[u]
        g = g / (np.linalg.norm(g) + 1e-8)
        # genuine: own probes
        for s in range(ENROLL_SHOTS, embeddings.shape[1]):
            pr = embeddings[u, s]; pr = pr / (np.linalg.norm(pr) + 1e-8)
            scores.append(float(g @ pr)); labels.append(0)
        # impostor: other users' probes
        others = rng.choice([v for v in galleries if v != u], size=n_impostor, replace=False)
        for v in others:
            s = rng.integers(ENROLL_SHOTS, embeddings.shape[1])
            pr = embeddings[v, s]; pr = pr / (np.linalg.norm(pr) + 1e-8)
            scores.append(float(g @ pr)); labels.append(1)
    # higher score = more similar = more genuine; EER expects higher=positive(impostor),
    # so return NEGATIVE cosine as the impostor score.
    return -np.array(scores, dtype=np.float32), np.array(labels, dtype=np.int32)
