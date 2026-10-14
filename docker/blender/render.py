"""Studio render: rebuilds a Duplex Designer "studio bundle" in Blender and renders it with Cycles.

Run headless:

    blender -b --factory-startup -P docker/blender/render.py -- <bundle dir> <output dir> <preview|standard|poster>

The bundle dir holds `scene.glb` (the design, every material, per-mesh extras: layer / entity / id, per-material extras:
materialId) and `sidecar.json` (camera, lights in physical units, sky, cutaway, output size; see src/studio/protocol.ts).
Writes `beauty.png`, `depth.exr`, `mask.png` and `result.json` to the output dir. Progress is Cycles' own
"Sample n/N" output (the job runner reads it). Environment: ASSETS_DIR (the folder with `pack/`, for the HDRI skies).
"""

import json
import math
import os
import sys
import time

import bpy
from mathutils import Matrix, Vector

QUALITY = {
    "preview": {"samples": 64, "long_side": 1280},
    "standard": {"samples": 256, "long_side": 1920},
    "poster": {"samples": 1024, "long_side": 3840},
}

# three.js (x, y up, z) -> Blender (x, -z, y up)
TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def b_pos(p):
    """A three.js position as a Blender vector."""
    return Vector((p[0], -p[2], p[1]))


def log(msg):
    print(f"[studio] {msg}", flush=True)


def hex_rgb(h):
    """`#rrggbb` (sRGB) to linear rgb."""
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c]


# ──────────────────────────────── cycles device ────────────────────────────────


def setup_device(scene):
    """GPU with OptiX (else CUDA, else CPU). Returns a readable description of the device used."""
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
        except Exception:  # noqa: BLE001 - this backend is not available
            continue
        gpus = [d for d in prefs.devices if d.type == kind]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == kind  # only the NVIDIA devices of this kind
            scene.cycles.device = "GPU"
            return f"{kind}: " + ", ".join(d.name for d in gpus)
    scene.cycles.device = "CPU"
    return "CPU (no OptiX or CUDA device found)"


# ─────────────────────────────────── materials ──────────────────────────────────


def clear_nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    return nt


def shadow_ray_mix(nt, shader, out):
    """Light from outside passes through glass and water as shadow rays do (no black windows), but the surface still shows."""
    path = nt.nodes.new("ShaderNodeLightPath")
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(path.outputs["Is Shadow Ray"], mix.inputs["Fac"])
    nt.links.new(shader.outputs[0], mix.inputs[1])
    nt.links.new(clear.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return mix


def make_glass(mat):
    nt = clear_nodes(mat)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    g = nt.nodes.new("ShaderNodeBsdfPrincipled")
    g.inputs["Base Color"].default_value = (0.82, 0.93, 0.95, 1)
    g.inputs["Roughness"].default_value = 0.02
    g.inputs["IOR"].default_value = 1.45
    g.inputs["Transmission Weight"].default_value = 1.0
    shadow_ray_mix(nt, g, out)


def make_water(mat):
    """Pool water: clear, slightly rippled, with absorption so deep water turns blue-green."""
    nt = clear_nodes(mat)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    g = nt.nodes.new("ShaderNodeBsdfPrincipled")
    g.inputs["Base Color"].default_value = (0.75, 0.95, 1.0, 1)
    g.inputs["Roughness"].default_value = 0.01
    g.inputs["IOR"].default_value = 1.333
    g.inputs["Transmission Weight"].default_value = 1.0
    # ripples
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 3.0
    tex.inputs["Detail"].default_value = 6.0
    coord = nt.nodes.new("ShaderNodeTexCoord")
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    nt.links.new(coord.outputs["Object"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], g.inputs["Normal"])
    # absorption: more depth, more colour
    vol = nt.nodes.new("ShaderNodeVolumeAbsorption")
    vol.inputs["Color"].default_value = (0.35, 0.85, 0.95, 1)
    vol.inputs["Density"].default_value = 0.6
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    shadow_ray_mix(nt, g, out)


def make_emissive(mat, color, strength):
    nt = clear_nodes(mat)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*color, 1)
    e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], out.inputs["Surface"])


