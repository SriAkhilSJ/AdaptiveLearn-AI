"""Loading, balancing and splitting the landmark table.

The public ISL dataset is heavily skewed (661 samples of "Z" vs 143 of "2"), so
every training run goes through :func:`load_samples`, which caps the large
classes and floors the small ones. Training on the raw distribution makes the
model lazily predict common letters and looks great on paper while failing on
stage.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

import numpy as np

from .config import (
    AUGMENT_PER_SAMPLE,
    LANDMARK_TABLE,
    MIN_SAMPLES_PER_CLASS,
    RANDOM_STATE,
    TEST_SIZE,
    VAL_SIZE,
)
from .features import FEATURE_DIM, augment_vector


@dataclass
class Split:
    """Train / validation / test partitions plus the class vocabulary."""

    X_train: np.ndarray
    y_train: np.ndarray
    X_val: np.ndarray
    y_val: np.ndarray
    X_test: np.ndarray
    y_test: np.ndarray
    classes: List[str]

    @property
    def class_to_index(self) -> Dict[str, int]:
        return {c: i for i, c in enumerate(self.classes)}


def load_samples(path: str | None = None) -> Tuple[np.ndarray, np.ndarray]:
    """Read the ``landmarks.npz`` table produced by ``scripts/01_extract_landmarks.py``."""
    from pathlib import Path

    table = Path(path) if path else LANDMARK_TABLE
    if not table.exists():
        raise FileNotFoundError(
            f"{table} not found. Run: python scripts/01_extract_landmarks.py"
        )
    with np.load(table, allow_pickle=False) as data:
        X = np.asarray(data["X"], dtype=np.float32)
        y = np.asarray(data["y"]).astype(str)
    if X.ndim != 2 or X.shape[1] != FEATURE_DIM:
        raise ValueError(f"{table} has feature width {X.shape[1] if X.ndim == 2 else '?'}; expected {FEATURE_DIM}")
    return X, y


def balance(
    X: np.ndarray,
    y: np.ndarray,
    max_per_class: int = 400,
    min_per_class: int = MIN_SAMPLES_PER_CLASS,
    rng: np.random.Generator | None = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """Cap over-represented classes; drop classes that cannot be learned at all."""
    rng = rng or np.random.default_rng(RANDOM_STATE)
    by_class: Dict[str, List[int]] = defaultdict(list)
    for i, label in enumerate(y):
        by_class[label].append(i)

    keep: List[int] = []
    dropped: List[str] = []
    for label in sorted(by_class):
        idx = by_class[label]
        if len(idx) < min_per_class:
            dropped.append(f"{label}({len(idx)})")
            continue
        if len(idx) > max_per_class:
            idx = list(rng.choice(idx, size=max_per_class, replace=False))
        keep.extend(idx)

    keep_arr = np.asarray(sorted(keep), dtype=int)
    if dropped:
        print(f"[info] dropped under-represented classes: {', '.join(dropped)}")
    return X[keep_arr], y[keep_arr]


def stratified_split(
    X: np.ndarray,
    y: np.ndarray,
    test_size: float = TEST_SIZE,
    val_size: float = VAL_SIZE,
    seed: int = RANDOM_STATE,
) -> Split:
    """Per-class train/val/test split so no class is missing from any partition.

    Deliberately hand-rolled instead of ``train_test_split``: we want the *same
    signer-independent guarantee* to be obvious in the code, and we want the
    class list to come out sorted and stable for the label encoder.
    """
    rng = np.random.default_rng(seed)
    by_class: Dict[str, List[int]] = defaultdict(list)
    for i, label in enumerate(y):
        by_class[label].append(i)

    classes = sorted(by_class)
    tr: List[int] = []
    va: List[int] = []
    te: List[int] = []
    for label in classes:
        idx = np.asarray(by_class[label], dtype=int)
        rng.shuffle(idx)
        n = len(idx)
        n_test = max(1, int(round(n * test_size)))
        n_val = max(1, int(round(n * val_size)))
        te.extend(idx[:n_test].tolist())
        va.extend(idx[n_test : n_test + n_val].tolist())
        tr.extend(idx[n_test + n_val :].tolist())

    def take(indices: Sequence[int]) -> Tuple[np.ndarray, np.ndarray]:
        arr = np.asarray(sorted(indices), dtype=int)
        return X[arr], y[arr]

    X_train, y_train = take(tr)
    X_val, y_val = take(va)
    X_test, y_test = take(te)
    return Split(X_train, y_train, X_val, y_val, X_test, y_test, classes)


def expand_augmented(
    X: np.ndarray,
    y: np.ndarray,
    per_sample: int = AUGMENT_PER_SAMPLE,
    seed: int = RANDOM_STATE,
) -> Tuple[np.ndarray, np.ndarray]:
    """Append ``per_sample`` landmark-space augmentations of every real sample."""
    rng = np.random.default_rng(seed + 1)
    Xs = [X]
    ys = [y]
    for _ in range(per_sample):
        aug = np.stack([augment_vector(v, rng) for v in X])
        Xs.append(aug)
        ys.append(y)
    Xa = np.concatenate(Xs, axis=0).astype(np.float32)
    ya = np.concatenate(ys, axis=0)
    return Xa, ya


def class_report(y_true: Sequence[str], y_pred: Sequence[str], classes: Sequence[str]) -> str:
    """Compact per-class precision/recall table for the training log."""
    truth = list(y_true)
    pred = list(y_pred)
    counts = Counter(truth)
    lines = [f"{'class':>6} {'n':>5} {'recall':>8} {'prec':>8}"]
    for c in classes:
        tp = sum(1 for t, p in zip(truth, pred) if t == c and p == c)
        fp = sum(1 for t, p in zip(truth, pred) if t != c and p == c)
        recall = tp / counts[c] if counts[c] else 0.0
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        lines.append(f"{c:>6} {counts[c]:>5} {recall:>8.3f} {prec:>8.3f}")
    return "\n".join(lines)
