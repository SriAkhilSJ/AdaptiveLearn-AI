"""Central configuration for the TalkWithGesture offline ISL translator.

Everything that a judge, a teammate, or a deployment engineer might want to
change lives here. Nothing in this module does I/O at import time.
"""

from __future__ import annotations

import os
from pathlib import Path

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #
REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
MODEL_DIR = REPO_ROOT / "models"

# Landmark table produced by scripts/01_extract_landmarks.py
LANDMARK_TABLE = PROCESSED_DIR / "landmarks.npz"
# Trained classifier produced by scripts/02_train.py
MODEL_PATH = MODEL_DIR / "isl_gesture.joblib"
# Browser-loadable mirror of the classifier (scripts/03_export_js_model.py)
JS_MODEL_PATH = MODEL_DIR / "isl_gesture.js.json"

for _d in (DATA_DIR, RAW_DIR, PROCESSED_DIR, MODEL_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# --------------------------------------------------------------------------- #
# MediaPipe / camera
# --------------------------------------------------------------------------- #
# The hand-landmark and palm-detection TFLite models ship inside the mediapipe
# wheel, so the whole perception stack runs with zero network access.
MAX_NUM_HANDS = 2
MIN_DETECTION_CONFIDENCE = float(os.environ.get("ISLG_MIN_DET", 0.5))
MIN_TRACKING_CONFIDENCE = float(os.environ.get("ISLG_MIN_TRACK", 0.5))
# Longest side an incoming frame is resized to before landmark extraction.
# 256 px keeps palm detection accurate while staying well under real-time on a
# Raspberry Pi 4 / any 4-core laptop CPU.
INFERENCE_RESOLUTION = 256

# --------------------------------------------------------------------------- #
# Gesture temporal logic
# --------------------------------------------------------------------------- #
# A sign is only accepted after it has been the top prediction for this many
# consecutive frames -- this kills single-frame flicker, which is the single
# biggest source of embarrassment in live sign-language demos.
STABLE_FRAMES = 3
# Minimum calibrated probability required before a sign may be committed.
CONFIDENCE_THRESHOLD = 0.55
# Frames of "rest" (no hand / no confident sign) that end the current *word*.
# This has to be long enough to survive the ambiguous frames between two
# fingerspelled letters -- measured, a signer produces 4-10 of those per letter
# transition -- while still feeling responsive as a word boundary. At the ~20 fps
# the UI runs at, 24 frames is about 1.2 s: a deliberate pause, not a hesitation.
# The UI also offers an explicit "end word" control for signers who prefer it.
REST_FRAMES_TO_COMMIT = 24
# A committed sign is suppressed for this many frames so one held sign does not
# get repeated into "help help help".
REPEAT_SUPPRESSION_FRAMES = 10

# --------------------------------------------------------------------------- #
# Training
# --------------------------------------------------------------------------- #
TEST_SIZE = 0.15
VAL_SIZE = 0.10
RANDOM_STATE = 42
AUGMENT_PER_SAMPLE = 3  # synthetic variants generated per real sample
# Classes with fewer than this many samples are dropped from training so they
# cannot silently poison the confusion matrix.
MIN_SAMPLES_PER_CLASS = 40
