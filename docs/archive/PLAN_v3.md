> [!WARNING]
> **历史快照 · 非当前结论 / HISTORICAL SNAPSHOT — NOT CURRENT**
>
> 本文档是项目开发过程中的内部记录，状态停留在写作当时，其中部分结论已被后续实测推翻或超越。
> 请以 [`docs/EVIDENCE.md`](../EVIDENCE.md) 的实测数字与 [`README.md`](../../README.md) 的说明为准。
> 本文提到的 `verify_artifacts.ps1` 等开发期脚本**已从公开仓库移除**，其中的命令不应照抄执行。
>
> This is an internal record from development. It reflects the state at the time of writing, and some
> conclusions have since been superseded. Treat [`docs/EVIDENCE.md`](../EVIDENCE.md) and
> [`README.md`](../../README.md) as authoritative. Development-only scripts mentioned here (such as
> `verify_artifacts.ps1`) have been **removed from the public repository** — do not copy-paste commands
> out of this file.

---
# PLAN_v3 - Qwen-Image 2.1 本机部署（RTX 3060 12GB）

Status: reviewed
Plan version: 3
Artifact directory: `dsh-plans/2026-10-16-qwen-image-21-local-deploy/`
State directory: `dsh-plans/.state/runs/20261016T042835Z-qwen-image-21-local-deploy/`
Language: `zh-Hans`

> 单位制声明（强制）：体积一律「精确字节 + GiB + GB(dec)」。依据：本 run 曾因单位混淆产生自我推翻的错误（`CORR-002`）。

> **v3 的核心变更**（详见 `PLAN_v2_criticizer_qa.md`，5 问全部作答）：
> ① `--fast-disk` 的语义从「已定结论」降级为「**阶段 0 A/B 实测定胜负**」（`CQ1`）；
> ② 「占内存」被**写死定义**，并改用能看见 WDDM 共享显存通道的计数器（`CQ2`）；
> ③ 所有阈值改为**相对空载基线的增量**，不再拍脑袋定绝对值（`CQ3`）；
> ④ **交付的 UI 模板本身必须被实跑验收**，API 图只作验证脚手架（`CQ4`）；
> ⑤ `ALT-001` **移出本 goal**，门禁失败的终态被明确化（`CQ5`）。

## Original Request

用户要**本地部署 AI 跑图模型 Qwen-Image 2.1**，自报硬件「RTX 3060 12G / 双 DDR4 8G（16GB）/ i5-9400F」，
并提供了一份**面向 P104（Pascal）的部署指南**。要求我详读指南 + 自行搜索查证，形成本地部署 plan，
**走审核流程后再执行**。首轮提问中用户追加决定性约束：
**「仅占用 12G 显存，完全不占用内存，或仅有上下文占用内存」**。

## Goals

- `G-001`: 在本机 RTX 3060 12GB 上完成 Qwen-Image 2.1 部署并实际出图。
- `G-002`: 满足用户的资源目标——**模型权重不驻留系统内存**，且该结论**可证伪**。
- `G-003`: 能力全开：文生图 + 图像编辑 + 重绘/扩图。
- `G-004`: 交付一键启停脚本、固化工作流、中文 README、资源自检脚本。
- `G-005`: 附 P104 迁移方案文档（**只写不执行**）。

## Non-Goals

- `NG-001`: 不执行 P104 迁移。
- `NG-002`: 不采购硬件。
- `NG-003`: 不改动 `D:\llm` 既有 27B 部署与 `D:\miniconda3` 环境。
- `NG-004`: 不把 GGUF 路线作为主路径。
- `NG-005`: 不做微调 / LoRA 训练。
- `NG-006`: 不承诺未实测的速度数字。
- `NG-007`: 不下载提示词增强器 PE（各 9,471,072,252 B = 8.82 GiB）。
- `NG-008`（**v3 新增，`CQ5`**）: **本 goal 不引入任何第三方 GGUF 节点包与第三方编码器**
  （即 `ALT-001` 全部内容）。门禁失败时不得自行扩大范围去拉取它们。

## Workspace State

- `STATE-001`: `dsh-plans/.state/config.json` — language `zh-Hans`（`source: user`）；
  reviewer/criticizer `delegated-subagent`、executor `goal-loop`，`model_selector: null`（inherit），
  `confirmed_at` 均已存在。
- `STATE-002`: 运行台账 `dsh-plans/.state/runs/20261016T042835Z-qwen-image-21-local-deploy/`；
  reviewer 第 1 轮（`qwen21-plan-review-r1`）与 criticizer 第 2 轮（`qwen21-plan-criticize-r2`）均已记录 `completed`。

## Repo Evidence

- `E-REPO-001`: Intel Core i5-9400F，6 核 6 线程，2904 MHz，无核显。
- `E-REPO-002`: 2 × 8,589,934,592 B @ 2666 MT/s，双通道已满。
- `E-REPO-003`: Windows 11 专业版 10.0.26200；可见内存 15.9 GB；测得空闲 7.6 GB。
- `E-REPO-004`: **RTX 3060 Laptop GPU**，`memory.total = 12288 MiB`，`compute_cap = 8.6`（Ampere sm_86，
  有 INT8 张量核、无 FP8/FP4），PCIe gen3 ×16，driver 616.92，CUDA UMD 13.4，功耗墙 80 W，WDDM，
  桌面占约 1068 MiB。
