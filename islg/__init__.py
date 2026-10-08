"""TalkWithGesture -- offline Indian Sign Language translation for service counters.

Built for PS-AIML-04. The whole perception + language pipeline runs on the
counter PC with no network access; the only models used (MediaPipe palm
detection / hand landmark, and our own gesture classifier) are local files.
"""

from __future__ import annotations

__version__ = "0.1.0"

__all__ = ["__version__"]
