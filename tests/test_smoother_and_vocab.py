"""Temporal smoothing and sentence assembly -- no camera required."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from islg.smoother import SignSmoother  # noqa: E402
from islg.vocab import (  # noqa: E402
    COUNTER_PHRASES,
    DOMAINS,
    FINGERSPELL_CLASSES,
    LetterBuffer,
    lookup_phrase,
    phrases_for_domain,
)


# --------------------------------------------------------------------------- #
# Smoother
# --------------------------------------------------------------------------- #
def test_sign_is_not_committed_before_it_is_stable() -> None:
    s = SignSmoother(stable_frames=4, confidence_threshold=0.5, rest_frames=3)
    for _ in range(3):
        result = s.update("A", 0.99)
        assert result.committed is None, "committed too early"
    assert s.update("A", 0.99).committed == "A"


def test_low_confidence_predictions_are_refused() -> None:
    s = SignSmoother(stable_frames=2, confidence_threshold=0.6)
    for _ in range(10):
        result = s.update("A", 0.31)
        assert result.committed is None
        assert "confidence" in result.reason


def test_a_flicker_does_not_commit() -> None:
    """A-B-A-B at high confidence must never produce a commit."""
    s = SignSmoother(stable_frames=3, confidence_threshold=0.5)
    commits = [s.update(label, 0.95).committed for label in "ABABABABABAB"]
    assert all(c is None for c in commits)


def test_rest_frames_end_the_utterance() -> None:
    s = SignSmoother(stable_frames=2, confidence_threshold=0.5, rest_frames=4)
    assert s.update("A", 0.9).committed is None
    assert s.update("A", 0.9).committed == "A"
    done_flags = [s.update(None, 0.0).utterance_done for _ in range(6)]
    assert done_flags.count(True) == 1, "utterance_done must fire exactly once"


def test_a_briefly_occluded_hand_does_not_split_the_word() -> None:
    s = SignSmoother(stable_frames=2, confidence_threshold=0.5, rest_frames=5)
    for _ in range(2):
        s.update("T", 0.9)
    for _ in range(2):  # shorter than rest_frames
        assert s.update(None, 0.0).utterance_done is False
    assert s.update("T", 0.9).label == "T"


def test_repeat_suppression_stops_one_held_sign_repeating() -> None:
    s = SignSmoother(stable_frames=2, confidence_threshold=0.5, repeat_suppression=5)
    commits = [s.update("H", 0.9).committed for _ in range(6)]
    assert commits.count("H") == 1, f"held sign committed repeatedly: {commits}"


def test_reset_clears_state() -> None:
    s = SignSmoother(stable_frames=2, confidence_threshold=0.5)
    s.update("A", 0.9)
    s.reset()
    assert s.committed_count == 0
    assert s.update("A", 0.9).committed is None


# --------------------------------------------------------------------------- #
# Vocabulary / sentence assembly
# --------------------------------------------------------------------------- #
def test_spelling_a_keyword_resolves_to_a_whole_phrase() -> None:
    buffer = LetterBuffer()
    for ch in "TICKET":
        # commit() only accumulates letters; the phrase resolves on flush()
        assert buffer.commit(ch) is None
    phrase = buffer.flush()
    assert phrase is not None
    assert phrase.id == "ticket"
    assert buffer.text_en() == "I want to buy a ticket."
    assert "टिकट" in buffer.text_hi()


def test_spelling_an_unknown_word_is_kept_verbatim() -> None:
    buffer = LetterBuffer()
    for ch in "XYZQ":
        buffer.commit(ch)
    buffer.flush()
    assert buffer.text_en() == "XYZQ"


def test_digits_accumulate_into_a_number() -> None:
    """A platform or token number is spelled as one run of digits."""
    buffer = LetterBuffer()
    for ch in "501":
        buffer.commit(ch)
    buffer.flush()
    assert buffer.text_en() == "501"
    assert lookup_phrase("501") is None


def test_pending_word_shows_while_spelling() -> None:
    buffer = LetterBuffer()
    for ch in "HELP":
        buffer.commit(ch)
    assert buffer.pending == "HELP"
    # The half-spelled word is shown with a trailing underscore so the signer can
    # see their own progress; it is not yet part of the sentence.
    assert buffer.text_en() == "HELP_"
    buffer.flush()
    assert buffer.pending == ""
    assert buffer.text_en() == "I need help."


def test_lookup_is_case_and_space_insensitive() -> None:
    assert lookup_phrase("waitingroom").id == "waiting_room"
    assert lookup_phrase("Waiting Room").id == "waiting_room"
    assert lookup_phrase("aadhar").id == "aadhaar"
    assert lookup_phrase("zzzz") is None
    assert lookup_phrase("") is None


def test_every_phrase_is_bilingual_and_unique() -> None:
    ids = [p.id for p in COUNTER_PHRASES]
    assert len(ids) == len(set(ids)), "duplicate phrase ids"
    for p in COUNTER_PHRASES:
        assert p.en.strip() and p.hi.strip(), f"{p.id} is missing a translation"
        assert any("\u0900" <= ch <= "\u097F" for ch in p.hi), f"{p.id} hi is not Devanagari"
        assert p.domain in {d.id for d in DOMAINS}, f"{p.id} has an unknown domain"
        assert p.keywords, f"{p.id} has no keywords, so it can never be fingerspelled"


def test_keyword_index_has_no_collisions() -> None:
    seen: dict[str, str] = {}
    for p in COUNTER_PHRASES:
        for k in p.keywords:
            key = k.replace(" ", "").upper()
            assert key not in seen, f"keyword {key} maps to both {seen[key]} and {p.id}"
            seen[key] = p.id


def test_domain_filter_always_includes_the_universal_phrases() -> None:
    railway = {p.id for p in phrases_for_domain("railway")}
    assert "ticket" in railway and "help" in railway
    assert "complaint" not in railway, "police-only phrase leaked into the railway domain"
    assert len(phrases_for_domain(None)) == len(COUNTER_PHRASES)


def test_fingerspell_vocabulary_covers_alphabet_and_digits() -> None:
    assert FINGERSPELL_CLASSES == [chr(c) for c in range(65, 91)] + [str(d) for d in range(10)]


def test_reset_empties_the_buffer() -> None:
    buffer = LetterBuffer()
    for ch in "TICKET":
        buffer.commit(ch)
    buffer.flush()
    buffer.reset()
    assert buffer.text_en() == ""
    assert len(buffer) == 0


def test_quick_card_appends_to_the_sentence() -> None:
    """The accessibility fallback works without any model or camera."""
    from islg.pipeline import TranslationSession
    from islg.vocab import PHRASES_BY_ID

    session = TranslationSession(model=object())  # quick-card path never touches the model

    state = session.speak_quick_phrase(PHRASES_BY_ID["toilet"])
    assert state.speak == {"text": "Where is the toilet?", "lang": "en"}
    assert state.phrase is not None and state.phrase["id"] == "toilet"
    assert state.sentence_en == "Where is the toilet?"

    session.set_language("hi")
    state = session.speak_quick_phrase(PHRASES_BY_ID["water"])
    assert state.speak["lang"] == "hi"
    assert "पानी" in state.speak["text"]
    assert state.sentence_hi, "Hindi sentence should not be empty"
    assert state.phrase["id"] == "water"
