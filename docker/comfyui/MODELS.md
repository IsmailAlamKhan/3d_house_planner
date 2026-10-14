# Models and node packs of the image service (ComfyUI)

Everything is downloaded by `comfyui-init` (models) or at image build time (node packs), pinned to exact revisions and checked by size.
Nothing here is in git. All of these allow the use the app makes of them (local, private image enhancement of the user's own designs).

| What                                      | Source (pinned)                                                                                                                        | Licence                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| ComfyUI v0.9.2                            | github.com/comfyanonymous/ComfyUI @ `8f40b43e0204…`                                                                                    | GPL-3.0                  |
| ComfyUI_IPAdapter_plus (style reference)  | github.com/cubiq/ComfyUI_IPAdapter_plus @ `a0f451a5113c…`                                                                              | GPL-3.0                  |
| ComfyUI_UltimateSDUpscale (tiled upscale) | github.com/ssitu/ComfyUI_UltimateSDUpscale @ `a5547db9e1d0…` (+ its submodule)                                                         | GPL-3.0                  |
| Stable Diffusion XL base 1.0              | huggingface.co/stabilityai/stable-diffusion-xl-base-1.0 @ `46216598403…`                                                               | CreativeML Open RAIL++-M |
| SDXL depth ControlNet (fp16)              | huggingface.co/diffusers/controlnet-depth-sdxl-1.0 @ `17bb97973f29…`                                                                   | CreativeML Open RAIL++-M |
| SDXL canny ControlNet (fp16)              | huggingface.co/diffusers/controlnet-canny-sdxl-1.0 @ `eb115a19a10d…`                                                                   | CreativeML Open RAIL++-M |
| IP-Adapter Plus SDXL (ViT-H)              | huggingface.co/h94/IP-Adapter @ `018e40277429…` (`sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors`)                                 | Apache-2.0               |
| CLIP ViT-H/14 image encoder               | huggingface.co/h94/IP-Adapter @ `018e40277429…` (`models/image_encoder/model.safetensors`, from laion/CLIP-ViT-H-14-laion2B-s32B-b79K) | MIT                      |
| Real-ESRGAN x4plus                        | github.com/xinntao/Real-ESRGAN release v0.1.0                                                                                          | BSD-3-Clause             |

**Other checkpoints.** SDXL base 1.0 is the default. A realistic SDXL fine-tune can be chosen in _Enhance → Model_ when it is in ComfyUI's
`checkpoints` folder (the app lists what it finds); its licence is the user's to check, which is why none is downloaded here. The
RAIL++-M licence allows commercial use of the pictures but forbids certain uses (see the licence text).
