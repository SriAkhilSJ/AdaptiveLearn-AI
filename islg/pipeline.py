"""The end-to-end translation session: landmarks -> sign -> sentence -> speech.

Everything stateful about a conversation with one signer lives in
:class:`TranslationSession`, and it is deliberately camera-free: you feed it
feature vectors, it tells you what to display and what to say. The web server,
the OpenCV demo and the unit tests all drive the same object, so what you test is
what ships.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

from .features import build_feature_vector
from .hand_tracker import WRIST, HandObservation
from .model import GestureModel
from .smoother import FrameResult, SignSmoother
from .vocab import LetterBuffer, Phrase, describe_sign


@dataclass
class TranslationState:
    """Snapshot of a session, serialised straight to the browser."""

    hands: int = 0
    landmarks: List[List[float]] = field(default_factory=list)  # [[x, y], ...] normalised
    sign: Optional[str] = None
    confidence: float = 0.0
    progress: float = 0.0
    reason: str = ""
    committed: Optional[str] = None
    committed_description: str = ""
    pending_word: str = ""
    sentence_en: str = ""
    sentence_hi: str = ""
    phrase: Optional[Dict[str, str]] = None
    utterance_done: bool = False
    speak: Optional[Dict[str, str]] = None
    top3: List[Dict[str, object]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, object]:
        return {
            "hands": self.hands,
            "landmarks": self.landmarks,
            "sign": self.sign,
            "confidence": round(self.confidence, 4),
            "progress": round(self.progress, 4),
            "reason": self.reason,
            "committed": self.committed,
            "committedDescription": self.committed_description,
            "pendingWord": self.pending_word,
            "sentenceEn": self.sentence_en,
            "sentenceHi": self.sentence_hi,
            "phrase": self.phrase,
            "utteranceDone": self.utterance_done,
            "speak": self.speak,
            "top3": self.top3,
        }


class TranslationSession:
    """Owns a tracker-free pipeline for one signer."""

    def __init__(
        self,
        model: GestureModel,
        language: str = "en",
        speak_resolved_phrases_only: bool = True,
        smoother: Optional[SignSmoother] = None,
    ) -> None:
        self.model = model
        self.language = language
        self.speak_resolved_phrases_only = speak_resolved_phrases_only
        self.smoother = smoother or SignSmoother()
        self.buffer = LetterBuffer()
        self.frames = 0

    # ------------------------------------------------------------------ #
    def set_language(self, language: str) -> None:
        self.language = language if language in ("en", "hi") else "en"

    def reset(self) -> None:
        self.smoother.reset()
        self.buffer.reset()
        self.frames = 0

    # ------------------------------------------------------------------ #
    def from_observations(
        self, observations: List[HandObservation], language: Optional[str] = None
    ) -> TranslationState:
        """Full path used by the live server: MediaPipe output in, state out."""
        if language:
            self.set_language(language)
        vector = build_feature_vector(observations) if observations else None
        return self.from_vector(vector, observations)

    def from_vector(
        self, vector: Optional[np.ndarray], observations: Optional[List[HandObservation]] = None
    ) -> TranslationState:
        """Frame-level update. ``vector=None`` means "no usable hand this frame"."""
        self.frames += 1
        state = TranslationState()
        state.hands = len(observations or [])

        if observations:
            state.landmarks = [
                [round(float(p[0]), 4), round(float(p[1]), 4)]
                for obs in observations
                for p in obs.landmarks
            ]

        if vector is None:
            result = self.smoother.update(None, 0.0)
        else:
            label, conf, top3 = self.model.predict_one(vector)
            state.top3 = [{"label": k, "confidence": round(v, 4)} for k, v in top3.items()]
            result = self.smoother.update(label, conf)

        state.sign = result.label
        state.confidence = result.confidence
        state.progress = result.progress
        state.reason = result.reason
        state.committed = result.committed
        state.utterance_done = result.utterance_done

        if result.committed:
            state.committed_description = describe_sign(result.committed)
            phrase = self.buffer.commit(result.committed)
            state.phrase = self._phrase_dict(phrase)
            state.speak = self._speak_for_commit(result.committed, phrase)

        if result.utterance_done:
            phrase = self.buffer.flush()
            if phrase is not None:
                state.phrase = self._phrase_dict(phrase)
                state.speak = self._speak_for_phrase(phrase)

        state.pending_word = self.buffer.pending
        state.sentence_en = self.buffer.text_en()
        state.sentence_hi = self.buffer.text_hi()
        return state

    # ------------------------------------------------------------------ #
    def end_word(self) -> TranslationState:
        """Explicit word boundary: the signer pressed "end word" (or Space).

        Some signers prefer to delimit words deliberately rather than rely on the
        rest-timer, especially in a noisy, brightly-lit counter environment.
        """
        phrase = self.buffer.flush()
        self.smoother.reset()
        state = TranslationState()
        state.utterance_done = True
        state.pending_word = self.buffer.pending
        state.sentence_en = self.buffer.text_en()
        state.sentence_hi = self.buffer.text_hi()
        if phrase is not None:
            state.phrase = self._phrase_dict(phrase)
            state.speak = self._speak_for_phrase(phrase)
        return state

    def speak_quick_phrase(self, phrase: Phrase) -> TranslationState:
        """Accessibility fallback: the citizen tapped a picture card instead of signing."""
        self.buffer.words.append(phrase.en)
        self.buffer.resolved.append(phrase)
        state = TranslationState()
        state.phrase = self._phrase_dict(phrase)
        state.sentence_en = self.buffer.text_en()
        state.sentence_hi = self.buffer.text_hi()
        state.speak = self._speak_for_phrase(phrase)
        state.committed = phrase.id
        state.committed_description = phrase.en
        return state

    # ------------------------------------------------------------------ #
    @staticmethod
    def _phrase_dict(phrase: Optional[Phrase]) -> Optional[Dict[str, str]]:
        if phrase is None:
            return None
        return {
            "id": phrase.id,
            "en": phrase.en,
            "hi": phrase.hi,
            "hiTranslit": phrase.hi_translit,
            "domain": phrase.domain,
            "emoji": phrase.emoji,
        }

    def _speak_for_phrase(self, phrase: Phrase) -> Dict[str, str]:
        return {"text": phrase.hi if self.language == "hi" else phrase.en, "lang": self.language}

    def _speak_for_commit(self, sign: str, phrase: Optional[Phrase]) -> Optional[Dict[str, str]]:
        if phrase is not None:
            return self._speak_for_phrase(phrase)
        if self.speak_resolved_phrases_only:
            return None  # do not shout single letters; wait for the word
        text = sign if self.language == "en" else sign
        return {"text": text, "lang": self.language}

    # ------------------------------------------------------------------ #
    @staticmethod
    def wrist_points(observations: List[HandObservation]) -> List[List[float]]:
        return [[float(o.landmarks[WRIST][0]), float(o.landmarks[WRIST][1])] for o in observations]
