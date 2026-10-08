# Install & operations

## Requirements

* Python **3.10 – 3.12** (3.11 tested). MediaPipe has no wheels for 3.13.
* A webcam.
* Any OS. Windows 10/11, macOS and Linux are all fine; a Raspberry Pi 4 works.

## Install

```bash
git clone <this repo> && cd TALKWITHGESTURE
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python server/app.py               # -> http://localhost:8000
```

The trained model is committed in `models/`, so **nothing needs training or
downloading** to run the demo.

### Windows notes

`pip install -r requirements.txt` pulls the headless OpenCV build on purpose:
MediaPipe otherwise installs `opencv-contrib-python`, which links against
`libGL.so.1` and fails on headless Linux. If you ever see

```
ImportError: libGL.so.1: cannot open shared object file
```

run `pip uninstall opencv-contrib-python && pip install opencv-contrib-python-headless==4.10.0.84`.

### Browser rules (not our bug)

`getUserMedia` requires a secure context. `http://localhost:8000` works.
`http://192.168.1.5:8000` from another machine will **not** — serve it over HTTPS,
or run the browser on the same machine.

## Offline speech

Speech is produced by the first available local engine. Check the UI's **Speech
engines** panel before you demo.

| Engine | Install | Quality | Hindi |
|---|---|---|---|
| **Piper** | `pip install piper-tts` + a `.onnx` voice in `./voices/` | best | needs `hi_IN` voice |
| **espeak-ng** | `apt install espeak-ng` (Linux/Pi) | robotic | yes, `hi` |
| **pyttsx3** | `pip install pyttsx3` | OS-native | Windows: yes (Kalpana/Hemant) |
| **browser** | nothing | OS-native | if the OS has a Hindi voice |

The default in a container with no audio device is `browser`, which is why the UI
speaks even when the Python process cannot.

To use Piper:

```bash
pip install piper-tts
mkdir -p voices
# copy your downloaded voices into voices/ , e.g. en_GB-alba-medium.onnx
# and hi_IN-pratham-medium.onnx for Hindi
```

Piper voices are distributed by the Piper project, not by this repo, and are not
bundled — downloading them is a one-time, deliberate step. At runtime nothing is
fetched.

## Running headless / on a counter kiosk

```bash
python server/app.py --host 0.0.0.0 --port 8000
```

For a kiosk, launch Chromium in app mode pointed at the URL and disable the
screen blanker. The UI is responsive down to a tablet width.

## Tunables

Everything is in `islg/config.py`, and the model hyper-parameters read
environment variables so you can trade accuracy against size without editing code:

| Variable | Default | Effect |
|---|---|---|
| `ISLG_TREES` | 150 | more trees = better and bigger |
| `ISLG_MIN_LEAF` | 10 | higher = smaller model, lower accuracy |
| `ISLG_PCA` | 50 | PCA components fed to the forest |
| `ISLG_CCP` | 0.0 | cost-complexity pruning; >0 shrinks trees |
| `ISLG_JOBS` | all cores | training parallelism |
| `ISLG_MIN_DET` | 0.5 | MediaPipe palm-detection threshold |
| `ISLG_MIN_TRACK` | 0.5 | MediaPipe tracking threshold |

Measured trade-off (see `docs/ARCHITECTURE.md`): 250 trees/leaf 6 gives 91.86% at
43.8 MB; 100 trees/leaf 15 gives 86.51% at 6.9 MB — the latter is the Raspberry Pi
setting.

Runtime behaviour is in `config.py`: `STABLE_FRAMES` (3),
`CONFIDENCE_THRESHOLD` (0.55), `REST_FRAMES_TO_COMMIT` (24).

> If signers find the system slow to accept a sign, lower
> `CONFIDENCE_THRESHOLD` to 0.45 — but read `docs/LIMITATIONS.md` §4 first, since
> you are trading away the property that makes the spoken output trustworthy.
> If words keep splitting mid-word, raise `REST_FRAMES_TO_COMMIT`.

## Retraining

```bash
bash scripts/00_download_dataset.sh      # 339 MB, into data/ (git-ignored)
python scripts/01_extract_landmarks.py   # ~3 min on 2 cores -> data/processed/landmarks.npz
python scripts/02_train.py               # ~15 s -> models/isl_gesture.joblib
```

`01` needs ~1 GB of free RAM and writes a 3.2 MB landmark table; the JPEGs are
never committed. Add `--workers 4` if you have the cores.

### Adding your own signs

```bash
python scripts/collect_data.py --label HELP --count 60
python scripts/02_train.py --include-collected
```

The collector saves the same 96-D feature vector used at inference, in
**static** MediaPipe mode so collected and pre-trained samples share a
distribution. Capture is automatic once the stability ring fills; `SPACE` forces a
capture, `Q` moves to the next class.

You can also collect from the browser: `POST /api/collect` with a label and a
feature vector. Then `POST /api/retrain` retrains and hot-reloads the model
without restarting the server.

## Tests

```bash
pip install pytest
pytest -q                      # 46 tests
pytest tests/ -q -s            # also prints accuracy / parity numbers
```

`tests/test_server_e2e.py` needs the dataset's images on disk, because it feeds
real photographs through the running FastAPI app. Without `data/raw/` it skips.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ImportError: libGL.so.1` | non-headless OpenCV; see Windows notes above |
| Camera button does nothing | not a secure context, or permission denied — see browser rules |
| `No module named 'mediapipe.python'` | you have MediaPipe ≥ 1.0. Install `mediapipe==0.10.14`; 1.x removed `mp.solutions` **and** stopped bundling the TFLite models, which would break the offline requirement |
| Model never commits a sign | lighting, or hand too small in frame — step back is wrong, step *closer*; check the confidence readout |
| Words split mid-word | raise `REST_FRAMES_TO_COMMIT`, or use the **End word** button |
| No speech at all | check the Speech engines panel; install `pyttsx3` or `espeak-ng`, and confirm the OS has a voice for the selected language |
| Hindi sounds like English | no Hindi voice installed on that machine — the panel marks it `no Hindi voice` |
| Training killed (exit 137) | out of RAM. Lower `ISLG_TREES`, raise `ISLG_MIN_LEAF`, or pass `--max-per-class 200` |
