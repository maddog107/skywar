#!/bin/sh
# Rebuild the vehicle textures (python3 + numpy + Pillow) and every scripted vehicle model (Blender).
#   sh tools/vehicles/build.sh              (from the repo root; BLENDER=/path/to/blender to override)
#   sh tools/vehicles/build.sh scud osa     (only these models)
set -e
BLENDER=${BLENDER:-/opt/homebrew/bin/blender}
if [ $# -eq 0 ]; then
  python3 tools/vehicles/textures.py
  set -- $(sed -n "s/^    \([a-z0-9_]*\): {\$/\1/p" src/vehicles.js)
fi
"$BLENDER" -b -P tools/vehicles/build.py -- "$@"
