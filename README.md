# TalkWithGesture — offline Indian Sign Language for public service counters

**PS-AIML-04** · Deaf and hard-of-hearing citizens face communication barriers at
railway, police, post-office and government counters. This system watches a
citizen sign, and speaks for them — **with no network connection at all**.

```
 webcam ──▶ MediaPipe Hands ──▶ 96-D landmark features ──▶ random forest ──▶ temporal
            (bundled TFLite,     (translation/scale/          (90.84%        smoother
             no download)         rotation invariant)          held-out)      ──▶ sentence
                                                                                    │
                                                              spoken by a local TTS engine ◀┘
```

Everything runs on the counter PC. The only model files are the TFLite graphs
shipped inside the `mediapipe` wheel and our own 20 MB classifier in `models/`.
`/api/state` reports `"cloud_used": false` and the UI shows which local speech
engine is active, so the offline claim is verifiable during judging rather than
asserted.

---

## Try it (60 seconds)

```bash
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python server/app.py                                  # -> http://localhost:8000
```

Press **Start camera**, allow access, and sign. The trained model ships in the
repo, so there is nothing to download or train first.

> The camera must be granted over `https://` or `localhost` — that is a browser
> rule, not a limitation of this project.

### Demo script that lands well with judges

1. Sign **T-I-C-K-E-T**, letter by letter, pausing after the last letter.
   The system says *"I want to buy a ticket."* — a sentence, not six letters.
2. Tap the **🚆 Railway** tab and then a **quick card**: the same sentence is
   spoken without any signing at all. That is the accessibility fallback for a
   signer who is struggling, and it is a deliberate design decision, not a stub.
3. Switch to **हिन्दी**: the identical interaction now speaks
   *"मुझे टिकट खरीदना है।"*
4. Open the **Speech engines** panel: the active engine is local; the badge in the
   header reads *offline*. Pull the network cable and nothing changes.

---

## What it actually recognises

| | |
|---|---|
| Classes | 36 — ISL fingerspelling **A–Z** and digits **0–9** |
| Held-out accuracy | **90.84%** on 1,364 real ISL photographs never seen in training |
| Accuracy at confidence ≥ 0.90 | **100.00%** (382/382) — this is why the confidence gate exists |
| Accuracy at confidence < 0.50 | 69.47% — and those are refused, never spoken |
| Vocabulary | 41 bilingual counter phrases across railway / police / post / government |
| Model size | 20.1 MB Python (`joblib`) · 4.9 MB browser JSON |
| Inference | ~45 ms/frame for landmarks on 2 shared sandbox CPUs; the classifier is <2 ms |

The full per-class recall/precision table and the top confusions are written to
`models/metrics.json` at training time. The honest headline: **9↔C, N↔R, X↔T and
G↔W are the hardest pairs**, because they differ by one finger's position and
MediaPipe's monocular depth is noisy exactly there.

## How a sign becomes a sentence

1. **Landmarks** — MediaPipe finds up to two hands and returns 21 3-D points each.
2. **Invariant features** — `islg/features.py` removes translation (wrist to
   origin), scale (divide by palm length), in-plane rotation (palm axis to
   vertical) and depth offset, then adds 20 joint angles, 5 finger-extension
   flags, handedness and two-handed geometry. Where a signer stands, how close
   they are, and how they tilt their hand are therefore *not* features.
3. **Classification** — a 150-tree random forest over 50 PCA components.
4. **Temporal smoothing** — `islg/smoother.py` refuses to commit until the same
   sign has been top-1 for 3 consecutive frames *and* clears 0.55 confidence, and
   suppresses repeats so one held sign cannot become "help help help".
5. **Sentence assembly** — `islg/vocab.py` accumulates letters into a word; a
   ~1.2 s pause (or the **End word** button / spacebar) closes the word, and a
   known keyword is upgraded to a full polite sentence in both languages.
6. **Speech** — Piper → espeak-ng → pyttsx3 → the browser's own OS voices.

## Repository layout

