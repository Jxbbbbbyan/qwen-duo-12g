> **记录说明 / Note.** 本文是开发期的记录，其中提到的部分探针脚本与私有目录**不在本仓库内**。
> 它用于说明当时的判断依据，不是可直接照做的操作手册；对外复现请以
> [`README.md`](../README.md) 的快速开始与 [`EVIDENCE.md`](EVIDENCE.md) 为准。
>
> This is a development-time record. Some probe scripts and private directories it mentions are
> **not part of this repository**. It documents the reasoning of that moment rather than a
> copy-and-run procedure; for public reproduction use the README quick start and `EVIDENCE.md`.

---
# VERIFY_EXTRACTION - 解压链路的实测验证（`I-002` / `Risk-011` / `VC-014` 的预验证）

Goal: `goal-86a1c096-ccc4-483f-a2bb-1eb835f77a0a`
Plan: `PLAN_v3.md`
Executed: 2026-10-16
性质：**离线、可复现**。不依赖下载，不需要网络即可重跑。

## ⚠️ 更正与重做（2026-10-16，同日晚些时候）

**上面那次验证用的是错的压缩参数。** 我当时从审阅者的描述里取用 `-md=512m`，
但那是 **nightly** 构建的参数。我们下载的稳定版 asset（`ComfyUI_windows_portable_nvidia.7z`）
由 **`stable-release.yml`** 构建，其参数是：

```yaml
# .github/workflows/stable-release.yml  @ tag v0.41.0
L152: mkdir ComfyUI_windows_portable
L153: mv python_embeded ComfyUI_windows_portable
L154: mv ComfyUI_copy ComfyUI_windows_portable/ComfyUI
L167: "C:\Program Files\7-Zip\7z.exe" a -t7z -m0=lzma2 -mx=9 -mfb=128 -md=768m -ms=on -mf=BCJ2 ComfyUI_windows_portable.7z ComfyUI_windows_portable
```

即 **字典是 `768m`，不是 `512m`**。（对比：nightly 用 `512m`，`windows_release_package.yml` 也用 `768m`。）

**字典更大是对解压器要求更高的情形**，所以"用 512m 验证通过"**不能**推出"768m 也通过"。
已按真实参数重做：

### 重做结果（`-md=768m`，测试集 12 文件 / 43,613,486 B）

| 解压器 | 退出码 | 耗时 | 结果 |
|---|---|---|---|
| `tar.exe`（bsdtar 3.8.9） | **0** | 0.15 s | **12/12 文件、字节数一致、SHA256 全匹配** |
| `7zr.exe` 26.04 | **0** | 0.14 s | **同上** |

（顺带：32 位的 `7zr.exe` 能正常创建 768m 字典的归档，说明该字典规模在本机可用。）

**结论不变且现在才是可信的**：`I-002` 的 `tar -xf` 对**真实归档参数**有效；`Risk-011` 的回退也有效。

### 同时确认的归档内部布局（来自同一份工作流）

```text
ComfyUI_windows_portable/          <- 归档顶层目录
  python_embeded/                  <- L153
  ComfyUI/                         <- L154
```

→ `post_download.ps1` 里的
`$py   = <root>\ComfyUI_windows_portable\python_embeded\python.exe` 与
`$main = <root>\ComfyUI_windows_portable\ComfyUI\main.py`
**与真实布局一致**（此前是假设，现已由构建工作流证实）。

## 原始验证记录（参数有误，保留以示经过）

## 为什么做这件事

审阅者第 1 轮 `RV1-7`（Medium）指出：`I-002` 用 `tar -xf` 解压 ComfyUI 便携版，
但**本机没有 `7z`**，而官方便携版是用
`7z a -t7z -m0=lzma2 -mx=9 -mfb=128 -md=512m -ms=on -mf=BCJ2` 造的
（512 MB 字典、BCJ2 过滤器、固实归档），与本机曾验证过的普通 7z 不同；
且本机 `LongPathsEnabled = 0`。**解压是单点故障，且当时没有任何验证。**

本文件就是那次验证的取证。

## 方法

