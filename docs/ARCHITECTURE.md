# Architecture

## The problem, restated as engineering constraints

PS-AIML-04 asks for a system that works at a government counter. That imposes four
constraints which drive every decision below:

1. **No reliable network.** No cloud vision API, no cloud TTS, no model download
   at runtime.
2. **Cheap hardware.** A counter PC, eventually maybe a Raspberry Pi. No GPU.
3. **A new signer every 30 seconds.** The system cannot be tuned to one person.
4. **Silent failure is unacceptable.** A wrong sentence spoken aloud to a police
   officer is worse than the system saying nothing.

## Pipeline

```
                 ┌──────────────────────── browser (operator UI) ───────────────────────┐
                 │ getUserMedia → JPEG (480 px, q0.72) ─┐      ▲ state JSON             │
                 │ skeleton overlay, confidence ring,   │      │ SpeechSynthesis        │
                 │ sentence, quick cards, language      │      │ (local OS voices)      │
                 └──────────────────────────────────────┼──────┼────────────────────────┘
                                                    WS binary   WS json
                 ┌──────────────────────────────────────▼──────┴────────────────────────┐
                 │ FastAPI (server/app.py) — one VisionWorker per connection            │
                 │                                                                      │
                 │  HandTracker        features.build_feature_vector   GestureModel      │
                 │  MediaPipe Hands ─▶ 21×3 pts, invariant ─────────▶ random forest ────┤
                 │  (static mode)      normalisation + angles                            │
                 │                                                                     │
                 │  SignSmoother ──▶ LetterBuffer ──▶ Phrase ──▶ speak directive ───────┤
                 └──────────────────────────────────────────────────────────────────────┘
```

### Why the camera lives in the browser

`getUserMedia` only works in a browser, and the counter's webcam is attached to
the counter PC. Streaming frames to a *local* server keeps the CV in Python
(where MediaPipe's bundled models already are) while the UI stays a normal web
page. Frames never leave `localhost`.

### Why static MediaPipe mode, not tracking mode

Measured, not guessed: fed the same frozen image repeatedly, MediaPipe's
inter-frame tracker drifts. On one ISL "E" the wrist landmark moved from x=0.1517
to x=0.1257 over five frames and the classifier's confidence decayed
**0.98 → 0.54 → 0.45 → 0.44 → 0.36**, until the sign was refused outright. A
signer holding a sign still is the *normal* case, so the live path uses
`static_image_mode=True`. It is also how the dataset was mined, so live features
come from the same distribution as the training ones. Static mode is fully
deterministic: the same frame always yields the same 21 landmarks.

## Feature engineering (`islg/features.py`)

The 96-D vector is the whole reason 90.84% is achievable from a classical
classifier. Raw MediaPipe coordinates encode *where the person was standing*;
we remove that before the model ever sees it.

| Stage | Operation | Removes |
|---|---|---|
| 1 | subtract the wrist landmark | translation |
| 2 | divide by ‖wrist → middle MCP‖ | scale / distance from camera |
| 3 | rotate the palm axis to vertical | in-plane hand tilt |
| 4 | clip and keep z relative to the wrist | depth offset |

Then, appended:

* **63** normalised coordinates (21 × 3)
* **20 joint angles** — rotation-invariant by construction, and the sharpest
  discriminator between lookalikes such as ISL G/H and N/M
* **5 finger-extension flags**
* **handedness** one-hot + score
* **two-handed geometry** — wrist separation and palm-axis angle difference,
  which is what makes two-handed ISL signs representable at all

`tests/test_features.py` asserts invariance numerically rather than trusting the
implementation: the same hand translated, scaled 2.7×, and rotated by 15°/−30°/90°/175°
must produce the same vector.

## Model (`islg/model.py`)

StandardScaler → PCA(50) → RandomForest(150 trees, `min_samples_leaf=10`,
`max_samples=0.8`, `class_weight="balanced_subsample"`).

A forest rather than a neural net because it trains in 13 s on two CPU cores,
serialises to 20 MB with no framework runtime, and gives calibrated
probabilities — which the smoother needs in order to *refuse* a shaky sign.

The hyper-parameters were chosen from a measured size/accuracy sweep, not by
taste:

| trees | leaf | ccp_α | held-out acc | size |
|---|---|---|---|---|
| 250 | 6 | 0 | 91.86% | 43.8 MB |
| **150** | **10** | **0** | **90.84%** | **20.1 MB** |
| 150 | 10 | 0.0002 | 90.10% | 17.8 MB |
| 120 | 12 | 0.0004 | 88.71% | 10.7 MB |
| 100 | 15 | 0.0006 | 86.51% | 6.9 MB |

We took a one-point accuracy hit to halve the artefact, because the artefact has
to be copied onto a counter PC. For a Pi-only deployment set `ISLG_TREES=100
ISLG_MIN_LEAF=15` and accept 86.5% at 6.9 MB.

## Temporal smoothing (`islg/smoother.py`)

A frame-level confusion matrix is not what the clerk hears. Three gates:

1. **Stability** — a sign must be top-1 for `STABLE_FRAMES` (3) consecutive frames.
2. **Confidence** — it must also clear 0.55. Justified by measurement: on held-out
   data the model is **100.00% correct (382/382) when confidence ≥ 0.90** and only
   69.47% correct below 0.50. Refusing the low band trades recall for precision,
   which is the right trade when the output is spoken aloud.
3. **Repeat suppression** — a held sign commits once, not every frame.

Word boundaries use `REST_FRAMES_TO_COMMIT` (24 ≈ 1.2 s at 20 fps). That value is
load-bearing: at 12 frames the ordinary ambiguous frames between two
fingerspelled letters ended the word, and "TICKET" arrived as "T I C K E T". The
UI also exposes an explicit **End word** control (spacebar) for signers who
prefer to delimit words deliberately.

## Sentence layer (`islg/vocab.py`)

Fingerspelling can express any word but is slow and reads badly. So 41 counter
phrases carry keyword aliases: spelling `TICKET` announces *"I want to buy a
ticket."* / *"मुझे टिकट खरीदना है।"* rather than six letters. Unknown words are
kept verbatim, so the fallback is still useful.

Keyword lookup strips spaces and case, and `Phrase.__post_init__` rejects any
single-character keyword — because `keywords=("platform")` is the *string*
`"platform"`, and iterating it once made the lone letter "O" announce "Where is
the platform?". That bug was found by `tests/test_smoother_and_vocab.py`, not by
a human.

## The no-server mode (`server/static/islg-model.js`)

`GestureModel.export_js` serialises scaler + PCA + every tree to JSON so the
browser can classify on its own, with no Python at all. The naive export stored
each node's 36-class distribution and produced a **146 MB** file; storing only
the split feature, threshold, children and the winning class per leaf brought it
to **4.9 MB**. That makes the browser use majority vote instead of averaged
probabilities, which costs accuracy — measured, the two agree on **98.60%** of
samples and the transform matches to **9.7e-06**. `tests/test_js_export.py` pins
both numbers so the gap cannot silently widen.

## What is deliberately *not* here

* No continuous-sentence ISL translation (see `LIMITATIONS.md`).
* No invented handshape descriptions. Sign illustrations must come from the
  ISLRTC dictionary or a Deaf consultant; generating plausible-looking ones from
  a model would be fabrication.
* No cloud fallback of any kind. There is no code path that reaches the network
  during inference.
