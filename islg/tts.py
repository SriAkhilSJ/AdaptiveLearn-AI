"""Offline text-to-speech with a documented fallback chain.

PS-AIML-04 requires speech output *without* cloud connectivity, so no network
TTS API is used anywhere in this project. Instead we probe a chain of local
engines and use the first that works on the machine the counter is running on:

1. **Piper** (``piper-tts`` + a local ``.onnx`` voice) -- best quality, needs a
   voice file on disk. See ``docs/INSTALL.md``.
2. **espeak-ng** -- present on most Linux installs and on Raspberry Pi OS;
   robotic but it does have a real Hindi voice (``hi``).
3. **pyttsx3** -- Windows SAPI5 / macOS NSSpeechSynthesizer. This is what most
   hackathon laptops will actually use, and Windows ships a Hindi voice
   ("Microsoft Kalpana"/"Hemant") that it picks up automatically.
4. **Browser ``speechSynthesis``** -- the server returns a ``speak`` directive
   and the page speaks using the operating system's local voices. Zero
   installation, fully offline, and it is the default when nothing else is
   available (e.g. inside a container with no audio device).

``available_engines()`` is surfaced in the web UI so that during a demo you can
prove the speech is coming from the local machine.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional

EN = "en"
HI = "hi"


@dataclass(frozen=True)
class Engine:
    name: str
    available: bool
    detail: str
    supports_hindi: bool = True


def _probe_piper() -> Engine:
    try:
        import piper  # noqa: F401
    except Exception as exc:  # pragma: no cover - optional dependency
        return Engine("piper", False, f"not installed ({type(exc).__name__})")
    voices = list(Path("voices").glob("*.onnx")) if Path("voices").exists() else []
    if not voices:
        return Engine("piper", False, "installed but no local .onnx voice found in ./voices")
    return Engine("piper", True, f"{len(voices)} local voice(s): {', '.join(v.stem for v in voices)}",
                  supports_hindi=any("hi" in v.stem.lower() for v in voices))


def _probe_espeak() -> Engine:
    exe = shutil.which("espeak-ng") or shutil.which("espeak")
    if not exe:
        return Engine("espeak-ng", False, "binary not on PATH")
    try:
        out = subprocess.run([exe, "--voices"], capture_output=True, text=True, timeout=10).stdout
        has_hi = any(line.split() and "hi" in line.split() for line in out.splitlines())
        return Engine("espeak-ng", True, f"{Path(exe).name} found; Hindi voice: {has_hi}", supports_hindi=has_hi)
    except Exception as exc:  # pragma: no cover
        return Engine("espeak-ng", False, f"probe failed: {exc}")


def _probe_pyttsx3() -> Engine:
    try:
        import pyttsx3  # noqa: F401
    except Exception as exc:
        return Engine("pyttsx3", False, f"not installed ({type(exc).__name__})")
    try:  # actually initialise it: import success is not enough on Linux
        engine = pyttsx3.init()
        voices = engine.getProperty("voices") or []
        names = [getattr(v, "name", "") for v in voices]
        has_hi = any("hi" in n.lower() or "hindi" in n.lower() for n in names)
        engine.stop()
        return Engine(
            "pyttsx3",
            True,
            f"{len(names)} system voice(s): {', '.join(names[:4])}{'...' if len(names) > 4 else ''}",
            supports_hindi=has_hi,
        )
    except Exception as exc:
        return Engine("pyttsx3", False, f"installed but init failed ({exc})")


def available_engines() -> List[Engine]:
    """Probe every local engine. Safe to call repeatedly (results are not cached
    so the UI reflects the machine it is running on right now)."""
    return [
        _probe_piper(),
        _probe_espeak(),
        _probe_pyttsx3(),
        Engine("browser", True, "Web Speech API in the client page (uses OS voices)", supports_hindi=True),
    ]


def default_engine() -> str:
    for engine in available_engines():
        if engine.available and engine.name != "browser":
            return engine.name
    return "browser"


# --------------------------------------------------------------------------- #
# Speaking
# --------------------------------------------------------------------------- #
class Speaker:
    """Speaks text on the local machine; returns ``False`` if it cannot."""

    def __init__(self, engine: Optional[str] = None, rate: int = 165, on_speak: Optional[Callable[[str, str], None]] = None) -> None:
        self.engine_name = engine or default_engine()
        self.rate = rate
        self._on_speak = on_speak  # e.g. push a directive to the browser over WebSocket
        self._pyttsx3 = None

    # ------------------------------------------------------------------ #
    def speak(self, text: str, lang: str = EN) -> bool:
        """Speak ``text``. Returns True if an engine actually produced audio."""
        text = (text or "").strip()
        if not text:
            return False
        if self._on_speak is not None:
            self._on_speak(text, lang)

        if self.engine_name == "browser":
            return False  # the browser handles it; nothing to do server-side
        if self.engine_name == "espeak-ng":
            return self._speak_espeak(text, lang)
        if self.engine_name == "pyttsx3":
            return self._speak_pyttsx3(text, lang)
        if self.engine_name == "piper":
            return self._speak_piper(text, lang)
        return False

    # ------------------------------------------------------------------ #
    def _speak_espeak(self, text: str, lang: str) -> bool:
        exe = shutil.which("espeak-ng") or shutil.which("espeak")
        if not exe:
            return False
        voice = "hi" if lang == HI else "en"
        try:
            subprocess.Popen(
                [exe, "-v", voice, "-s", str(self.rate), text],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        except Exception:  # pragma: no cover
            return False

    def _speak_pyttsx3(self, text: str, lang: str) -> bool:
        try:
            import pyttsx3
        except Exception:
            return False
        try:
            if self._pyttsx3 is None:
                self._pyttsx3 = pyttsx3.init()
            engine = self._pyttsx3
            engine.setProperty("rate", self.rate)
            if lang == HI:
                for v in engine.getProperty("voices") or []:
                    name = (getattr(v, "name", "") or "").lower()
                    if "hindi" in name or name.startswith("hi"):
                        engine.setProperty("voice", v.id)
                        break
            engine.say(text)
            engine.runAndWait()
            return True
        except Exception:  # pragma: no cover - audio device may be absent
            return False

    def _speak_piper(self, text: str, lang: str) -> bool:  # pragma: no cover - optional
        try:
            from piper import PiperVoice
        except Exception:
            return False
        voices_dir = Path("voices")
        wanted = f"hi_IN-{lang}" if lang == HI else "en_GB-alba"
        matches = sorted(voices_dir.glob("*.onnx")) if voices_dir.exists() else []
        voice_path = next((p for p in matches if wanted.split("-")[0] in p.stem), matches[0] if matches else None)
        if voice_path is None:
            return False
        try:
            import wave

            voice = PiperVoice.load(str(voice_path))
            with wave.open("/tmp/islg_tts.wav", "wb") as wav:
                voice.synthesize_wav(text, wav)
            player = shutil.which("aplay") or shutil.which("ffplay")
            if not player:
                return False
            args = [player, "/tmp/islg_tts.wav"] if player.endswith("aplay") else [player, "-nodisp", "-autoexit", "/tmp/islg_tts.wav"]
            subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except Exception:
            return False


def engine_report() -> Dict[str, object]:
    """JSON-serialisable snapshot for the UI's 'offline proof' panel."""
    engines = available_engines()
    return {
        "default": default_engine(),
        "engines": [e.__dict__ for e in engines],
        "cloud_used": False,
    }
