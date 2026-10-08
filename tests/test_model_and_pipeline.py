"""End-to-end checks against the *shipped* model and real landmark data.

These are the tests that would fail if someone retrained and quietly wrecked the
model, or wired the session up wrong. They need ``models/isl_gesture.joblib`` and
``data/processed/landmarks.npz`` -- i.e. run ``scripts/02_train.py`` first.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from islg import config  # noqa: E402

requires_model = pytest.mark.skipif(
    not config.MODEL_PATH.exists(), reason="run scripts/02_train.py first"
)
requires_table = pytest.mark.skipif(
    not config.LANDMARK_TABLE.exists(), reason="run scripts/01_extract_landmarks.py first"
)


@pytest.fixture(scope="module")
def model():
    from islg.model import GestureModel

    if not config.MODEL_PATH.exists():
        pytest.skip("run scripts/02_train.py first")
    return GestureModel.load()


@requires_model
def test_model_metadata_is_sane(model) -> None:
    assert model.feature_dim == 96
    assert len(model.classes) >= 36
    assert 0.0 <= model.accuracy <= 1.0
    assert model.top1_margin > 0.0


@requires_model
def test_model_refuses_the_wrong_feature_width(model) -> None:
    with pytest.raises(ValueError):
        model.predict(np.zeros((1, model.feature_dim + 1), dtype=np.float32))


@requires_model
@requires_table
def test_accuracy_on_held_out_landmarks_is_at_least_85_percent(model) -> None:
    """Re-score the *saved artefact* on the rows training never saw.

    Scoring the whole landmark table would quietly include training data; this
    rebuilds the identical deterministic split and uses only its test part.
    """
    split = _held_out_split()
    labels, probs = model.predict(split.X_test)
    accuracy = float(np.mean(labels == split.y_test))
    correct = labels == split.y_test
    print(f"\n[model] held-out accuracy from the saved .joblib: {accuracy*100:.2f}% "
          f"(n={len(split.y_test)} real images, {len(split.classes)} classes)")
    print(f"[model] mean confidence when correct: {probs[correct].mean():.3f}")
    assert accuracy >= 0.85, f"model accuracy regressed to {accuracy:.3f}"
    assert abs(accuracy - model.accuracy) < 0.02, (
        "the saved artefact no longer reproduces the accuracy recorded at train time"
    )


@requires_model
@requires_table
def test_confident_predictions_are_more_often_right(model) -> None:
    """The confidence gate in the smoother is only meaningful if this holds."""
    split = _held_out_split()
    labels, probs = model.predict(split.X_test)
    correct = labels == split.y_test

    high = probs >= 0.9
    low = probs < 0.5
    assert high.sum() > 50, "too few confident predictions to judge calibration"
    acc_high = float(correct[high].mean())
    print(f"\n[model] accuracy when confidence >= 0.90: {acc_high*100:.2f}% "
          f"({int(correct[high].sum())}/{int(high.sum())})")
    if low.sum():
        print(f"[model] accuracy when confidence <  0.50: {float(correct[low].mean())*100:.2f}% "
              f"(n={int(low.sum())})")
    assert acc_high >= 0.95, "high-confidence predictions are not actually reliable"


@requires_model
def test_session_turns_a_spelled_keyword_into_a_spoken_sentence(model) -> None:
    """The whole product, driven by landmark vectors instead of a camera."""
    from islg.pipeline import TranslationSession
    from islg.smoother import SignSmoother

    session = TranslationSession(model, language="en", smoother=SignSmoother(stable_frames=2))
    spoken = []

    def feed(vector):
        state = session.from_vector(vector)
        if state.speak:
            spoken.append(state.speak)
        return state

    for ch in "TICKET":
        for _ in range(2):  # hold the sign long enough for the smoother to commit
            feed(_vector_that_predicts(model, ch))
        # Realistic inter-letter transition: a handful of frames where the moving
        # hand is not confidently any letter. This must NOT split the word.
        for _ in range(6):
            feed(None)

    assert session.buffer.text_en() == "TICKET_", "the letters between T and T split into words"

    # Now the deliberate pause that ends the word.
    for _ in range(session.smoother.rest_frames + 1):
        feed(None)

    assert session.buffer.text_en() == "I want to buy a ticket."
    assert spoken, "nothing was spoken while spelling TICKET"
    assert spoken[-1]["text"] == "I want to buy a ticket."
    assert spoken[-1]["lang"] == "en"


@requires_model
def test_explicit_end_word_control_flushes_the_buffer(model) -> None:
    """The "end word" button must work without waiting out the rest timer."""
    from islg.pipeline import TranslationSession

    session = TranslationSession(model)
    for ch in "TICKET":
        for _ in range(session.smoother.stable_frames):
            session.from_vector(_vector_that_predicts(model, ch))
    state = session.end_word()
    assert state.utterance_done is True
    assert state.speak == {"text": "I want to buy a ticket.", "lang": "en"}
    assert session.buffer.pending == ""
    assert session.buffer.text_en() == "I want to buy a ticket."


@requires_model
@requires_table
def test_session_refuses_low_confidence_signs(model) -> None:
    """A sign the model is unsure about must never reach the spoken sentence.

    The vector used here is a real ground-truth landmark that the model happens to
    classify with very low confidence (an ambiguous ISL "K"), which is exactly the
    case the counter system has to stay quiet about.
    """
    from islg.pipeline import TranslationSession
    from islg.smoother import SignSmoother

    vector, confidence, label = _least_confident_vector(model)
    print(f"\n[model] ambiguous sample: ground truth {label!r}, "
          f"model says {label!r} at confidence {confidence:.3f}")
    session = TranslationSession(model, smoother=SignSmoother(stable_frames=2))
    for _ in range(20):
        state = session.from_vector(vector)
        assert state.committed is None, (
            f"committed {state.committed} at confidence {confidence:.3f} -- "
            f"the {session.smoother.confidence_threshold} gate is not being applied"
        )
    assert session.buffer.text_en() == ""


_SAMPLE_CACHE: dict = {}


def _vector_that_predicts(model, label: str, min_confidence: float = 0.7) -> np.ndarray:
    """Return a real landmark vector that is truly ``label`` *and* confidently so.

    Starting from the ground-truth label (rather than scanning predictions) means
    the helper never depends on how the extraction happened to order the table,
    and the confidence floor keeps the test from accidentally tripping the
    smoother's own gate -- a low-confidence sample *should* be refused, which is
    asserted separately in ``test_session_refuses_low_confidence_signs``.
    """
    from islg.dataset import load_samples

    if "X" not in _SAMPLE_CACHE:
        X, y = load_samples()
        _SAMPLE_CACHE.update(X=X, y=y)
    X, y = _SAMPLE_CACHE["X"], _SAMPLE_CACHE["y"]

    candidates = X[y == label]
    assert len(candidates), f"the landmark table has no ground-truth {label!r} samples"
    predicted, confidence = model.predict(candidates)
    good = np.where((predicted == label) & (confidence >= min_confidence))[0]
    assert len(good), f"the model is never confident about ground-truth {label!r}"
    return candidates[good[int(np.argmax(confidence[good]))]]


def _least_confident_vector(model):
    """Find a real landmark the model classifies with the lowest confidence."""
    from islg.dataset import load_samples

    if "X" not in _SAMPLE_CACHE:
        X, y = load_samples()
        _SAMPLE_CACHE.update(X=X, y=y)
    X, y = _SAMPLE_CACHE["X"], _SAMPLE_CACHE["y"]
    labels, confidence = model.predict(X)
    i = int(np.argmin(confidence))
    return X[i], float(confidence[i]), str(y[i])


def _held_out_split():
    """Reproduce training's own test split, so the score is genuinely held out.

    ``load_samples()`` alone would include the training rows and flatter the
    number -- the split is deterministic (same seed, same balancing), so calling
    ``stratified_split`` again returns exactly the rows training never saw.
    """
    from islg.dataset import balance, load_samples, stratified_split

    X, y = load_samples()
    X, y = balance(X, y, max_per_class=300)
    return stratified_split(X, y)