1. 用 `py7zr 1.1.3`（已存在于 `D:\miniconda3` 环境，**只读 import**）造不出 BCJ2，
   故改用 **`7zr.exe` 26.04**（7-Zip 官方独立版，602,624 B，已落地 `C:\ComfyUI\tools\7zr.exe`）
   按 **ComfyUI 构建时的完全相同参数**造参考归档：
   `7zr a -t7z -m0=lzma2 -mx=9 -mfb=128 -md=512m -ms=on -mf=BCJ2`
2. 测试集：8 个文件 / 42,792,390 B，含 8 MiB 高熵随机数据（逼真 512m 字典与 BCJ2 路径）、
   一个高可压缩文本文件、以及 `python_embeded/` 子目录结构（模拟便携版布局）。
3. 分别用 **Windows 自带 `tar.exe`（bsdtar 3.8.9 / libarchive 3.8.9）** 与 **`7zr.exe`** 解压，
   逐文件比对 **SHA256**。

## 结果

| 解压器 | 退出码 | 耗时 | 文件数 | 字节数 | SHA256 |
|---|---|---|---|---|---|
| `tar.exe`（bsdtar 3.8.9） | **0** | 0.15 s | 8 | 42,792,390 | **全部匹配** |
| `7zr.exe` 26.04 | **0** | 0.13 s | 8 | 42,792,390 | **全部匹配** |

**结论**：
1. **`I-002` 的 `tar -xf` 解压方法成立** —— bsdtar 能正确解开带 BCJ2 + 512 MB 字典 + 固实参数的 7z。
   `RV1-7` 提出的风险**经实测排除**。
2. **`Risk-011` 的回退提取器已验证**：`C:\ComfyUI\tools\7zr.exe`（7-Zip 26.04）可用。
3. **第三重回退**：`D:\miniconda3\python.exe -c "import py7zr"` → **1.1.3，可导入**（只读使用，
   不修改 `D:\miniconda3`）。
4. 旁证：bsdtar 亦能列出本机既有真实 7z（`node_modules.7z`、`ApplicationOntology.7z`，均 exit 0）。

## 复现命令

```powershell
# 1) 造同参数参考归档（7zr 已在 C:\ComfyUI\tools\）
cd C:\ComfyUI\_probe\extract_test\src
C:\ComfyUI\tools\7zr.exe a -t7z -m0=lzma2 -mx=9 -mfb=128 -md=512m -ms=on -mf=BCJ2 ..\ref_bcj2.7z .
# 2) 用 bsdtar 解压
tar -xf C:\ComfyUI\_probe\extract_test\ref_bcj2.7z -C <outdir>
# 3) 逐文件比对 SHA256（见本次运行的 VERDICT 输出）
```

归档副本已留存：`C:\ComfyUI\_evidence\extraction_proof_ref_bcj2.7z`（8,571,682 B）。

## 本文件记录的两次**我自己的**错误（必须登记，避免被当成结论）

- `CORR-013`: 我在第一次测试中喊出「**bsdtar 打不开这个 7z**，计划的解压方法可能是错的」。
  **该结论是错的。** 真实原因是那次运行的工件在两次调用之间已不存在（`Get-Item` 报路径不存在），
  bsdtar 面对不存在的文件自然报 `Failed to open`。**我把"文件不在"误读成了"格式不支持"。**
- `CORR-014`: 我的第一版验证脚本有 bug —— `$results[x] = (Verify ...)` 把函数内部的
  `Write-Output` 一并**捕获成返回值**，于是四个组合全部显示 `PASS`，而实际上一条
  "OK/FAIL" 明细都没有打印。**那是一组假阳性**；已改用 `Write-Host`（不被捕获）重做，
  并加上了逐文件 SHA256 比对与显式的最终判定。
  教训：**"脚本说 PASS" 必须与"能看到明细证据"同时成立才可信。**

## 对 Verifier 清单的影响

- `VC-014`（解压完整性）现有**离线可复现的前置证据**；仍须在真机上对真实便携版执行
  `tar -xf` + 关键路径断言 + `--quick-test-for-ci --cpu`，本文件不替代那一步。
- `Risk-011` 的缓解措施由"计划"升级为"已验证"。
- `I-002` 中"回退提取器"一栏由"独立 7-Zip 或 py7zr（待定）"**具体化为**
  `C:\ComfyUI\tools\7zr.exe`（首选）与 `D:\miniconda3` 的 `py7zr 1.1.3`（次选）。
