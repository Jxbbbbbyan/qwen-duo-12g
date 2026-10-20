# 历史工程记录 / Archived engineering records

本目录存放的是**项目开发过程中的内部记录**，作为历史快照保留，**不是当前使用说明**。

This directory holds **internal records from the development process**. They are kept as
historical snapshots and are **not current usage instructions**.

## 为什么单独归档 / Why these are archived separately

这三个文件原本与公开文档放在一起，但它们：

1. 写作对象是项目内部（含阶段编号、验收矩阵、计划修订历史）；
2. 记录的是**当时的**状态，其中一些结论**已被后续实测推翻或超越**；
3. 引用了若干只在开发机上存在的文件。

因此它们被移到这里，并加上时间与状态说明，避免被误读为"当前结论"。

These three files were originally mixed in with the public documentation, but they:

1. were written for an internal audience (stage numbers, acceptance matrices, plan revisions);
2. record the state **at that time**, and some conclusions have since been **superseded** by later measurement;
3. reference files that only exist on the development machine.

They are therefore archived here with explicit date and status notes, so they cannot be mistaken
for current conclusions.

## 文件清单 / Inventory

| 文件 / File | 内容 / Content | 状态 / Status |
|---|---|---|
| `PLAN_v3.md` | 最初的工程计划第 3 版：目标拆解、阶段划分、风险与验收项 | **历史计划**。其数字以 `docs/EVIDENCE.md` 的实测为准。 |
| `EXECUTION_STATUS.md` | 执行过程中的状态日记：逐阶段推进记录 | **历史日记**。文中早中期的"进行中/待完成"表述已被后续完成的工作超越，**请勿据此判断当前状态**。 |
| `VC_TRACEABILITY.md` | 验收项（VC）到证据的追溯矩阵 | **历史矩阵**。当前可用的证据汇总见 `docs/EVIDENCE.md`。 |

## 当前有效的公开文档 / Current public documents

| 文件 / File | 用途 / Purpose |
|---|---|
| [`../EVIDENCE.md`](../EVIDENCE.md) | **全部实测数字的出处**，本仓库性能声明的唯一依据 |
| [`../PREFLIGHT.md`](../PREFLIGHT.md) | 部署前的机器预检清单与结论 |
| [`../OOM_MITIGATION.md`](../OOM_MITIGATION.md) | 显存不足时的缓解阶梯（排查指南） |
| [`../VERIFY_EXTRACTION.md`](../VERIFY_EXTRACTION.md) | 模型包解压与校验的注意事项 |
| [`../LONGPATH_PROOF.md`](../LONGPATH_PROOF.md) | Windows 长路径限制的实证记录 |

## 阅读建议 / How to read these

如果你只想把这个系统跑起来，**不需要读本目录**。

如果你想知道"为什么当初这么设计"，可以读；但请始终以 `docs/EVIDENCE.md` 中的实测数字为准，
并注意本文档中的日期与状态标注。

If you just want to run the system, **you do not need this directory**.

If you want the design rationale, these are useful — but always treat the measurements in
`docs/EVIDENCE.md` as authoritative, and pay attention to the date and status notes above.
