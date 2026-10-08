"""Parity between the Python classifier and the exported browser classifier.

The "no server at all" mode runs ``server/static/islg-model.js`` instead of
scikit-learn, so two things must hold:

1. **The transform is numerically identical** (scaler -> PCA). If this drifts the
   browser model is looking at a different feature space entirely.
2. **The predictions agree closely.** They cannot be bit-identical: sklearn's
   ``predict`` averages each tree's class *distribution*, while the compact
   export stores only the winning class per leaf and majority-votes. That costs
   about a point of agreement and a few tenths of a point of accuracy -- a fair
   trade for a 146 MB -> 4.9 MB model file. This test pins the size of that gap
   so a future change cannot silently widen it.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from islg import config  # noqa: E402

JS_MODULE = ROOT / "server" / "static" / "islg-model.js"
JS_MODEL = config.JS_MODEL_PATH
PY_MODEL = config.MODEL_PATH
N_SAMPLES = 500

RUNNER = r"""
// Load the ES module under Node by stripping the `export` keywords.
// argv[1] is the runner's own path, so the real arguments start at argv[2].
const fs = require('node:fs');
const [MODULE_JS, MODEL_JSON, ROWS_JSON] = process.argv.slice(2);
const src = fs.readFileSync(MODULE_JS, 'utf8')
  .replace(/^export /gm, '')
  .replace(/^import .*$/gm, '');
const mod = { exports: {} };
new Function(
  'module', 'exports', 'require',
  src + '\nmodule.exports = { IslModel, TREE_LEAF };',
)(mod, mod.exports, require);
const { IslModel } = mod.exports;
if (typeof IslModel !== 'function') {
  console.error('IslModel was not exported; islg-model.js content may be wrong');
  process.exit(3);
}

const model = new IslModel(JSON.parse(fs.readFileSync(MODEL_JSON, 'utf8')));
const rows = JSON.parse(fs.readFileSync(ROWS_JSON, 'utf8'));
process.stdout.write(JSON.stringify({
  labels: rows.map((r) => model.predict(r).label),
  transformed: rows.slice(0, 5).map((r) => Array.from(model.transform(r))),
}));
"""


def _sample_vectors() -> np.ndarray:
    from islg.dataset import load_samples

    X, _y = load_samples()
    rng = np.random.default_rng(7)
    return X[rng.choice(len(X), size=min(N_SAMPLES, len(X)), replace=False)]


def _run_js(X: np.ndarray) -> dict:
    tmp = Path("/tmp/islg_js_check")
    tmp.mkdir(exist_ok=True)
    (tmp / "runner.js").write_text(RUNNER)
    (tmp / "rows.json").write_text(json.dumps(X.tolist()))
    result = subprocess.run(
        ["node", str(tmp / "runner.js"), str(JS_MODULE), str(JS_MODEL), str(tmp / "rows.json")],
        capture_output=True,
        text=True,
        timeout=900,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    return json.loads(result.stdout)


@pytest.fixture(scope="module")
def comparison() -> dict:
    from islg.model import GestureModel

    assert JS_MODEL.exists(), f"run scripts/02_train.py to produce {JS_MODEL}"
    assert PY_MODEL.exists(), "run scripts/02_train.py first"
    assert JS_MODULE.exists(), "server/static/islg-model.js is missing"
    if shutil.which("node") is None:
        pytest.skip("node is required for the JS parity check")

    model = GestureModel.load(PY_MODEL)
    X = _sample_vectors()
    py_labels, _probs = model.predict(X)
    py_transform = model.pipeline.named_steps["pca"].transform(  # type: ignore[union-attr]
        model.pipeline.named_steps["scaler"].transform(X[:5])  # type: ignore[union-attr]
    )
    out = _run_js(X)
    return {
        "py_labels": np.asarray(py_labels),
        "js_labels": np.asarray(out["labels"]),
        "py_transform": np.asarray(py_transform, dtype=np.float64),
        "js_transform": np.asarray(out["transformed"], dtype=np.float64),
    }


def test_transform_is_numerically_identical(comparison: dict) -> None:
    """Scaler + PCA must reproduce scikit-learn to within the export rounding."""
    diff = float(np.max(np.abs(comparison["py_transform"] - comparison["js_transform"])))
    print(f"\n[js-parity] max |python - browser| over the PCA transform: {diff:.2e}")
    assert diff < 1e-4, f"transform drift {diff:.2e}; export_js is rounding too aggressively"


def test_predictions_agree(comparison: dict) -> None:
    agreement = float(np.mean(comparison["js_labels"] == comparison["py_labels"]))
    print(f"\n[js-parity] label agreement on {len(comparison['py_labels'])} samples: {agreement*100:.2f}%")
    assert agreement >= 0.97, (
        f"browser/Python agreement fell to {agreement:.3f}. Expected >=0.97 "
        "(majority vote vs. averaged probabilities); a larger drop means the "
        "export is wrong, not just coarser."
    )
