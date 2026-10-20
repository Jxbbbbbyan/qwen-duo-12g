# 确切的模型与运行环境 / Exact models and runtime

本文件给出本仓库所有实测数字所对应的**确切模型文件与运行环境**。
任何人都可以拿下面的字节数与 SHA-256 核对：只要文件一致，`docs/EVIDENCE.md` 里的数字才适用于你。

This file pins the **exact model files and runtime** behind every measured number in this repo.
Verify the byte counts and SHA-256 values below: the numbers in `docs/EVIDENCE.md` only transfer to you
if your files are identical.

---

## 关于模型命名 / On the model names

- **`Qwen3.8-27B`** 是 GGUF 文件头里 `general.name` 的值，也就是模型自身的名字；`UD-Q4_K_S` 是量化档位标签。上游基座仓库是 `Qwen/Qwen3.8-27B`，量化由 Unsloth 产出——见第 0 节。
- 决定可复现性的是**架构元数据 + SHA-256**，不是名字。请引用下表的元数据与哈希，而不是引用一个名称。
- 本仓库**不包含权重**。若你换用另一个 27B GGUF，本仓库的显存/内存数字**不会自动适用**，需要重新测量。
- 每个模型遵循**其各自上游许可**；本仓库的 MIT 许可不覆盖权重。

- **`Qwen3.8-27B`** is the name used locally for this weight file; `UD-Q4_K_S` is the quantiser's tier label.
- What determines reproducibility is the **architecture metadata plus the SHA-256**, not the name. Cite the
  metadata and hashes below rather than a marketing name.
- This repository **does not ship weights**. If you substitute a different 27B GGUF, the VRAM/RAM figures
  here **do not automatically transfer** — you must re-measure.
- Each model is governed by **its own upstream licence**; this repo's MIT licence does not cover weights.

---

## 0. 上游身份（从 GGUF 文件头直接读出，非推测）/ Upstream identity, read from the GGUF header

下面的字段不是从文件名猜的，而是**解析 GGUF 元数据块**得到的。任何人都可以用同一方法复核。
These fields were not inferred from the filename — they were **parsed out of the GGUF metadata block**.
Anyone can reproduce this with the same method.

### 语言模型 / The LLM

| 元数据键 / Key | 值 / Value |
|---|---|
| `general.name` | **`Qwen3.8-27B`** |
| `general.basename` | `Qwen3.8-27B` |
| `general.base_model.0.name` | `Qwen3.8 27B` |
| `general.base_model.0.organization` | **`Qwen`** |
| `general.base_model.0.repo_url` | **<https://huggingface.co/Qwen/Qwen3.8-27B>**（已实测 HTTP 200 / verified reachable） |
| `general.quantized_by` | **`Unsloth`** |
| `general.repo_url` | <https://huggingface.co/unsloth> |
| `general.license` | **`apache-2.0`**（文件内的声明，仍以上游模型页为准 / declared in the file; upstream page remains authoritative） |
| `general.size_label` | `27B` |
| `general.description` | Renewal of the beloved Qwen model, delivering unmatched intelligence density. |
| `general.type` | `model` |
| `general.architecture` | `qwen35`（866 tensors，50 个元数据键 / 866 tensors, 50 KV pairs） |

### 视觉投影器 / The vision projector

| 元数据键 / Key | 值 / Value |
|---|---|
| `general.name` | `Qwen3.8-27B` |
| `general.type` | **`mmproj`** |
| `general.size_label` | `461M` |
| `general.architecture` | `clip` |
| `general.file_type` | `1`（F16） |
| `general.license` | `apache-2.0` |
| `general.quantized_by` | `Unsloth` |
| `clip.projector_type` | `qwen3vl_merger` |

### 图像模型 / The image model

| 项目 / Item | 值 / Value |
|---|---|
| 上游仓库 / Upstream repo | **<https://huggingface.co/Comfy-Org/Qwen-Image-2.1>**（已实测 HTTP 200） |
| DiT 版本 / DiT variant | **Turbo**，INT8，`convrot`（旋转量化 / rotation-based quantisation） |
| 文本编码器 / Text encoder | **Qwen3-VL-8B**，INT8，`convrot` |
| VAE | BF16 |

> 这三个 `.safetensors` 没有统一的"模型名"字段可比对，因此**文件哈希就是它们的身份**（见第 3 节）。
> These three `.safetensors` files carry no single comparable "model name" field, so **their hashes are their
> identity** (see section 3).

---
## 0.5 下载来源与哈希验证 / Download sources and hash verification

### 确切下载地址 / Exact download URLs

