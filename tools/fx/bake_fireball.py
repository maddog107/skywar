# ═══════════════════════════════════════════════════════════════
# Fireball flipbooks, stage 1: the fluid simulation (Blender 5.x Mantaflow gas: fire + smoke).
#
#   blender --background --factory-startup --python tools/fx/bake_fireball.py -- --event ground --cache /tmp/fx/ground
#   python3 tools/fx/render_flipbook.py --cache /tmp/fx/ground --out models/fx        (stage 2: the atlases)
#
# One burst is simulated in a box of air: a few hundred blobs of burning fuel thrown out of a point (a Blender
# particle system feeding a fire + smoke flow, with a share of their speed handed to the gas), as many blobs of
# unburnt soot thrown out with them (the dark folds in the fire), a ball of fuel at the centre that feeds the fire for
# a few frames, and a turbulence field that stirs the gas while the burst is young. The heat lifts it. Three events:
#   air     an air burst: a ball of fire that rolls, rises and turns to smoke
#   ground  a ground burst: a hemisphere off a closed floor, mushrooming up on a stem
#   fuel    a fuel fireball: more fuel, burning slower and sootier, rolling up off the floor for seconds
# The simulation's frames are the flipbook's frames: the time step grows frame by frame (the domain's time scale is
# keyframed), so the fast first tenth of a second and the slow smoke that follows both get their share of the 64.
# Every frame's grids (smoke density, flame, heat, velocity) are saved, half floats in a compressed .npz, into
# --cache (about 0.4 GB an event); nothing of that goes into the repository (stage 2 turns them into the atlases
# under models/fx/). Blender's own simulation cache is written under --cache/manta and deleted frame by frame.
#
# As baked for models/fx: --res 128 (the default: the longest side of the box; 89 × 89 × 128 cells of ~0.6 m) with
# wavelet noise × 2 (density and flame on a 178 × 178 × 256 grid of ~0.3 m), 64 frames; 3.3 minutes (air, ground) to
# 5.5 minutes (fuel) on an Apple M5, under 2 GB of memory. One at a time.
# ═══════════════════════════════════════════════════════════════
import bpy
import sys, os, json, math, time, shutil, argparse
import numpy as np

FRAMES = 64

# size, height: the domain box (m). z0: the burst's height in it. t0 / growth: the first frame's time step (s) and
# its growth per frame (64 frames then cover t0 (g^64 - 1) / (g - 1) of the simulation's seconds; the game plays
# them back at its own pace: flipbook.js fireballSpec). The rest: the fuel thrown (count of blobs, their speed (m per
# Blender second), how soon the air stops them, how many frames they shed fuel), the soot thrown with it, and the gas
# (how fast the fuel burns, how much soot it leaves, how hard the heat lifts it (gravity ×), the turbulence field's
# strength, eddy size (m) and the frame it dies away from, the wavelet noise's refinement).
EVENTS = {
    'air': dict(size=50.0, height=72.0, z0=16.0, floor=False, t0=0.035, growth=1.052,
                blobs=420, speed=38.0, speed_random=0.75, damping=0.42, life=4, blob_size=1.5, up=0.0,
                soot=240, soot_speed=34.0, soot_density=3.0,
                fuel=1.0, smoke=1.0, temperature=2.2, burning_rate=0.06, flame_smoke=2.5, flame_vorticity=0.3,
                vorticity=0.03, alpha=0.3, beta=5.0, gravity=2.0, dissolve=0, velocity_factor=0.5, core=2.4, core_frames=6,
                turb=5.0, turb_size=7.0, turb_until=20, noise=2, noise_strength=0.8, noise_pos=2.0, seed=11),
    'ground': dict(size=56.0, height=78.0, z0=1.2, floor=True, t0=0.035, growth=1.052,
                   blobs=460, speed=40.0, speed_random=0.75, damping=0.42, life=4, blob_size=1.5, up=0.3,
                   soot=260, soot_speed=36.0, soot_density=3.0,
                   fuel=1.0, smoke=1.0, temperature=2.6, burning_rate=0.06, flame_smoke=2.5, flame_vorticity=0.3,
                   vorticity=0.03, alpha=0.3, beta=5.0, gravity=2.2, dissolve=0, velocity_factor=0.5, core=2.6, core_frames=6,
                   turb=5.0, turb_size=7.0, turb_until=20, noise=2, noise_strength=0.8, noise_pos=2.0, seed=23),
    'fuel': dict(size=60.0, height=86.0, z0=4.0, floor=True, t0=0.04, growth=1.05,
                 blobs=520, speed=24.0, speed_random=0.8, damping=0.3, life=10, blob_size=1.8, up=0.5,
                 soot=220, soot_speed=22.0, soot_density=3.0,
                 fuel=1.6, smoke=1.0, temperature=2.0, burning_rate=0.032, flame_smoke=2.4, flame_vorticity=0.4,
                 vorticity=0.03, alpha=0.3, beta=5.0, gravity=1.5, dissolve=0, velocity_factor=0.6, core=3.0, core_frames=14,
                 turb=5.0, turb_size=8.0, turb_until=24, noise=2, noise_strength=0.8, noise_pos=2.0, seed=37),
}


