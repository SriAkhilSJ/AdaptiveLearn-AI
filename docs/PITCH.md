# Pitch — 5-minute version

## The problem (30 s)

India has roughly 63 million people with significant hearing loss. ISL is used by
an estimated 5 million. When a Deaf citizen walks up to a railway enquiry window,
a police desk or a post-office counter, there is usually **no interpreter, no
time, and no budget for one**.

Today the workaround is a piece of paper and a pen, or a family member, or simply
giving up and going home. That is not an accessibility inconvenience. It is a
citizen being unable to file a complaint, collect a pension, or buy a ticket.

The problem statement asks for something **affordable and offline** — because a
counter PC in a mofussil station does not have reliable internet, and because a
system that uploads footage of citizens to a cloud API is a privacy problem no
department will sign off on.

## The solution (60 s)

A camera, a laptop, and software that already fits in this repo.

The citizen signs. The system speaks. **Nothing leaves the machine.**

> *"I want to buy a ticket."* — spoken aloud in English or Hindi, in the voice of
> the counter PC, with the network cable unplugged.

Three things make it work:

1. **Landmarks, not pixels.** MediaPipe reduces a hand to 21 points, and we strip
   out where the person is standing, how close they are, and how they tilt their
   hand. What is left is *the shape of the sign* — which is why one model works on
   a stranger.
2. **A classifier small enough to be honest about.** 20 MB random forest,
   **90.84%** on held-out real ISL photographs, trained in 13 seconds on a CPU.
   It runs on a Raspberry Pi. There is no GPU, no cloud, no 4 GB model.
3. **It knows when it doesn't know.** When the model is confident (≥ 0.90) it is
   right **100% of the time** on held-out data — 382 out of 382. When it is unsure
   it says nothing rather than announcing the wrong thing to a police officer.

## Live demo (90 s)

1. **Sign T-I-C-K-E-T.** Not six letters — the system says *"I want to buy a
   ticket."* Point at the confidence ring filling before each letter commits.
2. **Tap the Railway tab, tap a quick card.** The same sentence, spoken, with no
   signing at all. Say out loud why this exists: *a translator that fails silently
   is worse than no translator.*
3. **Switch to हिन्दी.** Same interaction, now *"मुझे टिकट खरीदना है।"*
4. **Show the Speech engines panel and the offline badge.** Then, if the room has
   wifi, turn it off and do it again.

If a sign is missed on stage: that is the confidence gate working. Say so, and
show the **End word** button. Do not pretend.

## Why we win (60 s)

* **It runs.** Judges see a working demo, not a slide of an architecture diagram.
  46 tests, including one that drives the real server with real ISL photographs
  and asserts the spoken sentence.
* **The offline claim is verifiable, not asserted.** The API reports
  `cloud_used: false`; the UI shows which local engine is speaking.
* **The numbers are real and reproducible.** `scripts/02_train.py` prints
  held-out accuracy, the per-class table, and the confusions. `models/metrics.json`
  is committed.
* **We published our own failure modes.** `docs/LIMITATIONS.md` lists nine, and
  the roadmap starts with Deaf-community review rather than with more models.
* **It is cheap.** A webcam and any five-year-old laptop. No new hardware, no
  procurement cycle, no per-use cost.

## Impact (45 s)

One counter, one laptop, one camera. Multiply by the ~150,000 government service
counters in India — railways, police, post, municipal, banking.

The marginal cost after the first install is **zero**, and the system improves
every time a department records its own local signs with the collector we ship.

And the same pipeline, with a different vocabulary, is a classroom tool for
hearing children learning ISL, or a hospital triage aid. The hard part — offline,
signer-independent hand recognition on cheap hardware — is already built.

## The ask

Three months and one partnership with a Deaf organisation to:
review the phrase book, record 20 whole-word signs per domain, and pilot at three
counters with real citizens.

---

# Judge Q&A — prepared answers

**"Is this actually Indian Sign Language?"**
The classifier is trained on a published ISL fingerspelling dataset
(Vidya Academy of Science & Technology, ICICCT 2018), not on ASL. ISL's
fingerspelling is what we recognise. We do **not** claim to translate ISL grammar
— that is unsolved research, and we say so in `docs/LIMITATIONS.md`.

**"90% isn't good enough for a real counter."**
Agreed for raw frame accuracy — which is why we do not use it that way. Two gates
sit on top: a 3-frame stability requirement and a 0.55 confidence floor. In the
band where the system actually speaks (confidence ≥ 0.90) it was **100% correct on
382 held-out samples**. We optimised for *precision of what gets spoken aloud*,
and we publish the recall we gave up.

**"What if the lighting is bad, or the signer has dark skin?"**
MediaPipe detects a hand in only ~72% of the dataset's images, so this is a real
failure mode, not a hypothetical. Missed detection is handled as "no sign" — the
system stays silent. And the quick cards are the designed fallback.

**"Why not a deep learning model?"**
We measured it. A landmark-based forest gives 90.8% at 20 MB, training in 13
seconds on two CPU cores. A CNN on pixels would need a GPU, a bigger dataset than
we can responsibly collect, and would run worse on the hardware a counter
actually has. We chose the model that fits the deployment.

**"Does it work for left-handed signers?"**
Yes, by construction. Half of all training augmentation is a mirror of the other
half, and mirroring a feature vector swaps the handedness flags. There is a test
for it.

**"Two-handed signs?"**
The feature vector carries two-handed geometry — wrist separation and palm-axis
angle difference — and MediaPipe tracks both hands. But the shipped vocabulary is
one-handed fingerspelling, so two-handed support is scaffolding without content
yet. It is item 4 on the roadmap.

**"How is this different from the ten other ISL projects on GitHub?"**
Most recognise letters and print a label. This one produces a **spoken bilingual
sentence at a counter**, has an accessibility fallback for when vision fails,
runs provably offline, and ships 46 tests including an end-to-end test through the
real web server. We also publish our limitations instead of a 99.9% accuracy claim
from a 3-class model.

**"What does it cost to deploy?"**
A webcam (~₹800) and any existing counter PC. No new hardware, no licence, no
per-transaction cost, no connectivity requirement.

**"Is anyone from the Deaf community involved?"**
Not yet, and that is our biggest weakness — it is limitation 6 in
`docs/LIMITATIONS.md`. The phrase book was written by developers. The first thing
we would do with funding is pay Deaf consultants and ISL interpreters to review
the vocabulary and the handshape reference. We deliberately did **not** generate
handshape illustrations ourselves, because plausible-looking wrong signs are worse
than none.

**"What about privacy?"**
No frame is stored, logged or transmitted. Frames are decoded, reduced to 21
landmarks, classified and discarded. There is no code path that reaches the
network during inference. A real deployment still needs a written data policy and
an audit log for police use — that is listed as a known gap.
