#!/bin/sh
# Rebuild the ship models: textures (python3 + Pillow + numpy), then the Blender scripts.
#   sh tools/ships/build.sh              every vessel (from the repo root; BLENDER=/path/to/blender to override)
#   sh tools/ships/build.sh cruiser ssn  just those (carrier destroyer cruiser ssn ssgn supply rhib cb90 slava)
set -e
BLENDER=${BLENDER:-/opt/homebrew/bin/blender}
TEX=${TMPDIR:-/tmp}/skywar-shiptex
python3 tools/ships/ship_textures.py "$TEX"
python3 tools/ships/fleet_textures.py "$TEX"
ALL="carrier destroyer cruiser ssn ssgn supply rhib cb90 slava"
for s in ${*:-$ALL}; do
  case $s in
    ssn|ssgn) "$BLENDER" -b -P tools/ships/sub_model.py -- "$TEX" "models/ships/$s.glb" "$s" ;;
    *) if [ -f "tools/ships/${s}_model.py" ]; then "$BLENDER" -b -P "tools/ships/${s}_model.py" -- "$TEX" "models/ships/$s.glb"; fi ;;
  esac
done
