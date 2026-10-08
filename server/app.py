"""Local FastAPI server: webcam frames in, translated speech directives out.

Run it on the counter PC::

    python server/app.py --host 0.0.0.0 --port 8000

Nothing here reaches the network. MediaPipe's hand models come from the installed
wheel, the gesture classifier is ``models/isl_gesture.joblib``, and speech is
produced by a local TTS engine (or by the browser's own OS voices).

Endpoints
---------
``GET  /``               the operator UI (``server/static``)
``GET  /api/state``      model metadata, class list, TTS engines, phrase book
``WS   /ws/vision``      binary JPEG frames in -> JSON translation state out
``POST /api/speak``      speak arbitrary text through the local engine
``POST /api/collect``    save a labelled landmark sample from the browser
``POST /api/retrain``    trigger ``scripts/02_train.py --include-collected``
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from islg import config  # noqa: E402
from islg.collect import COLLECT_DIR  # noqa: E402
from islg.features import build_feature_vector  # noqa: E402
from islg.hand_tracker import HandTracker  # noqa: E402
from islg.model import GestureModel  # noqa: E402
from islg.pipeline import TranslationSession  # noqa: E402
from islg.tts import Speaker, engine_report  # noqa: E402
from islg.vocab import DOMAINS, COUNTER_PHRASES, PHRASES_BY_ID, FINGERSPELL_CLASSES  # noqa: E402

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="TalkWithGesture", version="0.1.0", docs_url=None, redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1024)

# --------------------------------------------------------------------------- #
# Process-wide singletons
# --------------------------------------------------------------------------- #
_MODEL: Optional[GestureModel] = None
_MODEL_LOCK = threading.Lock()


def get_model(reload: bool = False) -> GestureModel:
    """Lazily load (and optionally hot-reload) the gesture classifier."""
    global _MODEL
    with _MODEL_LOCK:
        if _MODEL is None or reload:
            _MODEL = GestureModel.load(config.MODEL_PATH)
        return _MODEL


class VisionWorker:
    """One MediaPipe graph + one translation session per connected browser.

    MediaPipe's Hands graph is stateful and not thread-safe, so each WebSocket
    gets its own worker and a lock that serialises frame processing.
    """

    def __init__(self, language: str = "en") -> None:
        # Static mode, not tracking mode. Measured on repeated identical frames,
        # MediaPipe's inter-frame tracker slowly drifts when a signer *holds* a
        # sign still -- confidence for one ISL "E" decayed 0.98 -> 0.36 over five
        # frames -- which is precisely the moment the system must stay steady.
        # It also matches how the training set was mined, so live features have
        # the same distribution as the ones the model learned from.
        self.tracker = HandTracker(video_mode=False)
        self.session = TranslationSession(get_model(), language=language)
        self.lock = threading.Lock()
        self.frames = 0
        self.last_fps = 0.0
        self._t_prev = time.perf_counter()

    def process(self, jpeg: bytes) -> Dict[str, object]:
        import cv2

        with self.lock:
            buf = np.frombuffer(jpeg, dtype=np.uint8)
            frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)
            if frame is None:
                return {"error": "undecodable frame"}

            observations = self.tracker.landmarks(frame)
            state = self.session.from_observations(observations)

            now = time.perf_counter()
            dt = now - self._t_prev
            self._t_prev = now
            self.frames += 1
            self.last_fps = (1.0 / dt) if dt > 1e-6 else 0.0

            payload = state.to_dict()
            payload["fps"] = round(self.last_fps, 1)
            payload["frames"] = self.frames
            return payload

    def close(self) -> None:
        with self.lock:
            self.tracker.close()


# --------------------------------------------------------------------------- #
# HTTP API
# --------------------------------------------------------------------------- #
@app.get("/api/state")
async def api_state() -> JSONResponse:
    model = await run_in_threadpool(get_model)
    metrics_path = config.MODEL_DIR / "metrics.json"
    metrics = json.loads(metrics_path.read_text()) if metrics_path.exists() else {}
    return JSONResponse(
        {
            "offline": True,
            "model": {
                "path": str(config.MODEL_PATH.relative_to(ROOT)),
                "classes": model.classes,
                "n_classes": len(model.classes),
                "feature_dim": model.feature_dim,
                "test_accuracy": model.accuracy,
                "top1_margin": model.top1_margin,
            },
            "metrics": metrics,
            "tts": engine_report(),
            "language": "en",
            "domains": [d.__dict__ for d in DOMAINS],
            "phrases": [p.__dict__ for p in COUNTER_PHRASES],
            "fingerspell": FINGERSPELL_CLASSES,
            "collected": await run_in_threadpool(_collected_counts),
            "smoother": {
                "stable_frames": config.STABLE_FRAMES,
                "confidence_threshold": config.CONFIDENCE_THRESHOLD,
                "rest_frames": config.REST_FRAMES_TO_COMMIT,
            },
        }
    )


def _collected_counts() -> Dict[str, int]:
    if not COLLECT_DIR.exists():
        return {}
    return {d.name: len(list(d.glob("*.npz"))) for d in sorted(COLLECT_DIR.iterdir()) if d.is_dir()}


@app.post("/api/speak")
async def api_speak(body: dict) -> JSONResponse:
    text = (body or {}).get("text", "")
    lang = (body or {}).get("lang", "en")
    engine = (body or {}).get("engine")
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    speaker = Speaker(engine=engine)
    spoken = await run_in_threadpool(speaker.speak, text, lang)
    return JSONResponse({"engine": speaker.engine_name, "spokenLocally": spoken, "text": text})


@app.post("/api/collect")
async def api_collect(body: dict) -> JSONResponse:
    """Save a landmark sample captured in the browser into ``data/collected``."""
    label = str((body or {}).get("label", "")).strip().upper()
    vector = (body or {}).get("vector")
    if not label or not vector:
        raise HTTPException(status_code=400, detail="label and vector are required")
    vec = np.asarray(vector, dtype=np.float32)
    if vec.shape != (get_model().feature_dim,):
        raise HTTPException(status_code=400, detail=f"expected {get_model().feature_dim} features")
    target = COLLECT_DIR / label
    target.mkdir(parents=True, exist_ok=True)
    path = target / f"{int(time.time() * 1000)}.npz"
    await run_in_threadpool(
        lambda: np.savez_compressed(path, vec=vec, label=label, handedness=str((body or {}).get("handedness", "?")))
    )
    return JSONResponse({"saved": str(path.relative_to(ROOT)), "label": label})


@app.post("/api/retrain")
async def api_retrain() -> JSONResponse:
    """Retrain including browser-collected samples, then hot-reload the model."""
    log_path = ROOT / "data" / "retrain.log"
    cmd = [sys.executable, "-u", str(ROOT / "scripts" / "02_train.py"), "--include-collected"]
    with open(log_path, "w") as log:
        proc = subprocess.Popen(cmd, cwd=str(ROOT), stdout=log, stderr=subprocess.STDOUT)
    proc.wait()
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=f"training failed; see {log_path.name}")
    await run_in_threadpool(get_model, True)
    return JSONResponse({"ok": True, "log": log_path.read_text()[-2000:]})


# --------------------------------------------------------------------------- #
# WebSocket vision stream
# --------------------------------------------------------------------------- #
@app.websocket("/ws/vision")
async def ws_vision(ws: WebSocket) -> None:
    await ws.accept()
    worker: Optional[VisionWorker] = None
    speaker = Speaker()
    try:
        worker = await run_in_threadpool(VisionWorker)
        await ws.send_json({"type": "ready", "classes": worker.session.model.classes})

        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break

            data = message.get("bytes")
            if data:
                result = await run_in_threadpool(worker.process, data)
                await ws.send_json({"type": "frame", **result})
                speak = result.get("speak")
                if speak and speaker.engine_name != "browser":
                    # Only used when a local engine exists; the browser speaks for
                    # itself otherwise (it receives the same directive in `speak`).
                    await run_in_threadpool(speaker.speak, speak["text"], speak.get("lang", "en"))
                continue

            text = message.get("text")
            if not text:
                continue
            try:
                control = json.loads(text)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "detail": "invalid JSON control message"})
                continue

            kind = control.get("type")
            if kind == "language":
                worker.session.set_language(str(control.get("lang", "en")))
                await ws.send_json({"type": "language", "lang": worker.session.language})
            elif kind == "flush":
                state = worker.session.end_word()
                await ws.send_json({"type": "frame", **state.to_dict()})
                if speaker.engine_name != "browser" and state.speak:
                    await run_in_threadpool(speaker.speak, state.speak["text"], state.speak["lang"])
            elif kind == "reset":
                worker.session.reset()
                await ws.send_json({"type": "reset"})
            elif kind == "quick":
                phrase = PHRASES_BY_ID.get(str(control.get("id", "")))
                if phrase is None:
                    await ws.send_json({"type": "error", "detail": "unknown phrase id"})
                else:
                    state = worker.session.speak_quick_phrase(phrase)
                    await ws.send_json({"type": "frame", **state.to_dict()})
                    if speaker.engine_name != "browser" and state.speak:
                        await run_in_threadpool(speaker.speak, state.speak["text"], state.speak["lang"])
            elif kind == "collect":
                await ws.send_json({"type": "error", "detail": "use POST /api/collect"})
            else:
                await ws.send_json({"type": "error", "detail": f"unknown control type: {kind}"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # pragma: no cover - surfaced to the client for debugging
        try:
            await ws.send_json({"type": "error", "detail": str(exc)})
        except Exception:
            pass
    finally:
        if worker is not None:
            await run_in_threadpool(worker.close)


# --------------------------------------------------------------------------- #
# Static assets
# --------------------------------------------------------------------------- #
@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
if config.MODEL_DIR.exists():
    app.mount("/models", StaticFiles(directory=config.MODEL_DIR), name="models")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    ap.add_argument("--reload", action="store_true")
    args = ap.parse_args()

    import uvicorn

    get_model()  # fail fast with a clear message if the model is missing
    print(f"[info] model loaded: {len(get_model().classes)} classes, "
          f"held-out accuracy {get_model().accuracy*100:.2f}%")
    print(f"[info] open http://localhost:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
