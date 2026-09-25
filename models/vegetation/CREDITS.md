# Vegetation impostor atlases

Each `*.webp` is a 3×3 atlas (512 px frames) baked in Blender by `tools/bake_impostors.py` from a
photoscanned tree model; `*.json` holds its real height, crown radius and frame layout
(frames 0–7: seen from azimuth k·45° around the tree; frame 8: from above).

| Atlas | Source model | Author | License |
|---|---|---|---|
| `fir_tree_01_a/b/c` | [Fir Tree 01](https://polyhaven.com/a/fir_tree_01) (three trees in one file, baked separately) | Poly Haven | CC0 |
| `fir_sapling` | [Fir Sapling](https://polyhaven.com/a/fir_sapling) | Poly Haven | CC0 |
| `island_tree_01` | [Island Tree 01](https://polyhaven.com/a/island_tree_01) | Poly Haven | CC0 |
| `island_tree_02` | [Island Tree 02](https://polyhaven.com/a/island_tree_02) | Poly Haven | CC0 |
| `tree_small_02` | [Tree Small 02](https://polyhaven.com/a/tree_small_02) | Poly Haven | CC0 |
| `grass_medium_02_e` (256 px frames) | [Grass Medium 02](https://polyhaven.com/a/grass_medium_02), clump e | Poly Haven | CC0 |
| `fern_02_b` (256 px frames) | [Fern 02](https://polyhaven.com/a/fern_02), plant b | Poly Haven | CC0 |

Re-bake: download the model's glTF (1k textures) from Poly Haven, then
`blender -b -P tools/bake_impostors.py -- <model.gltf> models/vegetation/<name> 512 [object-name filter]`
and convert with `cwebp -q 82 -alpha_q 90 -m 6`.