def rebuild_materials(report):
    """Glass and water get proper shaders; everything else keeps the Principled BSDF the glTF importer made from the
    exported PBR maps (repeat wrapping and the real-world UV scale travel in the glb)."""
    for mat in bpy.data.materials:
        mid = str(mat.get("materialId") or mat.name).split(".")[0].replace("@out", "")
        if mid == "glass":
            make_glass(mat)
            report["glass"] = report.get("glass", 0) + 1
        elif mid == "water":
            make_water(mat)
            report["water"] = report.get("water", 0) + 1
        else:
            mat.blend_method = "OPAQUE" if mat.blend_method == "BLEND" and mat.diffuse_color[3] >= 0.99 else mat.blend_method
            if mat.use_nodes:
                for n in mat.node_tree.nodes:
                    if n.type == "BSDF_PRINCIPLED":
                        # real surfaces are not mirrors; keep specular sane
                        n.inputs["Specular IOR Level"].default_value = min(n.inputs["Specular IOR Level"].default_value, 0.5)


# ───────────────────────────────── scene objects ────────────────────────────────


def extra(obj, key):
    """A glTF node extra: the importer puts it on the node's object; models are nested, so look up the parents."""
    while obj is not None:
        v = obj.get(key)
        if v is not None:
            return v
        obj = obj.parent
    return None


def fix_wall_normals():
    """Wall end caps come out of the app with some faces wound the wrong way (black patches): make every wall volume
    consistent and drop the exported split normals so shading follows the fixed faces."""
    import bmesh

    fixed = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH" or extra(obj, "layer") != "wall":
            continue
        me = obj.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.shade_flat()  # flat faces ignore the exported (partly wrong) split normals
        fixed += 1
    return fixed


def apply_cutaway(side, report):
    """Levels that are not shown, and (in a cutaway) ceilings and roofs, vanish for the camera but still cast shadows and
    block light (Cycles ray visibility)."""
    cut = side["cutaway"]["enabled"]
    n = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        roof_of_zone = str(extra(obj, "id") or "").endswith(":roof")
        if extra(obj, "cameraHidden") or (
            cut and (extra(obj, "layer") in ("ceiling", "roof") or extra(obj, "ceilingMounted") or roof_of_zone)
        ):
            obj.visible_camera = False
            n += 1
    report["hidden_from_camera"] = n


def assign_ids():
    """Object index per kind of surface, for the mask pass (prompt 23)."""
    kinds = {"wall": 1, "slab": 2, "floor": 3, "ceiling": 4, "roof": 5, "item": 6, "opening": 7, "stair": 8, "site": 9}
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        obj.pass_index = kinds.get(str(extra(obj, "layer")), 0)


def add_lamps(side, report):
    watts = lambda lumens: lumens * math.pi / 683.0  # a Blender point light: P watts = lumens * pi / 683
    count = 0
    for lamp in side["lights"]["lamps"]:
        pos = b_pos(lamp["position"])
        kind = "SPOT" if lamp.get("beam") else "POINT"
        data = bpy.data.lights.new(f"lamp-{lamp['id']}", kind)
        data.color = hex_rgb(lamp["color"])
        data.energy = watts(lamp["lumens"])
        data.shadow_soft_size = 0.06 if not lamp.get("accent") else 0.15
        if lamp.get("accent"):
            data.use_custom_distance = True
            data.cutoff_distance = 7.0
        obj = bpy.data.objects.new(data.name, data)
        obj.location = pos
        if kind == "SPOT":
            data.spot_size = math.radians(lamp["beam"])
            data.spot_blend = 0.45
            aim = b_pos(lamp.get("aim") or lamp["position"])
            direction = aim - pos
            if direction.length > 1e-6:
                obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.collection.objects.link(obj)
        count += 1
        if not lamp.get("accent") and not os.environ.get("NO_BULB"):
            add_bulb(pos, lamp["color"], lamp["lumens"])
    report["lamps"] = count


_bulb_mats = {}


def add_bulb(pos, color, lumens):
    """A small glowing bulb at each lit fixture, so lit lamps read as lit in the picture."""
    key = (color, round(lumens, -1))
    mat = _bulb_mats.get(key)
    if mat is None:
        mat = bpy.data.materials.new(f"bulb-{len(_bulb_mats)}")
        make_emissive(mat, hex_rgb(color), min(40.0, 8.0 + lumens / 100.0))
        _bulb_mats[key] = mat
    mesh = bpy.data.meshes.new("bulb")
    import bmesh

    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.045)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new("bulb", mesh)
    obj.location = pos
    obj.visible_shadow = False
    bpy.context.scene.collection.objects.link(obj)


