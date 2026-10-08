"""Temporal smoothing: the difference between a demo that works and one that lies.

A sign-language recogniser evaluated frame-by-frame looks excellent in a
confusion matrix and unusable in the field, because a single bad frame at the
moment the clerk is listening inserts a wrong word into the spoken sentence.

:meth:`SignSmoother.update` accepts one raw prediction per frame and only emits
a *commit* when the same sign has been the most likely one for
``STABLE_FRAMES`` consecutive frames **and** its calibrated probability clears
``CONFIDENCE_THRESHOLD``. When the hands drop out of frame for
``REST_FRAMES_TO_COMMIT`` frames the smoother reports the end of the utterance,
which is what lets :class:`~islg.vocab.LetterBuffer` flush the current word --
the same pause a signer naturally makes between signs.

The state machine is deliberately tiny and fully unit-testable without a camera.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .config import (
    CONFIDENCE_THRESHOLD,
    REPEAT_SUPPRESSION_FRAMES,
    REST_FRAMES_TO_COMMIT,
    STABLE_FRAMES,
)


@dataclass
class FrameResult:
    """What the smoother decided about one frame."""

    label: Optional[str] = None  # smoothed current-best sign (for live display)
    confidence: float = 0.0
    committed: Optional[str] = None  # set exactly once per accepted sign
    utterance_done: bool = False  # rest detected -> flush the word buffer
    stable_frames: int = 0  # how long the current candidate has held
    progress: float = 0.0  # stable_frames / STABLE_FRAMES, for the UI ring
    reason: str = ""


class SignSmoother:
    """Debounce raw per-frame predictions into committed signs."""

    def __init__(
        self,
        stable_frames: int = STABLE_FRAMES,
        confidence_threshold: float = CONFIDENCE_THRESHOLD,
        rest_frames: int = REST_FRAMES_TO_COMMIT,
        repeat_suppression: int = REPEAT_SUPPRESSION_FRAMES,
    ) -> None:
        self.stable_frames = max(1, stable_frames)
        self.confidence_threshold = confidence_threshold
        self.rest_frames = max(1, rest_frames)
        self.repeat_suppression = max(0, repeat_suppression)

        self._candidate: Optional[str] = None
        self._candidate_run = 0
        self._rest_run = 0
        self._frames_since_commit = 10**9
        self._last_commit: Optional[str] = None
        self.history: list[tuple[Optional[str], float]] = []

    # ------------------------------------------------------------------ #
    def update(self, label: Optional[str], confidence: float = 0.0) -> FrameResult:
        """Feed one frame. ``label=None`` means no hand / no confident detection."""
        self._frames_since_commit += 1
        accepted = label is not None and confidence >= self.confidence_threshold

        if not accepted:
            # Losing the candidate: require a full rest period before we treat it
            # as the end of the utterance, so a briefly occluded hand does not
            # split a word in half.
            self._candidate = None
            self._candidate_run = 0
            self._rest_run += 1
            done = self._rest_run >= self.rest_frames
            if done:
                self._rest_run = 0
            return FrameResult(
                label=None,
                confidence=float(confidence),
                utterance_done=done,
                reason="no hand" if label is None else f"confidence {confidence:.2f} < {self.confidence_threshold:.2f}",
            )

        self._rest_run = 0

        if label == self._candidate:
            self._candidate_run += 1
        else:
            self._candidate = label
            self._candidate_run = 1

        progress = min(1.0, self._candidate_run / self.stable_frames)

        if self._candidate_run < self.stable_frames:
            return FrameResult(
                label=label,
                confidence=float(confidence),
                stable_frames=self._candidate_run,
                progress=progress,
                reason=f"holding {self._candidate_run}/{self.stable_frames}",
            )

        # Candidate is stable. Suppress an immediate repeat of the same sign
        # (the signer is still holding it) but allow a deliberate re-sign later.
        if (
            label == self._last_commit
            and self._frames_since_commit <= self.repeat_suppression
        ):
            return FrameResult(
                label=label,
                confidence=float(confidence),
                stable_frames=self._candidate_run,
                progress=1.0,
                reason="repeat suppressed",
            )

        self._last_commit = label
        self._frames_since_commit = 0
        self._candidate_run = 0
        self._candidate = None
        self.history.append((label, float(confidence)))
        return FrameResult(
            label=label,
            confidence=float(confidence),
            committed=label,
            progress=1.0,
            reason="committed",
        )

    # ------------------------------------------------------------------ #
    def reset(self) -> None:
        self._candidate = None
        self._candidate_run = 0
        self._rest_run = 0
        self._frames_since_commit = 10**9
        self._last_commit = None
        self.history.clear()

    @property
    def committed_count(self) -> int:
        return len(self.history)
