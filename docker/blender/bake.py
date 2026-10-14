"""Lighting bake: renders the diffuse lighting (direct + indirect, no albedo) of the static geometry of a Duplex Designer
"bake bundle" into one lightmap atlas, for the walkthrough (three.js `lightMap` on UV2).

Run headless:

    blender -b --factory-startup -P docker/blender/bake.py -- <bundle dir> <output dir> <low|medium|high>

The bundle dir holds `scene.glb` (static geometry with a second UV set = the atlas, extras: layer / id / bake) and
`sidecar.json` (lights, sky and `bake: {preset, atlasWidth, atlasHeight}`; see src/bake/protocol.ts). Writes `lightmap.png`
(8-bit sRGB, normalised: `result.json` has the `scale` to put back) and `result.json`. Furniture is not in the bundle:
it moves, so it gets real-time light in the app. Progress is Cycles' own "Sample n/N" output.
"""

import json
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from studio_common import (  # noqa: E402
    add_lamps,
    add_pool_lights,
    add_windows,
    extra,
    log,
    rebuild_materials,
    setup_device,
    setup_world,
)

# Cycles samples for each quality (the quality also sets the texel density in the app: 8 / 16 / 32 texels per metre)
SAMPLES = {"low": 128, "medium": 256, "high": 512}