def add_windows(side, report):
    env = side["environment"]
    night = env["hdri"] == "night"
    dusk = env["hdri"] == "dusk"
    energy = 6.0 if night else (14.0 if dusk else 40.0)
    for w in side["lights"]["windows"]:
        data = bpy.data.lights.new(f"window-{w['id']}", "AREA")
        data.shape = "RECTANGLE"
        data.size = w["width"]
        data.size_y = w["height"]
        data.energy = energy * w["width"] * w["height"]
        data.color = (0.8, 0.88, 1.0) if not dusk else (1.0, 0.72, 0.5)
        obj = bpy.data.objects.new(data.name, data)
        pos = b_pos(w["position"])
        obj.location = pos
        direction = b_pos(w["aim"]) - pos
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        # the light comes from the window into the room, but not out of its back
        obj.visible_camera = False
        bpy.context.scene.collection.objects.link(obj)
    report["windows"] = len(side["lights"]["windows"])


def add_pool_lights(report):
    """Underwater lights in every pool: a cyan glow from below the water surface."""
    n = 0
    for obj in list(bpy.data.objects):
        if obj.type != "MESH" or "water" not in obj.name.lower() or ":water" not in obj.name:
            continue
        corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
        hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
        centre = (lo + hi) / 2
        depth = 1.2
        for k, fx in enumerate((0.3, 0.7)):
            data = bpy.data.lights.new(f"pool-light-{n}-{k}", "POINT")
            data.color = (0.35, 0.85, 1.0)
            data.energy = 3.0
            data.shadow_soft_size = 0.4
            lamp = bpy.data.objects.new(data.name, data)
            lamp.location = (lo.x + (hi.x - lo.x) * fx, centre.y, hi.z - depth)
            bpy.context.scene.collection.objects.link(lamp)
        n += 1
    report["pools"] = n


# ───────────────────────────────────── world ────────────────────────────────────


def hdri_file(preset):
    root = os.environ.get("ASSETS_DIR", "assets")
    try:
        with open(os.path.join(root, "pack", "pack.json"), encoding="utf8") as f:
            index = json.load(f)
        for h in index.get("hdris", []):
            if h.get("preset") == preset:
                path = os.path.abspath(os.path.join(root, "pack", h["file"]))
                if os.path.exists(path):
                    return path
    except (OSError, ValueError):
        pass
    return None


SKY_FALLBACK = {"day": ((0.45, 0.62, 0.85), 1.0), "dusk": ((0.55, 0.32, 0.25), 0.6), "night": ((0.02, 0.03, 0.08), 0.3)}