```text
# unsloth/Qwen3.8-27B-GGUF
https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-UD-Q4_K_S.gguf
https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/mmproj-F16.gguf

# Comfy-Org/Qwen-Image-2.1
https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors
https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors
https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors
```

### 交叉验证结果 / Cross-check result

核对方式：把上游 Hugging Face API 返回的 **LFS oid**（即该文件的 SHA-256）与本机 `Get-FileHash -Algorithm SHA256`
的计算值逐一比对。**五个文件全部一致**（核对日 / checked 2026-10-21）：

| 文件 / File | 上游 LFS sha256 | 本机计算值 | 结果 |
|---|---|---|---|
| `Qwen3.8-27B-UD-Q4_K_S.gguf` | `75bc9c8a…64017` | 同左 / same | ✅ |
| `mmproj-F16.gguf` | `cbb841a9…b4e43e` | 同左 / same | ✅ |
| `qwen_image_2.1_turbo_int8_convrot.safetensors` | `8144a018…67314c` | 同左 / same | ✅ |
| `qwen3vl_8b_int8_convrot.safetensors` | `8bfd0f6e…452e8f` | 同左 / same | ✅ |
| `qwen_image_2.1_vae_bf16.safetensors` | `bb21f747…876b7c9` | 同左 / same | ✅ |

> 这意味着：本机那五个文件与公开上游**字节级相同**，不是同名不同物。
> 你只要下载后核对哈希，就能确认自己跑的是同一批权重。
>
> These five local files are **byte-identical to the public upstream artifacts**, not merely same-named.
> Verify the hashes after downloading to confirm you are running the same weights.

### 两个容易踩的坑 / Two easy mistakes

