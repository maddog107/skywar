#!/bin/sh
# Rebuild the ship models: textures (python3 + Pillow + numpy), then the Blender scripts.
#   sh tools/ships/build.sh            (from the repo root; BLENDER=/path/to/blender to override)
set -e
BLENDER=${BLENDER:-/opt/homebrew/bin/blender}
TEX=${TMPDIR:-/tmp}/skywar-shiptex
python3 tools/ships/ship_textures.py "$TEX"
"$BLENDER" -b -P tools/ships/carrier_model.py -- "$TEX" models/ships/carrier.glb
if [ -f tools/ships/destroyer_model.py ]; then
  "$BLENDER" -b -P tools/ships/destroyer_model.py -- "$TEX" models/ships/destroyer.glb
fi
