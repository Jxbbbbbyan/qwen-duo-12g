# OOM_MITIGATION - 显存不足时的有序处置阶梯

Goal: `goal-86a1c096-ccc4-483f-a2bb-1eb835f77a0a`
Plan: `PLAN_v3.md`
Date: 2026-10-16
性质：**为 `Risk-001` / `Risk-003` 补写的处置方案**。原计划只写了"若失败则启用 `ALT-001`"，
中间是空的；本文件把它填成一条**有序、分级、且明确标注代价**的阶梯。

---

## 为什么需要这条阶梯

`E-EXT-024` 的三阶段估算里，**文本编码阶段是最紧的一格**：

| 阶段 | 权重 | Windows 预留 | 激活/工作集 | 合计 (GiB) | 占 12288 MiB |
|---|---|---|---|---|---|
| **文本编码** | **8.71** | 0.59 | 小（含视觉塔） | **≈9.4–10.3** | **余量最小** |
| 采样（int8 DiT，1 MP） | 6.76 | 0.59 | 0.48 | ≈7.8 | 余量大 |
| VAE 解码（1024²） | 0.63 | 0.59 | 2.778 | ≈4.0 | 充裕 |

用户已在 `Q-018` 裁定**保留官方 int8 编码器**（不用 5.88 GiB 的 w4a8），
因此 **8.71 GiB 这一格保持不变**，OOM 风险留在原地。这条阶梯就是应对它的。

**原则**：先试**零下载代价**的手段；需要下载的排在后面且**必须重新取得用户批准**。

---

## Tier 0 — 零下载、零风险，按顺序试

### 0.1 关闭后台程序（操作规程 `D-011`，不是可选项）
微信 / Edge / ChatGPT / 向日葵远控在你不跑图时占约 8 GB 内存。
本机只有 15.9 GB。**这是所有手段的前提**，启动脚本会拒启低于阈值的启动。

### 0.2 `QwenImage21Cache` 的 `dtype`：`default` → **`int8`** → `int4`
- **证据**：该节点 schema 的 tooltip 原文——`dtype: default is lossless.`
  **`int8` halves the cache at about bf16 accuracy**，`int4` quarters it but roughly doubles the per-step error.
- **怎么改**：每个交付工作流里都有这个节点（`turbo_t2i` id=490、`turbo_image_edit` id=469、
  `t2i` id=480、`image_edit` id=469、`background_removal` id=469），
  当前 widgets 均为 `["auto","default"]`，其中第 2 个就是 `dtype`。
  **它被提升到顶层子图实例上，可在界面里直接改。**
- **适用性（如实说明）**：该节点的官方描述是"Quantization potentially speeds up **edit workflows**
  when memory starved"——**主要作用于编辑类工作流**（缓存文本前缀跨步复用）。
  纯文生图只编码一次，收益较小。**不要指望它救文生图的编码阶段。**
- **代价**：`int8` 官方称约等于 bf16 精度；`int4` 逐步误差约翻倍。

### 0.3 `QwenImage21Cache` 的 `device`：`auto` → `cpu`
- **证据**：tooltip 原文——`auto uses spare VRAM, then RAM`；
  **`cpu (RAM) is prefetched behind compute and costs little speed`**；`off` 则每步重算（更慢）。
- **代价（必须说清）**：这是把缓存**搬进系统内存**。它**不是权重**，
  因此不违反 `R-010`（"权重不驻留内存"）的定义；但在 16 GB 机器上**是在拿内存换显存**。
  **只有在 0.2 不够时才用**，并须在 `I-008` 的记录里如实标注这一取舍。

### 0.4 `--cache-none`
- **证据**：`cli_args.py` 原文「Reduced RAM/VRAM usage at the expense of executing every node for each run.」
- **代价**：每次运行都重跑每个节点 → 变慢。

### 0.5 `--vram-headroom N` / `--reserve-vram N`
- 两者作用不同（`E-EXT-015`）：`--reserve-vram` 只影响"按总容量"的那次检查；
  `--vram-headroom` 是**给 DynamicVRAM 额外保留**的显存，且**会把其他程序占用的显存也算进去**。
- 本机桌面常占约 1068 MiB，所以 `--vram-headroom` 是更贴切的旋钮。

### 0.6 ⛔ **不要**把 `CLIPLoader` 的 `device` 改成 `cpu`（先挡住这个诱人的错误）

- **它确实存在**：`CLIPLoader` 的 schema 里 `device` 是可选输入，取值 `["default","cpu"]`
  （`nodes.py`，v0.41.0）。源码里 `if device == "cpu":
  model_options["load_device"] = model_options["offload_device"] = torch.device("cpu")`。
- **看起来像救命稻草**：它能把 8.71 GiB 的文本编码器**完全移出显存**，直接消除最紧的那一格。
- **对本机是错的**，理由是算术而不是偏好：
  - 那 8.71 GiB 会整块落进**系统内存**，而本机共 15.9 GB、空闲仅约 7.6–8 GB（`E-REPO-003`）；
  - 它**不是**"暂存缓冲"，而是**模型本身常驻**——`--disable-pinned-memory` 管不了它，
    因为那个开关针对的是 pin 住的内存缓冲，不是被显式放到 CPU 上的模型；
  - 因此它**直接违反本部署的核心要求**（权重不得驻留系统内存），并极可能触发换页甚至失败。
