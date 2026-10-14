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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from studio_common import *  # noqa: E402,F401,F403
from studio_common import QUALITY, TO_BLENDER, b_pos, log  # noqa: E402


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
    bundle, out_dir, quality = os.path.abspath(argv[0]), os.path.abspath(argv[1]), argv[2]
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
