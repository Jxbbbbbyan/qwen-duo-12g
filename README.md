# Qwen Duo 12G

**在 12 GB 显存 + 16 GB 内存的普通 PC 上，串行运行两个大模型：Qwen3.8-27B（4-bit 大语言模型）与 Qwen-Image 2.1（图像生成）。**

**Run two large models — Qwen3.8-27B (a 4-bit LLM) and Qwen-Image 2.1 (image generation) — serially on one ordinary PC with a 12 GB GPU and only 16 GB of system RAM.**

**机制：一个模型驻留显存，另一个以"磁盘后备的可回收内存映射页"待机；由总控台按任务阶段自动装载、腾退、回装——这才是"12 GB 装下两个模型"的关键。**

**Mechanism: one model resides in VRAM while the other stands by as reclaimable, disk-backed memory-mapped pages; the console loads, evicts and reloads automatically per stage — this is what makes "two models in 12 GB" work.**

![鳄鱼骑自行车的卡通图 / a cartoon crocodile riding a bicycle](screenshots/01-crocodile-cartoon.png)

*上图是本仓库流程的产出：Qwen3.8 写提示词 → Qwen-Image 2.1 出图。*
*The image above was produced by this pipeline — Qwen3.8 authors the prompt, Qwen-Image 2.1 renders it.*

---

## 30 秒速览 / Thirty-second summary

| 项目 / Item | 内容 / Detail |
|---|---|
| 这是什么 / What | 双模型本地推理系统：单入口、全自动串行调度、零人工切换 / A dual-model local inference system: single entry point, fully automatic serial scheduling, zero manual switching |
| 硬件边界 / Envelope | RTX 3060 Laptop **12 GiB** VRAM + **15.94 GiB** RAM（2/2 插槽已满，内存只能整组替换、无法加装 / both RAM slots occupied, so RAM can only be replaced, not added) |
| 上下文 / Context | **64K**（`-ngl 44`，实测工作点 / measured working point） |
| 生成速度 / Throughput | **约 4.0 tok/s**（模型在 SSD、热缓存 / model warm on SSD） |
| 出图速度 / Render | 1080p **约 88 秒**；2K **约 4.5 分钟**（均不含模型切换与加载 / excluding model swap and load） |
| 内存占用 / RAM | **96%**（大部分是可被系统回收的 mmap 页，不是锁死的私有内存 / mostly reclaimable mmap pages, not pinned private memory） |
| 切换代价 / Swap cost | 每次切换都要重新加载，SSD 热态下**数十秒**，无法消除 / every switch reloads a model: tens of seconds even when warm, not removable |
| 联网情况 / Network | 部署完成后**完全本地推理**；首次获取权重与运行时需联网 / fully local after setup; the first fetch of weights and runtime needs network |

> **诚实前置说明 / Up-front honesty.** 本仓库中的数字分为三类，请注意区分：
> ① **实测值**（来自本机测量，出处见 [`docs/EVIDENCE.md`](docs/EVIDENCE.md)）；
> ② **文件体积**（由字节数换算，**不等于**运行时占用）；
> ③ **估算 / 推导值**（文中会明确标注"估算""推导""示意"）。
> 我们不把 ① 之外的数字包装成实测。
>
> Numbers in this repo come in three kinds and are labelled as such: **measured** (from this machine,
> traceable to [`docs/EVIDENCE.md`](docs/EVIDENCE.md)), **file footprint** (converted from byte counts,
> *not* run-time allocation), and **estimate/derived** (explicitly marked). Anything that is not a
> measurement is not presented as one.

---

## 目录 / Table of contents

