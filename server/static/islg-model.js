/**
 * TalkWithGesture -- in-browser inference for the exported random forest.
 *
 * This is the "no server at all" mode: the camera, MediaPipe, the classifier and
 * the speech synthesis all run on the counter PC inside the page, so the system
 * works with the network cable unplugged.
 *
 * The JSON model is produced by `islg.model.GestureModel.export_js` and contains
 * the exact scaler + PCA + decision trees that Python uses, so the two agree on
 * essentially every frame (verified by `tests/test_js_export.py`).
 *
 * Written as a plain ES module with no dependencies so it runs in the browser
 * and under Node (for tests) unchanged.
 */

export const TREE_LEAF = -1;

export class IslModel {
  /** @param {object} json parsed contents of isl_gesture.js.json */
  constructor(json) {
    if (!json || !Array.isArray(json.trees)) {
      throw new Error("not an ISLG model file");
    }
    this.format = json.format || "unknown";
    this.classes = json.classes;
    this.featureDim = json.feature_dim;
    this.accuracy = json.accuracy;
    this.scaler = json.scaler;
    this.pca = json.pca;
    this.trees = json.trees;
    this.nTrees = this.trees.length;
  }

  /** Apply StandardScaler -> PCA so the input lands in the forest's feature space. */
  transform(vec) {
    if (vec.length !== this.featureDim) {
      throw new Error(`expected ${this.featureDim} features, got ${vec.length}`);
    }
    let x = vec;
    if (this.scaler) {
      const { mean, scale } = this.scaler;
      x = new Float64Array(x.length);
      for (let i = 0; i < vec.length; i++) x[i] = (vec[i] - mean[i]) / scale[i];
    }
    if (this.pca) {
      const { mean, components } = this.pca;
      const out = new Float64Array(components.length);
      for (let k = 0; k < components.length; k++) {
        const row = components[k];
        let acc = -mean[k]; // fold the PCA centre in: sum(row_i * (x_i - mean_i))
        for (let i = 0; i < row.length; i++) acc += row[i] * x[i];
        out[k] = acc;
      }
      return out;
    }
    return x;
  }

  /** @returns {number} class index predicted by a single tree */
  predictTree(tree, x) {
    let i = 0;
    while (tree.l[i] !== TREE_LEAF) {
      i = x[tree.f[i]] <= tree.t[i] ? tree.l[i] : tree.r[i];
    }
    return tree.c[i];
  }

  /**
   * Majority vote over the forest (the exported format stores leaf classes only).
   * @returns {{label: string, index: number, confidence: number, votes: Object<string, number>}}
   */
  predict(vec) {
    const x = this.transform(vec);
    const votes = new Array(this.classes.length).fill(0);
    for (let t = 0; t < this.nTrees; t++) {
      votes[this.predictTree(this.trees[t], x)] += 1;
    }
    let best = 0;
    for (let i = 1; i < votes.length; i++) if (votes[i] > votes[best]) best = i;
    const named = {};
    for (let i = 0; i < votes.length; i++) if (votes[i]) named[this.classes[i]] = votes[i] / this.nTrees;
    return {
      label: this.classes[best],
      index: best,
      confidence: votes[best] / this.nTrees,
      votes: named,
    };
  }

  /** Top-k predictions, highest vote share first. */
  topK(vec, k = 3) {
    const x = this.transform(vec);
    const votes = new Array(this.classes.length).fill(0);
    for (let t = 0; t < this.nTrees; t++) votes[this.predictTree(this.trees[t], x)] += 1;
    return votes
      .map((count, i) => ({ label: this.classes[i], confidence: count / this.nTrees }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, k);
  }
}

/** Fetch and construct the model. Works in the browser and under Node 18+. */
export async function loadIslModel(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load model: ${response.status}`);
  return new IslModel(await response.json());
}

/** Read the model from a local file path (Node only, used by the test-suite). */
export function loadIslModelFromFile(path) {
  const fs = require("node:fs");
  return new IslModel(JSON.parse(fs.readFileSync(path, "utf8")));
}
