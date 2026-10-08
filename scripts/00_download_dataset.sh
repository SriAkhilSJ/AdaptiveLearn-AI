#!/usr/bin/env bash
# One-time download of the public ISL fingerspelling image dataset.
# Kept out of git (data/ is .gitignore'd) -- the derived landmark table is what
# actually trains the model.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/data/raw"
cd "$ROOT/data/raw"
if ls Indian-Sign-Language-Recognition-*/train_image_folder >/dev/null 2>&1; then
  echo "[ok] dataset already present"
  exit 0
fi
echo "[info] downloading ISL dataset (~339 MB) ..."
curl -sL -o isl_sajanraj.tar.gz \
  https://codeload.github.com/sajanraj/Indian-Sign-Language-Recognition/tar.gz/refs/heads/master
tar -xzf isl_sajanraj.tar.gz --wildcards "*/train_image_folder/*"
rm -f isl_sajanraj.tar.gz
echo "[ok] extracted to data/raw/Indian-Sign-Language-Recognition-*/train_image_folder"
