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
# VC_TRACEABILITY - Verifier 清单的可追溯性审计

Goal: `goal-86a1c096-ccc4-483f-a2bb-1eb835f77a0a`
Plan: `PLAN_v3.md`
Executed: 2026-10-16
性质：**只读审计**。本文件不新增也不删除任何验收判据，只核对"每条判据是否真的存在产生它的实现"。

## 为什么做这件事

执行过程中已发现**一个计划项在交付物里没有实现**：`I-013`（条件下载基础版 DiT）当时**没有任何脚本能下载它**
（`D-177`）。那类缺口的特征是——**计划里写着，所以看起来"已覆盖"，但没有任何东西会真正产生证据**。
本审计把同样的检查施加到全部 Verifier 判据上。

## 结论一：清单实际是 **17 条**，不是 18 条

`PLAN_v3.md` 第 335–351 行共 **17** 个 `- [ ]` 复选框：

`VC-001` `VC-002` `VC-003` `VC-004` `VC-005` `VC-006` `VC-007` `VC-008` `VC-009`
`VC-010` `VC-011` `VC-012` `VC-014` `VC-015` `VC-016` `VC-017` `VC-018`

**`VC-013` 在清单中不存在。**

### `VC-013` 是一个"幽灵条目"（计划内部不一致，已登记为缺陷）

| 位置 | 原文 | 问题 |
|---|---|---|
| `PLAN_v3.md:414` | 「新增 `I-012`/`I-013` 与 **`VC-013`**…`VC-015`」 | 声称新增了 `VC-013` |
| `PLAN_v1_reviewer_comments.md:157` | 「**新增验证项 3 条**：`VC-013`、`VC-014`、`VC-015`」 | 声称 3 条 |
| 同文件 `RV1-1`…`RV1-11` 对应表 | `VC-014`←`RV1-7`、`VC-015`←`RV1-10` | **`VC-013` 无任何来源条目** |
| 同文件 `:156` | 「新增实施项 **2 条**：`I-012`、`I-013`」 | 实施 2 条 vs 验证 3 条，数量不匹配 |

**判定**：`VC-013` 只在**变更记录的散文**里出现过 **2 次**，**从未被定义为一条判据**
（无 pass 条件、无 evidence、无 metric），且**没有任何审阅意见条目导致它产生**。
最可能的成因是编号笔误。**本审计不擅自发明 `VC-013` 的内容**——那等于凭空增加验收要求，
需走计划修订（`Amendment`）并由用户确认。

**对目标的影响**：目标原文写「`VC-001` … `VC-018` 全部勾选」。按清单实际内容，
**需要勾选的是上述 17 条**；`VC-013` 不构成一条可勾选项。
`I-013` 自身的验证**已被 `VC-003` 覆盖**（`VC-003` 的 covers 明确含 `I-013`，
判据为"已下载文件字节数 + 完整 SHA256 匹配 `E-EXT-003`，3/3 或 4/4"）。

## 结论二：17 条判据的逐条追溯

| VC | covers | 证据生产者 | 现状 |
|---|---|---|---|
| `VC-001` | `I-001` | `PREFLIGHT.md` | **已机械覆盖** ✅ |
| `VC-005` | `I-007`,`R-002`,`D-013` | `start_qwen.bat` + 低内存拒绝逻辑 | **已机械覆盖** ✅ |
| `VC-010` | `I-009`,`R-006` | `C:\ComfyUI\README_zh.md` 五节 | **已机械覆盖** ✅ |
| `VC-011` | `I-010`,`NG-001` | `P104_MIGRATION.md`（含"只写不执行"声明） | **已机械覆盖** ✅ |
| `VC-012` | `R-008` | 速度仅作数据、不得作阈值 | **已机械覆盖** ✅ |
| `VC-015` | `I-009`,`C-011` | `README_zh.md` 许可节（research / non-commercial） | **已机械覆盖** ✅ |
| `VC-004` | `I-006`,`C-010` | `scan_workflow_refs.ps1`（`V-005`）+ 加载冒烟测试 | **部分**：扫描已跑；加载冒烟待 `I-006`/`I-012` ⏳ |
| `VC-014` | `I-002` | `post_download.ps1` STEP 1b + `V-002` 日志 | 阻塞于**归档** ⏳ |
| `VC-002` | `I-003` | `post_download.ps1` STEP 3 运行时探针（`V-003`） | 阻塞于**便携版 python** ⏳ |
| `VC-003` | `I-004`,`I-005`,`I-013`,`AC-005` | `post_download.ps1` STEP 0 + `place_models.ps1`（`V-004`） | 阻塞于**权重** ⏳ |
| `VC-016` | `I-012`,`CQ1`,`CORR-009` | `I-012` Phase B A/B + `V-009` 日志行 | 阻塞于 `I-012` Phase B ⏳ |
| `VC-017` | `I-001`,`I-012`,`R-011`,`CQ3` | `B0` + `SELFTEST.md` 增量 | 阻塞于 `I-012` ⏳ |
| `VC-009` | `AC-004`,`G-002`,`R-010`,`CQ2` | `SELFTEST.md` + `measure_resources.ps1` | 阻塞于 `I-008`/`I-012` ⏳ |
| `VC-006` | `I-012`,`AC-001` | `SELFTEST.md` 阶段 0 段 + 输出 PNG | 阻塞于 `I-012` ⏳ |
| `VC-018` | `I-014`,`R-012`,`CQ4` | `I-014` UI 实跑证据 | 阻塞于 `I-014` ⏳ |
| `VC-007` | `I-014`,`AC-002` | 输入/输出 PNG + 日志 | 阻塞于 `I-014` ⏳ |
| `VC-008` | `I-014`,`AC-003`,`C-009` | 二值判定记录 | 阻塞于 `I-014` ⏳ |

**小计：已机械覆盖 6 条，部分 1 条，阻塞 10 条。合计 17 条 —— 与结论一的计数一致。**

**审计结论：17 条判据的每一条都有明确的、真实存在的证据生产者**（脚本或产物路径），
没有出现第二例"计划写了但没实现"的缺口。10 条阻塞项**均为**"需要真实运行"这一同一原因，
且每一步都有对应脚本，不是缺少实现。

## 结论三：路径口径需要明确（`README_zh.md` 有两处候选）

`VC-010`/`VC-015` 的 evidence 只写 `README_zh.md`，未写目录。实际落点：

- `C:\ComfyUI\README_zh.md` —— **存在**，是交付给用户的运行时说明（主交付物）
- 取证目录 `dsh-plans\2026-10-16-qwen-image-21-local-deploy\README_zh.md` —— **不存在**

**判定**：`VC-010`/`VC-015` 的证据取 `C:\ComfyUI\README_zh.md`。
本审计据此消除歧义，避免 `I-011` 汇总时出现"证据找不到"。

## 与 `verify_artifacts.ps1` 的关系

`verify_artifacts.ps1` 现机械覆盖上表 6 条"已机械覆盖"项，并**逐条列出** 11 条待运行项
（脚本尾部 `=== NOT checkable before ComfyUI + the weights exist ===` 段）。
本审计**不替代**该脚本：前者是"判据 → 生产者"的映射核对，后者是"生产者 → 实测"的执行核对。
