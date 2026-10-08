"""Webcam data collector -- add your own signs, or your own signer, in minutes.

The public dataset covers one group of signers. The single highest-leverage thing
a team can do before a demo is record 30-60 samples per class *of the person who
will be demoing*, because cross-signer variation is the dominant error source.

Run it with the collector window in front of the signer::

    python scripts/collect_data.py --label A --count 40
    python scripts/collect_data.py --sweep           # walk the whole alphabet

Each accepted sample is stored as the same 96-feature vector used at inference
time (``data/collected/<LABEL>/<timestamp>.npz``), so retraining is just::

    python scripts/02_train.py --include-collected

Capture is *automatic*: a frame is only saved once the tracker has a confident
hand and the on-screen stability ring is full, which keeps near-duplicate and
half-formed poses out of the training set.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import List, Optional

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from islg import config  # noqa: E402
from islg.features import build_feature_vector  # noqa: E402
from islg.hand_tracker import HandTracker  # noqa: E402

COLLECT_DIR = config.DATA_DIR / "collected"


def _overlay(
    frame: np.ndarray,
    tracker: HandTracker,
    obs: List,
    label: str,
    saved: int,
    target: int,
    progress: float,
    message: str,
) -> np.ndarray:
    """Draw skeleton + a progress bar so the signer can self-pace."""
    out = tracker.draw(frame, obs)
    h, w = out.shape[:2]

    bar_w = int(w * 0.6)
    x0, y0 = int(w * 0.2), h - 46
    cv2.rectangle(out, (x0, y0), (x0 + bar_w, y0 + 18), (60, 60, 60), -1)
    cv2.rectangle(out, (x0, y0), (x0 + int(bar_w * progress), y0 + 18), (0, 200, 120), -1)
    cv2.rectangle(out, (x0, y0), (x0 + bar_w, y0 + 18), (200, 200, 200), 1)

    cv2.putText(out, f"SIGN: {label}   {saved}/{target}", (16, 34),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(out, message, (16, 62), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (180, 255, 200), 1, cv2.LINE_AA)
    cv2.putText(out, "SPACE capture | S skip | Q next class", (16, h - 14),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1, cv2.LINE_AA)
    return out


def collect_label(
    label: str,
    count: int,
    camera: int = 0,
    out_dir: Path = COLLECT_DIR,
    cooldown: float = 0.35,
    stability_frames: int = 6,
) -> int:
    """Record up to ``count`` samples of ``label``. Returns how many were saved."""
    label = label.strip().upper()
    if not label:
        raise ValueError("label must not be empty")
    target_dir = out_dir / label
    target_dir.mkdir(parents=True, exist_ok=True)

    existing = len(list(target_dir.glob("*.npz")))
    print(f"[info] '{label}' already has {existing} samples; collecting up to {count} more")

    cap = cv2.VideoCapture(camera)
    if not cap.isOpened():
        print(f"[error] cannot open camera {camera}", file=sys.stderr)
        return 0
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 960)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 540)

    saved = 0
    stable_run = 0
    last_save = 0.0
    window = f"TalkWithGesture collector - {label}"
    cv2.namedWindow(window, cv2.WINDOW_NORMAL)

    try:
        # Static mode: same code path as the dataset mining, so collected
        # samples have the same feature distribution as the pre-trained ones.
        with HandTracker(video_mode=False) as tracker:
            while saved < count:
                ok, frame = cap.read()
                if not ok:
                    print("[error] camera returned an empty frame", file=sys.stderr)
                    break
                frame = cv2.flip(frame, 1)  # selfie view: matches how people sign
                obs = tracker.landmarks(frame)
                vec = build_feature_vector(obs) if obs else None

                if vec is not None:
                    stable_run += 1
                else:
                    stable_run = 0

                progress = min(1.0, stable_run / stability_frames)
                ready = stable_run >= stability_frames and (time.time() - last_save) >= cooldown
                message = "hold steady..." if obs else "show your hand to the camera"
                if ready:
                    message = "captured"

                cv2.imshow(window, _overlay(frame, tracker, obs, label, saved, count, progress, message))

                if ready:
                    path = target_dir / f"{int(time.time()*1000)}.npz"
                    np.savez_compressed(path, vec=vec, label=label, handedness=obs[0].handedness if obs else "?")
                    saved += 1
                    last_save = time.time()
                    stable_run = 0

                key = cv2.waitKey(1) & 0xFF
                if key == ord(" "):  # manual capture
                    if vec is not None and (time.time() - last_save) >= cooldown:
                        np.savez_compressed(target_dir / f"{int(time.time()*1000)}.npz",
                                            vec=vec, label=label, handedness=obs[0].handedness)
                        saved += 1
                        last_save = time.time()
                elif key == ord("q") or key == 27:
                    break
    finally:
        cap.release()
        cv2.destroyAllWindows()

    print(f"[ok] saved {saved} sample(s) for '{label}' -> {target_dir}")
    return saved


def load_collected() -> Optional[tuple[np.ndarray, np.ndarray]]:
    """Read every collected sample back into an ``(X, y)`` pair for training."""
    if not COLLECT_DIR.exists():
        return None
    X: List[np.ndarray] = []
    y: List[str] = []
    for path in sorted(COLLECT_DIR.rglob("*.npz")):
        with np.load(path, allow_pickle=False) as blob:
            X.append(np.asarray(blob["vec"], dtype=np.float32))
            y.append(str(blob["label"]))
    if not X:
        return None
    return np.stack(X), np.asarray(y, dtype="<U4")


def main() -> int:
    from islg.vocab import FINGERSPELL_CLASSES

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--label", default=None, help="single class to collect, e.g. A or 7")
    ap.add_argument("--count", type=int, default=40, help="samples to record per class")
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--sweep", action="store_true", help="collect every class in the vocabulary")
    ap.add_argument("--classes", default=None, help="comma-separated subset for --sweep, e.g. A,B,1,2")
    args = ap.parse_args()

    if args.sweep:
        classes = (
            [c.strip().upper() for c in args.classes.split(",") if c.strip()]
            if args.classes
            else FINGERSPELL_CLASSES
        )
        total = 0
        for label in classes:
            print(f"\n===== {label} =====")
            total += collect_label(label, args.count, camera=args.camera)
        print(f"\n[ok] collected {total} samples total; retrain with: python scripts/02_train.py --include-collected")
        return 0

    if not args.label:
        ap.error("give --label A, or use --sweep")
    collect_label(args.label, args.count, camera=args.camera)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