- `E-REPO-005`: `C:` SSD 空闲 120.7 GB；`D:` HDD 空闲 360.4 GB（C: 473.1 MiB/s、D: 186.8 MiB/s）。
- `E-REPO-006`: 未安装任何 ComfyUI。
- `E-REPO-007`: PATH 上 `python`/`python3` 是 Store 存根；真实解释器 `D:\miniconda3\python.exe` = 3.13.13。
- `E-REPO-008`: miniconda 内 `torch 2.11.0+cu128`、CUDA 可用；`gguf`/`hf_hub`/`modelscope` 无。
- `E-REPO-009`: `D:\llm`（17.7 GB）为既有 27B 资产 → 受 `NG-003` 保护。
- `E-REPO-010`: 无 `7z`/`7za`；`tar.exe` = bsdtar 3.8.9 / libarchive 3.8.9（支持 7z）；
  本机已有 `D:\miniconda3\pkgs\py7zr-1.1.3-py313haa95532_1`（回退提取器）。
- `E-REPO-011`: `LongPathsEnabled = 0`。
- `E-REPO-012`: 可复用先例：`2026-10-14-qwen38-27b-local-deploy`、`2026-10-15-p102-p104-9b-feasibility`。
- `E-REPO-013`（**v3 新增，`CQ2`**）: **Windows 性能计数器实测可用**（`Get-Counter -ListSet`）：
  - `\GPU Process Memory(*)\Shared Usage`、`\Dedicated Usage`、`\Non Local Usage`、`\Local Usage`、`\Total Committed`
    —— **`Shared Usage` 就是 WDDM 共享内存溢出通道本身**；
  - `\Memory\Pages Input/sec`、`Available MBytes`、`Committed Bytes`、`Standby Cache Normal Priority Bytes` 等；
  - 实时抽样：`Available MBytes = 8074`、`Committed Bytes = 14,469,378,048`（≈13.5 GiB）。

## External Evidence

### 模型与资产
- `E-EXT-001`: `Qwen/Qwen-Image-2.1` 存在（2026-09-30）：`text_encoder/` 4 分片 16.34 GB(dec)（≈8B bf16）、
  `transformer/` 2 分片 13.25 GB(dec)（≈7B）、`vae/` 1.26 GB(dec)。
- `E-EXT-002`: `Comfy-Org/Qwen-Image-2.1`（官方 repack，下载量 10,250,615）清单已完整枚举。
- `E-EXT-003`: **下载基准（完整 64 位 SHA256）**，取自 ModelScope，与 HF LFS `sha256` 一致：

  | # | 相对路径 | 字节 | GiB | GB(dec) | SHA256（完整） |
  |---|---|---|---|---|---|
  | 1 | `diffusion_models/qwen_image_2.1_int8_convrot.safetensors` | 7,256,783,064 | 6.76 | 7.26 | `cb74113cb03faecd79611b01fd7fd642f0aa60d6f0b95086abee214d75eaa57d` |
  | 2 | `diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors` | 7,256,787,829 | 6.76 | 7.26 | `8144a0182964aa8403ad6dbc011db837304167d235161b9aabaa8532e967314c` |
  | 3 | `text_encoders/qwen3vl_8b_int8_convrot.safetensors` | 9,350,798,360 | 8.71 | 9.35 | `8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f` |
  | 4 | `vae/qwen_image_2.1_vae_bf16.safetensors` | 675,509,688 | 0.63 | 0.68 | `bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9` |
  | | **四件合计** | **24,539,878,941** | **22.85** | **24.54** | |
  | | 第一批（#2+#3+#4，Turbo 路径） | 17,283,095,877 | 16.10 | 17.28 | |
  | | 第二批（#1，条件下载） | 7,256,783,064 | 6.76 | 7.26 | |
- `E-EXT-004`: ModelScope 直链端点实测可用（`Range: bytes=0-1` → HTTP 206）；
  `modelscope` PyPI 1.40.2（`requires_python >=3.10`）。
- `E-EXT-005`: ModelScope **确实**镜像 `Comfy-Org/Qwen-Image-2.1`（23 文件）与
  `unsloth/Qwen-Image-2.1-GGUF`（21 文件）→ 指南「用 ModelScope 国内直下」成立，不需 hf-mirror。
- `E-EXT-006`: 许可 = `license: other` / `license_name: qwen-research`（研究评估、非商用）→ `C-011`。

### ComfyUI 支持与版本门槛
- `E-EXT-007`: master 含原生支持 `comfy/ldm/qwen_image21/model.py`、`comfy/text_encoders/qwen_image21.py`
  （`model_type="qwen3vl_8b"`）、原生节点 `TextEncodeQwenImage21` 与 `QwenImage21Cache` → **主路径零第三方节点**。
- `E-EXT-008`: 版本门槛：PR `#16400` merged 2026-09-19；按 tag 逐文件验证 v0.35.0/v0.36.0 为 404、
  **v0.37.0 起为 200**。最新 tag `v0.41.1`。
- `E-EXT-009`: `comfy/sd.py` 含 `# int8+convrot quantized decoder` → 原生量化格式。
- `E-EXT-010`: `ComfyUI_windows_portable_nvidia.7z` = **2,010,075,321 B**（1.87 GiB / 2.01 GB(dec)）；
  最新带资源的 release 为 **v0.41.0**。

### 启动参数与内存机制（含 v3 新增追踪）
- `E-EXT-011`（`RV1-1`）: `--gpu-only`/`--highvram` → `VRAMState.HIGH_VRAM`；
  `unet_offload_device()`（`model_management.py:1106-1118`）与 `text_encoder_offload_device()`（`:1213-1224`）
  在该状态返回 GPU 侧 → **"卸载"不释放任何显存**。
- `E-EXT-012`（`RV1-1`）: `cli_args.py:337` → 传 `--highvram`/`--gpu-only` **关闭 DynamicVRAM**，
  退出唯一提供磁盘后备卸载的动态加载器。
- `E-EXT-013`（`RV1-3`）: `model_management.py:1640` **`MAX_PINNED_MEMORY = ram * 0.40`**
  → 本机最多约 6.4 GB **不可换页**；`cli_args.py:206` `--disable-pinned-memory`；`:145` `--high-ram`。
