# AI image-to-3D aircraft models: notes for picking this up again

Status (2026-09-24): researched and priced, **nothing launched or installed yet**. Waiting on a go-ahead.

## Why
The hand-scripted F-35A (`tools/f35a_model.py` → `models/f35a.glb`, hangar entry `f35n`) is decent but
simplified. An image-to-3D model might capture the blended surfaces better (intakes, chines, canopy fairing)
and can produce a texture.

## Expected trade-offs (unverified until we actually run them)
- Better: organic/blended surfaces, and a texture (Hunyuan paint stage / TRELLIS.2 PBR).
- Worse: thin surfaces (wings, fins, stabs) tend to come out thick or lumpy; there's no enforced symmetry;
  the unseen side is guessed from a single image.
- Output is 100k–1M+ triangles, so it needs decimation in Blender to ~10–20k, then orientation and scale fixes
  (the game wants nose toward -Z; `normaliseGLTF` in `src/models.js` scales by `spec.length`).

## Candidate models
| Model | VRAM | Notes |
|---|---|---|
| **Hunyuan3D-2mv** (Tencent) | shape ~6–10 GB, texture ~16–21 GB | Multi-view input (front/left/back/right). Our 3-view drawing fits this well. **First choice.** Licence excludes EU/UK/South Korea and has an MAU threshold; fine for this project. |
| Hunyuan3D-2.1 | ~10 GB shape + ~21 GB texture | Single image, PBR texture. |
| **TRELLIS.2** (Microsoft) | recommends ≥24 GB | MIT licence, PBR output. |

VRAM figures are from memory; check each repo's README before installing.

Input images (public domain, Wikimedia Commons):
- https://commons.wikimedia.org/wiki/File:Lockheed_Martin_F-35A_Lightning_II_3-view_drawing.png
- https://commons.wikimedia.org/wiki/File:F-35A_Top.jpg

For multi-view input, crop the 3-view into separate front/side/top images on a white background.

## Option A: the house GPU server (not recommended right now)
- The address we were given logs into host **BZ2** (not BZ1). Connection details are kept out of the repo.
- GPU: NVIDIA RTX PRO 2000 Blackwell, **16 GB**. That's enough for the Hunyuan shape stage; texture needs low-VRAM/offload mode; TRELLIS.2 is likely too small.
- **The GPU was unusable on 2026-09-24.** `nvidia-smi` failed with "Driver/library version mismatch": driver 615.71
  was installed that day, but kernel module 595.71 is still loaded. The new DKMS module was built for kernel
  6.12.0-211, but 6.12.0-124 is running. **It needs a reboot.** The box runs production services (MariaDB,
  Postgres, OpenSearch, a llama-server) and had 179 days of uptime, so that's the owner's call.
- Disk: `/` has only ~30 GB free. Install to `/data` (7.6 TB free).

## Option B: AWS spot GPU, bootstrap → generate → terminate (recommended)
Spot prices checked 2026-09-24 in us-east-1 (they change, so re-check with
`aws ec2 describe-spot-price-history --instance-types <type> --product-descriptions Linux/UNIX`):

| Instance | GPU | Spot $/hr | Verdict |
|---|---|---|---|
| **g6e.xlarge** | 1× L40S 48 GB | ~1.71 | **Pick this.** Runs both models with texture. Only 32 GB RAM; use g6e.2xlarge if that's tight. |
| g5.2xlarge | 1× A10G 24 GB | ~0.70 | Budget option; texture only in low-VRAM mode. |
| g7e.2xlarge | 1× RTX PRO 6000 96 GB | ~1.84 | Plenty of headroom. |
| p4d.24xlarge | 8× A100 | ~14.2 | Overkill: AWS has no single-A100 instance. |

Account quotas are fine: G/VT spot 1260 vCPU, P spot 1890 vCPU, G/VT on-demand 920 vCPU.

Estimate: ~1 h setup (CUDA extension builds, 30–40 GB of weights) plus 1–2 h generating variants, so
**~$5 total, cap $10 / 4 h**. Add a 150 GB gp3 volume (pennies for a few hours).

Plan:
1. AMI: AWS Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu), which comes with the driver and CUDA.
2. Create a new key pair and a security group with SSH from the current public IP only.
3. Launch as a spot instance with `InstanceInitiatedShutdownBehavior=terminate`. Run `shutdown -h +240` at boot as a dead-man timer.
4. Bootstrap script (keep it re-runnable in case of a spot interruption): clone Hunyuan3D-2 and TRELLIS.2 into a venv,
   download the weights, and run a smoke test.
5. Generate variants: single-image vs. 3-view input, and shape-only vs. textured. Copy the `.glb`s back with scp.
6. **Terminate the instance, then delete the key pair and security group.** Verify with `aws ec2 describe-instances`.
7. Locally: in Blender, decimate, apply symmetry if needed, fix orientation and scale, export to `models/`. Add a hangar entry
   next to `f35n`/`f35` (see how `f35n` is wired: `src/config.js`, `src/models.js` `MODEL_FILES`,
   `MMAX` in `src/aircraft.js`, `AIRCRAFT_RANK` in `src/career.js`, credits in `src/main.js` + `models/CREDITS.md`).
8. Compare in the browser. The side-by-side render snippet used for `f35n` imports `/src/models.js`,
   calls `createAircraftModel(id)` for each, and renders 4 views into a canvas.

Launching costs money on the AWS account, so **get explicit approval before step 3**.
