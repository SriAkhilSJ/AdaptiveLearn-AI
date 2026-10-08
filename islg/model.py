"""Gesture classifier: training, calibration, persistence and export.

Model choice matters for PS-AIML-04 because the system has to run *offline* on
counter hardware. A gradient-boosted / random-forest ensemble over 96 handcrafted
landmark features:

* trains in seconds on a laptop CPU (no GPU, no framework download),
* serialises to a few MB with ``joblib`` -- easy to copy onto an edge box,
* gives well-behaved probabilities once calibrated, which the temporal smoother
  needs in order to refuse a shaky sign instead of guessing,
* and exports to plain JSON so the same decision surface can run in the browser.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Sequence

import joblib
import numpy as np

import os

from .config import MODEL_PATH, RANDOM_STATE

# Forest hyper-parameters are module-level so `scripts/02_train.py` and the
# memory-constrained edge build can both reason about them.
N_ESTIMATORS = int(os.environ.get("ISLG_TREES", 150))
MIN_SAMPLES_LEAF = int(os.environ.get("ISLG_MIN_LEAF", 10))
PCA_COMPONENTS = int(os.environ.get("ISLG_PCA", 50))
# Cost-complexity pruning; measured on the ISL table, 0.0 keeps the most accuracy.
CCP_ALPHA = float(os.environ.get("ISLG_CCP", 0.0))
N_JOBS = int(os.environ.get("ISLG_JOBS", max(1, (os.cpu_count() or 2))))


@dataclass
class GestureModel:
    """Everything inference needs: the estimator, the label map, and metadata."""

    pipeline: object
    classes: List[str]
    feature_dim: int
    accuracy: float
    top1_margin: float = 0.0

    # ------------------------------------------------------------------ #
    def predict(self, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Return ``(labels, probabilities)`` for a batch or a single vector."""
        X = np.atleast_2d(np.asarray(X, dtype=np.float32))
        if X.shape[1] != self.feature_dim:
            raise ValueError(f"expected {self.feature_dim} features, got {X.shape[1]}")
        proba = self.pipeline.predict_proba(X)
        idx = np.argmax(proba, axis=1)
        return np.asarray(self.classes)[idx], proba[np.arange(len(idx)), idx]

    def predict_one(self, vector: np.ndarray) -> tuple[str, float, Dict[str, float]]:
        """Single-vector convenience wrapper used by the live inference loop."""
        labels, probs = self.predict(vector.reshape(1, -1))
        proba = self.pipeline.predict_proba(vector.reshape(1, -1))[0]
        top3 = np.argsort(-proba)[:3]
        return str(labels[0]), float(probs[0]), {str(self.classes[i]): float(proba[i]) for i in top3}

    # ------------------------------------------------------------------ #
    def save(self, path: str | Path = MODEL_PATH) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                "classes": self.classes,
                "feature_dim": self.feature_dim,
                "accuracy": self.accuracy,
                "top1_margin": self.top1_margin,
                "pipeline": self.pipeline,
            },
            path,
            compress=9,
        )
        return path

    @classmethod
    def load(cls, path: str | Path = MODEL_PATH) -> "GestureModel":
        blob = joblib.load(Path(path))
        return cls(
            pipeline=blob["pipeline"],
            classes=list(blob["classes"]),
            feature_dim=int(blob["feature_dim"]),
            accuracy=float(blob.get("accuracy", 0.0)),
            top1_margin=float(blob.get("top1_margin", 0.0)),
        )

    # ------------------------------------------------------------------ #
    def export_js(self, path: str | Path) -> Path:
        """Serialise the decision trees to JSON so the browser can classify locally.

        The browser path removes even the local Python server from the demo:
        camera -> MediaPipe (in-page) -> this JSON model -> speech, all on-device.
        Only ``RandomForestClassifier`` / ``ExtraTreesClassifier`` are exportable.
        """
        estimator = self.pipeline
        steps = dict(getattr(estimator, "steps", None) or [])
        clf = steps.get("clf", estimator)
        tree = getattr(clf, "estimators_", None)
        if tree is None:
            raise TypeError("export_js supports forest estimators only")

        def dump_tree(t: object) -> Dict[str, object]:
            """Columnar, leaf-only encoding of one sklearn tree.

            Storing ``tree_.value`` (a 36-float distribution per node) is what made
            the naive export 146 MB. A forest only needs, per node, the split
            feature, its threshold and the two children -- plus the winning class
            on leaves -- so we store five flat arrays and skip every internal-node
            distribution. Majority vote over trees reproduces ``predict_proba``'s
            argmax to within a fraction of a percent (checked by
            ``tests/test_js_export.py``) at roughly 1/20th the file size.
            """
            tr = t.tree_  # type: ignore[attr-defined]
            leaf = tr.children_left == -1
            return {
                "f": tr.feature.tolist(),
                "t": np.round(tr.threshold.astype(np.float64), 5).tolist(),
                "l": tr.children_left.tolist(),
                "r": tr.children_right.tolist(),
                # class index on leaves, -1 on internal nodes
                "c": [int(np.argmax(v)) if is_leaf else -1 for v, is_leaf in zip(tr.value.reshape(tr.node_count, -1), leaf)],
            }

        # The forest splits on *PCA* dimensions, so the browser needs the same
        # scaler + PCA matrices or its predictions will not match Python's.
        scaler, pca = steps.get("scaler"), steps.get("pca")

        payload = {
            "format": "islg-rf-1",
            "classes": list(self.classes),
            "feature_dim": self.feature_dim,
            "accuracy": self.accuracy,
            "n_estimators": len(tree),
            "vote": "majority",
            "scaler": (
                None
                if scaler is None
                else {
                    "mean": np.round(np.asarray(scaler.mean_, dtype=np.float64), 7).tolist(),
                    "scale": np.round(np.asarray(scaler.scale_, dtype=np.float64), 7).tolist(),
                }
            ),
            "pca": (
                None
                if pca is None
                else {
                    "mean": np.round(np.asarray(pca.mean_, dtype=np.float64), 7).tolist(),
                    # Row i of `components` is the i-th principal axis.
                    "components": np.round(np.asarray(pca.components_, dtype=np.float64), 7).tolist(),
                }
            ),
            "trees": [dump_tree(t) for t in tree],
        }
        out = Path(path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, separators=(",", ":")))
        return out


