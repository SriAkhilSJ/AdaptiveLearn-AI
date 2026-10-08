# Limitations — read this before the demo

Judges reward honesty here more than they reward optimism. Everything below is
true of the system as it stands today.

## 1. It recognises isolated signs, not continuous ISL

ISL is a language with its own grammar, word order, non-manual markers (facial
expression, head movement) and regional variation. Continuous ISL translation is
an **open research problem**. This system does isolated-sign recognition plus
fingerspelling, assembled into sentences by a keyword layer. That is a real,
shippable product; it is not "ISL → English translation" and it should never be
described that way.

**What this means in practice:** the citizen spells or signs one item at a time.
They cannot sign a fluent sentence and expect fluent English.

## 2. 36 classes, fingerspelling only

The shipped model covers A–Z and 0–9. It does **not** include whole-word ISL
signs, even though the phrase layer is built to accept them. Adding a whole-word
sign means recording it with `scripts/collect_data.py` and retraining — the
pipeline supports it, the vocabulary does not yet contain any.

## 3. 90.84% is not "done"

* **9↔C, N↔R, X↔T, G↔W** are the hardest pairs. They differ by one finger's
  position, and MediaPipe's monocular depth is least reliable exactly there.
* Accuracy is measured on **one public dataset from one group of signers in
  Kerala**. It will be lower for a different signer, camera and lighting setup.
  Budget a drop of several points in a bright, backlit counter hall.
* **MediaPipe detects a hand in only ~72% of this dataset's images.** At inference
  time a missed detection is simply a "no sign" frame, which is safe — but it
  means a signer with dark skin against a dark background, or hands at the edge of
  frame, will be dropped more often than the accuracy figure suggests.

## 4. The confidence gate refuses real signs

To keep spoken output trustworthy we refuse anything below 0.55 confidence and
require 3 stable frames. The trade is that a correct-but-uncertain sign produces
silence. In testing this shows up as a signer having to hold a sign slightly
longer or re-sign it. The **End word** button and the quick cards exist precisely
because of this.

## 5. Single-signer, single-session

One `VisionWorker` per WebSocket connection, one MediaPipe graph each. Two people
signing at the same counter simultaneously is not supported. MediaPipe is told to
look for two hands, but that is for **two-handed signs by one signer**, not two
signers.

## 6. No linguistic authority behind the phrase book

The 41 English/Hindi sentences were written by the developers, not by Deaf users
or ISL interpreters. They are polite and comprehensible, but:

* They have **not been reviewed by the Deaf community**.
* No handshape illustrations are shipped, and none should be added from a model
  output. Use the **ISLRTC dictionary** or a Deaf consultant.
* ISL varies regionally. A sign that works in Bengaluru may not work in Delhi.

**This is the single most important thing to fix before this touches a real
counter, and it is a community-engagement problem, not a technical one.**

## 7. Hindi speech quality depends on the machine

The server has no audio device in a container, so the default engine is the
browser's own `speechSynthesis`. Quality then depends entirely on which OS voices
are installed. Windows ships Hindi voices ("Kalpana", "Hemant"); a minimal Linux
install may only have `espeak-ng`, which sounds robotic. The UI's **Speech
engines** panel shows exactly what is available, so check it *before* the demo
rather than discovering it on stage.

## 8. Fingerspelling is slow

A fluent signer manages roughly one letter per second. Spelling a six-letter word
takes six seconds — longer than pointing at a quick card. For high-frequency
counter needs, whole-word signs (limitation 2) are the real fix.

## 9. Known sharp edges

* `models/isl_gesture.joblib` is 20 MB and is committed so the demo runs out of
  the box. It pins scikit-learn's model format; a large scikit-learn version jump
  may refuse to load it. Retrain rather than downgrading blindly.
* The browser-only mode majority-votes instead of averaging probabilities, so it
  disagrees with Python on ~1.4% of frames (measured, and pinned by a test).
* No user authentication or audit log. A real deployment at a police counter needs
  both, and needs a data-protection review — the system observes people's hands on
  camera, and nothing is recorded today, but that policy should be written down.

## Roadmap, in priority order

1. Deaf-community review of the phrase book and the handshape reference.
2. Collect whole-word ISL signs for the top 20 counter intents per domain.
3. Per-signer calibration on first use (30 s, 5 signs) to recover the
   cross-signer drop.
4. Two-handed sign support beyond the current geometry features.
5. On-device evaluation on a Raspberry Pi 4 to publish a real latency figure.