def setup_world(side, report):
    env = side["environment"]
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    path = hdri_file(env["hdri"])
    if path:
        tex = nt.nodes.new("ShaderNodeTexEnvironment")
        tex.image = bpy.data.images.load(path)
        coord = nt.nodes.new("ShaderNodeTexCoord")
        mapping = nt.nodes.new("ShaderNodeMapping")
        nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
        nt.links.new(mapping.outputs[0], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Color"], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = env["hdriStrength"]
        report["hdri"] = os.path.basename(path)
    else:
        color, strength = SKY_FALLBACK[env["hdri"]]
        bg.inputs["Color"].default_value = (*color, 1)
        bg.inputs["Strength"].default_value = strength * env["hdriStrength"]
        report["hdri"] = "gradient fallback (the asset pack is not installed)"
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    bpy.context.scene.world = world

    sun = env["sun"]
    if sun["strength"] > 0:
        data = bpy.data.lights.new("sun", "SUN")
        data.energy = sun["strength"]
        data.color = hex_rgb(sun["color"])
        data.angle = math.radians(1.0)
        obj = bpy.data.objects.new("sun", data)
        direction = b_pos(sun["direction"])  # towards the sun
        obj.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.collection.objects.link(obj)


# ───────────────────────────────────── camera ───────────────────────────────────


def setup_camera(side, scene):
    cam = side["camera"]
    data = bpy.data.cameras.new("studio")
    data.clip_start = cam["near"]
    data.clip_end = max(cam["far"], 200.0)
    out_w, out_h = side["output"]["width"], side["output"]["height"]
    aspect = out_w / out_h
    if cam["kind"] == "ortho":
        data.type = "ORTHO"
        data.sensor_fit = "AUTO"
        # ortho_scale is the larger side of the view
        data.ortho_scale = cam["orthoHeight"] * (aspect if aspect >= 1 else 1.0)
    else:
        data.type = "PERSP"
        data.sensor_fit = "VERTICAL"
        data.angle = math.radians(cam["fov"])
    obj = bpy.data.objects.new("studio", data)
    m = Matrix([cam["matrixWorld"][i : i + 4] for i in range(0, 16, 4)]).transposed()  # column-major -> rows
    obj.matrix_world = TO_BLENDER @ m
    bpy.context.scene.collection.objects.link(obj)
    scene.camera = obj


# ──────────────────────────────── render and outputs ────────────────────────────


def setup_outputs(scene, side, out_dir):
    """Composite = beauty (with glare); depth (EXR) and object-index mask (PNG) go through file-output nodes."""
    vl = scene.view_layers[0]
    vl.use_pass_z = True
    vl.use_pass_object_index = True
    scene.use_nodes = True
    nt = scene.node_tree
    nt.nodes.clear()
    rl = nt.nodes.new("CompositorNodeRLayers")
    comp = nt.nodes.new("CompositorNodeComposite")
    last = rl.outputs["Image"]
    if side.get("glare"):
        glare = nt.nodes.new("CompositorNodeGlare")
        glare.glare_type = "FOG_GLOW"
        glare.quality = "HIGH"
        glare.threshold = 1.2
        glare.mix = -0.7  # mostly the original, a slight glow
        glare.size = 7
        nt.links.new(last, glare.inputs["Image"])
        last = glare.outputs["Image"]
    nt.links.new(last, comp.inputs["Image"])

    depth = nt.nodes.new("CompositorNodeOutputFile")
    depth.base_path = out_dir
    depth.format.file_format = "OPEN_EXR"
    depth.format.color_depth = "32"
    depth.file_slots[0].path = "depth"
    nt.links.new(rl.outputs["Depth"], depth.inputs[0])

    mask = nt.nodes.new("CompositorNodeOutputFile")
    mask.base_path = out_dir
    mask.format.file_format = "PNG"
    mask.format.color_mode = "BW"
    mask.format.color_depth = "8"
    mask.file_slots[0].path = "mask"
    div = nt.nodes.new("CompositorNodeMath")
    div.operation = "DIVIDE"
    div.inputs[1].default_value = 255.0
    nt.links.new(rl.outputs["IndexOB"], div.inputs[0])
    nt.links.new(div.outputs[0], mask.inputs[0])


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    bundle, out_dir, quality = argv[0], argv[1], argv[2]
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(bundle, "sidecar.json"), encoding="utf8") as f:
        side = json.load(f)
    preset = QUALITY[quality]
    report = {"quality": quality, "blender": bpy.app.version_string}

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    t0 = time.time()
    bpy.ops.import_scene.gltf(filepath=os.path.join(bundle, "scene.glb"))
    report["import_seconds"] = round(time.time() - t0, 1)

    rebuild_materials(report)
    report["walls_fixed"] = fix_wall_normals()
    apply_cutaway(side, report)
    assign_ids()
    setup_world(side, report)
    add_lamps(side, report)
    add_windows(side, report)
    add_pool_lights(report)
    setup_camera(side, scene)

    # output size from the sidecar, scaled to the preset's long side
    w, h = side["output"]["width"], side["output"]["height"]
    scale = preset["long_side"] / max(w, h)
    scene.render.resolution_x = int(round(w * scale))
    scene.render.resolution_y = int(round(h * scale))
    scene.render.resolution_percentage = 100

    scene.render.engine = "CYCLES"
    report["device"] = setup_device(scene)
    cy = scene.cycles
    cy.samples = preset["samples"]
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.01
    cy.use_denoising = True
    cy.denoiser = "OPTIX" if report["device"].startswith("OPTIX") else "OPENIMAGEDENOISE"
    cy.max_bounces = 10
    cy.transmission_bounces = 8
    cy.volume_bounces = 2
    cy.sample_clamp_indirect = 10.0  # tames fireflies from small bright lights
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = side["environment"]["exposure"]
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False

    setup_outputs(scene, side, out_dir)
    scene.render.filepath = os.path.join(out_dir, "beauty.png")
    scene.frame_set(1)

    log(f"device: {report['device']}  size: {scene.render.resolution_x}x{scene.render.resolution_y}  samples: {cy.samples}")
    t1 = time.time()
    bpy.ops.render.render(write_still=True)
    report["render_seconds"] = round(time.time() - t1, 1)
    report["width"] = scene.render.resolution_x
    report["height"] = scene.render.resolution_y
    report["samples"] = cy.samples
    # the file-output nodes append the frame number: rename to stable names
    for base, ext in (("depth", ".exr"), ("mask", ".png")):
        src = os.path.join(out_dir, f"{base}0001{ext}")
        if os.path.exists(src):
            os.replace(src, os.path.join(out_dir, f"{base}{ext}"))
    with open(os.path.join(out_dir, "result.json"), "w", encoding="utf8") as f:
        json.dump(report, f, indent=1)
    log("done " + json.dumps(report))


main()