- [总述 / Overview](#总述--overview)
- [分述 / Feature breakdown](#分述--feature-breakdown)
  - [一 · 一体化串行流水线 / Unified serial pipeline](#分述一--一体化串行流水线全自动--unified-serial-pipeline-fully-automated)
  - [二 · 可调思考等级 / Adjustable thinking level](#分述二--可调思考等级--adjustable-thinking-level)
  - [三 · 上传图片并据此改图 / Upload an image and edit it](#分述三--上传图片并据此改图--upload-an-image-and-edit-it)
  - [四 · 两个入口 / Two consoles](#分述四--两个入口两种使用姿态--two-consoles-two-modes-of-use)
  - [五 · 可复现的构建与验收 / Reproducible build](#分述五--可复现的构建与验收--reproducible-build-and-acceptance)
- [为什么这件事不平凡 / Why this is hard](#为什么这件事不平凡--why-this-is-hard)
- [核心思路 / The approach](#核心思路--the-approach)
- [实测数据 / Measured results](#实测数据--measured-results)
- [更多样图 / More samples](#更多样图--more-samples)
- [仓库结构 / Repository layout](#仓库结构--repository-layout)
- [快速开始 / Quick start](#快速开始--quick-start)
- [边界与诚实声明 / Honest limitations](#边界与诚实声明--honest-limitations)
- [工程记录 / Engineering notes](#工程记录--engineering-notes)
- [License](#license)

---

## 总述 / Overview

**中文。** Qwen Duo 12G 是一套面向消费级小显存整机的**双模型本地推理系统**。它把两件通常被认为需要更大显存才能并存的工作——一个 27B 级 4-bit 大语言模型，与一个图像扩散模型——收敛到单张 12 GB 显卡与 16 GB 内存的范围内，并以**单一入口、全自动、无人工切换**的方式交付给使用者。

系统的设计出发点不是"把两个模型塞进显存"。恰恰相反，它**承认显存的硬边界**，并在此基础上重构两件事：**模型如何驻留**，以及**任务如何调度**。任务进行时任一个模型驻留显存，另一个处于已停止或待机状态；由总控台按任务阶段自动完成装载、腾退与回装。这一取舍使"两个模型"在物理上成为一件可交付的能力，而不是两份互相排斥的资源占用。

在此之上，系统提供三项面向实际创作的能力：**可直接调节的思考等级**、**上传参考图并据此改图**，以及一个**只做纯对话、长期驻留**的第二入口。

**English.** Qwen Duo 12G is a **dual-model local inference system** built for commodity machines with small VRAM. It collapses two workloads that are normally assumed to need more VRAM to coexist — a 27B-class 4-bit large language model and an image diffusion model — into the envelope of a single 12 GB GPU and 16 GB of system RAM, and delivers them through a **single entry point, fully automated, with no manual switching**.

The design does not set out to squeeze both models into VRAM. On the contrary, it **accepts the hard ceiling of VRAM** and rebuilds two things around it: **how a model resides**, and **how work is scheduled**. While a task runs, exactly one model occupies VRAM and the other is stopped or standing by; the console performs loading, eviction and reloading automatically, driven by task stage. This trade-off is what turns "two models" into one deliverable capability rather than two mutually exclusive resource claims.

On top of that foundation the system exposes three capabilities aimed at real creative work: an **adjustable thinking level**, **reference-image upload with image-guided editing**, and a **second, chat-only console** that stays resident for long sessions.

---

## 分述 / Feature breakdown

### 分述一 · 一体化串行流水线（全自动） / Unified serial pipeline, fully automated

**中文。** 本系统最核心的特色是**一体化**：使用者只面对一个入口、只提交一次任务，其后所有的模型装载、阶段交接、显存腾退、结果落盘与回装待命，全部由总控台自动完成，**不需要任何人工切换**。

流程被建模为四个阶段的状态机，每一阶段都有明确的资源账目：

| 阶段 / Stage | 驻留模型 / Resident | 显存占用 / VRAM | 自动动作 / Automatic action |
|---|---|---:|---|
| **A** 需求解析与提示词生成 / parse & author prompt | Qwen3.8-27B | **11,552 MiB**（实测 / measured） | 读任务、读参考图，写出可直接出图的详细英文提示词 / reads the task and reference image, authors a renderable prompt |
| **B** 交接 / hand-off | 无 / none | 模型已停止 / stopped | 总控台**终止** Qwen3.8 进程，释放约 11.28 GiB；提示词落盘 / console **terminates** the LLM process, frees ~11.28 GiB; prompt persisted |
| **C** 图像生成 / render | Qwen-Image 2.1 | 峰值未单独记录，权重合计 16.10 GiB / peak not recorded separately; weights total 16.10 GiB | 文本编码 → 卸载编码器 → DiT 采样 → VAE 解码 → 出图写入桌面 / encode → unload encoder → DiT → VAE → image to desktop |
| **D** 回归待命 / return to standby | Qwen3.8-27B | 11,552 MiB | 总控台**终止** ComfyUI；重新装载 Qwen3.8 待命 / console **terminates** ComfyUI; reloads the LLM and stands by |

三点值得强调。第一，**交接是通过"终止进程"完成的，而不是通过内存回收**——这是本项目在 12 GB 显存上采用的可靠释放手段（实现上调用 `taskkill /T /F`，由总控台驱动，不是模型自己"主动退出"）。第二，**提示词会持久化到文件**，便于回溯与人工复用；需要说明的是，出图阶段实际使用的是同一进程内存中的提示词变量，因此这里是"可追溯"，而不是严格意义上的进程隔离与断点恢复。第三，**总控台始终是调度者**：它先起停 Qwen3.8，再起停 ComfyUI，最后把 Qwen3.8 装回来，使用者感知到的只是"提交任务 → 等待 → 拿到图"。

**English.** The defining property of this system is **unification**: the user faces one entry point and submits one task. Everything that follows — model loading, stage hand-off, VRAM eviction, result persistence and reload-back — is performed automatically by the console, with **no manual switching at any point**.

The flow is modelled as a four-stage state machine, each stage carrying an explicit resource ledger (table above).

Three properties deserve emphasis. First, **the hand-off is achieved by terminating a process, not by memory reclamation** — the reliable release mechanism this project uses on a 12 GB card (implemented as `taskkill /T /F`, driven by the console; the model does not "exit by itself"). Second, **the prompt is persisted to a file** for traceability and manual reuse; note that the render stage consumes the in-memory prompt variable within the same Node process, so this gives traceability rather than strict process isolation or resumable recovery. Third, **the console is always the scheduler**: it starts and stops Qwen3.8, then ComfyUI, then brings Qwen3.8 back — all the user perceives is "submit a task, wait, receive an image."

### 分述二 · 可调思考等级 / Adjustable thinking level

**中文。** 总控台允许在提交任务前**直接选择思考等级**，共五档。档位在实现上映射到 llama.cpp 的 `--reasoning` / `--reasoning-effort`：`off` 对应 `--reasoning off`，其余档位对应 `--reasoning on --reasoning-effort <level>`。切换档位会重启 LLM 进程使其生效。

| 档位 / Level | 行为 / Behaviour | 适用 / Use when |
|---|---|---|
| `off`（默认 / default） | 不经思考链，直接输出 / no reasoning chain | 绝大多数出图提示词、短问答 / most prompt authoring, short Q&A |
| `low` | 轻量推理 / light reasoning | 需要稍微推敲措辞 / wording needs deliberation |
| `medium` | 中等推理 / moderate | 复杂构图、多约束指令 / complex composition, multi-constraint briefs |
| `high` | 深度推理 / deep | 需要拆解的多步骤任务 / multi-step tasks |
| `xhigh` | 最深推理 / deepest | 疑难任务，耗时最长 / hard cases, slowest |

需要说清楚的是：这五个档位是**传给推理引擎的"推理强度请求"**，而不是保证质量递增的质量等级；本仓库没有针对档位的质量基准测试。它们的实际价值在于**控制思考链占用的 token 预算**。

这一点在本机不是锦上添花，而是**必需**：27B 模型在此硬件上算力非常紧张，而思考链会与正式输出**共享同一个 token 预算**。工程过程中曾出现"返回空内容"的故障，根因就是思考链把预算吃光。其中一次调用观测到两者合计用掉 **415/420** 个 token（推理 704 字符 + 回答 1302 字符），回答被压缩到接近最小；另一些调用则被截断到完全为空。最终修复是把 `max_tokens` 从 420 提高到 **2000**，并把默认档位设为 `off`。记录见 [`docs/EVIDENCE.md` §9.1](docs/EVIDENCE.md)。

**English.** Before submitting a task, the console lets you **select the thinking level directly**, from five presets. Each level maps onto llama.cpp's `--reasoning` / `--reasoning-effort`: `off` becomes `--reasoning off`, and every other level becomes `--reasoning on --reasoning-effort <level>`. Changing the level restarts the LLM process so that it takes effect.

To be precise: these five presets are **requests for reasoning effort passed to the engine**, not quality tiers with guaranteed monotonic improvement — this repository ships no quality benchmark per level. Their practical value is **controlling how much of the token budget the reasoning chain consumes.**

On this hardware that is not a nicety but a **necessity**. A 27B model is severely compute-constrained here, and the reasoning chain **shares the same token budget as the answer**. During development the system produced empty responses, and the root cause was exactly this: the reasoning chain exhausted the budget. In one observed call the two together used **415 of 420** tokens (704 characters of reasoning plus 1302 characters of answer), compressing the answer to near-minimum; in other calls it was truncated to nothing at all. The fix was to raise `max_tokens` from 420 to **2000** and default the level to `off`. Recorded in [`docs/EVIDENCE.md` §9.1](docs/EVIDENCE.md).

### 分述三 · 上传图片并据此改图 / Upload an image and edit it

**中文。** 总控台支持**上传参考图**，并把"看图"与"改图"接成一条完整链路，而不是让使用者自己描述图里有什么：

1. **上传与预览** — 选择本地图片，界面即时预览。
2. **看图** — 图片编码后送入 Qwen3.8 的多模态投影器，由模型基于画面内容生成提示词。
3. **重写提示词** — 结合你的自然语言指令（例如"把这张图改成水彩画风格"），模型输出一段完整的、可直接出图的新提示词，而不是复述你的原话。
4. **以原图为参考重绘** — 提示词与参考图一同送入 Qwen-Image 2.1 的条件编码器，参考图作为图像条件参与采样。
5. **落盘** — 结果写入桌面并回显在界面。

需要说明的两点。第一，**输出画幅会跟随参考图的长宽比**：喂方形参考图会得到 1920×1920 的方形输出，不会自动裁成 16:9（本仓库样图 `02-crocodile-watercolor.png` 就是这种情况）。第二，"看图"这一步给出的是**基于视觉输入生成的提示词**，它不保证精确保持原图的主体身份、姿态或细节——请把它理解为强得多的"参考驱动"，而不是像素级保真。

视觉塔被强制放在 CPU（不做视觉塔的 GPU 卸载）。"看图"这一步因此**不占用视觉塔的显存**，代价是多花几秒——这几秒是**估计值**，本仓库没有做计时对比。

**English.** The console accepts an **uploaded reference image** and wires "look at the image" and "edit the image" into one continuous path, instead of making you describe what is in the picture:

1. **Upload and preview** — pick a local image; the UI previews it immediately.
2. **Look** — the encoded image is fed to Qwen3.8's multimodal projector, and the model generates a prompt grounded in the image content.
3. **Rewrite the prompt** — combined with your natural-language instruction (e.g. "turn this into a watercolour"), the model emits a complete, directly-renderable new prompt rather than parroting your words.
4. **Re-render against the reference** — prompt and reference image go into Qwen-Image 2.1's conditioning encoder together, with the reference participating as an image condition during sampling.
5. **Persist** — the result is written to the desktop and shown in the UI.

Two caveats. First, **the output aspect ratio follows the reference image**: feed a square reference and you get a 1920×1920 square render; it is not auto-cropped to 16:9 (sample `02-crocodile-watercolor.png` in this repo is exactly that case). Second, the "look" step yields **a prompt generated from visual input**; it does not guarantee exact preservation of the subject's identity, pose or fine detail. Read it as reference-driven generation — much stronger than textual description, but not pixel-level fidelity.

The vision tower is forced onto the CPU rather than GPU-offloaded, so the "look" step **costs no vision-tower VRAM** and adds a few seconds — that figure is an **estimate**; no timing comparison was recorded.

### 分述四 · 两个入口，两种使用姿态 / Two consoles, two modes of use

**中文。** 系统提供两个总控台，覆盖"要出图"和"只要对话"两类互不相同的使用姿态：

- **出图总控台（端口 8090）** — 完整串行流水线。上传参考图 + 写任务 → Qwen3.8 写提示词 → 自动切换到 ComfyUI 出图 → 自动切回。浏览器心跳停止约 60 秒后自动退出并释放显存。
- **纯对话总控台（端口 8091）** — 64K 上下文的纯文本对话，**不出图、不参与图像流程**，且**不会自动退出**：只有你点「退出」才停止，适合长时间挂着使用。

两者共享 8080 上的 llama-server，但**进程所有权是分开的**：纯对话入口只会复用已存在的健康后端，并且只清理**自己启动**的实例，不会杀掉别人的进程。由此产生一个需要知道的边界情况：如果纯对话入口先启动并占用了后端，那么出图总控台在切换阶段停掉该后端时，对话会中断；反之，若对话入口借用的是出图总控台启动的后端，它也无法通过切换档位去重启一个不属于自己的进程。目前**没有跨总控台的后端仲裁机制**，请按需二选一使用，或接受这种中断。

**English.** Two consoles cover two genuinely different modes of use:

- **Image console (port 8090)** — the full serial pipeline. Upload a reference image and write a task → Qwen3.8 authors the prompt → the system switches to ComfyUI to render → and switches back. It exits and releases VRAM roughly 60 seconds after the browser heartbeat stops.
- **Chat-only console (port 8091)** — pure text chat at 64K context. It **does not render images and does not take part in the image pipeline**, and it **never exits on its own**: only your explicit "exit" stops it, so it can stay up for long sessions.

Both share the llama-server on 8080, but **process ownership is kept separate**: the chat console only reuses an existing healthy backend, and it only cleans up instances **it started** — it never kills someone else's process. One boundary case follows, and you should know it: if the chat console started the backend first, the image console will stop it during its hand-off stage and the chat will be interrupted; conversely, if the chat console borrowed a backend started by the image console, it cannot restart a process it does not own when you change the thinking level. There is **no cross-console backend arbitration** today — use one at a time, or accept the interruption.

### 分述五 · 可复现的构建与验收 / Reproducible build and acceptance

**中文。** 仓库不包含模型权重（体积过大，且受各自上游许可约束），但**包含把机器从裸机推到可运行的自动化脚本**：模型与 ComfyUI 的获取、解压、校验、放置、工作流安装、资源测量、阶段门禁，以及一条无人值守的推进流水线。这些脚本位于 [`comfyui/scripts/`](comfyui/scripts/)，共 16 个 PowerShell 脚本 + 2 个工作流 JSON。

校验环节独立于下载环节——`place_models.ps1` 只比对字节数，因此本次部署另做了一次独立的 SHA-256 校验，3 个模型文件全部一致（记录见 [`docs/EVIDENCE.md` §9.2](docs/EVIDENCE.md)；期望哈希写在 [`comfyui/scripts/fetch_models.ps1`](comfyui/scripts/fetch_models.ps1) 的清单里）。

此外仓库还包含**离线验证方法**与全部实测数字的出处：

- [`docs/EVIDENCE.md`](docs/EVIDENCE.md) — 全部实测数字、边界条件与已知限制
- [`tools/fw-on.ps1`](tools/fw-on.ps1) / [`tools/fw-off.ps1`](tools/fw-off.ps1) — 出站阻断的添加与清理（**仅针对两个推理程序**，不是整机断网）

> **安全提示 / Security note.** `fetch_*.ps1` 与 `post_download.ps1` 会下载并**执行**第三方内容（ComfyUI、嵌入式 Python、模型包）。项目内的校验（字节数/CRC/结构）只能证明"文件完整"，**不能证明发布者身份**。请在运行前自行确认来源，并在有条件时用**独立已知**的哈希或签名核对。详见 [`docs/EVIDENCE.md` §10](docs/EVIDENCE.md)。

**English.** The repository does not ship model weights — far too large, and governed by their own upstream licences — but it **does ship the automation that takes a bare machine to a working system**: fetching and extracting models and ComfyUI, verifying, placing, installing workflows, measuring resources, stage gating, and an unattended end-to-end pipeline. Those live in [`comfyui/scripts/`](comfyui/scripts/) — 16 PowerShell scripts plus 2 workflow JSON files.

Verification is deliberately independent of download: `place_models.ps1` only compares byte counts, so this deployment additionally performed an independent SHA-256 check, and all 3 model files matched (recorded in [`docs/EVIDENCE.md` §9.2](docs/EVIDENCE.md); the expected hashes live in the manifest inside [`comfyui/scripts/fetch_models.ps1`](comfyui/scripts/fetch_models.ps1)).

The repo also ships the **offline-verification method** and the provenance of every measured number:

- [`docs/EVIDENCE.md`](docs/EVIDENCE.md) — every measurement, its boundary conditions and known limits
- [`tools/fw-on.ps1`](tools/fw-on.ps1) / [`tools/fw-off.ps1`](tools/fw-off.ps1) — add and remove outbound blocks (**scoped to the two inference programs**, not a machine-wide disconnect)

> **Security note.** `fetch_*.ps1` and `post_download.ps1` download and **execute** third-party content (ComfyUI, embedded Python, model packages). The checks in this project (byte counts / CRC / structure) prove only that *files are intact*; they **do not establish publisher identity**. Verify sources yourself before running, and cross-check against independently known hashes or signatures where you can. See [`docs/EVIDENCE.md` §10](docs/EVIDENCE.md).

---

## 为什么这件事不平凡 / Why this is hard

**中文。** 单看体积就知道这是个**资源超售**问题：

**English.** The footprint alone shows this is a **resource oversubscription** problem:

| 组件 / Component | 体积 / Footprint |
|---|---:|
| Qwen3.8-27B UD-Q4_K_S（LLM） | **14.30 GiB** |
| Qwen-Image 2.1 Turbo DiT | **6.76 GiB** |
| Qwen-Image 2.1 文本编码器 / text encoder | **8.71 GiB** |
| Qwen-Image 2.1 VAE | **0.63 GiB** |
| 多模态投影器 / multimodal projector（`mmproj`） | **0.86 GiB** |
| **四个主要权重合计 / Four main assets** | **≈ 30.40 GiB** |
| 含投影器合计 / Including projector | **≈ 31.26 GiB** |

而硬件只有 **12 GiB 显存 + 15.94 GiB 内存**。
The hardware has **12 GiB of VRAM and 15.94 GiB of RAM**.

**关键问题是：两个阶段若同时驻留，占用就会超过显存。**
**The key problem: if the two stages were resident at the same time, the total would exceed VRAM.**

```text
文本编码器权重 / text-encoder weights     8.71 GiB
+ LLM 驻留     / LLM residency           11.28 GiB   （实测 / measured 11,552 MiB）
= 19.99 GiB   >   12 GiB  显卡 / VRAM
```

> 上式为**示意推导**：它混合了"权重体积"与"运行时驻留"两种口径，仅用于说明"两个阶段不能同时驻留"这一结论。文本编码器阶段**单独**的实际总显存占用高于 8.71 GiB（估算区间约 9.4–10.3 GiB，见 [`docs/OOM_MITIGATION.md`](docs/OOM_MITIGATION.md)），但低于 12 GiB——所以问题不是"单个阶段装不下"，而是"两个阶段不能并存"。
> The arithmetic above is **illustrative**: it mixes a weight footprint with a run-time residency figure, purely to show that the two stages cannot coexist. The encoder stage **alone** uses more than 8.71 GiB (estimated ~9.4–10.3 GiB, see [`docs/OOM_MITIGATION.md`](docs/OOM_MITIGATION.md)) but stays under 12 GiB — so the problem is not that one stage does not fit, but that two cannot coexist.

**这不是调参能解决的，是算术。** 所以我们没有试图"塞进去"，而是**重构了加载与调度方式**。
**This is not solvable by tuning — it is arithmetic.** So instead of trying to squeeze things in, we **rebuilt how models are loaded and scheduled**.

---

## 核心思路 / The approach

### 1. 串行驻留：同一时刻只有一个模型占用显存 / Serial residency

```text
        ┌──────────────────────────────────────────────┐
        │  用户输入 + 参考图 / user input + reference    │
        └───────────────────┬──────────────────────────┘
                            ▼
        ┌──────────────────────────────────────────────┐
        │  阶段 A / Stage A：Qwen3.8-27B               │
        │  · 读图、理解需求 / read image, parse the ask │
        │  · 写出可直接出图的详细英文提示词              │
        │    author a detailed renderable prompt        │
        └───────────────────┬──────────────────────────┘
                            ▼  提示词落盘 / prompt persisted
                    ╔═══════════════════╗
                    ║  总控台终止进程     ║  ← 释放 ~11.28 GiB
                    ║  console terminates║    frees ~11.28 GiB
                    ╚═══════════════════╝
                            ▼
        ┌──────────────────────────────────────────────┐
        │  阶段 B / Stage B：Qwen-Image 2.1            │
        │  · 文本编码 → 卸载编码器 → DiT 采样 → VAE     │
        │    encode → unload encoder → DiT → VAE        │
        └───────────────────┬──────────────────────────┘
                            ▼  出图写入桌面 / image to desktop
                    ╔═══════════════════╗
                    ║  总控台终止 ComfyUI ║  ← 释放其占用
                    ║  console stops it  ║
                    ╚═══════════════════╝
                            ▼
        ┌──────────────────────────────────────────────┐
        │  Qwen3.8 重新装载，进入下一轮待命               │
        │  Qwen3.8 reloaded, standing by for next round  │
        └──────────────────────────────────────────────┘
```

全程自动，无需人工切换。总控台（Node.js 进程）是调度者，Qwen3.8 是被调度的"大脑"。
Fully automatic, no manual switching. The console (a Node.js process) is the scheduler; Qwen3.8 is the scheduled "brain".

### 2. 磁盘后备的可回收页，而不是把权重复制进内存 / Disk-backed reclaimable pages, not copies in RAM

**中文。** 多数"小显存跑大模型"的教程会教你**把权重卸载到系统内存**。在 16 GB 内存的机器上这条路会直接把机器拖死。我们的做法是反过来的：

- **`-ngl` 部分卸载**：GPU 装得下的层上显存，其余层**保持内存映射（mmap）的文件页**——这些页**可被操作系统回收**，不会像"复制进内存"那样锁死物理内存。也就是说：**CPU 侧权重仍然存在，但以"磁盘后备、可驱逐"的形式存在，而不是被钉死在物理内存里。**
- **显式避免 `-ncffn`**：`--n-cpu-ffn` 走 tensor override，会把 CPU 侧张量**复制成匿名私有内存**。实测对比：`-ncffn` 时进程私有内存 **13.4 GB**、物理内存占用 **99.3%**；改用纯 `-ngl 44` 后降到 **96.1%**。**这是本项工作最重要的一个发现。**
- **`-lm mmap` 而非 `mmap+mlock`**：`mlock` 会把页锁在物理内存里，实测内存直接冲到 **94.2%（可用仅 0.93 GiB）**；改成纯 `mmap` 后回落到 **29.7%**（该读数取自加载/待机阶段的采样，与运行期 96.1% 不是同一时点，两者口径不同）。
- **ComfyUI `--fast-disk`**：强制磁盘后备的动态加载/卸载，避免权重被提升进内存。
- **32 GB 页面文件**：兜底，把"提交不足导致崩溃"变成"可恢复的换页"。本机页面文件由 **8,107 MB** 提升到 **32,768 MB**，提交上限达到 **47.94 GiB**，剩余提交余量 **39.39 GiB**（快照值，非恒定保证）。

**English.** Most "run a big model on a small GPU" guides tell you to **offload weights into system RAM**. On a 16 GB machine that path strangles the system. We do the opposite:

- **Partial offload with `-ngl`**: layers that fit go to VRAM; the rest **stay as memory-mapped file pages**, which the OS **can reclaim**. In other words the CPU-side weights are still there — as **disk-backed, evictable** pages rather than something pinned into physical RAM.
- **Explicitly avoiding `-ncffn`**: `--n-cpu-ffn` uses a tensor override that **copies** CPU-side tensors into anonymous private memory. Measured: with `-ncffn`, private memory reached **13.4 GB** and physical memory use **99.3%**; with plain `-ngl 44` it dropped to **96.1%**. **This is the single most important finding in this work.**
- **`-lm mmap`, not `mmap+mlock`**: `mlock` pins pages into physical memory, driving RAM to **94.2%** (only 0.93 GiB free); plain `mmap` brought it down to **29.7%** — note that reading was taken during load/standby sampling and is a different measurement point from the 96.1% run-time figure, so the two are not directly comparable.
- **ComfyUI `--fast-disk`**: forces disk-backed dynamic loading, preventing weights from being promoted into RAM.
- **A 32 GB pagefile** as a backstop, turning "commit failure crash" into "recoverable paging". On this machine the pagefile went from **8,107 MB** to **32,768 MB**, bringing the commit limit to **47.94 GiB** with **39.39 GiB** headroom (snapshot values, not a standing guarantee).

### 3. 视觉塔放 CPU / Vision tower on the CPU

**中文。** Qwen3.8 的多模态投影器（`mmproj`，0.86 GiB）通过 `LLAMA_ARG_MMPROJ_OFFLOAD=0` 强制跑在 CPU，不做视觉塔的 GPU 卸载。代价是单张图编码慢几秒；而看图是偶发操作，这个交换很划算。
**English.** Qwen3.8's multimodal projector (`mmproj`, 0.86 GiB) is forced onto the CPU via `LLAMA_ARG_MMPROJ_OFFLOAD=0`, so the vision tower is not GPU-offloaded. The cost is a few extra seconds per image encode; since "looking" is an occasional operation, the trade is clearly worthwhile.

### 4. 为什么 64K 上下文在这个内存预算下可行 / Why 64K context fits this RAM budget

**中文。** 这是**模型架构**给的红利：Qwen3.8 是**混合注意力（hybrid attention）**结构——GGUF 元数据显示 `general.architecture=qwen35`、65 个 block、`full_attention_interval=4`，即约 16 层全注意力、其余为状态空间/线性层。只有那些全注意力层持有随上下文线性增长的 KV cache，所以 64K 的 KV 规模远小于同尺寸纯注意力模型。再叠加 `-ctk q4_0 -ctv q4_0`（KV 量化，必须同时开 `-fa on`）与 `-ub 256`（缩小计算缓冲区），才落进预算。

另需注意：元数据里的 `context_length` 是 **262144**，那是**模型支持能力**，不是本机实测可用容量。本机实测可用点是 **64K**。

**English.** This comes from the **architecture**: Qwen3.8 uses **hybrid attention** — its GGUF metadata reports `general.architecture=qwen35`, 65 blocks and `full_attention_interval=4`, i.e. roughly 16 full-attention layers with the rest being state-space/linear layers. Only those full-attention layers hold a KV cache that grows linearly with context, so the KV footprint at 64K is far smaller than a dense model of the same size would need. Add `-ctk q4_0 -ctv q4_0` (KV quantisation, which requires `-fa on`) and `-ub 256` (smaller compute buffer), and it fits.

Note that the metadata's `context_length` is **262144** — that is the model's *supported capability*, not a usable capacity measured here. The measured working point on this machine is **64K**.

---

## 实测数据 / Measured results

> 硬件 / Hardware: RTX 3060 Laptop **12 GiB** · i5-9400F（6C/6T，无核显 / no iGPU）· **15.94 GiB** DDR4-2666（2×8 GB，插槽已满 / slots full）· C: SSD · D: HDD
> 全部数字的出处与边界条件见 / Provenance and boundary conditions: [`docs/EVIDENCE.md`](docs/EVIDENCE.md)

### 上下文与卸载的权衡 / Context vs offload trade-off

| 上下文（测量时）/ ctx at measurement | `-ngl` | 能否启动 / Boots | 显存 / VRAM | 物理内存 / RAM |
|---:|---:|:---:|---|---:|
| 100,000 | 42 | ✅ | 11,814 MiB | 99.0% |
| **64,000** | **44** | ✅ | **11,552 MiB** | **96.1%** |
| 未记录 / not recorded | 48 | ❌ 显存不足 / OOM | — | — |

**结论 / Conclusion：64K 上下文 + `-ngl 44` 是本机的稳定工作点。** 仓库内启动脚本默认 `-c 65536`（比测量点略大，KV 量化下差异很小）；两者不要混为一谈。`-ngl 48` 那一行只知道会 OOM，**当次上下文长度没有记录**，不要假定它等于某一行。
**64K context with `-ngl 44` is this machine's stable working point.** The shipped launcher defaults to `-c 65536`, slightly above the measurement point; under KV quantisation the difference is small — do not conflate the two. For the `-ngl 48` row, all that is known is that it OOMs; **the context length of that run was not recorded**, so do not assume it matches either row above.

### 推理速度 / Throughput

| 项目 / Item | 实测值 / Measured | 说明 / Note |
|---|---|---|
| LLM 生成 / LLM generation | **~4.0 tok/s** | 模型在 SSD、64K、热缓存稳态 / SSD-resident, 64K, warm |
| 图像生成 1080p / render 1080p | **~88 秒 / s** | 1920×1088 |
| 图像生成 2K / render 2K | **~4.5 分钟 / min** | 2560×1440 |
| 模型切换 / model swap | **数十秒 / tens of seconds** | SSD 热态；每次流水线都要付一次 / warm SSD; paid once per run |

> **这些时间不含模型切换开销。** 每次流水线都要重新装载模型，SSD 热态下**每次切换数十秒**。因此"提交任务到拿到图"的实际总时长 = 提示词生成 + 切换加载 + 出图，明显长于上表的单项数字。
> **These numbers exclude model-swap overhead.** Every pipeline run reloads a model, which takes **tens of seconds even with the model warm on an SSD**. Real submit-to-image wall time = prompt authoring + swap/load + render, materially longer than any single row above.

> 约 4 tok/s 是**这一配置下的实测吞吐**。本仓库没有做跨配置对比，因此不宣称它是"不可突破的物理上限"——只能说：在这个模型、这个量化、这张卡、这组参数下，我们测到的就是它。
> ~4 tok/s is the **observed throughput on this configuration**. No cross-configuration comparison was run here, so we do not claim it is an absolute physical ceiling — only that this is what we measured for this model, this quantisation, this card and these flags.

---

## 更多样图 / More samples

全部由本项目流程实测产出（Qwen3.8 写提示词 → Qwen-Image 2.1 出图）。
All produced by this pipeline on this machine (Qwen3.8 authors the prompt → Qwen-Image 2.1 renders).

| 参考图 + 指令 → 图像 / Reference + instruction → image | 文生图·水彩 / Text → image, watercolour |
|---|---|
| ![把卡通鳄鱼改成水彩风格的方形输出 / the cartoon crocodile re-rendered as a square watercolour](screenshots/02-crocodile-watercolor.png) | ![橘猫坐在窗台上晒太阳的水彩画 / a ginger cat on a windowsill in the sun, watercolour](screenshots/03-cat-watercolor.png) |
| *"把这张图改成水彩画风格"* → 模型看图后重写提示词，再以原图为参考重绘。输出跟随参考图的方形画幅（1920×1920）。 | *"橘猫坐在窗台上晒太阳，水彩风格"* · 1920×1088 |
| *"turn this into a watercolour"* → the model rewrites the prompt from the image, then re-renders against it. Output follows the reference's square aspect (1920×1920). | *"a ginger cat on a windowsill in the sun, watercolour"* · 1920×1088 |

| 2K 大图 / 2K render |
|---|
| ![雨夜霓虹街道的电影感画面 / a neon street on a rainy night, cinematic](screenshots/04-neon-street-2k.png) |
| *"雨夜的霓虹街道，电影感"* · 2560×1440 · *"a neon street on a rainy night, cinematic"* |

> 提示词由模型的系统指令约束在 **130 词以内**（`Keep it under 130 words`），此处不逐字统计实际词数。
> The system instruction constrains prompts to **under 130 words**; the exact word count of each sample is not tabulated here.

---

## 仓库结构 / Repository layout

```text
qwen-duo-12g/
├── README.md                  本文件 / this file
├── LICENSE                    MIT（仅覆盖本仓库原创代码与文档 / original code and docs only）
├── .gitignore · .gitattributes
├── orchestrator/              两个总控台 / the two consoles
│   ├── orchestrator.mjs       出图总控台后端 :8090 / image console backend
│   ├── ui.html                出图总控台前端 / image console UI
│   ├── launch.ps1 · qwen-console.cmd · start-orchestrator.ps1
│   ├── chat-console.mjs       纯对话后端 :8091 / chat backend
│   ├── chat-ui.html           纯对话前端 / chat UI
│   └── chat-launch.ps1 · chat-console.cmd
├── comfyui/
│   ├── start_qwen.bat         启动 ComfyUI（含空闲内存闸门）/ start with a free-RAM gate
│   ├── stop_qwen.bat          停止 ComfyUI / stop it
│   └── scripts/               16 个 .ps1 + 2 个工作流 JSON / 16 .ps1 + 2 workflow JSON
├── tools/
│   ├── set-pagefile.ps1       页面文件配置（带校验、备份与回滚）/ pagefile with validation, backup, rollback
│   ├── fw-on.ps1              离线验证：添加出站阻断 / offline proof: add blocks
│   └── fw-off.ps1             离线验证：清理并回读确认 / remove and verify
├── docs/
│   ├── EVIDENCE.md            ★ 全部实测数字的出处 / provenance of every number
│   ├── PREFLIGHT.md           机器预检 / machine preflight
│   ├── OOM_MITIGATION.md      显存不足排查阶梯 / OOM mitigation ladder
│   ├── VERIFY_EXTRACTION.md   模型包解压校验 / extraction verification
│   ├── LONGPATH_PROOF.md      Windows 长路径实证 / long-path evidence
│   └── archive/               历史工程记录（非当前说明）/ historical records
└── screenshots/               实测出图样张 / sample renders
```

| 目录 / Directory | 内容 / Content |
|---|---|
| [`orchestrator/`](orchestrator/) | **总控台**：Node.js 后端 + 单文件前端，负责串行调度、进程生命周期、提示词流转、参考图上传。The **consoles**: Node.js backend + single-file front-end, handling serial scheduling, process lifecycle, prompt hand-off and reference-image upload. |
| [`comfyui/`](comfyui/) | ComfyUI 启停脚本与全部自动化：获取、解压、校验、放置、工作流安装、资源测量、阶段门禁。ComfyUI launch/stop scripts and all automation: fetch, extract, verify, place, install workflows, measure, gate. |
| [`tools/`](tools/) | 需要管理员权限的主机级工具：页面文件、离线验证用的防火墙规则。Admin-level host utilities: pagefile, and firewall rules for the offline proof. |
| [`docs/`](docs/) | 实测证据、预检、OOM 缓解、解压校验、长路径实证；历史记录在 [`docs/archive/`](docs/archive/)。Evidence, preflight, OOM mitigation, extraction checks, long-path proof; history under [`docs/archive/`](docs/archive/). |
| [`screenshots/`](screenshots/) | 本机实测出图样张。Sample renders produced on this machine. |

---

## 快速开始 / Quick start

### 适用的系统 / What this targets

**中文。** Windows 10/11；**PowerShell 7**（`pwsh`，脚本用到 PowerShell 7 的解析特性）；**Node.js LTS**（两个总控台都是单个 `.mjs` 文件，**只用内置模块，无 npm 依赖**）；一块 **12 GB 级** NVIDIA 显卡 + **16 GB** 内存；SSD 上有足够空间（见下方磁盘预算）。`.cmd` 入口保持纯 ASCII，避免代码页导致的乱码。

**English.** Windows 10/11; **PowerShell 7** (`pwsh` — the scripts use PowerShell 7 parsing features); **Node.js LTS** (both consoles are single `.mjs` files that use **built-in modules only, no npm dependencies**); a **12 GB-class** NVIDIA GPU with **16 GB** of RAM; enough space on an SSD (see the disk budget below). The `.cmd` entry points are kept pure ASCII to avoid code-page corruption.

### 磁盘预算 / Disk budget

| 项目 / Item | 需求 / Requirement |
|---|---|
| 模型权重 / Model weights | **≈ 31.3 GiB** |
| 页面文件（固定大小）/ Pagefile (fixed size) | **32 GiB** |
| 部署峰值（解压 + 安装，估算）/ Deployment peak (estimated) | **≈ 41.45 GiB**（见 [`docs/PREFLIGHT.md`](docs/PREFLIGHT.md)） |

建议准备 **100 GiB 以上**可用空间，并把模型放在 SSD 上——HDD 冷加载明显更慢。
Budget **100 GiB or more** of free space, and keep models on an SSD — cold loading from an HDD is markedly slower.

### 安装映射：仓库路径 → 运行路径 / Installation mapping

**这一节很重要。** 两个后端里写着**参考机上的绝对路径**（可用环境变量覆盖）。克隆仓库本身**不会**让这些路径存在，你需要把文件按下面放好，或用环境变量指向你自己的位置。

**This section matters.** Both backends contain **absolute paths from the reference machine** (overridable via environment variables). Cloning the repo does **not** create those paths; either place files as mapped below, or point the variables at your own locations.

| 仓库中的位置 / In this repo | 参考机路径 / Reference-machine path | 覆盖变量 / Override |
|---|---|---|
| `orchestrator/*.mjs`、`*.html` | `C:\ComfyUI\orchestrator\` | `QWEN_COMFY_ROOT`（改根目录 / changes the root）；`QWEN_UI_DIR`（**只影响对话台 UI** / chat UI only） |
| `comfyui/scripts/stage0_scaffold_api.json` | `C:\ComfyUI\scripts\stage0_scaffold_api.json` | `QWEN_GRAPH`（**完整文件路径** / full file path） |
| ComfyUI 本体（自行获取）/ ComfyUI itself | `C:\ComfyUI\ComfyUI_windows_portable\`（其父目录是 `C:\ComfyUI` / its parent is `C:\ComfyUI`） | `QWEN_COMFY_ROOT` = **`C:\ComfyUI`（父目录，不是 `..._portable`）** / the **parent** dir, not `..._portable` |
| 嵌入式 Python / embedded Python | `…\ComfyUI_windows_portable\python_embeded\python.exe` | `QWEN_PY`（完整文件路径 / full file path） |
| ComfyUI 入口 / ComfyUI entry | `…\ComfyUI_windows_portable\ComfyUI\main.py` | `QWEN_COMFY_MAIN`（完整文件路径 / full file path） |
| 输出目录 / output dir | `…\ComfyUI_windows_portable\ComfyUI\output\` | `QWEN_COMFY_OUTPUT` |
| LLM 权重 / LLM weights | `C:\llm\models\Qwen3.8-27B\Qwen3.8-27B-UD-Q4_K_S.gguf` | `QWEN_MODEL`（完整文件路径 / full file path） |
| 多模态投影器 / projector | `D:\llm\models\Qwen3.8-27B\mmproj-F16.gguf` | `QWEN_MMPROJ`（完整文件路径 / full file path） |
| `llama-server.exe` | `D:\llm\bin\llama.cpp\llama-server.exe` | `QWEN_LLAMA_EXE`（完整文件路径 / full file path） |

**覆盖能力的确切边界 / Exact scope of these overrides**（请不要假定"全部可搬移" / do not assume everything is relocatable）:

- `QWEN_CTX`、`QWEN_NGL` **只被纯对话总控台读取**；出图总控台里这两个值是写死的 `65536` / `44`。要改出图侧，直接改 `orchestrator.mjs`。
  `QWEN_CTX` and `QWEN_NGL` are **read only by the chat console**; the image console hard-codes `65536` / `44`. To change the image side, edit `orchestrator.mjs`.
- `QWEN_COMFY_PORT` 只影响总控台做健康检查与调用 API 时用的端口，**不会**把 `--port` 传给被启动的 ComfyUI；改 ComfyUI 端口要同时改它的启动参数。
  `QWEN_COMFY_PORT` only changes the port used for health checks and API calls — it is **not** passed as `--port` to the spawned ComfyUI.
- 启动 ComfyUI 时的工作目录在 `orchestrator.mjs` 里写死为 `C:\ComfyUI\ComfyUI_windows_portable`，所以只改 `QWEN_COMFY_ROOT` / `QWEN_PY` / `QWEN_COMFY_MAIN` **不能**把 ComfyUI 完整搬家。
  The working directory used when spawning ComfyUI is hard-coded to `C:\ComfyUI\ComfyUI_windows_portable`, so overriding the three variables above does **not** fully relocate ComfyUI.
- `orchestrator/launch.ps1` 与 `chat-launch.ps1` 里也有写死的脚本路径、工作目录与浏览器端口，因此**这两个 `.ps1` 启动器不随环境变量搬移**；要搬移请直接用 `node <path>` 启动。
  `launch.ps1` and `chat-launch.ps1` also hard-code script paths, working directories and browser ports, so **these launchers do not follow the environment overrides**; start with `node <path>` instead.

### 权重从哪来 / Where the weights come from

**中文。** 本仓库**不包含权重**。你需要自行从模型发布方获取上表列出的 5 个文件，并放到对应位置：

- **Qwen3.8-27B 的 GGUF 与配套 `mmproj-F16.gguf`** — 由上游/社区量化发布方提供；请在 [Hugging Face 上的 Qwen 组织页](https://huggingface.co/Qwen) 定位与你所用模型对应的仓库，并按该仓库说明选择 UD-Q4_K_S 量化与配套 mmproj。本仓库不代为分发，也不保证你找到的就是本机用的那一份。
- **Qwen-Image 2.1 的 DiT / 文本编码器 / VAE** — 放入 ComfyUI 的 `models\diffusion_models`、`models\text_encoders`、`models\vae`；文件名与期望字节数/SHA-256 见 [`comfyui/scripts/fetch_models.ps1`](comfyui/scripts/fetch_models.ps1) 的清单，模型页通常在 [Comfy-Org 组织页](https://huggingface.co/Comfy-Org)。
- **ComfyUI 本体** — 本机用的是 **v0.41.0** 的 Windows 免安装包（[`comfyui/scripts/fetch_comfy.ps1`](comfyui/scripts/fetch_comfy.ps1) 里 pin 的就是这个版本的资产）；上游项目见 [comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI)。
- **`llama-server.exe`** — CUDA 构建，来自 [ggml-org/llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases)。本机使用一个 CUDA 12 构建，但**具体 release 标签/commit 未记录**，因此无法给出精确版本号。

**English.** The repo **does not ship weights**. Obtain the 5 files listed above from their publishers and place them as mapped:

- **The Qwen3.8-27B GGUF and its `mmproj-F16.gguf`** — published by upstream/community quantisers; locate the repository for your exact model on the [Qwen organisation page on Hugging Face](https://huggingface.co/Qwen) and follow that repository's instructions for the UD-Q4_K_S quantisation and the matching mmproj. This repo neither redistributes them nor guarantees you will find the same file used here.
- **Qwen-Image 2.1 DiT / text encoder / VAE** — place into ComfyUI's `models\diffusion_models`, `models\text_encoders`, `models\vae`. Filenames plus expected byte counts and SHA-256 values are in the manifest inside [`comfyui/scripts/fetch_models.ps1`](comfyui/scripts/fetch_models.ps1); model pages are usually under the [Comfy-Org organisation](https://huggingface.co/Comfy-Org).
- **ComfyUI itself** — this machine ran the **v0.41.0** Windows portable build (the exact asset pinned in [`comfyui/scripts/fetch_comfy.ps1`](comfyui/scripts/fetch_comfy.ps1)); upstream project: [comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI).
- **`llama-server.exe`** — a CUDA build from [ggml-org/llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases). This machine used a CUDA 12 build, but **the exact release tag/commit was not recorded**, so no precise version can be given.

> 每个模型遵循**其各自的上游许可**（部分可能含非商用或使用范围限制），请以模型发布页的许可文本为准——本仓库的 MIT 许可**不覆盖**这些权重。
> Each model is governed by **its own upstream licence** (some may restrict commercial use or scope). The licence published with each model is authoritative; this repo's MIT licence **does not** cover those weights.

### 启动 / Run

```powershell
# 出图总控台（8090）/ image console
pwsh -File .\orchestrator\launch.ps1
# 或直接 / or directly
node .\orchestrator\orchestrator.mjs
# 然后打开 / then open  http://127.0.0.1:8090
```

```powershell
# 纯对话总控台（8091）/ chat-only console
pwsh -File .\orchestrator\chat-launch.ps1
# 或直接 / or directly
node .\orchestrator\chat-console.mjs
# 然后打开 / then open  http://127.0.0.1:8091
```

```powershell
# 命令行跑一次完整出图流程 / one full pipeline run from the CLI
node .\orchestrator\orchestrator.mjs --run "一只骑自行车的鳄鱼，卡通风格"   # a cartoon crocodile riding a bicycle
# 带参考图 / with a reference image
node .\orchestrator\orchestrator.mjs --run "把这张图改成水彩风格" --image .\my.png   # turn this into a watercolour
# 指定分辨率 / pick a resolution
node .\orchestrator\orchestrator.mjs --run "雨夜的霓虹街道" --mode 2k   # a neon street on a rainy night
```

### 关键启动参数 / Key LLM flags

**这些是 `llama-server` 侧的核心参数**，两个总控台在启动 LLM 时都会拼装它们（纯对话台还允许用 `QWEN_CTX` / `QWEN_NGL` 覆盖前两项）。
**These are the core `llama-server` flags**; both consoles assemble them when starting the LLM (the chat console additionally allows `QWEN_CTX` / `QWEN_NGL` to override the first two).

| 参数 / Flag | 值 / Value | 为什么 / Why |
|---|---|---|
| `-ngl` | **44** | 显存装得下且内存最省的实测点 / measured sweet spot |
| `-c` | **65536**（仓库默认 / shipped default） | 实测工作点是 **64,000**；默认值略高于测量点 / the measured point is **64,000**; the default is slightly above it |
| `-ctk` / `-ctv` | `q4_0` / `q4_0` | KV 量化，**必须**配 `-fa on` / requires flash attention |
| `-fa` | `on` | 开启 flash attention / enable it |
| `-ub` | **256** | 缩小计算缓冲区 / smaller compute buffer |
| `-lm` | `mmap` | **不要**用 `mmap+mlock` / do **not** use mlock |
| `-ncffn` | **不使用 / not used** | 会复制成不可回收私有内存 / copies into unreclaimable memory |

ComfyUI 侧启动脚本 [`comfyui/start_qwen.bat`](comfyui/start_qwen.bat) 使用 `--fast-disk --disable-pinned-memory --windows-standalone-build`，并在启动前检查空闲物理内存（**低于 6144 MB 则拒绝启动**）。该闸门只在这个 `.bat` 里；总控台直接 spawn `main.py` 的路径不经过它。

The ComfyUI launcher [`comfyui/start_qwen.bat`](comfyui/start_qwen.bat) uses `--fast-disk --disable-pinned-memory --windows-standalone-build` and refuses to start when free physical memory is **below 6144 MB**. That gate lives only in this `.bat`; the console's direct spawn of `main.py` does not pass through it.

---

## 边界与诚实声明 / Honest limitations

**中文。**

1. **内存占用 96%，不满足"90% 安全线"。** 15.36 GB 模型 + 64K KV 在 16 GB 物理内存上的必然结果，是**硬件算术**而非配置失误。运行时这些页大部分是**可驱逐的 mmap 页**，所以系统通常仍可响应，但留给其他程序的空间很小。
2. **速度约 4 tok/s，慢。** 这是**该配置下的实测吞吐**；本仓库没有做跨配置对比，因此不宣称它是不可突破的上限。
3. **两个模型不能同时驻留。** 必须串行切换，每次切换需要重新加载，SSD 热态下**数十秒**，这段等待无法消除。
4. **"提交任务到拿到图"包含多段开销**：提示词生成 + 切换加载 + 出图。上表中的 88 秒 / 4.5 分钟只是**出图段**。
5. **64K 是配置与实测工作点，不等于满 64K 长对话的压力测试结论。** 本仓库没有做"塞满 64K 上下文持续对话"的稳定性基准。
6. **参考图模式输出跟随参考图长宽比**，方形参考图得到方形输出，不会自动裁成 16:9。
7. **"看图"不等于像素级保真**：它生成的是基于视觉输入的提示词，不保证保持原主体身份/姿态/细节。
8. **两个总控台共享后端但无仲裁**：一个在切换时会停掉后端，可能中断另一个（详见分述四）。
9. **本地部署不会移除模型的安全对齐。** Qwen3.8 的对齐训练在**权重本身**里，不存在可以单独关闭的模块（实测 chat template 全长 9,993 字符，安全检查关键词 0 个；本机也没有 guard/moderation 模型）。本项目**不提供**规避安全机制的代码；系统提示词层面的"减少过度拒答"文本只是提示词工程，不是对齐移除。
10. **首次部署需要联网**获取权重与运行时；"完全本地推理"指的是**部署完成之后**。
11. **下载执行的第三方内容只做了完整性校验，未做发布者身份校验**（见分述五的安全提示与 [`docs/EVIDENCE.md` §10](docs/EVIDENCE.md)）。
12. **本机扩展性受限**（属测试机情况，非普遍规律）：笔记本 OEM 驱动无 Pascal 设备 ID，无法用 Pascal 卡扩显存；主板只有 1 条 x4 以上 PCIe 槽，无法叠加第二块卡；内存 2/2 插槽已满，只能整组替换、无法加装。

**English.**

1. **RAM use reaches 96%, which does not meet a "90% safe" line.** That is the inevitable result of a 15.36 GB model plus 64K KV cache on 16 GB of physical RAM — **hardware arithmetic**, not misconfiguration. Most of those pages are **reclaimable mmap pages**, so the system normally stays responsive, but little room is left for anything else.
2. **About 4 tok/s — slow.** This is the **observed throughput on this configuration**; no cross-configuration comparison was run here, so we do not claim it is an absolute ceiling.
3. **The two models cannot coexist.** Switching is strictly serial and requires a reload, taking **tens of seconds** even with the model warm on an SSD; that wait cannot be removed.
4. **Submit-to-image includes several overheads**: prompt authoring + swap/load + render. The 88 s / 4.5 min figures above cover **the render stage only**.
5. **64K is the configured and measured working point, not a stress-test conclusion at a full 64K window.** No long-session "fill the context and keep chatting" benchmark is included.
6. **Reference-image mode follows the reference's aspect ratio**: a square reference yields a square output, with no automatic 16:9 crop.
7. **"Looking at an image" is not pixel-level fidelity**: what it produces is a prompt grounded in visual input, with no guarantee of preserving the subject's identity, pose or fine detail.
8. **Both consoles share a backend with no arbitration**: one stopping it during a hand-off can interrupt the other (see feature four).
9. **Local deployment does not remove the model's safety alignment.** Qwen3.8's alignment is trained **into the weights**; there is no separable module to switch off (measured: the chat template is 9,993 characters long and contains **0** safety keywords; there is no guard/moderation model locally). This project **provides no code to circumvent safety mechanisms**; the system-prompt text that reduces over-refusal is prompt engineering, not alignment removal.
10. **The first deployment needs network access** for weights and runtime; "fully local inference" refers to **after setup**.
11. **Downloaded-and-executed third-party content is only checked for integrity, not publisher identity** (see the security note in feature five and [`docs/EVIDENCE.md` §10](docs/EVIDENCE.md)).
12. **This machine's expansion options are constrained** (test-rig specifics, not a general rule): the laptop OEM driver ships no Pascal device IDs, so a Pascal card cannot extend VRAM; the board has only one PCIe slot of x4 or wider, so a second GPU cannot be added; and both RAM slots are occupied, so RAM can only be replaced as a pair, never added.

---

## 工程记录 / Engineering notes

| 文档 / Document | 内容 / Content |
|---|---|
| [`docs/EVIDENCE.md`](docs/EVIDENCE.md) | ★ 全部实测数字、测量口径与已知限制 / every measurement, its basis and the known limits |
| [`docs/PREFLIGHT.md`](docs/PREFLIGHT.md) | 部署前的机器预检与结论 / machine preflight and conclusions |
| [`docs/OOM_MITIGATION.md`](docs/OOM_MITIGATION.md) | 显存不足时的缓解阶梯（排查指南）/ OOM mitigation ladder, a troubleshooting guide |
| [`docs/VERIFY_EXTRACTION.md`](docs/VERIFY_EXTRACTION.md) | 模型包解压与校验注意事项 / extraction and verification notes |
| [`docs/LONGPATH_PROOF.md`](docs/LONGPATH_PROOF.md) | Windows 长路径限制的实证 / long-path evidence |
| [`docs/archive/`](docs/archive/) | 历史工程记录（计划、执行日记、验收矩阵）/ historical records — **非当前结论** / **not current conclusions** |

> `docs/EVIDENCE.md` 是**人工汇总的实测记录**，不是原始日志的完整存档。若你要独立复核，请按你自己机器上的条件重测；本仓库不把汇总值当作比原始数据更强的证据。
> `docs/EVIDENCE.md` is a **manually summarised measurement record**, not a full archive of raw logs. To independently verify, re-measure under your own conditions; this repository does not present the summary as stronger evidence than it is.

---

## License

本仓库的**原创代码与文档**采用 [MIT License](LICENSE)。

**模型权重不在此仓库内**，各自遵循其上游许可（可能包含非商用或使用范围限制），请以模型发布页的许可文本为准。同理，[ComfyUI](https://github.com/comfyanonymous/ComfyUI)（GPL-3.0）、[llama.cpp](https://github.com/ggml-org/llama.cpp)（MIT）以及各模型的分发条款均由各自上游决定——本仓库的 MIT 许可不影响、也不替代它们。

The **original code and documentation** in this repository are released under the [MIT License](LICENSE).

**Model weights are not included here** and remain under their own upstream licences (which may restrict commercial use or scope); the licence published with each model is authoritative. Likewise, [ComfyUI](https://github.com/comfyanonymous/ComfyUI) (GPL-3.0), [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT) and each model's redistribution terms are set by their respective upstreams — this repo's MIT licence neither changes nor replaces them.