```
islg/                 the library — no web server, no camera required
  features.py         landmarks -> invariant feature vector   (the heart of it)
  hand_tracker.py     MediaPipe wrapper, NumPy-only surface
  smoother.py         per-frame debounce + word-boundary state machine
  vocab.py            41 bilingual counter phrases + sentence assembly
  pipeline.py         TranslationSession: the whole path, camera-free
  model.py            train / save / load / export-to-browser
  tts.py              offline speech engine chain
  collect.py          webcam data collector
server/
  app.py              FastAPI + WebSocket
  static/             operator UI, plus islg-model.js for the no-server mode
scripts/
  00_download_dataset.sh   fetch the public ISL image dataset (~339 MB, git-ignored)
  01_extract_landmarks.py  mine MediaPipe landmarks from it
  02_train.py              train, evaluate, save, export
  collect_data.py          record your own signs
tests/                46 tests, including a real end-to-end server test
models/               trained classifier (committed so the demo runs out of the box)
docs/                 ARCHITECTURE, PITCH, LIMITATIONS, INSTALL
```

## Training from scratch

```bash
bash scripts/00_download_dataset.sh          # 16,698 ISL images (A–Z, 0–9)
python scripts/01_extract_landmarks.py       # -> data/processed/landmarks.npz (~3 min)
python scripts/02_train.py                   # -> models/isl_gesture.joblib  (~15 s)
```

`01` writes a 3.2 MB landmark table rather than keeping 339 MB of JPEGs, so the
dataset is reproducible but never committed. `02` reports validation *and*
held-out test accuracy, the per-class table, and the top confusions.

### Make it recognise *your* signer

Cross-signer variation is the dominant error source, so record the person who
will demo:

```bash
python scripts/collect_data.py --sweep --classes T,I,C,K,E --count 40
python scripts/02_train.py --include-collected
```

Then `POST /api/retrain` (or restart the server) to hot-reload.

## Tests

```bash
pytest -q
```

46 tests. The ones worth reading before judging:

* `tests/test_features.py` — asserts the vector is genuinely invariant to
  translation, scale and rotation, which is what makes cross-signer accuracy
  possible at all.
* `tests/test_server_e2e.py` — drives the **running FastAPI app** over its
  WebSocket with real ISL photographs, and asserts that spelling `TICKET`
  produces a spoken `"I want to buy a ticket."` with a Hindi rendering.
* `tests/test_js_export.py` — runs the browser classifier under Node and checks
  it reproduces scikit-learn's transform to 9.7e-06 and its labels to 98.6%.
* `tests/test_model_and_pipeline.py` — re-scores the saved artefact on the rows
  training never saw, and pins the calibration that the confidence gate relies on.

## Design decisions worth defending

**Why landmarks instead of a CNN on pixels?** A landmark vector is ~40× smaller,
trains in 15 seconds on a CPU, and — crucially — the invariances are *engineered
and provable* rather than hoped for from augmentation. It also runs on a
Raspberry Pi. See `docs/ARCHITECTURE.md`.

**Why not full continuous ISL translation?** Because that is an unsolved research
problem and claiming otherwise in a hackathon is how projects die on stage. This
is honest isolated-sign recognition plus fingerspelling, which can already
express *any* word. See `docs/LIMITATIONS.md`.

**Why quick cards if the vision works?** A translator that fails silently is
worse than no translator. Under bad lighting or for a signer who is not fluent,
the citizen taps a picture and the sentence is still spoken.

## Dataset & attribution

Sign images: Sajanraj T D, Sreeram T P, Sarath, Tharun, Jameena (guidance: Beena
M V), Vidya Academy of Science & Technology — *"Indian Sign Language Recognition"*,
ICICCT 2018, [github.com/sajanraj/Indian-Sign-Language-Recognition](https://github.com/sajanraj/Indian-Sign-Language-Recognition).
Hand tracking: [MediaPipe](https://mediapipe.dev) (Apache-2.0), models bundled in
the pip wheel.

## Licence

MIT — see `LICENCE`.