def build_estimator(random_state: int = RANDOM_STATE) -> object:
    """Construct the training pipeline: scale -> PCA-trim -> random forest.

    PCA to 60 components removes the redundant, highly-correlated coordinate
    dimensions (21 landmarks x 3 axes of one rigid hand) which measurably speeds
    up the forest and slightly improves cross-signer generalisation.
    """
    from sklearn.decomposition import PCA
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    return Pipeline(
        [
            ("scaler", StandardScaler()),
            ("pca", PCA(n_components=PCA_COMPONENTS, random_state=random_state)),
            (
                "clf",
                RandomForestClassifier(
                    n_estimators=N_ESTIMATORS,
                    max_depth=None,
                    # A leaf must contain several samples: this is what stops the
                    # forest from memorising the augmented set (and keeps it small
                    # enough to run on a counter PC with a few hundred MB of RAM).
                    min_samples_leaf=MIN_SAMPLES_LEAF,
                    ccp_alpha=CCP_ALPHA,
                    max_features="sqrt",
                    # Each tree sees 80% of the rows -> smaller trees, better
                    # ensemble diversity, and roughly half the memory.
                    max_samples=0.8,
                    class_weight="balanced_subsample",
                    n_jobs=N_JOBS,
                    random_state=random_state,
                ),
            ),
        ]
    )


def top1_margin(proba: np.ndarray) -> float:
    """Mean gap between the best and second-best class -- a confidence health metric."""
    if proba.ndim == 1:
        proba = proba.reshape(1, -1)
    top2 = np.sort(proba, axis=1)[:, -2:]
    return float(np.mean(top2[:, 1] - top2[:, 0]))


def confusion_pairs(y_true: Sequence[str], y_pred: Sequence[str], k: int = 8) -> List[tuple[str, str, int]]:
    """Most common (true -> predicted) confusions, for the README's honest-limits table."""
    counts: Dict[tuple[str, str], int] = {}
    for t, p in zip(y_true, y_pred):
        if t != p:
            counts[(str(t), str(p))] = counts.get((str(t), str(p)), 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])[:k]
    return [(a, b, n) for (a, b), n in ranked]
