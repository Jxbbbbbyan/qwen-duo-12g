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
# EXECUTION_STATUS - Qwen-Image 2.1 本机部署

Goal: `goal-86a1c096-ccc4-483f-a2bb-1eb835f77a0a`（active）
Plan: `PLAN_v3.md`（已接受）+ `PLAN_v3_AMENDMENT_001.md` / `_002.md`
Updated: 2026-10-16 ~19:22

## 一句话状态

**执行中：主体包与解压已完成，只剩权重下载。** 2026-10-17 01:04–01:10 期间，**无人值守流水线自动**
完成了 `I-002`、`I-003`、`I-006` 与 `I-012` Phase A，并被日志逐条取证（`post_download.log`）。

- ComfyUI 主体包：**COMPLETE 2,010,075,321 B**；解压 `tar exit = 0`（110.0 s）。
- `I-002` 冒烟测试 `--quick-test-for-ci --cpu`：**exit code = 0**（79.2 s）→ `VC-014` 证据已具备。
- `I-003` 运行时（`V-003`/`VC-002`）：`COMFY_VERSION=0.41.0`、`TORCH=2.14.0+cu130`、
  `TORCH_CUDA=13.0`、`CUDA_AVAILABLE=True`、python exit 0 → `VC-002` 证据已具备
  （版本 ≥ 0.37.0、CUDA 可用、版本串非空三项全中）。
  **注**：torch 2.14.0 ≥ 2.8，满足 DynamicVRAM / `--fast-disk` 的前置要求。
- `I-006`：4 个官方模板 + 1 个派生件已安装（两份副本哈希一致），`DELIVERED_HASHES.txt` 已写。
- `I-012` Phase A：`fastdisk_on` / `fastdisk_off` 两配置均 `ready: true`，CSV 已落盘；
  `policy` 为空**属预期**——`Model storage policy` 行只在模型加载时打印（Phase B 才能取到）。
- **权重（`I-004`）：进行中**，第一个文件（turbo DiT）下载中，实测 ~88 KB/s。
- **`VC-004` 当前为 FAIL（count = 10）** —— 见下方"未决项"。
- `verify_artifacts.ps1` = **92 passed / 0 failed**。

> 早前 18:55 / 19:05 两次 `post_download.ps1` 尝试**正确地失败**（`start-header CRC mismatch`、
  `archive size mismatch`），守卫按设计生效，未在残缺归档上继续。

## 交付物清单（`C:\ComfyUI\`）