- `E-EXT-014`: `model_management.py:877/:879` `EXTRA_RESERVED_VRAM = 600 * 1024 * 1024
  #Windows is higher because of the shared vram issue` → **源码自认 WDDM 共享显存溢出**。
- `E-EXT-015`: `--disable-smart-memory` 语义与字面相反（aggressively offload to regular ram）→ 禁用。
  `--async-offload` 仅控 `NUM_STREAMS`，不是内存主因。
- `E-EXT-026`（**v3 新增，`CQ1` 的追查结果：部分证实**）:
  1. `comfy/storage.py` `model_fast_disk(paths)`：
     `if args.fast_disk or args.disable_fast_disk: fast = not args.disable_fast_disk`，
     否则走自动判定 `fast_storage(path)` → `_fast_nvme(name)`（判该路径是否 NVMe 快盘）。
     → **`--fast-disk` 是「强制覆盖按路径自动判定」的开关**，不是某个机制的总闸。
  2. 真正实现在**外部包** `comfy_aimdo.storage.fast_disk(path)`（`comfy-aimdo` 0.5.6，
     "AI Model Dynamic Offloader for ComfyUI"，基于 VBAR + `fault()` 的按需卸载）。
  3. `comfy/ops.py:204-265` 证明 `fast_disk` **确实改变内存策略**
     （`subset = "weights-fast" if fast_disk else "weights"`；`if pin is None and not fast_disk:` 等）。
  4. **可观测启动日志**：`logging.info("Model storage policy: fast_disk=%s paths=%s", fast, …)`（`storage.py:110`）。
  5. **仍未证实**：被驱逐权重的物理去向。该逻辑在 `comfy_aimdo.storage` 内，主代理无法从可达源码确认。
     → **不得**再断言"溢出落到磁盘"；作为 `OPEN-006` 由 `I-012` 的 A/B 实测裁决。

### 官方工作流模板
- `E-EXT-017`: `image_qwen_image_2_1_t2i.json`（78,056 B）引用 `qwen_image_2.1_int8_convrot`、
  `qwen3vl_8b_int8_convrot`、`qwen_image_2.1_vae_bf16`（**与本案选型一致**）；
  `KSampler = [0,"fixed",25 步,cfg 1,"euler","simple",1]`；`EmptyLatentImage=[1024,1024,1]`。
- `E-EXT-018`: `image_qwen_image_2_1_turbo_t2i.json` 引用 `qwen_image_2.1_turbo_int8_convrot` +
  `qwen3vl_8b_int8_convrot` + `qwen_image_2.1_vae_bf16`；`SamplerCustomAdvanced` + `KSamplerSelect("euler")`
  + 显式 sigma `1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0`（9 点 = **8 步**）。
- `E-EXT-019`: `image_qwen_image_2_1_turbo_image_edit.json` 存在；`LoadImage` 在**顶层**；
  `CFGGuider` widget = **8** → `I-006` 须显式声明 cfg 取值与理由。
- `E-EXT-020`（`RV1-4`）: 逐模板计数证明 `*_bf16.safetensors` **只出现在 `MarkdownNote` 散文里**，
  **无任何 `widgets_values` 引用 bf16 文件**；唯一真实缺文件引用是 PE 的 `CLIPLoader`，
  其分支由 `ComfySwitchNode`（`widgets=false`、输入 `lazy=True`）门控，未选中分支不执行。
  模板为子图结构：可执行图在 `definitions.subgraphs[0].nodes`，文件名另镜像在顶层 **promoted-widget 数组**。
- `E-EXT-021`: 可用模板清单：`..._t2i`、`..._turbo_t2i`、`..._image_edit`、`..._turbo_image_edit`、`..._background_removal`。
- `E-EXT-022`: **重绘/扩图无 2.1 专用模板**（只有 `blueprints/image_{in,out}painting_qwen_image.json`，
  指向上一代）→ `C-009`。

### 硬件适配
- `E-EXT-023`: 同型卡推导分析（该页自述未在 3060 上实测）：int8 DiT 6.758 + 编码器 8.709 = 15.467 GiB
  **永不共驻** 12 GB；「32 GB 系统内存」列为推荐；Windows `EXTRA_RESERVED_VRAM` = 600 MiB；
  1 MP latent = 4,096 token（bf16 ≈0.480 GiB）；VAE 1024² 解码预算 2.778 GiB；
  且「Under DynamicVRAM ComfyUI does not unload one model to make room for the other …
  comfy-aimdo evicts weights as allocations need the room」→ **分阶段驻留依赖 DynamicVRAM 开启**。
  **无任何 12 GB / Ampere 卡跑通该模型的公开记录**；社区两次 RTX 3060 GGUF 尝试均失败。
- `E-EXT-024`（单一三阶段表；**全部为推导**，须由 `I-008` 实测取代）：

  | 阶段 | 权重 | Windows 预留 | 激活/工作集 | 合计（GiB） | < 12288 MiB？ |
  |---|---|---|---|---|---|
  | 文本编码（8B 编码器） | 8.71 | 0.59 | 小（含视觉塔） | ≈9.4–10.3 | 是（**最紧阶段**） |
  | 采样（int8 DiT，1 MP） | 6.76 | 0.59 | 0.48 | ≈7.8 | 是 |
  | VAE 解码（1024²） | 0.63 | 0.59 | 2.778 | ≈4.0 | 是 |

  前提是阶段之间**真的发生驱逐**——即 DynamicVRAM 必须开启（`E-EXT-012`）。
