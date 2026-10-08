"""Thin, offline wrapper around MediaPipe Hands.

MediaPipe ships its palm-detection and hand-landmark TFLite models inside the
pip wheel, so once the package is installed this module never touches the
network -- a hard requirement of PS-AIML-04 (offline public-service counters).

The wrapper exposes one method, :meth:`HandTracker.landmarks`, that returns a
plain NumPy array so the rest of the codebase (and the tests) never has to know
about MediaPipe protobufs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence

import cv2
import numpy as np

from .config import (
    INFERENCE_RESOLUTION,
    MAX_NUM_HANDS,
    MIN_DETECTION_CONFIDENCE,
    MIN_TRACKING_CONFIDENCE,
)

# MediaPipe canonical hand topology.
NUM_LANDMARKS = 21
WRIST = 0
THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP = 1, 2, 3, 4
INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP = 5, 6, 7, 8
MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP = 9, 10, 11, 12
RING_MCP, RING_PIP, RING_DIP, RING_TIP = 13, 14, 15, 16
PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP = 17, 18, 19, 20

FINGER_JOINTS = {
    "thumb": (THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP),
    "index": (INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP),
    "middle": (MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP),
    "ring": (RING_MCP, RING_PIP, RING_DIP, RING_TIP),
    "pinky": (PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP),
}


@dataclass
class HandObservation:
    """One detected hand, in MediaPipe normalised image coordinates."""

    landmarks: np.ndarray  # shape (21, 3), x/y in [0,1] of the frame, z relative
    handedness: str  # "Left" | "Right" (the *subject's* hand, already flipped)
    score: float

    @property
    def palm_size(self) -> float:
        """Wrist -> middle-MCP distance; the scale reference for normalisation."""
        return float(np.linalg.norm(self.landmarks[MIDDLE_MCP] - self.landmarks[WRIST]))


def resize_for_inference(frame: np.ndarray, max_side: int = INFERENCE_RESOLUTION) -> np.ndarray:
    """Downscale a BGR frame so the longest side is ``max_side`` pixels."""
    h, w = frame.shape[:2]
    longest = max(h, w)
    if longest <= max_side:
        return frame
    scale = max_side / float(longest)
    return cv2.resize(frame, (max(1, int(round(w * scale))), max(1, int(round(h * scale)))))


class HandTracker:
    """MediaPipe Hands with a NumPy-only public surface.

    Parameters
    ----------
    video_mode:
        ``True`` enables inter-frame tracking (use for webcam streams, it is both
        faster and more stable). ``False`` treats every frame independently, which
        is what you want when mining a still-image dataset.
    """

    def __init__(
        self,
        video_mode: bool = True,
        max_num_hands: int = MAX_NUM_HANDS,
        min_detection_confidence: float = MIN_DETECTION_CONFIDENCE,
        min_tracking_confidence: float = MIN_TRACKING_CONFIDENCE,
        max_side: int = INFERENCE_RESOLUTION,
    ) -> None:
        import mediapipe as mp  # imported lazily: heavy, and CLI tools may not need it

        self._mp = mp
        self._max_side = max_side
        self._hands = mp.solutions.hands.Hands(
            static_image_mode=not video_mode,
            max_num_hands=max_num_hands,
            model_complexity=0,  # 0 = "lite" graph; ~2x faster, negligible accuracy loss
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )

    # ------------------------------------------------------------------ #
    def landmarks(self, frame_bgr: np.ndarray) -> List[HandObservation]:
        """Return every detected hand in ``frame_bgr`` (an OpenCV BGR image)."""
        small = resize_for_inference(frame_bgr, self._max_side)
        rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
        result = self._hands.process(rgb)
        if not result.multi_hand_landmarks:
            return []

        observations: List[HandObservation] = []
        handedness_list: Sequence = result.multi_handedness or []
        for idx, hand_lms in enumerate(result.multi_hand_landmarks):
            pts = np.array([[lm.x, lm.y, lm.z] for lm in hand_lms.landmark], dtype=np.float32)
            label, score = "Right", 0.0
            if idx < len(handedness_list):
                classification = handedness_list[idx].classification[0]
                # MediaPipe reports the label as seen in a *mirrored* (selfie) view;
                # flip it so it names the signer's actual hand.
                label = "Left" if classification.label == "Right" else "Right"
                score = float(classification.score)
            observations.append(HandObservation(landmarks=pts, handedness=label, score=score))

        # Deterministic ordering: left-of-frame hand first. Downstream two-handed
        # features depend on this being stable.
        observations.sort(key=lambda o: float(o.landmarks[WRIST][0]))
        return observations

    def draw(self, frame_bgr: np.ndarray, observations: Sequence[HandObservation]) -> np.ndarray:
        """Render the hand skeleton over ``frame_bgr`` (for the collector UI)."""
        out = frame_bgr.copy()
        h, w = out.shape[:2]
        connections = self._mp.solutions.hands.HAND_CONNECTIONS
        for obs in observations:
            pts = [(int(p[0] * w), int(p[1] * h)) for p in obs.landmarks]
            for a, b in connections:
                cv2.line(out, pts[a], pts[b], (0, 220, 130), 2)
            for i, (px, py) in enumerate(pts):
                cv2.circle(out, (px, py), 3 if i else 5, (255, 200, 0) if i == WRIST else (0, 120, 255), -1)
        return out

    def close(self) -> None:
        self._hands.close()

    def __enter__(self) -> "HandTracker":
        return self

    def __exit__(self, *exc_info: object) -> Optional[bool]:
        self.close()
        return None