1. **基座仓库里没有 GGUF。** [`Qwen/Qwen3.8-27B`](https://huggingface.co/Qwen/Qwen3.8-27B) 放的是原始 BF16 分片
   （18 个 `model-*.safetensors`）与 `LICENSE`、tokenizer 等；**GGUF 与 mmproj 由 Unsloth 的仓库发布**。
2. **同仓库还有十几个量化档位**（Q2 到 Q8、IQ 系列）。本仓库的显存/内存数字**只对应 UD-Q4_K_S**，
   换档位必须重测——例如 `UD-Q4_K_M` 是 16,464,440,224 B，比本档大 1.1 GB，12 GB 显存下的 `-ngl` 会不同。

1. **The base repo has no GGUF.** [`Qwen/Qwen3.8-27B`](https://huggingface.co/Qwen/Qwen3.8-27B) holds the original BF16
   shards plus `LICENSE` and tokenizer files; **the GGUF and mmproj are published by Unsloth**.
2. **That GGUF repo also lists a dozen other quant tiers** (Q2 through Q8, plus the IQ series). The VRAM/RAM
   figures here apply **only to UD-Q4_K_S**; any other tier must be re-measured - e.g. `UD-Q4_K_M` is
   16,464,440,224 B, about 1.1 GB larger, and the workable `-ngl` on 12 GB will differ.

---
## 1. 语言模型 / The LLM

| 项目 / Item | 值 / Value |
|---|---|
| 文件名 / Filename | `Qwen3.8-27B-UD-Q4_K_S.gguf` |
| 字节数 / Bytes | **15,358,213,024**（14.30 GiB） |
| SHA-256 | `75bc9c8adba2842e72f0ab5201aaa07133c5010b566305c09187fcbdcd364017` |
| 参考机路径 / Reference path | `C:\llm\models\Qwen3.8-27B\Qwen3.8-27B-UD-Q4_K_S.gguf` |

**GGUF 元数据 / GGUF metadata**（决定它为什么能在 16 GB 内存上开 64K）：

```text
general.architecture       = qwen35            # 混合注意力架构 / hybrid attention
block_count               = 65
full_attention_interval   = 4                  # 约 16 层全注意力，其余为 SSM/线性层
ssm.state_size            = 128
ssm.inner_size            = 6144
embedding_length          = 5120
context_length            = 262144             # 模型支持能力，不是本机实测容量
nextn_predict_layers      = 1
```

> 只有那约 16 个全注意力层持有随上下文线性增长的 KV cache，这是 64K 在 16 GB 内存上可行的
> **架构原因**。纯注意力同尺寸模型做不到。
> Only those ~16 full-attention layers hold a context-scaling KV cache; that is the **architectural reason**
> 64K is viable on 16 GB. A dense model of the same size could not.

## 2. 视觉投影器 / Vision projector

| 项目 / Item | 值 / Value |
|---|---|
| 文件名 / Filename | `mmproj-F16.gguf` |
| 字节数 / Bytes | **927,607,488**（0.86 GiB） |
| SHA-256 | `cbb841a9ee0636b2ec172f5bb8df2ea8dfeb01e90fe7c6126581d662a0b4e43e` |
| 类型 / Type | `projector_type = qwen3vl_merger`，`projection_dim = 5120` |
| 视觉塔 / Vision tower | 27 层，hidden 1152，patch 16，merge 2，DeepStack 全为 False |
| 运行位置 / Runs on | **CPU**（`LLAMA_ARG_MMPROJ_OFFLOAD=0`），不占视觉塔显存 |

## 3. 图像模型 / The image model

上游仓库 / Upstream repository: **`Comfy-Org/Qwen-Image-2.1`**

| 角色 / Role | 文件名 / Filename | 字节数 / Bytes | SHA-256 |
|---|---|---:|---|
| DiT（Turbo） | `qwen_image_2.1_turbo_int8_convrot.safetensors` | **7,256,787,829**（6.76 GiB） | `8144a0182964aa8403ad6dbc011db837304167d235161b9aabaa8532e967314c` |
| 文本编码器 / text encoder | `qwen3vl_8b_int8_convrot.safetensors` | **9,350,798,360**（8.71 GiB） | `8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f` |
| VAE | `qwen_image_2.1_vae_bf16.safetensors` | **675,509,688**（0.63 GiB） | `bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9` |

放置位置 / Where they go: ComfyUI 的 `models\diffusion_models`、`models\text_encoders`、`models\vae`。
清单与下载源写在 [`../comfyui/scripts/fetch_models.ps1`](../comfyui/scripts/fetch_models.ps1)（含 ModelScope 与 hf-mirror 两个源）。

**可选的非 Turbo 基础 DiT**（仅在显式 `-IncludeBaseDit` 时下载，用于质量对比，不属于默认集合）：
`qwen_image_2.1_int8_convrot.safetensors`，7,256,783,064 B，SHA-256 `cb74113cb03faecd79611b01fd7fd642f0aa60d6f0b95086abee214d75eaa57d`。

> 文本编码器是 **Qwen3-VL-8B**（`qwen3vl_8b`），隐藏维 **4096**；而上面那个 27B 的 `embedding_length`
> 是 **5120**。两者**不能互换**——图像条件编码必须用 8B 编码器。
> The text encoder is **Qwen3-VL-8B** (hidden size **4096**); the 27B LLM has `embedding_length` **5120**.
> They are **not interchangeable** — image conditioning requires the 8B encoder.

## 4. 运行环境 / Runtime and host

| 组件 / Component | 确切版本 / Exact version |
|---|---|
| llama.cpp | **0.6.0-dev, build 11617, commit `14310190c`**，Clang 20.1.8，Windows x86_64 |
| ComfyUI | **0.41.0**（`comfyui_version.py` 回读） |
| PyTorch | **2.14.0+cu130**（`torch.version.cuda = 13.0`，`cuda_available = True`） |
| Python（嵌入式） | **3.13.14** |
| 操作系统 / OS | **Windows 11 专业版, build 26200** |
| GPU | **NVIDIA GeForce RTX 3060 Laptop GPU**，12,288 MiB VRAM，sm_86 |
| 显卡驱动 / Driver | **32.0.16.1692**（对外称 616.92） |
| CPU / 内存 | i5-9400F（6C/6T）· 15.94 GiB DDR4-2666，2×8 GB，2/2 插槽已满 |

## 5. 关键启动参数（复现时必须一致）/ Flags required to reproduce

```text
-ngl 44            # GPU 层数：实测最优（代价/内存平衡）
-c 65536           # 配置的上下文；实际测量点是 64,000
-ctk q4_0 -ctv q4_0 -fa on   # KV 量化必须配 flash attention
-ub 256            # 缩小计算缓冲区
-lm mmap           # 不要 mmap+mlock
（不使用 -ncffn）
```

ComfyUI 侧：`--fast-disk --disable-pinned-memory --windows-standalone-build`。

## 6. 测量口径 / What each number refers to

| 类别 / Category | 含义 / Meaning |
|---|---|
| **实测 / measured** | 本机进程/设备的实际读数，记录在 `docs/EVIDENCE.md` |
| **文件体积 / file footprint** | 上表的字节数换算，**不等于**运行时占用 |
| **估算 / estimate** | 文中明确标注为估算或推导 |

> 特别注意：文本编码器权重是 8.71 GiB，但编码器阶段的**实际总显存占用更高**
> （估算约 9.4–10.3 GiB，见 [`OOM_MITIGATION.md`](OOM_MITIGATION.md)）。不要把"权重体积"当成"峰值占用"。
