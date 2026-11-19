# Prerequisites

The packaged scripts do not download these files and do not check their bytes unless the user sets `expectedBytes` for a path they already have. Sizes and hashes below are the repository's recorded identity for the historical stack, copied from `docs/MODELS.md` and `comfyui/scripts/fetch_models.ps1`. They are not new measurements.

| File | Bytes | SHA-256 |
| --- | --- | --- |
| Qwen3.8-27B-UD-Q4_K_S.gguf | 15358213024 | 75bc9c8adba2842e72f0ab5201aaa07133c5010b566305c09187fcbdcd364017 |
| mmproj-F16.gguf | 927607488 | cbb841a9ee0636b2ec172f5bb8df2ea8dfeb01e90fe7c6126581d662a0b4e43e |
| qwen_image_2.1_turbo_int8_convrot.safetensors | 7256787829 | 8144a0182964aa8403ad6dbc011db837304167d235161b9aabaa8532e967314c |
| qwen3vl_8b_int8_convrot.safetensors | 9350798360 | 8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f |
| qwen_image_2.1_vae_bf16.safetensors | 675509688 | bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9 |

The five files sum to 33568916389 bytes, about 31.3 GiB. The historical ComfyUI portable archive size recorded in `fetch_comfy.ps1` is 2010075321 bytes. A 32 GiB fixed pagefile and a 100 GiB free-disk planning figure are historical operator notes. This skill does not change the pagefile or the disk.

Licences, as recorded in the repository, not as a new legal opinion: this repository's code and docs are MIT. The GGUF header recorded `apache-2.0`; the upstream model page remains the authority. ComfyUI is GPL-3.0. llama.cpp is MIT. Those upstream licences are not changed here. No paid API and no GPU rental is required by the packaged scripts, and none is used by the tests.

Recorded local runtime, not a platform promise: llama.cpp 0.6.0-dev build 11617 commit 14310190c, ComfyUI 0.41.0, PyTorch 2.14.0+cu130, embedded Python 3.13.14, Windows 11 build 26200, RTX 3060 Laptop 12288 MiB. The language model and the image stack must not be loaded at the same time on that 12 GiB card.

Publisher URLs are identity notes. Do not download them while following the stage scripts. Permission to download multi-gigabyte weights in a buyer session is not established.

```text
https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-UD-Q4_K_S.gguf
https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/mmproj-F16.gguf
https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors
https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors
https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors
```

Config fields the user fills with their own absolute paths: `llamaExe`, `model`, `mmproj`, `python`, `comfyMain`, `comfyCwd`, `graph`, `comfyOutput`, `projectRoot`. Optional stat paths: `imageDit`, `imageEncoder`, `imageVae`. `allowDownloads` and `allowSystemChanges` must stay false.
