> **记录说明 / Note.** 本文是开发期的记录，其中提到的部分探针脚本与私有目录**不在本仓库内**。
> 它用于说明当时的判断依据，不是可直接照做的操作手册；对外复现请以
> [`README.md`](../README.md) 的快速开始与 [`EVIDENCE.md`](EVIDENCE.md) 为准。
>
> This is a development-time record. Some probe scripts and private directories it mentions are
> **not part of this repository**. It documents the reasoning of that moment rather than a
> copy-and-run procedure; for public reproduction use the README quick start and `EVIDENCE.md`.

---
# PREFLIGHT - I-001（只读门禁 + 系统基线）

Run ID: `20261016T042835Z-qwen-image-21-local-deploy`
Goal: `goal-86a1c096-ccc4-483f-a2bb-1eb835f77a0a`
Plan: `PLAN_v3.md`
Executed: 2026-10-16
性质：**只读**。本步骤未安装任何软件、未下载任何文件、未改动任何受保护路径。

## 门禁断言结果

| # | 断言 | 阈值 | 实测 | 结论 |
|---|---|---|---|---|
| 1 | `C:` 可用空间 | ≥ 35 GiB | **120.65 GiB** | **PASS** |
| 2 | 可用系统内存 | ≥ 6 GB | **7.92 GB** | **PASS** |
| 3 | NVIDIA 设备显存 | = 12288 MiB | **12288 MiB** | **PASS** |
| 4 | `tar` 可用 | 存在 | **`C:\WINDOWS\system32\tar.exe` = bsdtar 3.8.9 / libarchive 3.8.9** | **PASS** |
| 5 | 目标目录尚未被占用 | `C:\ComfyUI` 不存在 | **不存在** | **PASS** |
| 6 | 受保护路径在位（`NG-003`） | 存在 | `D:\llm` = True、`D:\miniconda3` = True | **PASS** |

**门禁总判定：PASS** → 允许进入 `I-002`。

## GPU / 驱动

```text
NVIDIA GeForce RTX 3060 Laptop GPU, 12288 MiB, 11133 MiB free,
driver 616.92, compute_cap 8.6, PCIe gen3 x16
```

`memory.free` = 11133 MiB（本步独占采样，桌面占用低于计划书 `E-REPO-004` 记录的 1068 MiB 时刻）。

## 其他已记录事实

- `LongPathsEnabled = 0`（`C-012`）→ 当初据此要求安装路径必须短，`C:\ComfyUI\` 满足。
  **后续已实测推翻该担忧**：`tar`、`7zr` 与 PowerShell 7 自身均能处理超长路径
  （最大验证到 **313 字符**），详见 `LONGPATH_PROOF.md`。安装路径保持短仍然无害。
- 本步**未**安装 ComfyUI，因此**无法**在此时测得 ComfyUI 空载基线 `B0`（见 `PLAN_v3_AMENDMENT_001.md`）。

## 磁盘预算（执行期补充，2026-10-16）

`place_models.ps1` 采用**复制 → 校验 → 删除**，因此**峰值时暂存副本与已放置副本同时存在**，
这是全流程最吃空间的时点。当时的实测与预算：

| 项 | 大小 |
|---|---|
| 便携版归档（下载中） | 2,010,075,321 B ≈ 1.87 GiB |
| 解压后的便携版（1.87 GiB 归档按 3–4× 压缩率估） | ~6–8 GiB |
| 权重暂存 `_downloads` | 17,283,095,877 B ≈ 16.10 GiB |
| **放置峰值（暂存 + 已放置同时存在）** | **≈32.19 GiB** |
| **峰值合计** | **≈41.45 GiB** |
| `C:` 当时可用 | **116.18 GiB** → **余量 ≈74.73 GiB** |

**结论：空间充足。** 记录此项是为了避免"下载全部结束后才发现空间不够"这一类晚期失败。

## 系统基线 `B0_sys`（本步实测；**不是** `VC-017` 所需的 `B0`）

| 计数器 | 值 |
|---|---|
| `\Memory\Available MBytes` | **8097 MB** |
| `\Memory\Committed Bytes` | **14,388,670,464 B**（≈13.40 GiB） |
| `\Memory\Pages Input/sec` | **15.79** |

> 注：`B0_sys` 是**整机**（未装 ComfyUI）的系统基线，仅用于记录；
> `VC-017`/`VC-009` 所要求的 `B0` 是**ComfyUI 零模型空载**基线，按修正后的顺序在 `I-012` 首步测得。

## 与计划书的一致性

`PLAN_v3.md` 的 `I-001` 原文要求「**并实测并记录空载基线 `B0`**：启动 ComfyUI（零模型）后采样…」。
本步发现该要求在顺序上不可执行（`I-001` 早于 `I-002` 安装），已按
`PLAN_v3_AMENDMENT_001.md` 修正为：`I-001` 只测 `B0_sys`，真正的 `B0` 在 `I-012` 首步测得。
**该修正不改变任何验收标准（`AC-001`…`AC-006`）与任何 Verifier 判据的语义。**