def frame_times(P, n=FRAMES):
    """the simulation time at the start of each frame, and each frame's step"""
    dt = [P['t0'] * P['growth'] ** i for i in range(n)]
    t = [0.0]
    for d in dt[:-1]:
        t.append(t[-1] + d)
    return t, dt


def build(event, res, cache, over):
    P = dict(EVENTS[event])
    P.update(over)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    t, dt = frame_times(P)
    fps = int(10.0 / max(dt))   # (Blender caps the time scale at 10: the longest step is 10 frames' worth)
    scene.render.fps = fps
    scene.frame_start = 1
    scene.frame_end = FRAMES + 2
    S, H = P['size'], P['height']
    scene.gravity = (0, 0, -9.81 * P['gravity'])

    # the domain: x, y in ±S/2, z from 0 to H
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, H / 2))
    dom = bpy.context.object
    dom.name = 'Domain'
    dom.scale = (S, S, H)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ds = dom.modifiers.new('Fluid', 'FLUID')
    ds.fluid_type = 'DOMAIN'
    ds = ds.domain_settings
    ds.domain_type = 'GAS'
    ds.resolution_max = res
    ds.cache_type = 'REPLAY'
    ds.cache_directory = os.path.join(cache, 'manta')
    ds.cache_data_format = 'OPENVDB'
    ds.openvdb_data_depth = '16'
    ds.use_adaptive_timesteps = True
    ds.cfl_condition = 3.0
    ds.timesteps_max = 24
    ds.timesteps_min = 1
    for side in ('front', 'back', 'left', 'right', 'top', 'bottom'):
        setattr(ds, 'use_collision_border_' + side, side == 'bottom' and P['floor'])
    ds.alpha = P['alpha']            # density buoyancy
    ds.beta = P['beta']              # heat buoyancy
    ds.vorticity = P['vorticity']
    ds.burning_rate = P['burning_rate']
    ds.flame_smoke = P['flame_smoke']
    ds.flame_vorticity = P['flame_vorticity']
    ds.flame_ignition = 1.25
    ds.flame_max_temp = 3.0
    ds.flame_smoke_color = (0.7, 0.7, 0.7)
    ds.use_dissolve_smoke = P['dissolve'] > 0
    if P['dissolve'] > 0:
        ds.dissolve_speed = int(P['dissolve'])
        ds.use_dissolve_smoke_log = True
    # wavelet noise: the simulation's eddies carried down to finer ones on a grid `noise` times as fine
    ds.use_noise = P['noise'] > 1
    if ds.use_noise:
        ds.noise_scale = int(P['noise'])
        ds.noise_strength = P['noise_strength']
        ds.noise_pos_scale = P['noise_pos']
        ds.noise_time_anim = 0.1
    # the time step grows frame by frame: Blender's frame is 1/fps s at time scale 1
    # (Blender's frame 1 only places the emitters; the flipbook's frame i is Blender's frame i + 2)
    for i, d in enumerate(dt):
        ds.time_scale = d * fps
        ds.keyframe_insert('time_scale', frame=i + 2)
    ds.time_scale = dt[0] * fps
    ds.keyframe_insert('time_scale', frame=1)

    # the fuel: blobs thrown out of a small sphere (upward only off a floor), stopped by the air within a few frames,
    # shedding fuel, smoke and heat into the gas along the way and handing it some of their speed
    def burst(name, count, speed, life, seed, soot):
        bpy.ops.mesh.primitive_ico_sphere_add(radius=0.8, location=(0, 0, P['z0']), subdivisions=3)
        src = bpy.context.object
        src.name = name
        if P['floor']:
            # keep the upper half: nothing is thrown into the ground
            import bmesh
            bm = bmesh.new()
            bm.from_mesh(src.data)
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.05], context='VERTS')
            bm.to_mesh(src.data)
            bm.free()
        src.modifiers.new('Blobs', 'PARTICLE_SYSTEM')
        ps = src.particle_systems[0]
        st = ps.settings
        ps.seed = int(seed)
        st.count = int(count)
        st.frame_start = 1
        st.frame_end = 2
        st.lifetime = life
        st.lifetime_random = 0.6
        st.emit_from = 'FACE'
        st.physics_type = 'NEWTON'
        st.normal_factor = speed
        st.factor_random = speed * P['speed_random']
        st.object_align_factor = (0, 0, speed * P['up'])
        st.damping = P['damping']
        st.drag_factor = 0.0
        st.mass = 1.0
        st.effector_weights.gravity = 0.0
        st.effector_weights.turbulence = 0.0
        st.render_type = 'NONE'
        fm = src.modifiers.new('Fluid', 'FLUID')
        fm.fluid_type = 'FLOW'
        fs = fm.flow_settings
        fs.flow_type = 'SMOKE' if soot else 'BOTH'
        fs.flow_behavior = 'INFLOW'
        fs.flow_source = 'PARTICLES'
        fs.particle_system = ps
        fs.use_particle_size = True
        fs.particle_size = P['blob_size'] * (0.8 if soot else 1.0)
        fs.density = P['soot_density'] if soot else P['smoke']
        fs.temperature = 0.6 if soot else P['temperature']
        if not soot:
            fs.fuel_amount = P['fuel']
        fs.use_initial_velocity = True
        fs.velocity_factor = P['velocity_factor']
        fs.subframes = 6
        fs.smoke_color = (0.7, 0.7, 0.7)
        return src

    burst('Burst', P['blobs'], P['speed'], P['life'], P['seed'], False)
    # and blobs of unburnt soot thrown out with it: the dark folds in the fire
    if P['soot'] > 0:
        burst('Soot', P['soot'], P['soot_speed'], P['life'] + 2, P['seed'] + 101, True)

    # the charge itself: a ball of fuel at the centre that keeps feeding the fire for a few frames
    bpy.ops.mesh.primitive_ico_sphere_add(radius=P['core'], location=(0, 0, P['z0'] + (P['core'] * 0.6 if P['floor'] else 0)), subdivisions=3)
    core = bpy.context.object
    core.name = 'Core'
    cm = core.modifiers.new('Fluid', 'FLUID')
    cm.fluid_type = 'FLOW'
    cs = cm.flow_settings
    cs.flow_type = 'BOTH'
    cs.flow_behavior = 'INFLOW'
    cs.fuel_amount = P['fuel']
    cs.density = P['smoke']
    cs.temperature = P['temperature']
    cs.use_initial_velocity = True
    cs.velocity_normal = P['speed'] * 0.3
    cs.velocity_random = P['speed'] * 0.1
    cs.surface_distance = 1.0
    cs.volume_density = 1.0
    cs.use_inflow = True
    cs.keyframe_insert('use_inflow', frame=1)
    cs.keyframe_insert('use_inflow', frame=int(P['core_frames']))
    cs.use_inflow = False
    cs.keyframe_insert('use_inflow', frame=int(P['core_frames']) + 1)

    # the air isn't still: a turbulence field stirs the gas (the rolling comes from this and the heat's lift)
    if P['turb'] > 0:
        bpy.ops.object.effector_add(type='TURBULENCE', location=(3.0, -2.0, P['z0'] + 5.0))
        fld = bpy.context.object.field
        fld.strength = P['turb']
        fld.size = P['turb_size']
        fld.flow = 0.0
        fld.noise = 0.0
        fld.seed = int(P['seed'])
        # (only while the burst is young: stirred for ever, the cloud would be torn apart instead of hanging there)
        for fr, k in ((1, 1.0), (int(P['turb_until']), 1.0), (int(P['turb_until']) + 12, 0.06)):
            fld.strength = P['turb'] * k
            fld.keyframe_insert('strength', frame=fr)
    return scene, dom, P


