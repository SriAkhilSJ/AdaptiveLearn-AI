"""Feature-vector invariance -- the property the whole cross-signer story rests on.

If the vector changed when the signer moved closer to the camera or tilted their
hand, the classifier would be learning *where people stand* rather than *what
they signed*.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from islg.features import (  # noqa: E402
    FEATURE_DIM,
    FEATURE_NAMES,
    augment_vector,
    build_feature_vector,
    mirror_vector,
    normalize_hand,
)
from islg.hand_tracker import HandObservation, WRIST  # noqa: E402


def synthetic_hand(seed: int = 0, pose: str = "index_up") -> np.ndarray:
    """A crude but geometrically plausible 21-point hand, in normalised coords."""
    rng = np.random.default_rng(seed)
    pts = np.zeros((21, 3), dtype=np.float32)
    pts[WRIST] = [0.5, 0.8, 0.0]
    # knuckle row (5=index MCP, 9=middle MCP, 13=ring MCP, 17=pinky MCP)
    for i, x in zip((5, 9, 13, 17), (0.42, 0.5, 0.58, 0.65)):
        pts[i] = [x, 0.6, rng.normal(0, 0.01)]
    # thumb CMC sits on the side of the palm, not at the origin
    pts[1] = [0.38, 0.7, rng.normal(0, 0.01)]
    fingers = {"thumb": (1, 2, 3, 4), "index": (5, 6, 7, 8), "middle": (9, 10, 11, 12),
               "ring": (13, 14, 15, 16), "pinky": (17, 18, 19, 20)}
    extended = {"index_up": {"index"}, "open": set(fingers), "fist": set(),
                "peace": {"index", "middle"}}[pose]
    for name, (mcp, pip, dip, tip) in fingers.items():
        base = pts[mcp]
        for j, idx in enumerate((pip, dip, tip), start=1):
            step = np.array([0.0, -0.07 * j if name in extended else -0.015 * j, 0.01 * j])
            if name == "thumb":
                step = np.array([-0.06 * j if name in extended else -0.02 * j, -0.04 * j, 0.0])
            pts[idx] = base + step + rng.normal(0, 0.002, 3)
    return pts


def obs(pts: np.ndarray, handedness: str = "Right") -> HandObservation:
    return HandObservation(landmarks=pts.astype(np.float32), handedness=handedness, score=0.97)


# --------------------------------------------------------------------------- #
def test_feature_width_and_names_are_consistent() -> None:
    vec = build_feature_vector([obs(synthetic_hand())])
    assert vec is not None
    assert vec.shape == (FEATURE_DIM,)
    assert len(FEATURE_NAMES) == FEATURE_DIM
    assert len(set(FEATURE_NAMES)) == FEATURE_DIM, "duplicate feature names"


def test_returns_none_when_no_hand() -> None:
    assert build_feature_vector([]) is None


def test_translation_invariance() -> None:
    base = synthetic_hand()
    moved = base + np.array([0.31, -0.22, 0.0], dtype=np.float32)
    a = build_feature_vector([obs(base)])
    b = build_feature_vector([obs(moved)])
    assert a is not None and b is not None
    assert np.allclose(a, b, atol=1e-4), f"translation changed the vector by {np.abs(a-b).max():.2e}"


def test_scale_invariance() -> None:
    base = synthetic_hand()
    wrist = base[WRIST]
    bigger = wrist + (base - wrist) * 2.7  # hand 2.7x larger on screen
    a = build_feature_vector([obs(base)])
    b = build_feature_vector([obs(bigger)])
    assert a is not None and b is not None
    assert np.allclose(a, b, atol=1e-3), f"scale changed the vector by {np.abs(a-b).max():.2e}"


@pytest.mark.parametrize("degrees", [15, -30, 90, 175])
def test_in_plane_rotation_invariance(degrees: float) -> None:
    base = synthetic_hand()
    wrist = base[WRIST]
    theta = np.radians(degrees)
    rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]])
    rotated = base.copy()
    rotated[:, :2] = (base[:, :2] - wrist[:2]) @ rot.T + wrist[:2]
    a = build_feature_vector([obs(base)])
    b = build_feature_vector([obs(rotated)])
    assert a is not None and b is not None
    # Coordinates and angles should agree; allow a little slack for the z channel.
    assert np.allclose(a, b, atol=2e-2), f"rotation by {degrees}deg changed the vector by {np.abs(a-b).max():.2e}"


def test_distinct_poses_give_distinct_vectors() -> None:
    fist = build_feature_vector([obs(synthetic_hand(pose="fist"))])
    index = build_feature_vector([obs(synthetic_hand(pose="index_up"))])
    peace = build_feature_vector([obs(synthetic_hand(pose="peace"))])
    assert fist is not None and index is not None and peace is not None
    assert np.linalg.norm(fist - index) > 0.5
    assert np.linalg.norm(index - peace) > 0.3


def test_two_handed_features_activate() -> None:
    left = synthetic_hand(1)
    right = synthetic_hand(2) + np.array([-0.4, 0.0, 0.0], dtype=np.float32)
    single = build_feature_vector([obs(right)])
    both = build_feature_vector([obs(left, "Left"), obs(right, "Right")])
    assert single is not None and both is not None
    two_hands_idx = FEATURE_NAMES.index("two_hands")
    assert single[two_hands_idx] == 0.0
    assert both[two_hands_idx] == 1.0
    assert both[FEATURE_NAMES.index("wrist_dist_norm")] > 0.0
    assert both[FEATURE_NAMES.index("left_present")] == 1.0
    assert both[FEATURE_NAMES.index("right_present")] == 1.0


# --------------------------------------------------------------------------- #
def test_mirror_swaps_handedness_flags_and_negates_x() -> None:
    vec = build_feature_vector([obs(synthetic_hand(), handedness="Right")])
    assert vec is not None
    mirrored = mirror_vector(vec)
    assert mirrored[FEATURE_NAMES.index("is_right")] == 0.0
    assert mirrored[FEATURE_NAMES.index("is_left")] == 1.0
    xs = vec[:63].reshape(21, 3)[:, 0]
    mxs = mirrored[:63].reshape(21, 3)[:, 0]
    assert np.allclose(xs, -mxs, atol=1e-6)
    # Mirroring twice is the identity.
    assert np.allclose(mirror_vector(mirrored), vec, atol=1e-6)


def test_augmentation_stays_finite_and_close() -> None:
    """Augmentation perturbs geometry slightly and mirrors about half the samples.

    The distance therefore has to be measured against the original *or* its
    mirror -- both are legitimate, because ISL treats a left- and a right-handed
    rendering of the same sign as the same sign.
    """
    vec = build_feature_vector([obs(synthetic_hand())])
    assert vec is not None
    mirrored = mirror_vector(vec)
    rng = np.random.default_rng(3)
    n_mirrored = 0
    distances = []
    for _ in range(300):
        aug = augment_vector(vec, rng)
        assert aug.shape == (FEATURE_DIM,)
        assert np.all(np.isfinite(aug)), "augmentation produced a NaN/inf"
        d_plain = float(np.linalg.norm(aug - vec))
        d_mirror = float(np.linalg.norm(aug - mirrored))
        distances.append(min(d_plain, d_mirror))
        n_mirrored += int(d_mirror < d_plain)

    distances = np.asarray(distances)
    # Measured over 5k draws: mean 0.62, p99 1.63, max 2.27. The bound below is
    # the max plus slack -- tight enough to catch a runaway sigma, loose enough
    # not to flake.
    assert distances.mean() < 1.0, f"mean perturbation too large: {distances.mean():.2f}"
    assert distances.max() < 2.5, f"an augmented sample drifted {distances.max():.2f} from its origin"
    assert 60 < n_mirrored < 240, f"mirroring rate looks wrong: {n_mirrored}/300"