- **判定**：登记为**明确禁用**，与禁列表并列。若在阶段 0 真的走到"编码器阶段 OOM"，
  正确的下一步是 **Tier 2.1（`ALT-006` w4a8 编码器，5.88 GiB，需用户批准）**，
  而**不是**把编码器推给 CPU。


---

## Tier 1 — 零下载，但改变输出

### 1.1 降低分辨率
**旋钮因工作流而异**（源码 + 模板自带说明共同确认，见 `D-129`）：

| 工作流 | 旋钮 | 取值 |
|---|---|---|
| 文生图 `turbo_t2i` | `ResolutionSelector` 的 **`megapixels`** | `1.0` = 1024²、**`0.25` = 512²**、`4.0` = 2048²（`aspect_ratio` = `1:1 (Square)`） |
| 图像编辑 / 重绘 `turbo_image_edit` | `TextEncodeQwenImage21` 的 **`resolution`** | 默认 1024；改小即缩小输出 |

`turbo_t2i` 内嵌的 MarkdownNote 原文：「Output size comes from **ResolutionSelector** (width/height).
Default is 1 megapixel (1024*1024). For native 2K, set 1:1 and **4 megapixels** (2048*2048).」
`turbo_image_edit` 的默认路径则走 `TextEncodeQwenImage21` 输出的 64 通道 latent（`switch=false` 选 `on_false`）。

降分辨率会同时缩小 latent 与激活。
**这正是 `PLAN_v3` 上机验证顺序里"先用 512×512 确认能出图，再逐步升到 1024×1024"的意图**，
只是原计划没把它写进 `AC`。降分辨率属于**调试手段**，不计入最终验收。


### 1.2 `--disable-fast-disk`（A/B 的对照臂）
若怀疑 `--fast-disk` 本身参与了问题，`I-012` Phase B 本来就会跑这个对照臂，直接读它的数据。

---

## Tier 2 — **需要下载，且必须重新取得用户批准**

### 2.1 `ALT-006`：w4a8 文本编码器（**首选备选**）
- **大小** 6,312,105,364 B（5.88 GiB），比现用 int8 版少 **3,038,692,996 B（2.83 GiB）**。
- **把最紧的一格从 8.71 GiB 降到 5.88 GiB** —— 直接针对 `Risk-001` 的病灶。
- **已核实**：同仓库、同架构、同张量命名；ComfyUI `v0.41.0` 的 `comfy/ops.py:1085`
  有 `_GROUPED_INT8_FORMATS = {"asym_w4a8_int8": 4, ...}`，`:1299` 注释与该文件的
  `weight_codebook` / `weight_s_channel` **逐项对应**；**原生格式，非第三方**。
- **代价**：偏离官方模板默认（`R-001`/`D-003`），且 **4 bit 权重量化对文本编码器的精度影响没有官方数字**。
- **注意**：它在 `NG-008` 之外吗？**不在**——`NG-008` 禁的是"第三方 GGUF 节点包与第三方文本编码器"，
  w4a8 是同一官方仓库、原生格式。但 `D-003`/`R-001` 指向官方 int8，
  故**改用 w4a8 需要用户批准**。

### 2.2 `ALT-001`：全 GGUF 最小集（**范围外**）
DiT `Q4_K_M` 3.91 GiB + 第三方编码器 `qwen3vl-8b-it-q4_k_m` 4.68 GB(dec) + VAE ≈ 9.22 GiB。
需第三方节点包 `molbal/ComfyUI-GGUF` 与第三方编码器——
**被 `NG-008` 明确排除**，必须**另起一次规划**，不得在 `I-012` 失败后自行扩大范围。

---

## Tier 3 — 终态

若 Tier 0/1 用尽、用户不批准 Tier 2，则**如实报告**：
「本轮目标在该硬件配置上未达成」，附全部实测证据。
按 `D-025` 的终态规则收尾：**停止后续下载、保留证据、不引入范围外组件、
不因难度标记 blocked、不假装成功**。

---

## 与 Verifier 清单的对应

- `VC-006` / `VC-009` / `VC-017`：Tier 0/1 的任何尝试都**必须**用
  `measure_resources.ps1` 记录，判据不变（加载大权重后 Private Bytes 与 GpuShared 增量 < 1 GiB）。
- **特别注意**：Tier 0.3（`device=cpu`）会把缓存放进内存，
  **必须同时报告 `ram_mb` 与 `Shared GPU Usage`**，不得只说"显存够了"。
- `VC-016`：`--fast-disk` 的二值裁定不受本阶梯影响。
- **`AC-004` 的独立性**：Tier 0/1 只用于**救活一次运行**；
  若最终验收是在降分辨率或 `device=cpu` 下取得的，**必须在该验收记录里注明**，
  不得让 `AC-001`/`AC-002`/`AC-003` 在缩水配置下冒充合格。
