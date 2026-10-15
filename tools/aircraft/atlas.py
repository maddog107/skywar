# ═══════════════════════════════════════════════════════════════
# Bake a model's many materials into one texture atlas (Blender, headless; used by import_model.py --atlas and
# the kit's finish(atlas=...)).
#
# Imported models often come with a material and a small texture per part (90 on a MiG-21): the game splits every
# mesh by material and by damage section (damage.js segmentModel), so each would be its own draw call several times
# over, for every jet of the type. Here every opaque material's colour (its texture through its own UVs, flat
# colours, projected decals, whatever its nodes compute) is baked with Cycles into one image through a fresh,
# packed UV layout, and the faces are given one plain textured material:
#   'Skin'        the airframe (liveries repaint it: models.js applyLivery multiplies the texture)
#   'Nozzle_Trim' parts liveries must leave alone (nozzles, missiles, wheels, the pilot: name matches applyLivery's
#                 skip list), its own smaller atlas
# Glass (alpha-blended or named like glass) is left as it was. Optionally an ambient-occlusion bake darkens creases
# and the shadowed undersides of the airframe into the skin (ao = strength, 0..1).
# ═══════════════════════════════════════════════════════════════
import bpy, bmesh, re, math

def _is_glass(m, glass_rx):
    if m is None:
        return False
    if glass_rx and re.search(glass_rx, m.name, re.I):
        return True
    try:
        if m.surface_render_method == 'BLENDED':
            return True
    except Exception:
        pass
    return getattr(m, 'blend_method', 'OPAQUE') == 'BLEND'

def _unwrap(ob, faces_of, margin):
    """Smart-project only the faces of one class into the active UV layer (packed into 0..1)."""
    me = ob.data
    bpy.context.scene.tool_settings.use_uv_select_sync = False
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    bpy.ops.mesh.select_all(action='DESELECT')
    # (select by index in the edit mesh itself: flags set on the object-mode mesh would be flushed from the
    # vertices still selected from the previous class, re-selecting faces that were already unwrapped and baked)
    bm = bmesh.from_edit_mesh(me)
    bm.faces.index_update()
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        f.select_set(f.index in faces_of)
    bmesh.update_edit_mesh(me)
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    try:   # tighter packing, rotations allowed (only the islands just projected: smart_project leaves them selected,
           # and with UV sync selection off nothing of the classes already baked is touched)
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    except Exception as e:
        print('pack_islands', e)
    bpy.ops.object.mode_set(mode='OBJECT')

def _bake_target(mats, img):
    """Give every material an (unlinked, active) image node writing into img; return the nodes to remove after."""
    added = []
    for m in mats:
        if not m.use_nodes:
            m.use_nodes = True
        nt = m.node_tree
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        n.name = '__bake_target'
        for x in nt.nodes:
            x.select = False
        n.select = True
        nt.nodes.active = n
        added.append((m, n))
    return added

def _check(me, faces, img, label, layer='atlas'):
    """How many of the class's faces sample a near-black texel at their UV centre (a broken layout shows up here)."""
    import numpy as np
    w, h = img.size
    px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(h, w, 4)
    uv = me.uv_layers[layer].data
    dark = 0
    for p in me.polygons:
        if p.index not in faces: continue
        u = sum(uv[l].uv[0] for l in p.loop_indices) / p.loop_total
        v = sum(uv[l].uv[1] for l in p.loop_indices) / p.loop_total
        if px[min(h - 1, max(0, int(v * h))), min(w - 1, max(0, int(u * w)))][:3].max() < 0.03: dark += 1
    print('atlas %s: %d faces, %d sample black' % (label, len(faces), dark))

