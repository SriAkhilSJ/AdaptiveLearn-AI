"""Landmark -> feature vector.

This is the part of the system that decides whether the model generalises to a
*new signer at a new counter with a new camera*. Raw MediaPipe coordinates are
useless on their own because they encode where the person happened to stand.

Every vector produced here is made invariant to, in order:

1. **Translation** - the wrist is moved to the origin.
2. **Scale** - everything is divided by the wrist->middle-MCP palm length, so a
   hand 40 cm from the camera and a hand 2 m away look identical.
3. **In-plane rotation** - the palm axis (wrist -> middle MCP) is rotated to
   point straight up. A signer who holds their hand tilted is not a new class.
4. **Depth offset** - z is re-referenced to the wrist and scaled by palm length.

On top of the 63 normalised coordinates we add:

* 20 **joint angles** (rotation-invariant by construction, very discriminative
  between e.g. ISL "G" and "H"),
* 5 **finger-extension flags**,
* **handedness** one-hot,
* **two-handed geometry** (wrist separation and palm-axis angle difference) for
  the many ISL signs that use both hands.

The same code path is used for dataset mining, training, live inference and the
self-test, so a model trained offline behaves identically at the counter.
"""

from __future__ import annotations

from typing import List, Sequence

import numpy as np

from .hand_tracker import (
    FINGER_JOINTS,
    MIDDLE_MCP,
    NUM_LANDMARKS,
    WRIST,
    HandObservation,
)

# Angle triplets (a, b, c) -> angle at vertex b, in degrees.
_ANGLE_TRIPLETS = [
    (WRIST, MIDDLE_MCP, 10),
    (MIDDLE_MCP, 10, 11),
    (10, 11, 12),
    (WRIST, 5, 6),
    (5, 6, 7),
    (6, 7, 8),
    (WRIST, 13, 14),
    (13, 14, 15),
    (14, 15, 16),
    (WRIST, 17, 18),
    (17, 18, 19),
    (18, 19, 20),
    (WRIST, 1, 2),
    (1, 2, 3),
    (2, 3, 4),
    (5, WRIST, 17),
    (8, 4, WRIST),
    (12, 4, WRIST),
    (16, 4, WRIST),
    (20, 4, WRIST),
]

FINGER_NAMES = ("thumb", "index", "middle", "ring", "pinky")

FEATURE_NAMES: List[str] = []


def _build_feature_names() -> List[str]:
    names: List[str] = []
    for i in range(NUM_LANDMARKS):
        names += [f"lm{i}_x", f"lm{i}_y", f"lm{i}_z"]
    for a, b, c in _ANGLE_TRIPLETS:
        names.append(f"ang_{a}_{b}_{c}")
    names += [f"ext_{f}" for f in FINGER_NAMES]
    names += ["is_left", "is_right", "hand_score"]
    names += ["two_hands", "wrist_dist_norm", "palm_axis_delta", "left_present", "right_present"]
    return names


FEATURE_NAMES = _build_feature_names()
FEATURE_DIM = len(FEATURE_NAMES)


