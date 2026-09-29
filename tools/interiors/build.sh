#!/bin/sh
# Rebuild the interior rooms (models/interiors/*.glb) and their shared textures. Needs Blender on the PATH.
set -e
cd "$(dirname "$0")/../.."
python3 tools/interiors/textures.py models/interiors/tex
for r in ssn_control cvn_cic cvn_prifly joc joc_ext tel_cabin tel_cab; do
    blender -b -P tools/interiors/$r.py -- models/interiors/$r.glb
done
