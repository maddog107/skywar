#!/bin/sh
# Rebuild the airbase textures (python3 + numpy + Pillow) and every airbase model (Blender), from the repo root:
#   sh tools/airbases/build.sh                (BLENDER=/path/to/blender to override)
#   sh tools/airbases/build.sh has_nato igloo (only these models)
set -e
BLENDER=${BLENDER:-/opt/homebrew/bin/blender}
if [ $# -eq 0 ]; then
  python3 tools/airbases/textures.py
  set -- has_nato has_red qrahut igloo fueltank generator searchlight siren revetment loader dumptruck tug followme hcds
fi
"$BLENDER" -b -P tools/airbases/build.py -- "$@"