| 路径 | 说明 |
|---|---|
| `start_qwen.bat` / `stop_qwen.bat` | 一键启停；参数集固化；5 项禁用参数及源码理由写在注释里；拒启阈值暂定 6144 MB（待 `I-012` 回填 `B0`） |
| `README_zh.md` | 含参数陷阱表、逐模板 cfg/步数表、官方模板自带的参数说明、OOM 阶梯指引、许可声明、实测回填区 |
| `tools\7zr.exe` | 已验证的回退提取器（7-Zip 26.04） |
| `_workflows_official\` | 5 个模板：4 个官方（逐字节等同被 pin 的 `v0.11.84`）+ **1 个派生的重绘工作流** |
| `_evidence\extraction_proof_ref_bcj2.7z` | 解压验证留档 |
| `_probe\aimdo\` | `comfy-aimdo` 0.5.6 wheel 及其解包内容（**只读取证，未安装**） |

### `scripts\` — **14 个脚本 + 2 个 JSON**（全部语法解析通过，0 问题）

| 脚本 | 作用 | 验证状态 |
|---|---|---|
| `ensure_fetch_running.ps1` | 下载看护：只在"未完成**且**无进程存活"时重启 | 已实跑 |
| `fetch_comfy.ps1` | 便携版下载：自适应竞速 4 源 + `-C -` 续传 + 90 s 连接刷新 | 运行中 |
| `fetch_models.ps1` | 权重下载（17,283,095,877 B，三件套）+ 逐文件 SHA256 | 待 `I-002` 后启动 |
| `post_download.ps1` | **下载后整条序列的驱动**（`I-002`→`I-003`→`I-006`→`I-012 Phase A`），失败即停 | STEP 0b/0 已实测；STEP 1 失败路径已用坏档端到端验证 |
| `place_models.ps1` | 权重落位 + 重断言字节数；先复制校验再删源 | 待权重到位 |
| `install_workflows.ps1` | 原样安装 4 官方 + 1**派生**；断言 PE 开关 OFF；写 `DELIVERED_HASHES.txt` | **干运行通过**（5 个工作流、两份副本哈希一致） |
| `scan_workflow_refs.ps1` | `V-005`：可执行路径的未下载文件引用扫描 | **已实跑出证据** |
| `measure_resources.ps1` | 资源仪器（按 `R-010` 定义） | **自测通过** |
| `run_stage0_gate.ps1` | `I-012` Phase A/B；头部写明测试矩阵 | 待 ComfyUI |
| `derive_inpaint.ps1` | 派生重绘工作流（零提升改动方案） | **已实施 + 结构验证通过** |
| `verify_artifacts.ps1` | `I-011` 用的机械自检器 | 已实跑 |

## 已完成并已取证

| 项 | 产物 | 状态 |
|---|---|---|
| `I-001` 预检门禁 | `PREFLIGHT.md` | **6 项断言全 PASS** |
| `I-006` 派生（重绘） | `image_qwen_image_2_1_turbo_image_edit_inpaint.json` | **结构验证通过**（见下），**尚未加载实跑** |
| `I-007` 启停脚本 | `start_qwen.bat` / `stop_qwen.bat` | 机器核对通过 |
| `I-009` 中文 README | `README_zh.md` | 5 节齐全 + 许可声明 + 速度非门槛声明 |
| `I-010` P104 迁移方案 | `P104_MIGRATION.md` | 含"只写不执行"声明 |
| 解压链路预验证 | `VERIFY_EXTRACTION.md` | bsdtar 与 7zr 均 PASS（参数已更正为真实的 `-md=768m`） |
| OOM 处置阶梯 | `OOM_MITIGATION.md` | 10 个分级条目，全部附依据 |
| `I-014` 执行规程 | `I014_UI_RUN.md` | 逐步操作 + 证据清单 + 禁止项 |
| 工作流规格 | `I006_WORKFLOW_SPEC.md` | 图拓扑 + 权威采样参数 + 分级派生方案 |

## 派生件的结构证据链（`I-006`）

定位（`468`=ComfySwitchNode / `505`=SamplerCustomAdvanced / 连线 `913`）→ 改接（`509`→`505`）→
**无悬空连线端点** → **未引入新的未下载引用** → PE 开关仍 `false` →
**序列化往返无损**（顶层与子图的键、28 个提升输入名、逐节点结构全部逐项比对一致）。
**唯一未证实的仍是"ComfyUI 能否加载并运行它"** —— 归 `I-012`/`I-014`。

## 关键事实（已验证，勿遗忘）

- **`--fast-disk` 是磁盘后备**：`comfy-aimdo` 的绑定层显示
  `hostbuf_file_reader_read(device, file_handle, file_offset, size, stream, device_ptr, mark_cold)`
  ——按**文件句柄+偏移**直接读进显存；配合 `ModelMMAP.model_mmap_get_file_handle()`。
  另有 `HostBuffer` 是内存路径。VBAR 页粒度 **32 MiB**，`fault()` 返回 0/1/2，
  `get_residency()` 的 bit0=驻留显存、bit1=pinned。
  **仍未读到** DLL 内的策略决策 → `VC-016` 的 A/B 实测仍是正式裁定者。
- **便携版是 cu129**（`stable-release.yml` 的默认输入），满足 `comfy-aimdo` 的 CUDA 12.8+ 要求。
  **torch 版本读不到**（在 `cache_tag` 依赖包里）→ `I-003` 的门禁项（`PyTorch 2.8+`）。
- **版本读取**：权威来源是 `comfyui_version.py` 的 `__version__`（`server.py:45` 如此导入）。
- **`GET /system_stats` 在 `server.py:771`** → `run_stage0_gate.ps1` 的就绪轮询有效。
- **`--quick-test-for-ci` 会 `exit(0)`**（`main.py:621`），在节点注册之后、事件循环之前 →
  同步等待安全；但它**不验证** HTTP 服务能否启动（`run_stage0_gate.ps1` 补这一层）。
- **尺寸旋钮因工作流而异**：文生图改 `ResolutionSelector.megapixels`（`1.0`=1024²、`0.25`=512²、`4.0`=2048²）；
  编辑/重绘改 `TextEncodeQwenImage21.resolution`。
- **⛔ 明确禁用**：把 `CLIPLoader.device` 设为 `cpu`——那会把 8.71 GiB 放进只剩约 8 GB 的内存，
  直接违反核心要求（详见 `OOM_MITIGATION.md` Tier 0.6）。

## 网络：实测结论

| 归因 | 判定 | 证据 |
|---|---|---|
| ~~VPN~~ | 排除 | 关闭后路由改直连，速度几乎未变 |
| ~~站点问题 / GitHub 被墙~~ | 排除 | **阿里云**（正常 MB/s 级 CDN）也只有 **121.2 KB/s** |
| ~~单流限速 / 多线程可加速~~ | 排除 | 1 流 116.1；4 流合计 109.4；**不同主机并发 0.99×** |
| ~~沙箱限速我的进程~~ | 排除 | **见下方 `CORR-021`**（原论证无效，已换证据） |

**根因（`CORR-021` 后的结论）**：本地 WLAN 通路实际吞吐仅 **~120 KB/s ≈ 1 Mbps**，
而链路**协商速率是 207 Mbps**（`MERCURY Wireless N Adapter`，2.4 GHz）——即协商速率高、
**实际可用吞吐极低**，是典型的重干扰/弱信号 2.4 GHz 表现。波动区间 4–145 KB/s。

**`CORR-021`（我推翻了自己的归因论证）**：我原先写"排除沙箱限速：curl 自身 123,340 B/s ≈
整块网卡 127,262 B/s"。**这条推理是无效的**——`NIC 总量 ≈ curl 量` 只能说明"网卡上没有别的流量"，
它**同样**出现在"服务器就给不出更多、链路其实很空闲"的情形，因此**不能推出网卡饱和**。
结论本身（瓶颈在本地链路）**仍然成立**，但改由更强的新证据支撑：**阿里云 CDN 也只有 121 KB/s**
（一个正常 CDN 不会这样服务），加上本地链路协商 207 Mbps 却只跑出 ~1 Mbps。
—— 这是本会话第 8 次自我更正，模式相同：**拿一个不足以支撑结论的量当成了充分证据**。

**唯一有效的解法：插网线。** 主板上 `Realtek PCIe GbE` **仍为 Disconnected（未插网线）**。
按 40 小时 vs 插线后可能的 MB/s 级估算，这是 **~80×** 的差距，也是全流程最大的单项杠杆。
换 5 GHz 不可行（该适配器为单频 2.4 GHz 的 Wireless N）。

**`OPEN-010`（抓取器的已知低效，不修）**：日志中出现 `curl: (33) HTTP server does not seem to
support byte ranges. Cannot resume.`（15 分钟内 2 次）。单次约损失 **18 s**，即约 **3%** 的时间。
**故意不改**：`fetch_comfy.ps1` 的 curl 退出码从未被读取，只按字节增长判定；而 `(33)` 会立即
返回 0 字节 ⇒ `$stall++`，下一条 `(28)` 又拿到数 MB 把 stall 清零，因此**源码永不被弃用**，
行为是可接受的。收益（3%）远小于"改一个我无法安全测试（一测就开始下载）的正在运行的长任务"
的风险。**若日后要改**：读取 `$LASTEXITCODE`，遇 `33` 立刻换源而非等下一次内层循环。
出现这种情况时**不会截断已下载数据**——文件大小全程单调增长，已连续观测确认。

## 恢复指引

1. **一条命令看清状态（首选）**：`pwsh -File C:\ComfyUI\scripts\status.ps1`
   —— 给出归档/权重进度、**近期与整体两个速率口径**、进程存活、当前阶段 S1–S4、下一步动作，
   并做**卡住检测**。恢复时先跑这条。
2. **看进度（原始）**：`(Get-Item C:\ComfyUI\ComfyUI_windows_portable_nvidia.7z).Length` vs `2010075321`
3. **无人值守（推荐，已启动）**：`pwsh -File C:\ComfyUI\scripts\run_unattended.ps1` 常驻循环，
   每 10 分钟调一次 `advance_pipeline.ps1`，自动把主体包完成 → 起权重下载 → 解压。
   **可重复启动**（推进器只在"该进程没在跑"时才启动它，重复循环不会产生重复下载）。
   日志：`C:\ComfyUI\logs\advance_pipeline.log`（每轮一块，含 S1/S2/S3/S4 状态）。
4. **单步推进（等价，手动）**：`pwsh -File C:\ComfyUI\scripts\advance_pipeline.ps1`
   —— 加 `-DryRun` 只看它打算做什么、不启动任何东西。
5. **下载若停**：`pwsh -File C:\ComfyUI\scripts\ensure_fetch_running.ps1`（幂等看护）
6. **解压序列（推进器会自动跑；也可手动）**：`pwsh -File C:\ComfyUI\scripts\post_download.ps1`
7. **再下权重**：`pwsh -File C:\ComfyUI\scripts\fetch_models.ps1`（17.28 GB，Turbo 三件套）
   —— 基础版 DiT（`I-013`，7.26 GB）**默认不下载**；仅当 `I-012` 通过后才加 `-IncludeBaseDit`。
   先看清清单可不下载：加 `-ListOnly`。
8. → `place_models.ps1`（`I-005`）→ `derive_inpaint.ps1`（若需重建派生件）→
   `install_workflows.ps1`（`I-006`）→ `run_stage0_gate.ps1 -Phase Load`（`I-012` Phase B）
   → 按 `I014_UI_RUN.md` 走 `I-014`
9. **随时自检**：`pwsh -File C:\ComfyUI\scripts\verify_artifacts.ps1`（当前 **89 passed / 0 failed**）

> **`D-198` 重要提示**：goal 轮次约每分钟触发一次，而下载需数十小时，
> **轮次会远早于下载完成而耗尽**。但**无人值守循环是独立进程**，不依赖轮次——
> 轮次结束后下载与解压仍会继续。届时用上面的 `status.ps1` 查看，必要时重新启动
> `run_unattended.ps1`（可重复启动，不会产生重复下载）。

**严禁**：触碰 `D:\llm` / `D:\miniconda3`；加禁列表参数；把 `CLIPLoader.device` 设为 `cpu`；
下载 bf16/PE；`I-012` 未过就执行 `I-013`；引入第三方 GGUF 节点包或编码器（`NG-008`）；
用 API 结果替代 `I-014` 的 UI 实跑。

## 自我更正清单（本会话已推翻的自己）

`CORR-001` ModelScope 无 repack · `CORR-002` 指南体积偏大（我用 GiB 比十进制 GB）·
`CORR-007` 模板必须裁剪 · `CORR-008` 只驻显存靠 `--gpu-only`（作用相反）·
`CORR-009` `--fast-disk` 是已定杠杆（只凭 help text）· `CORR-011` 两次把瞬时速率当稳态 ·
`CORR-013` "bsdtar 打不开 7z"（文件不存在）· `CORR-014` 验证脚本假阳性 ·
`CORR-015` 翻 latent 开关会坏（框架有 `fix_empty_latent_channels` 兜底）·
`CORR-016` `SetLatentNoiseMask` 输入名（是 `samples`）· `CORR-017` 解压验证用错字典参数（512m vs 真实 768m）·
`CORR-018` 资源自检曾"通过"但计数器失败被吞（旧代码返回 `0.0`）·
**`CORR-019` 负向断言写成源码正则（无法区分该行是否在 `if` 守卫内）**·
**`CORR-020` 否定型断言缺正向对照**（空输出会"因错误原因通过"）·
**`CORR-021` 用"NIC 总量 ≈ curl 量"论证网卡饱和（推理无效；结论改由"阿里云也只有 121 KB/s"支撑）**·
**`CORR-022` 第三次拿源码文本当行为证据（改用绊线 + 正向对照）**。
另有：两处 `Write-Output` 被 `return` 捕获、一处 `import comfy` 工作目录错、
一处 `[uint32]0xFFFFFFFF` 陷阱、一处文件占用被误报成"签名错"、一次跨模板混用同名节点 id、
`I-013` 基础版 DiT **无任何抓取实现**、`[int](Get-Date -UFormat %s)` 潜在运行时异常。

> **贯穿性教训（`CORR-019/020/022` 三次同源）**：**"计划里写了" ≠ "交付物实现了"**，
> **"文件里有这段字" ≠ "脚本会做这件事"**。凡属前者，只能靠**运行并观察**来证明，
> 且否定型断言**必须**配一个正向对照，否则它可能因"检查器本身是坏的"而虚过。
