"""End-to-end test of the *running server*, driven by real ISL photographs.

This is the test that proves the product works, not just the pieces: a JPEG goes
into the WebSocket, MediaPipe finds the hand, the classifier names the sign, the
smoother commits it, the sentence buffer assembles a phrase, and a ``speak``
directive comes back out. Nothing here uses a camera or a mock -- the frames are
actual images from the ISL dataset the model was trained from, selected by ground
truth and re-encoded to JPEG exactly as the browser would send them.

    pytest tests/test_server_e2e.py -s
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from islg import config  # noqa: E402

pytestmark = pytest.mark.skipif(
    not (config.MODEL_PATH.exists() and config.LANDMARK_TABLE.exists()),
    reason="run scripts/01_extract_landmarks.py and scripts/02_train.py first",
)

_CACHE: dict = {}


def _jpeg_for_sign(label: str, min_confidence: float = 0.8) -> bytes:
    """A real dataset photograph of ``label`` that the model classifies confidently."""
    import cv2

    if "table" not in _CACHE:
        with np.load(config.LANDMARK_TABLE, allow_pickle=False) as blob:
            _CACHE["table"] = (blob["X"], np.asarray(blob["y"]).astype(str), np.asarray(blob["src"]).astype(str))
    X, y, src = _CACHE["table"]

    if "model" not in _CACHE:
        from islg.model import GestureModel

        _CACHE["model"] = GestureModel.load()
    model = _CACHE["model"]

    idx = np.where(y == label)[0]
    assert len(idx), f"no ground-truth {label!r} rows in the landmark table"
    predicted, confidence = model.predict(X[idx])
    good = np.where((predicted == label) & (confidence >= min_confidence))[0]
    assert len(good), f"the model is never confident about ground-truth {label!r}"
    best = idx[good[int(np.argmax(confidence[good]))]]

    frame = cv2.imread(str(src[best]), cv2.IMREAD_COLOR)
    assert frame is not None, f"could not read {src[best]}"
    ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    assert ok
    return encoded.tobytes()


def _blank_frame() -> bytes:
    """A frame with no hand in it -- the 'rest' signal."""
    import cv2

    frame = np.full((360, 480, 3), 30, dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", frame)
    assert ok
    return encoded.tobytes()


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from server.app import app

    with TestClient(app) as test_client:
        yield test_client


def test_state_endpoint_reports_an_offline_system(client) -> None:
    response = client.get("/api/state")
    assert response.status_code == 200
    body = response.json()
    assert body["offline"] is True
    assert body["tts"]["cloud_used"] is False
    assert len(body["model"]["classes"]) >= 36
    assert len(body["phrases"]) >= 30
    assert body["fingerspell"] == [chr(c) for c in range(65, 91)] + [str(d) for d in range(10)]


def test_index_and_assets_are_served(client) -> None:
    assert client.get("/").status_code == 200
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/static/styles.css").status_code == 200


def _recv_frame(client) -> dict:
    """Read until the next vision frame, skipping control acknowledgements."""
    for _ in range(10):
        message = client.receive_json()
        if message.get("type") == "frame":
            return message
        assert message["type"] in {"ready", "language", "reset"}, message
    raise AssertionError("no frame arrived after 10 control messages")


def test_a_single_sign_is_recognised_from_a_real_photograph(client) -> None:
    jpeg = _jpeg_for_sign("A")
    with client.websocket_connect("/ws/vision") as ws:
        assert ws.receive_json()["type"] == "ready"

        committed = None
        last = None
        for _ in range(8):
            ws.send_bytes(jpeg)
            last = _recv_frame(ws)
            committed = committed or last.get("committed")

        assert last is not None
        assert last["hands"] >= 1, "MediaPipe found no hand in a real ISL photograph"
        assert len(last["landmarks"]) >= 21, "landmarks were not returned to the client"
        assert last["sign"] == "A", f"expected A, saw {last['sign']} at {last['confidence']:.2f}"
        assert committed == "A", f"the sign was never committed: {last['reason']}"


def test_spelling_ticket_produces_a_spoken_bilingual_sentence(client) -> None:
    """The headline demo path, from photograph bytes to a spoken sentence."""
    from islg import config as cfg

    frames_per_sign = cfg.STABLE_FRAMES + 2
    rest_frames = cfg.REST_FRAMES_TO_COMMIT + 2
    blank = _blank_frame()
    spoken = []

    with client.websocket_connect("/ws/vision") as ws:
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "language", "lang": "en"})

        for ch in "TICKET":
            jpeg = _jpeg_for_sign(ch)
            for _ in range(frames_per_sign):
                ws.send_bytes(jpeg)
                frame = _recv_frame(ws)
                if frame.get("speak"):
                    spoken.append(frame["speak"])
            # A short transition between letters must not end the word.
            for _ in range(5):
                ws.send_bytes(blank)
                _recv_frame(ws)

        # Now the deliberate pause that closes the word.
        final = None
        for _ in range(rest_frames):
            ws.send_bytes(blank)
            final = _recv_frame(ws)
            if final.get("speak"):
                spoken.append(final["speak"])

        assert final is not None
        assert final["sentenceEn"] == "I want to buy a ticket.", final["sentenceEn"]
        assert "टिकट" in final["sentenceHi"], final["sentenceHi"]
        assert spoken, "nothing was spoken while spelling a known keyword"
        assert spoken[-1]["text"] == "I want to buy a ticket."
        assert spoken[-1]["lang"] == "en"


def test_quick_card_speaks_without_any_signing(client) -> None:
    """The accessibility fallback: tap a card, hear a sentence."""
    with client.websocket_connect("/ws/vision") as ws:
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "language", "lang": "hi"})
        assert ws.receive_json()["type"] == "language"

        ws.send_json({"type": "quick", "id": "doctor"})
        frame = _recv_frame(ws)
        assert frame["speak"]["lang"] == "hi"
        assert "डॉक्टर" in frame["speak"]["text"], frame["speak"]["text"]
        assert frame["phrase"]["id"] == "doctor"


def test_unknown_quick_card_is_rejected(client) -> None:
    with client.websocket_connect("/ws/vision") as ws:
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "quick", "id": "does-not-exist"})
        assert ws.receive_json()["type"] == "error"


def test_reset_clears_the_sentence(client) -> None:
    with client.websocket_connect("/ws/vision") as ws:
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "quick", "id": "thanks"})
        _recv_frame(ws)
        ws.send_json({"type": "reset"})
        assert ws.receive_json()["type"] == "reset"
        ws.send_json({"type": "quick", "id": "yes"})
        frame = _recv_frame(ws)
        assert frame["sentenceEn"] == "Yes.", frame["sentenceEn"]