# --------------------------------------------------------------------------- #
# Geometry helpers
# --------------------------------------------------------------------------- #
def _angle_deg(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Angle at ``b`` formed by segments b->a and b->c, in degrees [0, 180]."""
    v1 = a - b
    v2 = c - b
    n1 = float(np.linalg.norm(v1))
    n2 = float(np.linalg.norm(v2))
    if n1 < 1e-9 or n2 < 1e-9:
        return 0.0
    cos_t = np.clip(float(np.dot(v1, v2)) / (n1 * n2), -1.0, 1.0)
    return float(np.degrees(np.arccos(cos_t)))


def normalize_hand(landmarks: np.ndarray) -> np.ndarray:
    """Return ``(21, 3)`` landmarks that are translation/scale/rotation invariant.

    Uses only the x/y plane for the rotation estimate (z from a monocular camera
    is noisy), then applies the same 2-D rotation to x and y.
    """
    pts = np.array(landmarks, dtype=np.float64)
    wrist = pts[WRIST].copy()
    pts = pts - wrist  # (1) translation invariance

    palm = float(np.linalg.norm(pts[MIDDLE_MCP, :2]))
    if palm < 1e-6:
        palm = 1e-6  # (2) scale invariance
    pts = pts / palm

    # (3) in-plane rotation: rotate the palm axis onto +y (screen-down is +y,
    # so "pointing up" is -y).
    axis = pts[MIDDLE_MCP, :2]
    angle = float(np.arctan2(axis[0], -axis[1]))
    cos_a, sin_a = np.cos(-angle), np.sin(-angle)
    rot = np.array([[cos_a, -sin_a], [sin_a, cos_a]], dtype=np.float64)
    pts[:, :2] = pts[:, :2] @ rot.T

    # (4) depth: clip the runaway monocular z values MediaPipe emits.
    pts[:, 2] = np.clip(pts[:, 2], -3.0, 3.0)
    return pts.astype(np.float32)


def _extension_flags(pts: np.ndarray) -> List[float]:
    """Is each finger extended? Tip is farther from the wrist than the PIP joint."""
    flags: List[float] = []
    for finger in FINGER_NAMES:
        mcp, pip, _dip, tip = FINGER_JOINTS[finger]
        d_tip = float(np.linalg.norm(pts[tip, :2] - pts[WRIST, :2]))
        d_pip = float(np.linalg.norm(pts[pip, :2] - pts[WRIST, :2]))
        d_mcp = float(np.linalg.norm(pts[mcp, :2] - pts[WRIST, :2]))
        flags.append(1.0 if d_tip > max(d_pip, d_mcp) * 1.05 else 0.0)
    return flags


def _dominant_hand(observations: Sequence[HandObservation]) -> HandObservation:
    """Pick the hand the signer is most likely signing with: largest palm on screen."""
    return max(observations, key=lambda o: o.palm_size)


def build_feature_vector(observations: Sequence[HandObservation]) -> np.ndarray | None:
    """Turn MediaPipe output into a fixed-length ``float32`` vector.

    Returns ``None`` when no hand was detected -- callers use that as the
    "rest / no sign" signal rather than a zero vector.
    """
    if not observations:
        return None

    primary = _dominant_hand(observations)
    pts = normalize_hand(primary.landmarks)

    feats: List[float] = list(pts.flatten())

    for a, b, c in _ANGLE_TRIPLETS:
        feats.append(_angle_deg(pts[a], pts[b], pts[c]))

    feats += _extension_flags(pts)
    feats.append(1.0 if primary.handedness == "Left" else 0.0)
    feats.append(1.0 if primary.handedness == "Right" else 0.0)
    feats.append(float(primary.score))

    # ---- two-handed geometry -------------------------------------------------
    two_handed = len(observations) >= 2
    feats.append(1.0 if two_handed else 0.0)
    if two_handed:
        other = observations[0] if observations[0] is not primary else observations[1]
        ref = max(primary.palm_size, other.palm_size, 1e-6)
        wrist_dist = float(np.linalg.norm(primary.landmarks[WRIST, :2] - other.landmarks[WRIST, :2])) / ref

        def palm_angle(obs: HandObservation) -> float:
            v = obs.landmarks[MIDDLE_MCP, :2] - obs.landmarks[WRIST, :2]
            return float(np.degrees(np.arctan2(v[1], v[0])))

        delta = abs(palm_angle(primary) - palm_angle(other)) % 360.0
        delta = min(delta, 360.0 - delta)
        feats += [wrist_dist, delta]
    else:
        feats += [0.0, 0.0]

    labels = {o.handedness for o in observations}
    feats.append(1.0 if "Left" in labels else 0.0)
    feats.append(1.0 if "Right" in labels else 0.0)

    vec = np.asarray(feats, dtype=np.float32)
    if vec.shape[0] != FEATURE_DIM:  # pragma: no cover - guards future edits
        raise ValueError(f"feature width drift: got {vec.shape[0]}, expected {FEATURE_DIM}")
    if not np.all(np.isfinite(vec)):
        return None
    return vec


# --------------------------------------------------------------------------- #
# Augmentation - operates in *landmark* space, so it is essentially free.
# --------------------------------------------------------------------------- #
def augment_vector(vec: np.ndarray, rng: np.random.Generator, strength: float = 1.0) -> np.ndarray:
    """Jitter / rescale / re-rotate an already-normalised feature vector.

    We only perturb the coordinate block and recompute nothing else; the derived
    angle features are left untouched because a few degrees of coordinate jitter
    changes them negligibly, and recomputing would double the cost.
    """
    out = vec.copy()
    coords = out[: NUM_LANDMARKS * 3].reshape(NUM_LANDMARKS, 3)

    # Isotropic scale wobble (signer slightly closer/further).
    scale = 1.0 + rng.normal(0.0, 0.05 * strength)
    coords *= scale

    # Small residual rotation that survived normalisation.
    theta = rng.normal(0.0, np.radians(6.0) * strength)
    cos_t, sin_t = np.cos(theta), np.sin(theta)
    rot = np.array([[cos_t, -sin_t], [sin_t, cos_t]], dtype=np.float64)
    coords[:, :2] = coords[:, :2] @ rot.T

    # Sensor noise + a small lateral shift (signer not perfectly centred).
    coords[:, :2] += rng.normal(0.0, 0.015 * strength, size=(NUM_LANDMARKS, 2))
    coords[:, 2] += rng.normal(0.0, 0.03 * strength, size=NUM_LANDMARKS)

    out[: NUM_LANDMARKS * 3] = coords.flatten()

    # Mirror across the vertical axis: a left-handed signer produces the mirror
    # image of a right-handed one, and ISL treats them as the same sign.
    if rng.random() < 0.5:
        out = mirror_vector(out)
    return out.astype(np.float32)


# Indices are looked up by name rather than computed: getting them wrong silently
# corrupts every mirrored training sample, which is exactly the kind of bug that
# shows up as "the model only works for right-handed signers".
_IS_LEFT_I = _build_feature_names().index("is_left")
_IS_RIGHT_I = _build_feature_names().index("is_right")
_LEFT_PRESENT_I = _build_feature_names().index("left_present")
_RIGHT_PRESENT_I = _build_feature_names().index("right_present")


def mirror_vector(vec: np.ndarray) -> np.ndarray:
    """Reflect a feature vector so a left hand becomes a right hand (and back).

    Only ``x`` changes sign. ``z`` is monocular *depth relative to the wrist*, and
    mirroring the image plane does not move the hand towards or away from the
    camera, so negating it would invent a depth that was never observed.
    """
    out = vec.copy()
    coords = out[: NUM_LANDMARKS * 3].reshape(NUM_LANDMARKS, 3)
    coords[:, 0] *= -1.0
    out[: NUM_LANDMARKS * 3] = coords.flatten()

    # Angles and finger-extension flags are reflection-invariant -> untouched.
    out[_IS_LEFT_I], out[_IS_RIGHT_I] = out[_IS_RIGHT_I], out[_IS_LEFT_I]
    out[_LEFT_PRESENT_I], out[_RIGHT_PRESENT_I] = out[_RIGHT_PRESENT_I], out[_LEFT_PRESENT_I]
    return out.astype(np.float32)