def srgb_encode(linear):
    import numpy as np

    c = np.clip(linear, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def denoise(image, scene, out_dir):
    """OpenImageDenoise through the compositor: Image -> Denoise -> Composite, at the atlas size."""
    w, h = image.size
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.use_nodes = True
    nt = scene.node_tree
    nt.nodes.clear()
    src = nt.nodes.new("CompositorNodeImage")
    src.image = image
    dn = nt.nodes.new("CompositorNodeDenoise")
    dn.use_hdr = True
    comp = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(src.outputs["Image"], dn.inputs["Image"])
    nt.links.new(dn.outputs["Image"], comp.inputs["Image"])
    fo = nt.nodes.new("CompositorNodeOutputFile")
    fo.base_path = out_dir
    fo.format.file_format = "OPEN_EXR"
    fo.format.color_depth = "32"
    fo.file_slots[0].path = "denoised"
    nt.links.new(dn.outputs["Image"], fo.inputs[0])
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.render.use_compositing = True
    bpy.ops.render.render()
    path = os.path.join(out_dir, "denoised0001.exr")
    result = bpy.data.images.load(path)
    result.colorspace_settings.name = "Non-Color"
    return result, path


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    bundle, out_dir, quality = os.path.abspath(argv[0]), os.path.abspath(argv[1]), argv[2]
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(bundle, "sidecar.json"), encoding="utf8") as f:
        side = json.load(f)
    bake = side["bake"]
    report = {"quality": quality, "preset": bake["preset"], "blender": bpy.app.version_string}

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=os.path.join(bundle, "scene.glb"))
    rebuild_materials(report)
    # (no normal repair here: the app's faces are wound correctly, and recalculating normals on its open wall meshes turns
    # parts of them inside out, which bakes as black)
    setup_world(side, report)
    add_lamps(side, report, bulbs=False)
    add_windows(side, report)
    add_pool_lights(report)

    scene.render.engine = "CYCLES"
    report["device"] = setup_device(scene)
    cy = scene.cycles
    cy.samples = int(os.environ.get("BAKE_SAMPLES", SAMPLES[quality]))
    cy.use_adaptive_sampling = False  # a bake wants every texel sampled evenly
    cy.use_denoising = False
    # a lightmap needs a few bounces, not ten: the rest is a faint, long wait
    cy.max_bounces = int(os.environ.get("BAKE_BOUNCES", "4"))
    cy.diffuse_bounces = cy.max_bounces
    cy.glossy_bounces = 1
    cy.transmission_bounces = 4
    cy.volume_bounces = 0
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.sample_clamp_indirect = 10.0

    w, h = bake["atlasWidth"], bake["atlasHeight"]
    atlas = bpy.data.images.new("lightmap", w, h, alpha=False, float_buffer=True)
    atlas.colorspace_settings.name = "Non-Color"

    targets = []
    for obj in bpy.data.objects:
        if obj.type != "MESH" or not extra(obj, "bake"):
            continue
        layers = obj.data.uv_layers
        if len(layers) < 2:
            continue
        layers.active = layers[1]
        layers[1].active_render = True
        targets.append(obj)
    report["baked_objects"] = len(targets)
    if not targets:
        raise RuntimeError("the bundle has no meshes with a lightmap UV set")

    # Cycles re-syncs the whole scene for every object it bakes (minutes with a few hundred objects): bake ONE object
    bpy.ops.object.select_all(action="DESELECT")
    for obj in targets:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    if len(targets) > 1:
        bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active
    merged.data.uv_layers.active = merged.data.uv_layers[1]
    merged.data.uv_layers[1].active_render = True
    targets = [merged]

    # every material of a baked object gets the atlas as its (unconnected) active image node: that is where Cycles writes
    seen = set()
    plain = bpy.data.materials.new("bake-plain")
    plain.use_nodes = True
    for obj in targets:
        if not obj.material_slots:
            obj.data.materials.append(plain)  # a mesh without a material still needs a bake target
        for slot in obj.material_slots:
            mat = slot.material
            if mat is None or mat.name in seen or not mat.use_nodes:
                continue
            seen.add(mat.name)
            node = mat.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = atlas
            node.select = True
            mat.node_tree.nodes.active = node

    bpy.ops.object.select_all(action="DESELECT")
    for obj in targets:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]

    log(f"device: {report['device']}  atlas: {w}x{h}  samples: {cy.samples}  objects: {len(targets)}")
    t0 = time.time()
    bpy.ops.object.bake(
        type="DIFFUSE",
        pass_filter={"DIRECT", "INDIRECT"},
        margin=6,
        margin_type="EXTEND",
        use_clear=True,
        target="IMAGE_TEXTURES",
        use_selected_to_active=False,
    )
    report["bake_seconds"] = round(time.time() - t0, 1)
    bake_samples = cy.samples

    import numpy as np

    px = np.empty(w * h * 4, dtype=np.float32)
    atlas.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    lum = px[..., 0] * 0.2126 + px[..., 1] * 0.7152 + px[..., 2] * 0.0722
    valid = lum > 1e-6
    # normalise: the 99.5th percentile of the lit texels maps to 0.9, so 8 bits hold the useful range (after sRGB encoding)
    scale = float(np.percentile(lum[valid], 99.5) / 0.9) if valid.any() else 1.0
    scale = max(scale, 1e-4)
    t1 = time.time()
    try:
        dn, dn_path = denoise(atlas, scene, out_dir)
        dpx = np.empty(w * h * 4, dtype=np.float32)
        dn.pixels.foreach_get(dpx)
        dpx = dpx.reshape(h, w, 4)
        # keep texels the bake never reached (outside the charts) black
        px[..., :3] = np.where(valid[..., None], dpx[..., :3], 0.0)
        report["denoised"] = True
        os.remove(dn_path)
    except Exception as e:  # noqa: BLE001 - a denoise failure must not lose the bake
        report["denoised"] = False
        report["denoise_error"] = str(e)[:200]
    report["denoise_seconds"] = round(time.time() - t1, 1)

    enc = srgb_encode(px[..., :3] / scale)
    out = bpy.data.images.new("lightmap-out", w, h, alpha=False, float_buffer=False)
    out.colorspace_settings.name = "Non-Color"
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = enc
    # The glTF importer turns V upside down (glTF's origin is the top left, three.js's is the bottom left), so Blender baked
    # into an image whose V is 1 - v of the app's lightmap UVs: put the rows back, so three.js finds each texel at its own UV.
    rgba = rgba[::-1]
    out.pixels.foreach_set(rgba.ravel())
    out.filepath_raw = os.path.join(out_dir, "lightmap.png")
    out.file_format = "PNG"
    out.save()

    report.update({"width": w, "height": h, "samples": bake_samples, "scale": scale, "render_seconds": report["bake_seconds"]})
    with open(os.path.join(out_dir, "result.json"), "w", encoding="utf8") as f:
        json.dump(report, f, indent=1)
    log("done " + json.dumps(report))


main()