- `E-EXT-025`: `city96/ComfyUI-GGUF` 最后 push 2026-01-12（早于模型发布 8 个月）；
  活跃分支 `molbal/ComfyUI-GGUF` 支持该模型但其仓库**只含 DiT 不含编码器**；
  编码器 GGUF 仅在第三方仓库，且未被列为已支持编码器 → `ALT-001` 前提未证实（`NG-008`）。

## Corrections To The Supplied Guide

指南的**文件名、路径、版本门槛、十进制 GB 体积数字**经查证**正确**。
需纠正/补充：

- `CORR-001`（推翻我自己）：曾判「ModelScope 无 ComfyUI int8 repack」。错（`E-EXT-005`）。
- `CORR-002`（推翻我自己）：曾判指南「体积数字普遍偏大」。错——指南用十进制 GB，我用 GiB 比（`ERRATA`）。
- `CORR-003`: 指南的 `git clone city96/ComfyUI-GGUF` 过时 8 个月（`E-EXT-025`）；主路径不需要 GGUF 节点。
- `CORR-004`: 指南整段 **P104 专属结论不适用于本机**（Pascal sm_61 无 INT8 张量核 vs 本机 Ampere sm_86 **有**）。
  「必须弃用 INT8」「文本编码器必须跑 CPU」「nvfp4/int8 节点不能碰」在本机**均不成立**。
- `CORR-005`: 指南「P104 PCIe 1.1 x4」未获一手证实 → 迁移文档标注**待查**。
- `CORR-006`: 指南未提两个本机真风险：① 内存仅 16 GB；② `--disable-smart-memory` 语义陷阱。
- `CORR-007`（推翻我 v1）：曾断言官方模板"引用未下载的 bf16 文件、必须裁剪"。错（`E-EXT-020`）。
- `CORR-008`（推翻我 v1）：曾断言「只驻显存是启动参数问题」并选 `--gpu-only`/`--highvram`。
  **这两个参数作用恰好相反**（`E-EXT-011`/`E-EXT-012`）。
- `CORR-009`（**v3 新增，推翻我 v2**）：v2 把 `--fast-disk` 说成「正确杠杆」并断言溢出「落到磁盘」——
  这**只依据了一句 argparse 帮助文本**，属于与 `CORR-008` 同类的错误。
  现降级为「**部分证实 + 待 A/B 裁决**」（`E-EXT-026`、`OPEN-006`）。

## Resolved Decisions

