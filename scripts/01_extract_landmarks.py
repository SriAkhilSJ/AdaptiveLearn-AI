"""Step 1 -- mine MediaPipe hand landmarks out of the raw ISL image dataset.

Source dataset: Sajanraj T D et al., "Indian Sign Language Recognition",
Vidya Academy of Science & Technology (ICICCT 2018) -- 16,698 images of the ISL
fingerspelling alphabet A-Z plus digits 0-9, filename-prefixed with the class
(``A_1.jpg``, ``7_11.jpg``). We download it once into ``data/raw`` and never
commit it; the derived landmark table (a few MB) is what the model trains on.

Usage
-----
    python scripts/01_extract_landmarks.py                # everything
    python scripts/01_extract_landmarks.py --per-class 300
    python scripts/01_extract_landmarks.py --workers 4

The output ``data/processed/landmarks.npz`` stores ``X`` (N, FEATURE_DIM),
``y`` (N,) class strings and ``src`` (N,) source filenames, so training,
evaluation and the browser model export all read the exact same features.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from islg import config  # noqa: E402

IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
CLASS_RE = re.compile(r"^\s*([A-Za-z0-9])(?:[ _\-.]|$)")
# ``IMG_4936.JPG`` carries no class label in this dataset -> unusable.
UNLABELLED_RE = re.compile(r"^IMG[_-]?\d", re.IGNORECASE)


def parse_label(filename: str) -> str | None:
    """``A_1.jpg`` -> ``A``, ``7_11.jpg`` -> ``7``, ``w (97).jpeg`` -> ``W``."""
    if UNLABELLED_RE.match(filename):
        return None
    m = CLASS_RE.match(filename)
    if not m:
        return None
    return m.group(1).upper()


def collect_images(root: Path, per_class: int | None) -> List[Tuple[Path, str]]:
    """Walk ``root`` and return ``(path, label)`` pairs, capped per class."""
    buckets: Dict[str, List[Path]] = defaultdict(list)
    for path in sorted(root.rglob("*")):
        if path.suffix.lower() not in IMG_EXTS or not path.is_file():
            continue
        label = parse_label(path.name)
        if label:
            buckets[label].append(path)

    pairs: List[Tuple[Path, str]] = []
    for label in sorted(buckets):
        files = buckets[label]
        if per_class:
            # Deterministic even subsample: keeps subjects/scenes spread out.
            step = max(1, len(files) // per_class)
            files = files[::step][:per_class]
        pairs += [(p, label) for p in files]
    return pairs


def _worker_init() -> None:
    """Each worker builds its own MediaPipe graph; silence its logging."""
    os.environ.setdefault("GLOG_minloglevel", "2")
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
    global _TRACKER
    from islg.hand_tracker import HandTracker

    _TRACKER = HandTracker(video_mode=False)


def _worker_run(task: Tuple[str, str]) -> Tuple[str, str, object]:
    import cv2

    from islg.features import build_feature_vector

    path_str, label = task
    frame = cv2.imread(path_str, cv2.IMREAD_COLOR)
    if frame is None:
        return path_str, label, None
    try:
        obs = _TRACKER.landmarks(frame)
        vec = build_feature_vector(obs)
    except Exception:  # corrupt image, exotic colour profile, ...
        return path_str, label, None
    if vec is None:
        return path_str, label, None
    return path_str, label, vec


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--images", default=None, help="root of the raw ISL images")
    ap.add_argument("--out", default=str(config.LANDMARK_TABLE))
    ap.add_argument("--per-class", type=int, default=None, help="cap samples per class")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2)))
    args = ap.parse_args()

    root = Path(args.images) if args.images else _default_image_root()
    if not root.exists():
        print(f"[error] no image folder at {root}", file=sys.stderr)
        print("        run scripts/00_download_dataset.sh first", file=sys.stderr)
        return 2

    tasks = collect_images(root, args.per_class)
    if not tasks:
        print(f"[error] no labelled images found under {root}", file=sys.stderr)
        return 2
    print(f"[info] {len(tasks)} labelled images from {root}")

    from multiprocessing import Pool

    X: List[np.ndarray] = []
    y: List[str] = []
    src: List[str] = []
    misses = 0
    t0 = time.time()

    with Pool(processes=args.workers, initializer=_worker_init) as pool:
        for i, (path_str, label, vec) in enumerate(
            pool.imap_unordered(_worker_run, [(str(p), l) for p, l in tasks], chunksize=16), start=1
        ):
            if vec is None:
                misses += 1
            else:
                X.append(vec)
                y.append(label)
                src.append(path_str)
            if i % 500 == 0 or i == len(tasks):
                rate = i / max(1e-9, time.time() - t0)
                eta = (len(tasks) - i) / max(1e-9, rate)
                print(f"[info] {i}/{len(tasks)}  {rate:.1f} img/s  eta {eta/60:.1f} min", flush=True)

    if not X:
        print("[error] MediaPipe found no hand in any image", file=sys.stderr)
        return 3

    Xa = np.stack(X).astype(np.float32)
    ya = np.array(y, dtype="<U4")
    # Fixed-width unicode, NOT dtype=object: an object array forces every reader
    # to use allow_pickle=True, which is both a security smell and a footgun.
    sa = np.array(src, dtype=f"<U{max(len(s) for s in src)}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, X=Xa, y=ya, src=sa)

    uniq, counts = np.unique(ya, return_counts=True)
    print(f"\n[ok] wrote {out}  ({Xa.shape[0]} samples, {Xa.shape[1]} features)")
    print(f"[ok] detection rate: {100*Xa.shape[0]/max(1,len(tasks)):.1f}% ({misses} images had no detectable hand)")
    print(f"[ok] {len(uniq)} classes: {', '.join(f'{u}={c}' for u, c in zip(uniq.tolist(), counts.tolist()))}")
    return 0


def _default_image_root() -> Path:
    """Locate the extracted dataset folder without hard-coding a version suffix."""
    candidates = sorted(config.RAW_DIR.glob("Indian-Sign-Language-Recognition-*/train_image_folder"))
    if candidates:
        return candidates[-1]
    return config.RAW_DIR / "images"


if __name__ == "__main__":
    raise SystemExit(main())
