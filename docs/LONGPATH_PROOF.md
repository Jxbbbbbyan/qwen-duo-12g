> **记录说明 / Note.** 本文是开发期的记录，其中提到的部分探针脚本与私有目录**不在本仓库内**。
> 它用于说明当时的判断依据，不是可直接照做的操作手册；对外复现请以
> [`README.md`](../README.md) 的快速开始与 [`EVIDENCE.md`](EVIDENCE.md) 为准。
>
> This is a development-time record. Some probe scripts and private directories it mentions are
> **not part of this repository**. It documents the reasoning of that moment rather than a
> copy-and-run procedure; for public reproduction use the README quick start and `EVIDENCE.md`.

---
# LONGPATH_PROOF - 长路径（MAX_PATH / `LongPathsEnabled=0`）风险实测排除

Goal: `goal-86a1c096-ccc4-483f-a2bb-1eb835f77a0a`
Plan: `PLAN_v3.md`
Executed: 2026-10-16
性质：**离线、可复现**。不依赖下载，不需要网络即可重跑。
探针：`C:\ComfyUI\_probe\longpath\_lpt_probe.ps1`

## 为什么做这件事

计划中的 `C-012` 记录本机 **`LongPathsEnabled = 0`**（实测确认，见文末），而
`post_download.ps1` 第 154–155 行据此写道：

> "This machine has LongPathsEnabled = 0 (C-012), and the portable contains deep
> `python_embeded\Lib\site-packages\...` paths, so a partial extraction is a live possibility."

`VERIFY_EXTRACTION.md` 虽然已证明 `tar`/`7zr` 能解 **768m 字典 + BCJ2 + 固实** 的 7z，
但**测试集只有 12 个浅路径文件**。真实归档是 2 GB 的 `python_embeded` 树。
于是留下一个**会在多日下载结束之后才暴露**的失败模式：

- 超长路径的成员**报错失败**（`tar` 退出码非 0 ⇒ 现有守卫能抓到），还是
- **被静默截断**（守卫永不触发 ⇒ 树悄悄残缺，只在很久之后才被发现）？

`post_download.ps1` 的 STEP 1b 树断言**只检查 `python.exe` 与 `main.py` 是否存在**（浅路径），
它**不会**发现深路径成员缺失。所以这个问题必须实测。

## 方法

1. 在 `D:\_lpt\src\` 下用 `\\?\` 前缀构造 **5 个不同相对长度**的成员
   （`ComfyUI_windows_portable\python_embeded\Lib\site-packages\<n×'dddddddd'>\f.txt`）：

   | n | 归档内相对路径长度 |
   |---|---|
   | 16 | 207 |
   | 18 | 225 |
   | 20 | 243 |
   | 22 | 261 |
   | 24 | 279 |

2. 用**与 `stable-release.yml` 完全相同的参数**打包：
   `7zr a -t7z -m0=lzma2 -mx=9 -mfb=128 -md=768m -ms=on -mf=BCJ2`
3. 解压到**长度被扫描的目标前缀**（`D:\` + k 个 `p`，k ∈ {0,12,14,16,20,30}，
   即 destLen ∈ {3,15,17,19,23,33}），使 `destLen + 1 + 相对长度` **跨越 260**。
4. 分别用 `tar.exe`（bsdtar 3.8.9）与 `7zr.exe` 26.04 解压，
   逐成员用 `[System.IO.File]::Exists('\\?\' + 绝对路径)` 判定是否真的落盘；
   同时记录退出码与错误行数。

**关键设计**：目标前缀被扫描，而**不是**依赖源路径很长——这样源文件始终可创建，
而"解压后绝对路径超限"这一真实情形可以被精确制造出来。

## 结果

两个解压器 × 6 个目标前缀 × 5 个成员 = **60 个组合，全部命中，退出码全为 0，错误行全为 0**：

| 工具 | destLen | 退出码 | 落盘 |
|---|---|---|---|
| `tar.exe` | 3 / 15 / 17 / 19 / 23 / 33 | 0（全部） | **5/5（全部）** |
| `7zr.exe` 26.04 | 3 / 15 / 17 / 19 / 23 / 33 | 0（全部） | **5/5（全部）** |

最大绝对路径长度 = `33 + 1 + 279` = **313 字符**，远超声称的 260 上限，**仍然完整创建**。

### 补充：PowerShell 自身对长路径的能力（实测）

用 `\\?\` 创建一个绝对长度 **276** 的文件，然后**不带**前缀地去访问：

| 访问方式 | 结果 |
|---|---|
| `[System.IO.File]::Exists(纯路径)` | **True** |
| `Test-Path -LiteralPath (纯路径)` | **True** |
| `Get-ChildItem -Recurse`（从顶层） | **count = 1（找到了深处那个文件）** |
| `[System.IO.Directory]::GetFiles(..., AllDirectories)` | **count = 1** |

## 结论

1. **`LongPathsEnabled = 0` 对本部署不构成风险。** `tar`、`7zr` 与 **PowerShell 7 自身**
   三者都能在**不借助 `\\?\` 前缀**的情况下读写、枚举超过 260 的路径。
   原因：`libarchive` 与 7-Zip 在 Windows 上内部就走 `\\?\`；而 PowerShell 7 运行在
   自带长路径支持的 .NET 上，该注册表开关只约束**未声明长路径感知**的程序。
2. **`C-012` 的担忧被实测推翻**，`post_download.ps1` 第 154–155 行的"partial extraction is a
   live possibility"**不是本机的真实风险**。（该守卫**保留**——它是零成本的纵深防御，
   且对**其它**可能的失败模式仍然有效。）
3. **`VC-014` 的已知失败模式清单**因此可以去掉"长路径截断"一项；
   解压环节的残余风险回到"归档本身损坏"，而那一项由
   `E-EXT-003` 的字节数 + STEP 0b 的 7z 起始头 CRC32 事先覆盖。

## 本文件记录的两次**我自己的**探针错误（必须登记）

- `CORR-023`: 探针 v1 把**同一个 `$lp`（指向文件的路径）先传给 `CreateDirectory`**，
  于是该路径上建出的是**目录**，紧接着 `WriteAllText` 写同一个路径自然报
  **"Access to the path ... is denied."**
  我最初把它读成"沙箱拒绝 `\\?\` 前缀"——**那是错的**。单独诊断后，`\\?\` 的
  短路径写入/读取/建目录/枚举**六项全部 OK**。**是探针写错了，不是环境。**
- `CORR-024`: 探针 v2 构造目录链时**漏掉了 `root\` 这一层**，导致文件路径指向不存在的目录
  （`Could not find a part of the path`），且绝对长度只有 240——**既没建成文件，也没测到超限情形**。
  两次都属于同一模式：**报告"环境不支持"之前，必须先证明探针本身是有效的**
  （即先有正向对照）。这与 `CORR-014` / `CORR-019` / `CORR-020` / `CORR-022` 同源。

## 本机实测的 `LongPathsEnabled`

```text
HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 0
```

（保留在此以说明"注册表为 0"与"实际能用长路径"**并不矛盾**。）
