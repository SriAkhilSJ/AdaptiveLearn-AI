# TalkWithGesture — developer shortcuts
#
# `make demo` is the only target you need for a hackathon.

PY ?= python

.PHONY: help install demo test test-verbose dataset extract train collect retrain clean

help:
	@echo "install      create a venv and install dependencies"
	@echo "demo         run the counter UI on http://localhost:8000"
	@echo "test         run the test suite"
	@echo "test-verbose run tests and print accuracy / parity numbers"
	@echo "dataset      download the public ISL image dataset (~339 MB, git-ignored)"
	@echo "extract      mine MediaPipe landmarks from the dataset"
	@echo "train        train, evaluate and export the classifier"
	@echo "collect      record your own signs from the webcam"
	@echo "retrain      retrain including data/collected/"
	@echo "clean        remove caches and build artefacts"

install:
	$(PY) -m venv .venv
	./.venv/bin/pip install --upgrade pip
	./.venv/bin/pip install -r requirements.txt

demo:
	$(PY) server/app.py --host 0.0.0.0 --port 8000

test:
	$(PY) -m pytest -q

test-verbose:
	$(PY) -m pytest -q -s

dataset:
	bash scripts/00_download_dataset.sh

extract:
	$(PY) scripts/01_extract_landmarks.py

train:
	$(PY) scripts/02_train.py

collect:
	$(PY) scripts/collect_data.py --sweep --count 40

retrain:
	$(PY) scripts/02_train.py --include-collected

clean:
	find . -name '__pycache__' -type d -prune -exec rm -rf {} +
	rm -rf .pytest_cache .mypy_cache .ruff_cache
	rm -f /tmp/islg_tts.wav