- `D-001`: 范围 = 本机 3060 为主，P104 只出文档。
- `D-002`: 首要目标 = 权重不驻留系统内存。
- `D-003`: 路线 = 官方原生 `int8_convrot` 全套；放弃指南混合路线。
- `D-004`: 安装形态 = ComfyUI 官方 Windows 便携版（nvidia 构建）。
- `D-005`: 下载渠道 = ModelScope。
- `D-006`: 安装根目录 = `C:\ComfyUI\`（SSD）。
- `D-007`: 能力范围 = 文生图 + 图像编辑 + 重绘/扩图。
- `D-008`: 下两个 int8 DiT；Turbo 三件先下并过门禁，基础 DiT 条件下载。
- `D-009`: 验收 = 跑通 + 不 OOM/不爆内存为硬门槛；速度只如实记录。
- `D-010`: 交付形态 = 完整交付。
- `D-011`: 操作规程 = 跑图前关后台；启动脚本前置检测可用内存。
- `D-012`: 最终范围确认 = `No more requirements`。
- `D-013`: 启动参数集 = `--fast-disk --disable-pinned-memory`；禁 `--gpu-only`、`--highvram`、
  `--disable-dynamic-vram`、`--disable-smart-memory`、`--high-ram`、`--lowvram`、`--novram`、`--cpu`。
- `D-021`（**v3，`CQ2`**）: **「权重驻留系统内存」的定义**见 `R-010`；仪器 = `Private Bytes` +
  `GPU Process Memory\Shared Usage` + `Pages Input/sec`。
- `D-022`（**v3，`CQ1`**）: `--fast-disk` 的语义**不由文本裁定**，改由 `I-012` 的 A/B 实测定胜负。
- `D-023`（**v3，`CQ3`**）: 所有阈值改为**相对空载基线的增量**（见 `R-011`）。
- `D-024`（**v3，`CQ4`**）: **权威执行面 = 交付的 UI 模板**；最终验收必须在 ComfyUI 前端实跑该文件；
  API 图仅为"验证脚手架"（见 `R-012`）。
- `D-025`（**v3，`CQ5`**）: **`ALT-001` 移出本 goal**（`NG-008`）；门禁失败终态明确化；`AC-005` 修正。

## Requirements

- `R-001`: 选型与官方模板一致（`int8_convrot` 三件套），主路径零第三方节点。
- `R-002`: 启动参数 = `--fast-disk` + `--disable-pinned-memory`；禁列表见 `D-013`。
- `R-003`: 下载全走 ModelScope；每文件以**字节数 + 完整 SHA256** 校验。
- `R-004`: 安装位置 `C:\ComfyUI\`（SSD）。
- `R-005`: 跑图前关后台；启动脚本前置检测可用内存，**阈值 = 空载基线 `B0` + 4 GiB**，
  不足时**拒绝启动**（`CQ3`）。
- `R-006`: 三类能力各有一个可用工作流。
- `R-007`: 全文体积/显存数字标注单位制。
- `R-008`: 实测速度只作数据报告，不得作为验收门槛。
- `R-009`: 先证明机制成立（`I-012`），**再**投入第二批下载（`I-013`）。
- `R-010`（**v3 新增**）: **「权重驻留系统内存」的定义（写死，不得临场解释）**：
  ComfyUI 进程的**提交/匿名内存**（`\Process(...)\Private Bytes`）或
  **GPU 共享显存**（`\GPU Process Memory(...)\Shared Usage`）随权重量级增长。
  **mmap 的文件后备页计入 standby 缓存不算违规**（可立即回收，非提交内存）。
  「不占内存」= 上述两项不随权重体积增长。
- `R-011`（**v3 新增**）: 所有资源阈值必须表述为**相对空载基线 `B0` 的增量**，
  禁止使用未经实测校准的绝对值。
- `R-012`（**v3 新增**）: `AC-001`/`AC-002`/`AC-003` 的验收**必须实跑交付的 UI 工作流文件**；
  API 图上的任何结果都只能作为脚手架证据，不得单独作为验收依据。

## Constraints

- `C-001`: 显存 12288 MiB；Windows 预留 600 MiB；桌面占约 1068 MiB。
- `C-002`: 系统内存 15.9 GB，空闲仅 7.6 GB。
- `C-003`: int8 DiT 6.76 GiB + 编码器 8.71 GiB = 15.47 GiB，永不共驻。
- `C-004`: C: 空闲 120.7 GB；预留约 31 GB。
- `C-005`: 80 W 功耗墙笔记本 3060，速度无同型卡实测可参考。
- `C-006`: ComfyUI < v0.37.0 无该模型节点。
- `C-007`: 无 `7z`，只有 bsdtar 3.8.9。
- `C-008`: 便携版实际 CUDA 版本未证实（`OPEN-001`）。
- `C-009`: 2.1 无专用重绘/扩图官方模板。
- `C-010`: 官方模板可执行路径上唯一缺文件是 PE 编码器，其分支被惰性开关门控。
- `C-011`: 权重为 Qwen Research License（非商用），交付物须声明。
- `C-012`: `LongPathsEnabled = 0` → 路径必须短。
- `C-013`: `MAX_PINNED_MEMORY = ram * 0.40` → 不加 `--disable-pinned-memory` 时最多约 6.4 GB 不可换页。
- `C-014`（**v3 新增**）: C: 是 **SATA SSD 而非 NVMe**，`fast_storage()` 的自动判定**预期为"不快"**
  （`E-EXT-026`）；`--fast-disk` 正是强制覆盖该判定的开关 → A/B 实测必须覆盖此情形。
- `C-015`（**v3 新增**）: 定义与仪器必须以 `E-REPO-013` 实测存在的计数器为准，不得假设其他工具可用。

## Implementation Items

- `I-001`（**v3 加强**）**预检门禁 + 空载基线**：断言 C: 可用 ≥ 35 GB、可用内存 ≥ 6 GB、
  读到 12288 MiB 设备与驱动、`tar` 可用、记录 `LongPathsEnabled`；
  **并实测并记录空载基线 `B0`**：启动 ComfyUI（零模型）后采样
  `\Process(...)\Private Bytes`、`\GPU Process Memory(...)\Shared Usage`、`\Memory\Available MBytes`、
  `\Memory\Pages Input/sec`。产出 `PREFLIGHT.md`（含 `B0`）。依赖：无。**不通过则停止。**
- `I-002` **安装 ComfyUI 便携版**：下载 `ComfyUI_windows_portable_nvidia.7z`（2,010,075,321 B），
  `tar -xf` 解压到 `C:\ComfyUI\`；随后断言解压树完整（`python_embeded\python.exe`、`ComfyUI\main.py`）
  并运行 `python_embeded\python.exe -s ComfyUI\main.py --quick-test-for-ci --cpu` 断言退出码 0。
  回退提取器：独立 7-Zip 或本机已有 `py7zr`。依赖：`I-001`。
- `I-003` **运行时校验**：断言版本 ≥ 0.37.0、`torch.cuda.is_available() = True`、设备为 3060，
  记录 `torch.version.cuda` 与 `torch.__version__`。cu130 要求为**单源未证实**；
  不匹配时回退为带回执实验（判据：记录 CUDA 版本 + int8 ConvRot 能加载 + 能出图）。依赖：`I-002`。
- `I-004` **第一批下载（Turbo 三件套）**：#2+#3+#4 = 17,283,095,877 B；
  逐文件校验**字节数 + 完整 SHA256**；支持断点续传。依赖：`I-002`。
- `I-005` **落位与完整性复核**。依赖：`I-004`。
- `I-006` **固化工作流**：取 `image_qwen_image_2_1_turbo_t2i.json`、`..._turbo_image_edit.json`
  存入 `ComfyUI/user/default/workflows/`。**默认保持官方原样、不裁剪**；
  断言 PE 开关（`ComfySwitchNode`）为 off、其输入为 `lazy`；**以实跑为准**，
  只有实跑证实缺文件才做最小手术，术后须保证顶层 promoted-widget 数组与 `definitions.subgraphs` 一致，
  并以"能被 ComfyUI 正常加载"的冒烟测试收尾。
  **重绘/扩图**：以 turbo 图像编辑为基底派生带 `SetLatentNoiseMask` 的工作流，
  **显式写明所选 cfg 值与理由**（官方 turbo 编辑模板 `CFGGuider` = 8，`E-EXT-019`）。
  依赖：`I-003`。
- `I-007`（**v3 修订**）**一键启停脚本**：参数集 = `--fast-disk --disable-pinned-memory`；
  禁列表见 `D-013`；启动前检测可用内存，**阈值 = `B0` + 4 GiB**，不足时打印原因并拒绝启动。
  落位：`C:\ComfyUI\`。依赖：`I-001`（需要 `B0`）、`I-003`。
- `I-012`（**v3 重写**）**阶段 0 实测门禁 + `--fast-disk` A/B**：在**只下载了 Turbo 三件套**、
  尚未下载基础 DiT 的状态下：
  1. 启动 ComfyUI，读取启动日志行 **`Model storage policy: fast_disk=... paths=...`**，记录其值；
  2. 在 `--fast-disk` **开**与**关**两种配置下各跑通一张 Turbo 1024×1024 文生图；
  3. 每次记录：`\GPU Process Memory(...)\Shared Usage` 峰值、`\Process(...)\Private Bytes` 峰值、
     `\Memory\Pages Input/sec`、`\Memory\Available MBytes`、`nvidia-smi` 峰值显存；
  4. **判定**：(a) 出图成功、无 OOM；(b) 权重加载后的 `Private Bytes` 与 `Shared GPU Usage`
     **增量均 < 1 GiB**；(c) 由 A/B 数据裁定 `--fast-disk` 是否真的改变了溢出通道去向，
     并据此**确定最终写入 `I-007` 脚本的参数**。
  **不通过时的终态（明确，`CQ5`）**：停止后续下载（**不执行 `I-013`**）、保留已得证据、
  如实报告「本轮目标在该硬件上未达成」；**不得**引入 `NG-008` 禁止的第三方组件，**不得**因难度标记 blocked。
  依赖：`I-005`、`I-006`、`I-007`。
- `I-013`（**条件项**）**第二批下载（基础 DiT）**：**仅在 `I-012` 通过后**下载 #1 并校验。
  依赖：`I-012`。
- `I-008`（**v3 修订**）**资源自检脚本**：以 API 提交一张 Turbo 1024×1024 图（**明确定位为"验证脚手架"，
  非交付物**），采集：`ram_mb`/`vram_mb` 明细日志、编码器与 DiT 的 offload device 行、
  `Private Bytes` 增量、`Shared GPU Usage` 峰值、`Pages Input/sec`、`nvidia-smi` 峰值显存 → 写 `SELFTEST.md`。
  依赖：`I-006`、`I-007`。
- `I-014`（**v3 新增，`CQ4`**）**UI 实跑验收**：在 ComfyUI 前端加载并**实际运行交付的三个 UI 工作流文件**
  （可用本机 UI 自动化驱动，或由用户手动执行一次），留存截图与 ComfyUI 日志。
  这是 `AC-001`/`AC-002`/`AC-003` 的**唯一权威证据来源**。依赖：`I-006`、`I-007`、`I-012`。
- `I-009`（**v3 加强**）**中文 README**：启停方法；参数集含义（含 `--fast-disk` 与
  `--disable-pinned-memory` 为何入选、以及 `--gpu-only`/`--highvram`/`--disable-smart-memory` 为何是陷阱）；
  操作规程；报错速查；**许可声明节**。落位：`C:\ComfyUI\README_zh.md`。依赖：`I-007`、`I-012`。
- `I-010` **P104 迁移方案文档（只写不执行）**。依赖：无（可并行）。
- `I-011` **实测取证与验收汇总**：汇总三类能力的 UI 实跑结果、峰值资源、速度数据。依赖：`I-008`、`I-014`。

## Acceptance Criteria

- `AC-001`: Turbo 文生图在 1024×1024 产出可辨认的图（**由 `I-014` 的 UI 实跑证明**）。
- `AC-002`: 图像编辑输入参考图并产出可辨认结果（同上）。
- `AC-003`: 重绘/扩图给出**明确二值判定**（成功出图，或如实登记不可行并给等价替代），不允许悬空。
- `AC-004`: 全程无 CUDA OOM，**且按 `R-010` 的定义，权重不驻留系统内存**。
- `AC-005`（**v3 修正，`CQ5`**）: **已下载文件**的字节数与完整 SHA256 100% 匹配 `E-EXT-003`
  —— 即 **3/3**（第一批）或 **4/4**（若 `I-013` 执行）。**不再要求固定的"最终 4/4"**，
  以消除"条件分支下永不满足"的自相矛盾。
- `AC-006`: 交付物齐全（启停脚本、三个工作流、README、自检脚本、P104 迁移文档）。

## Verification Plan

- `V-001`: 重跑 `I-001` 预检并比对报告与 `B0`。
- `V-002`: `python_embeded\python.exe -s ComfyUI\main.py --quick-test-for-ci --cpu`（退出码 0）。
- `V-003`: `python_embeded -c "import torch;print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"`。
- `V-004`: 对每个已下载文件重算 SHA256（`Get-FileHash -Algorithm SHA256`）与字节数。
- `V-005`: 扫描固化工作流 JSON 的可执行路径（`definitions.subgraphs[0].nodes` 的 widget 值与
  顶层 promoted-widget 数组），断言无未下载文件。
- `V-006`: 独立运行 `I-008` 自检脚本并比对峰值数据。
- `V-007`: **在 ComfyUI 前端实跑交付的 UI 工作流文件**（`I-014`），留存截图与日志。
- `V-008`: 审查 README 是否含参数陷阱说明与许可声明。
- `V-009`: 读取启动日志行 `Model storage policy: fast_disk=... paths=...` 并记录。

## Verifier Checklist

- [ ] `VC-001` covers `I-001`; pass: 预检报告存在、断言全过、且 `B0` 已实测记录；evidence: `PREFLIGHT.md` + 命令输出；metric: C: ≥ 35 GB 且可用内存 ≥ 6 GB 且读到 12288 MiB 设备且 `B0` 非空。
- [ ] `VC-014` covers `I-002`; pass: 解压树完整且 `--quick-test-for-ci --cpu` 退出码 0；evidence: `V-002` 输出 + 关键路径存在性；metric: 退出码 = 0 且 `python_embeded\python.exe` 与 `ComfyUI\main.py` 均存在。
- [ ] `VC-002` covers `I-003`; pass: 版本 ≥ 0.37.0、CUDA 可用、`torch.version.cuda` 已记录；evidence: `V-003`；metric: 版本 ≥ 0.37.0 且 is_available = True 且 CUDA 版本字符串非空。
- [ ] `VC-003` covers `I-004`,`I-005`,`I-013`,`AC-005`; pass: **每个已下载文件**字节数与完整 64 位 SHA256 匹配 `E-EXT-003`；evidence: `V-004`；metric: 已下载文件 100% 匹配（**3/3 或 4/4**）。
- [ ] `VC-005` covers `I-007`,`R-002`,`D-013`; pass: 脚本含 `--fast-disk` 与 `--disable-pinned-memory`，不含禁列表 5 项，且可用内存 < `B0`+4 GiB 时拒绝启动；evidence: 脚本内容 + 低内存模拟记录；metric: 2 项必备 + 5 项禁用 + 拒绝启动，全部满足。
- [ ] `VC-004` covers `I-006`,`C-010`; pass: 三个工作流在**实际执行路径**上不引用任何未下载文件；evidence: `V-005` 扫描输出 + 加载冒烟测试；metric: 可执行路径未下载文件引用数 = 0（散文不计入）。**注：加载成功为必要非充分条件**（`CQ4`）。
- [ ] `VC-016` covers `I-012`,`CQ1`,`CORR-009`; pass: `--fast-disk` 开/关 A/B 均执行、`Model storage policy` 日志行已记录、并**据此明确裁定** `--fast-disk` 是否改变溢出通道去向；evidence: `SELFTEST.md` 阶段 0 A/B 段 + `V-009`；metric: 二值裁定成立（采用/弃用），**不允许以"未证实"结案**。
- [ ] `VC-017` covers `I-001`,`I-012`,`R-011`,`CQ3`; pass: 所有资源判据均以 `B0` 为基准表述，且实测增量已记录；evidence: `PREFLIGHT.md` 的 `B0` + `SELFTEST.md` 增量；metric: 加载大权重后 `Private Bytes` 增量与 `Shared GPU Usage` 峰值**均 < 1 GiB**。
- [ ] `VC-009` covers `AC-004`,`G-002`,`R-010`,`CQ2`; pass: 按 `R-010` 的定义证明权重不驻留内存；evidence: `SELFTEST.md`（`Private Bytes`、`Shared GPU Usage`、`Pages Input/sec`、`ram_mb`）+ ComfyUI 日志无 OOM；metric: 见 `VC-017` 的 1 GiB 增量判据，且**不得**再用"峰值显存 < 12288 MiB"这类方向相反的指标。
- [ ] `VC-018` covers `I-014`,`R-012`,`CQ4`; pass: `AC-001`/`AC-002`/`AC-003` 的证据来自**在 ComfyUI 前端实跑交付的 UI 文件**；evidence: `I-014` 截图 + ComfyUI 日志 + 一致性声明；metric: 被验证的文件 = 交付的文件（同一路径同一哈希），二值成立。
- [ ] `VC-006` covers `I-012`,`AC-001`; pass: 阶段 0 在只下 Turbo 三件套时出图成功、无 OOM；evidence: `SELFTEST.md` 阶段 0 段 + 输出 PNG；metric: 出图成功且满足 `VC-017` 的增量判据。
- [ ] `VC-007` covers `I-014`,`AC-002`; pass: 图像编辑经 UI 实跑输入参考图并产出可辨认结果；evidence: 输入/输出 PNG + 日志；metric: 可辨认性为人工判定，非量化。
- [ ] `VC-008` covers `I-014`,`AC-003`,`C-009`; pass: 重绘/扩图给出明确二值判定；evidence: 判定记录 + 图或缺口说明；metric: 二值判定成立，不允许悬空。
- [ ] `VC-010` covers `I-009`,`R-006`; pass: README 含 启停方法 / 参数集含义（含陷阱参数）/ 操作规程 / 报错速查 / 许可声明 五节；evidence: `README_zh.md`；metric: 5 节齐全。
- [ ] `VC-011` covers `I-010`,`NG-001`; pass: P104 迁移文档存在且显式声明「只写不执行」；evidence: `P104_MIGRATION.md`；metric: 存在且含不执行声明。
- [ ] `VC-012` covers `R-008`; pass: 速度以数据形式报告且未被用作通过门槛；metric: 非量化——本项要求**显式排除**速度阈值。
- [ ] `VC-015` covers `I-009`,`C-011`; pass: 交付物与 README 声明 Qwen Research License 非商用限制；evidence: `README_zh.md` 许可节；metric: 声明存在且提及 research/non-commercial。

## Risks And Mitigations

- `Risk-001`（**v3 重写**）: 16 GB 内存不足以支撑 int8 编码器驻留 → 换页或失败。
  Mitigation: `R-002` 参数集 + `R-005` + `I-001` 门禁 + **`I-012` 阶段 0 A/B 门禁先于第二批下载**。
  **`ALT-001` 不在本 goal 内**（`NG-008`）；门禁失败按 `I-012` 的明确终态收尾。
- `Risk-002`: 误裁剪模板会破坏子图 widget 绑定。Mitigation: `I-006` 默认不裁剪 + 实跑为准（`RV1-4`）。
- `Risk-003`: 无 12 GB / Ampere 成功先例。Mitigation: 两级门禁 + 分阶段验证 + 如实报告失败。
- `Risk-004`: 重绘/扩图无官方 2.1 模板。Mitigation: `AC-003` 允许二值判定并登记缺口。
- `Risk-005`: 每张图可能需重读约 15.5 GiB 权重 → 体验差。Mitigation: C: SSD；`ALT-001` 为范围外选项。
- `Risk-006`: 便携版自带 CUDA 版本未证实。Mitigation: `I-003` 记录并以"能加载 int8 + 能出图"为判据。
- `Risk-007`: GitHub 下载过慢。Mitigation: 允许国内加速镜像，**须先实测**。
- `Risk-008`: 单位制混淆。Mitigation: 文首声明 + `R-007` + `CORR-002`。
- `Risk-009`: 不关 pinned memory 时最多约 6.4 GB 不可换页。Mitigation: `R-002` 强制 `--disable-pinned-memory`。
- `Risk-010`: `--fast-disk` 溢出去向若为磁盘，而 C: 是 SATA SSD 非 NVMe，可能比 RAM 溢出慢。
  Mitigation: `I-012` 的 A/B 覆盖此情形；若过慢作为数据报告而非失败（`C-014`）。
- `Risk-011`: 解压单点故障。Mitigation: `VC-014` + 回退提取器。
- `Risk-012`（**v3 新增，`CQ1`**）: `--fast-disk` 的真实语义未证实，若误用可能不改变内存去向。
  Mitigation: `D-022` —— 语义不由文本裁定，由 `I-012` 的 A/B 实测裁决（`VC-016`），
  并以实测结果**决定最终写入 `I-007` 的参数**。

## Alternatives Considered

- `ALT-001`（**v3：明确移出本 goal，`NG-008`**）: 全 GGUF 最小集（DiT Q4_K_M 3.91 GiB +
  编码器 `qwen3vl-8b-it-q4_k_m` 4.68 GB(dec) + VAE ≈ 9.22 GiB）——唯一能让三者同时常驻 12 GB 的组合。
  移出原因：需第三方节点包与**加载可行性未证实**的第三方编码器，且无 SHA256 基线、无 Verifier 行。
  **若要采纳，须另起一次规划。**
- `ALT-002`: 「GGUF DiT + 原生 int8 编码器」= 12.62 GiB，无收益，已否决。
- `ALT-003`: 加内存到 32 GB。范围外（`NG-002`），仅登记。
- `ALT-004`: v1 的 `--gpu-only`/`--highvram` 参数集。不可行（`RV1-1`）。

## Open Questions

- `OPEN-001`: 便携版自带 torch/CUDA 版本（`I-003`）。
- `OPEN-002`: 官方模板在缺 PE 文件时实跑是否报错（`I-006`/`I-012`）。
- `OPEN-003`: 重绘/扩图派生工作流是否可用（`AC-003`）。
- `OPEN-004`: 本机实测速度、峰值显存/内存（`I-008`）。
- `OPEN-005`: 交付的 UI 工作流能否被自动化驱动完成验收（`I-014`）；不能则需用户手动点一次。
- `OPEN-006`（**v3 新增**）: `--fast-disk` 开启后被驱逐权重的**物理去向**（`E-EXT-026` 第 5 点）。
  由 `I-012` 的 A/B 实测裁决，不得以"未证实"结案（`VC-016`）。

## Refinement Settings

- Reviewer mode: `delegated-subagent`; model selector: `inherit`（第 1 轮完成，11 条全部采纳）。
- Criticizer mode: `delegated-subagent`; model selector: `inherit`（第 2 轮完成，5 问全部作答）。

## DSH Goal Execution Handoff Notes

执行顺序：`I-001` →（门禁）→ `I-002` → `I-003` → `I-004` → `I-005` → `I-006` → `I-007`
→ **`I-012`（阶段 0 门禁 + `--fast-disk` A/B）** →（通过）→ `I-013` → `I-008` → `I-014` → `I-011`；
`I-009`、`I-010` 可并行（`I-009` 需 `I-012` 的结论）。
**硬性禁止**：触碰 `D:\llm`；改动 `D:\miniconda3`；给启动脚本加禁列表中的参数；
下载 bf16 / PE 大文件；在 `I-012` 未通过时执行 `I-013`；引入第三方 GGUF 节点包或第三方编码器（`NG-008`）；
用 API 结果替代 UI 实跑作为 `AC-001`/`AC-002`/`AC-003` 的证据。
验证命令：`V-002`、`V-003`、`V-004`、`V-005`、`V-006`、`V-007`（UI 实跑）、`V-009`（storage policy 日志）。
**只有 `VC-001` … `VC-018` 全部勾选后，才可 `update_goal` complete。**

## Revision Ledger

- `PLAN_v1`: 首版（本机实测 + ModelScope 精确字节与 SHA256 + 官方模板逐节点解析 + `cli_args.py` 逐条读取）。
- `PLAN_v2`: Reviewer 第 1 轮 11 条发现全部采纳。核心：`--gpu-only`/`--highvram` 被 `RV1-1` 判定为使首要目标
  不可达（改用 `--fast-disk --disable-pinned-memory`）；`VC-009` 度量重做；模板裁剪指令撤回；
  补全 SHA256；`E-EXT-018` 重写为三阶段表；新增 `I-012`/`I-013` 与 `VC-013`…`VC-015`。
- `PLAN_v3`: Criticizer 第 2 轮 5 问全部作答（无 `Auto-complete`）：
  - `CQ1` → `E-EXT-026`（`--fast-disk` 追踪：部分证实）、`D-022`、`Risk-012`、`VC-016`、`CORR-009`（推翻 v2 自己）；
  - `CQ2` → `R-010` 写死定义、`E-REPO-013`（计数器实测存在）、`C-015`、`VC-009` 重写；
  - `CQ3` → `R-011` 相对增量、`I-001` 加 `B0`、`R-005` 阈值 = `B0`+4 GiB、`VC-017`；
  - `CQ4` → `R-012`、`I-014`（UI 实跑验收）、`VC-018`、`I-008` 标注为脚手架；
  - `CQ5` → `NG-008`、`ALT-001` 移出、`I-012` 失败终态明确化、`AC-005` 修正为「已下载文件 100% 匹配」。