def regrey(img, hexcol, sat_max=0.22):
    """Repaint the unsaturated pixels of a skin (the paint, its panel lines and shading) in hexcol, keeping their
    relative brightness; saturated ones (stars, numbers, stripes) stay as they are. A model painted in a tinted grey
    (a mauve MiG-31) gets the real one's grey."""
    import numpy as np
    h = int(hexcol.lstrip('#'), 16)
    # (a byte image's pixels are its stored sRGB values: the target is too)
    tgt = np.array([((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255], np.float32)
    w, hh = img.size
    px = np.empty(w * hh * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(-1, 4)
    rgb = px[:, :3].copy()
    mx, mn = rgb.max(1), rgb.min(1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    grey = (sat < sat_max) & (lum > 0.02)
    ref = float(np.median(lum[grey])) if grey.any() else 0.5
    k = np.clip((sat - sat_max) / 0.12, 0, 1)[:, None]            # 0: repaint fully, 1: keep
    new = np.clip(tgt[None, :] * (lum / max(ref, 1e-3))[:, None], 0, 1)   # a pixel as bright as the median is tgt
    px[:, :3] = new * (1 - k) + rgb * k
    img.pixels.foreach_set(px.ravel())
    print('regrey', img.name, hexcol, 'ref lum %.3f' % ref)

def bake_atlas(ob, size=2048, trim_size=None, glass_rx=None, trim_rx=None, ao=0.0, ao_samples=48, margin=0.004,
               metal=0.15, rough=0.55, skin_name='Skin', trim_name='Nozzle_Trim', samples=4, grey=None):
    """ob: one joined mesh object. Returns (skin material, trim material or None)."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.render.bake.margin = 6
    sc.render.bake.margin_type = 'EXTEND'
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    me = ob.data
    mats = list(me.materials)
    glass = {i for i, m in enumerate(mats) if _is_glass(m, glass_rx)}
    trim = {i for i, m in enumerate(mats) if i not in glass and m is not None and trim_rx and re.search(trim_rx, m.name, re.I)}
    skin = {i for i in range(len(mats)) if i not in glass and i not in trim}
    classes = [('skin', skin, size)] + ([('trim', trim, trim_size or max(256, size // 4))] if trim else [])
    # the source UVs stay the render-active layer (what the materials' image nodes read); the new layer is the
    # active one (what bake writes through)
    src_uv = me.uv_layers.active.name if me.uv_layers else None
    if src_uv:
        me.uv_layers[src_uv].active_render = True
    me.uv_layers.new(name='atlas')
    # (layer references go stale across edit-mode switches: always look them up by name)
    def layers():
        me.uv_layers.active = me.uv_layers['atlas']
        if src_uv:
            me.uv_layers[src_uv].active_render = True
    layers()
    out = {}
    for cname, idxs, sz in classes:
        faces = {p.index for p in me.polygons if p.material_index in idxs}
        if not faces:
            continue
        layers()
        _unwrap(ob, faces, margin)
        layers()
        img = bpy.data.images.new('atlas_' + cname, sz, sz, alpha=False)
        img.generated_color = (0.5, 0.5, 0.5, 1)
        cmats = [mats[i] for i in sorted(idxs) if mats[i] is not None]
        added = _bake_target(cmats, img)
        # (bake wants an active image node in every material of the object: the other classes write into a dummy)
        dummy = bpy.data.images.new('__dummy', 8, 8, alpha=False)
        others = _bake_target([m for m in me.materials if m is not None and m not in cmats], dummy)
        # bake only this class's faces: select them, others not (bake writes every face of every material that has
        # the active target node, and only those materials got one)
        sc.render.bake.use_selected_to_active = False
        sc.cycles.bake_type = 'DIFFUSE'
        sc.render.bake.use_pass_direct = False
        sc.render.bake.use_pass_indirect = False
        sc.render.bake.use_pass_color = True
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=6, use_clear=True)
        if ao > 0 and cname == 'skin':
            import numpy as np
            col = np.empty(sz * sz * 4, np.float32); img.pixels.foreach_get(col)
            aoimg = bpy.data.images.new('atlas_ao', sz, sz, alpha=False)
            for m, n in added:
                n.image = aoimg
            sc.cycles.samples = ao_samples
            bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
            sc.cycles.samples = samples
            a = np.empty(sz * sz * 4, np.float32); aoimg.pixels.foreach_get(a)
            k = 1.0 - ao * (1.0 - np.clip(a.reshape(-1, 4)[:, :1], 0, 1))
            c = col.reshape(-1, 4); c[:, :3] *= k
            img.pixels.foreach_set(c.ravel())
            bpy.data.images.remove(aoimg)
        if grey and cname == 'skin':
            regrey(img, grey)
        img.pack()
        _check(me, faces, img, cname)
        for m, n in added + others:
            m.node_tree.nodes.remove(n)
        bpy.data.images.remove(dummy)
        # the class's one plain material
        nm = bpy.data.materials.new(skin_name if cname == 'skin' else trim_name)
        nm.use_nodes = True
        b = nm.node_tree.nodes['Principled BSDF']
        t = nm.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img
        nm.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
        b.inputs['Metallic'].default_value = metal if cname == 'skin' else 0.5
        b.inputs['Roughness'].default_value = rough
        me.materials.append(nm)
        ni = len(me.materials) - 1
        for p in me.polygons:
            if p.index in faces:
                p.material_index = ni
        out[cname] = (nm, faces, img)
    # drop the source UVs, keep the atlas layout as the only layer (glass keeps whatever the atlas pass left it:
    # glass faces were never unwrapped, so give them their old UVs back first)
    if src_uv and glass:
        src = me.uv_layers[src_uv].data; dst = me.uv_layers['atlas'].data
        for p in me.polygons:
            if p.material_index in glass:
                for li in p.loop_indices:
                    dst[li].uv = src[li].uv
    while len(me.uv_layers) > 1:
        for l in me.uv_layers:
            if l.name != 'atlas':
                me.uv_layers.remove(l); break
    me.uv_layers['atlas'].name = 'UVMap'
    # vertex colours are baked into the atlas now; exported as COLOR_0 they would multiply it again in three.js
    # (and a vertex alpha below 1 leaks into the framebuffer)
    while len(me.color_attributes):
        me.color_attributes.remove(me.color_attributes[0])
    # remove the now unused material slots
    used = {p.material_index for p in me.polygons}
    for i in reversed(range(len(me.materials))):
        if i not in used:
            ob.active_material_index = i
            bpy.ops.object.material_slot_remove()
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    for im in list(bpy.data.images):
        if im.users == 0:
            bpy.data.images.remove(im)
    for k, (nm, faces, img) in out.items():
        _check(me, faces, img, k + ' (final)', 'UVMap')
    print('ATLAS', {k: v[0].name for k, v in out.items()}, 'materials now', [m.name for m in me.materials])
    return tuple(out[k][0] if k in out else None for k in ('skin', 'trim'))
