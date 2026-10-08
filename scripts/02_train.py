"""Step 2 -- train, evaluate and save the offline ISL gesture classifier.

    python scripts/02_train.py                     # default run
    python scripts/02_train.py --augment 8         # more augmentation
    python scripts/02_train.py --max-per-class 300

Reports the number that actually matters for a counter deployment -- top-1
accuracy on a *held-out* split of real (un-augmented) dataset images -- plus the
top confusions, so the README can be honest about where the model fails.

Writes ``models/isl_gesture.joblib`` and ``models/isl_gesture.js.json``.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from islg import config  # noqa: E402
from islg.dataset import balance, class_report, expand_augmented, load_samples, stratified_split  # noqa: E402
from islg.model import GestureModel, build_estimator, confusion_pairs, top1_margin  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--table", default=None, help="landmarks.npz to train from")
    ap.add_argument("--augment", type=int, default=config.AUGMENT_PER_SAMPLE)
    ap.add_argument("--max-per-class", type=int, default=300)
    ap.add_argument("--out", default=str(config.MODEL_PATH))
    ap.add_argument("--export-js", default=str(config.JS_MODEL_PATH))
    ap.add_argument("--metrics", default=str(config.MODEL_DIR / "metrics.json"))
    ap.add_argument(
        "--include-collected",
        action="store_true",
        help="also train on data/collected/ (your own webcam recordings)",
    )
    args = ap.parse_args()

    X, y = load_samples(args.table)
    print(f"[info] loaded {X.shape[0]} real samples, {X.shape[1]} features")

    if args.include_collected:
        from islg.collect import load_collected

        collected = load_collected()
        if collected is None:
            print("[warn] --include-collected given but data/collected/ is empty")
        else:
            Xc, yc = collected
            X = np.concatenate([X, Xc], axis=0)
            y = np.concatenate([y, yc], axis=0)
            print(f"[info] + {len(yc)} webcam-collected samples -> {len(y)} total")

    X, y = balance(X, y, max_per_class=args.max_per_class)
    split = stratified_split(X, y)
    print(
        f"[info] {len(split.classes)} classes | train {len(split.y_train)} "
        f"val {len(split.y_val)} test {len(split.y_test)}"
    )

    X_aug, y_aug = expand_augmented(split.X_train, split.y_train, per_sample=args.augment)
    print(f"[info] augmented train set -> {len(y_aug)} rows")

    estimator = build_estimator()
    t0 = time.time()
    estimator.fit(X_aug, y_aug)
    fit_s = time.time() - t0
    print(f"[info] fitted in {fit_s:.1f}s")

    # ---- evaluation on real, un-augmented held-out data ----------------------
    val_pred = estimator.predict(split.X_val)
    val_acc = float(np.mean(val_pred == split.y_val))
    test_proba = estimator.predict_proba(split.X_test)
    test_pred = test_proba.argmax(axis=1)
    test_labels = np.asarray(split.classes)[test_pred]
    test_acc = float(np.mean(test_labels == split.y_test))
    margin = top1_margin(test_proba)

    print(f"\n[result] validation top-1 accuracy : {val_acc*100:.2f}%")
    print(f"[result] held-out TEST top-1 accuracy: {test_acc*100:.2f}%  (n={len(split.y_test)} real images)")
    print(f"[result] mean top-1 margin          : {margin:.3f}")
    print("\n[result] per-class recall/precision on the test split:")
    print(class_report(split.y_test.tolist(), test_labels.tolist(), split.classes))
    pairs = confusion_pairs(split.y_test.tolist(), test_labels.tolist())
    if pairs:
        print("\n[result] most common confusions:")
        for a, b, n in pairs:
            print(f"        {a} -> {b}  x{n}")

    model = GestureModel(
        pipeline=estimator,
        classes=list(split.classes),
        feature_dim=int(X.shape[1]),
        accuracy=test_acc,
        top1_margin=margin,
    )
    saved = model.save(args.out)
    print(f"\n[ok] saved {saved}  ({saved.stat().st_size/1024/1024:.2f} MB)")

    js_path = model.export_js(args.export_js)
    print(f"[ok] exported browser model {js_path}  ({js_path.stat().st_size/1024:.0f} KB)")

    # The browser "no server" mode loads the model from the static bundle.
    static_copy = Path(__file__).resolve().parent.parent / "server" / "static" / js_path.name
    static_copy.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(js_path, static_copy)
    print(f"[ok] copied to {static_copy.relative_to(static_copy.parent.parent.parent)}")

    metrics = {
        "classes": split.classes,
        "n_classes": len(split.classes),
        "n_real_samples": int(X.shape[0]),
        "n_train_augmented": int(len(y_aug)),
        "n_test": int(len(split.y_test)),
        "feature_dim": int(X.shape[1]),
        "validation_accuracy": round(val_acc, 4),
        "test_accuracy": round(test_acc, 4),
        "top1_margin": round(margin, 4),
        "fit_seconds": round(fit_s, 1),
        "model_size_mb": round(saved.stat().st_size / 1024 / 1024, 2),
        "confusions": [{"true": a, "predicted": b, "count": n} for a, b, n in pairs],
        "dataset": "sajanraj/Indian-Sign-Language-Recognition (ICICCT 2018), MediaPipe landmark mining",
    }
    Path(args.metrics).write_text(json.dumps(metrics, indent=2))
    print(f"[ok] wrote {args.metrics}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
