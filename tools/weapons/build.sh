#!/bin/zsh
# Build (or preview) weapon models from tools/weapons/specs/<id>.json.
#   WEAPON_SRC=<dir with the downloaded <uid>.glb files> tools/weapons/build.sh export ak47 m9 ...
#   WEAPON_SRC=... PREVIEW_DIR=/tmp/pv tools/weapons/build.sh preview ak47      (side view + cm grid, 3/4 view)
cd "$(dirname "$0")/../.."
MODE=$1; shift
BLENDER=${BLENDER:-/opt/homebrew/bin/blender}
for id in "$@"; do
  if [[ $MODE == preview ]]; then
    out=${PREVIEW_DIR:-/tmp/weapon_preview}/$id
    $BLENDER -b -P tools/weapons/import_weapon.py -- tools/weapons/specs/$id.json preview $out > $out.log 2>&1 || { mkdir -p $out; $BLENDER -b -P tools/weapons/import_weapon.py -- tools/weapons/specs/$id.json preview $out > $out.log 2>&1; }
    grep -E "BUTTFRAME|^PART|^TRIS|^MATERIALS|^IMAGES|Error" $out.log | sed "s/^/$id /"
    python3 tools/weapons/grid.py $out
  else
    out=models/weapons/$id.glb
    $BLENDER -b -P tools/weapons/import_weapon.py -- tools/weapons/specs/$id.json export $out > /tmp/weapon_$id.log 2>&1
    grep -E "^PART|^TRIS|^LOD1|^EXPORTED|Error" /tmp/weapon_$id.log | sed "s/^/$id /"
  fi
done
