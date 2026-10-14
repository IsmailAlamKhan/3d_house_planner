"""CLIP image similarity for the enhancement eval (npm run eval:enhance): cosine similarity of the image embeddings of
a reference picture and some candidates, using ComfyUI's own CLIP vision loader and the CLIP-ViT-H-14 weights.

    python scripts/clip_similarity.py <reference> <image> [<image> ...]      ->  {"<image>": 0.83, ...}

Environment: REF_CROP (x,y,w,h of the design inside the reference picture), COMFYUI_DIR (the ComfyUI workspace), CLIP_VISION (path of the CLIP vision model; default: the ViT-H-14 in the
workspace's models/clip_vision).
"""
import glob
import json
import os
import sys

args = [os.path.abspath(a) for a in sys.argv[1:]]  # before the working folder changes
comfy_dir = os.environ.get("COMFYUI_DIR", r"E:\ComfyUI\ComfyUI\comfyui")
sys.path.insert(0, comfy_dir)
os.chdir(comfy_dir)

import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402

import comfy.clip_vision as clip_vision  # noqa: E402

path = os.environ.get("CLIP_VISION") or next(
    iter(sorted(glob.glob(os.path.join(comfy_dir, "models", "clip_vision", "*ViT-H-14*")))), None
)
if not path:
    sys.exit("no CLIP-ViT-H-14 model found; set CLIP_VISION")
model = clip_vision.load(path)


def embed(p, crop=None):
    im = Image.open(p).convert("RGB")
    if crop:
        x, y, w, h = crop
        im = im.crop((x, y, x + w, y + h))
    img = np.asarray(im).astype(np.float32) / 255.0
    out = model.encode_image(torch.from_numpy(img)[None], crop=False)  # the whole picture (squeezed), not its centre
    e = out["image_embeds"].float().flatten()
    return e / e.norm()


# REF_CROP="x,y,w,h": the part of the reference picture that is the design (the screenshot has bars around it)
ref_crop = [int(v) for v in os.environ["REF_CROP"].split(",")] if os.environ.get("REF_CROP") else None
ref = embed(args[0], ref_crop)
print(json.dumps({p: round(float((ref * embed(p)).sum()), 4) for p in args[1:]}), flush=True)
os._exit(0)  # ComfyUI's model patcher complains while the interpreter shuts down