def read_grids(dom):
    dg = bpy.context.evaluated_depsgraph_get()
    d = dom.evaluated_get(dg).modifiers['Fluid'].domain_settings
    rx, ry, rz = d.domain_resolution
    n = rx * ry * rz

    def grid(g, comps=1):
        # (with noise on, the density and flame grids are the fine ones: `up` times the cells along each axis)
        up = max(1, round((len(g) / (n * comps)) ** (1 / 3)))
        a = np.zeros(len(g) if len(g) == n * comps * up ** 3 else n * comps, dtype=np.float32)
        if len(g) == len(a):
            g.foreach_get(a)
        else:
            up = 1
        return a.reshape((rz * up, ry * up, rx * up, comps) if comps > 1 else (rz * up, ry * up, rx * up))
    return grid(d.density_grid), grid(d.flame_grid), grid(d.heat_grid), grid(d.velocity_grid, 3), (rx, ry, rz)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--event', default='air', choices=sorted(EVENTS))
    ap.add_argument('--res', type=int, default=128)
    ap.add_argument('--cache', required=True)
    ap.add_argument('--set', action='append', default=[], help='override an event parameter: name=value')
    a = ap.parse_args(argv)
    over = {}
    for s in a.set:
        k, v = s.split('=')
        over[k] = float(v) if k not in ('floor',) else v in ('1', 'true', 'True')
    a.cache = os.path.abspath(a.cache)
    os.makedirs(a.cache, exist_ok=True)
    os.chdir(a.cache)   # (Mantaflow drops its wavelet noise tile in the working directory)
    scene, dom, P = build(a.event, a.res, a.cache, over)
    t, dt = frame_times(P)
    t_start = time.time()
    res = None
    scene.frame_set(1)
    for i in range(FRAMES):
        f = i + 2
        scene.frame_set(f)
        dens, flame, heat, vel, res = read_grids(dom)
        # the velocity only where there is something to see (it only makes the motion vectors), and it and the heat
        # at half resolution in a fine bake: the cache stays a fraction of the size
        vh, hh = vel, heat
        if vel.shape[:3] == dens.shape:
            vel *= ((dens + flame) > 1e-4)[..., None]
            if a.res > 96:
                rz, ry, rx = dens.shape
                ez, ey, ex = rz - rz % 2, ry - ry % 2, rx - rx % 2
                vh = vel[:ez, :ey, :ex].reshape(ez // 2, 2, ey // 2, 2, ex // 2, 2, 3).mean(axis=(1, 3, 5))
                hh = heat[:ez, :ey, :ex].reshape(ez // 2, 2, ey // 2, 2, ex // 2, 2).mean(axis=(1, 3, 5))
        np.savez_compressed(os.path.join(a.cache, 'frame_%03d.npz' % i), density=dens.astype(np.float16), flame=flame.astype(np.float16),
                            heat=hh.astype(np.float16), velocity=vh.astype(np.float16))
        # Blender's own cache: only the frame just simulated is read again (by the next one)
        md = os.path.join(a.cache, 'manta')
        for sub in ('data', 'noise'):
            p = os.path.join(md, sub)
            if os.path.isdir(p):
                for fn in os.listdir(p):
                    digits = ''.join(c for c in os.path.splitext(fn)[0][-6:] if c.isdigit())
                    if digits and int(digits) < f:
                        try:
                            os.remove(os.path.join(p, fn))
                        except OSError:
                            pass
        print('frame %2d  t %.3f s  smoke %.1f  flame %.1f  heat max %.2f  %.0f s' % (i, t[i], float(dens.sum()), float(flame.sum()), float(heat.max()), time.time() - t_start), flush=True)
    S = P['size']
    meta = dict(event=a.event, res=list(dens.shape[::-1]), base_res=list(res), size=S, height=P['height'], dx=max(S, P['height']) / max(dens.shape), origin=[0.0, 0.0, P['z0']], floor=bool(P['floor']), times=t, steps=dt, frames=FRAMES,
                fps=scene.render.fps, params={k: v for k, v in P.items()}, bake_seconds=time.time() - t_start, blender=bpy.app.version_string)
    with open(os.path.join(a.cache, 'sim.json'), 'w') as fh:
        json.dump(meta, fh, indent=1)
    shutil.rmtree(os.path.join(a.cache, 'manta'), ignore_errors=True)
    print('baked %s at %s in %.0f s' % (a.event, res, time.time() - t_start))


main()
