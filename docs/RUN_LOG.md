# 一次真实运行的时间线 / A real run, timestamped

本文件不是示意图，而是**本机总控台日志的一段原始摘录**（`orchestrator.log`），
用来说明"提交任务 → 拿到图"到底花在哪里。

This is not a diagram. It is a **verbatim excerpt of this machine's own console log** (`orchestrator.log`),
showing where the wall time actually goes.

---

## 为什么需要这一页 / Why this page exists

README 里写着"1080p 出图约 88 秒"。这个数字**只覆盖出图那一段**。
一次完整运行还要加上提示词生成、两次进程启停、以及**重新装载模型**的时间。
下面这次运行总共 **6 分 41 秒**。

The README says "1080p render ~88 s". That figure covers **the render stage only**. A full run also pays for
prompt authoring, two process stop/start cycles, and **reloading a model**. The run below took **6 min 41 s** in total.

---

## 本次运行 / This run

参考图模式（上传一张图 + 一句指令），输出 1920×1088。
Reference-image mode (one uploaded image plus one instruction), output 1920×1088.

| 时刻 / Time | 阶段 / Stage | 耗时 / Δ |
|---|---|---:|
| `14:21:48` | **流程开始**（带参考图）/ run start | — |
| `14:21:48` | ① Qwen3.8 看图 + 写提示词 / read image, author prompt | **217 s** |
| `14:25:25` | 提示词产出，**785 字符** / prompt produced (785 chars) | |
| `14:25:25` | ② 终止 Qwen3.8 / terminate the LLM | **5 s** |
| `14:25:30` | Qwen3.8 已停止，显存释放 / stopped, VRAM released | |
| `14:25:30` | ③ ComfyUI 接管 / ComfyUI takes over | **22 s** |
| `14:25:52` | ComfyUI 就绪，上传参考图 / ready, reference uploaded | |
| `14:25:52` | 提交出图 1920×1088 / submit render | **80 s** |
| `14:27:12` | ④ 出图完成 / image written | |
| `14:27:12` | ⑤ 终止 ComfyUI / terminate ComfyUI | **6 s** |
| `14:27:18` | ComfyUI 已停止 / stopped | |
| `14:27:18` | ⑥ 重新装载 Qwen3.8 / reload the LLM | **71 s** |
| `14:28:29` | Qwen3.8 就绪，**流程结束** / ready, run ends | |
| | **合计 / Total** | **401 s ≈ 6 min 41 s** |

### 原始日志摘录 / Verbatim log excerpt

```text
[14:21:48] ==== 流程开始 ====（带参考图）
[14:21:48] ① 让 Qwen3.8 看图并写提示词…
[14:25:25] （本次没有产生思考链——思考等级为 off，或该请求被模板跳过）
[14:25:25] ──── 【Qwen3.8 输出·提示词】 ────
[14:25:25]   📝 An anime-style female character with short pink hair and green eyes, smiling gently,
            standing outdoors in a sunlit forest setting …
            （此处省略提示词正文，全文共 785 字符）
[14:25:25] ──── 【输出结束】 共 785 字符 ────
[14:25:25] 提示词(785 字符) 已生成并落盘
[14:25:25] ② Qwen3.8 退出
[14:25:25] 停止 Qwen3.8，释放显存…
[14:25:27] Qwen3.8 进程退出 code=1
[14:25:30] Qwen3.8 已停止
[14:25:30] ③ ComfyUI 接管
[14:25:30] 启动 ComfyUI / Qwen-Image 2.1…
[14:25:52] ComfyUI 就绪
[14:25:52] 参考图已上传: ref_1792419952624.png
[14:25:52] 提交出图 1920x1088 seed=1418591100 (参考图 ref_1792419952624.png)
[14:25:52] prompt_id = 47c5e67d-e81c-41c0-a8f4-de8b41d92e0b，等待出图…
[14:27:12] ④ 出图完成 -> <桌面路径已隐去>
[14:27:12] ⑤ ComfyUI 退出
[14:27:12] 停止 ComfyUI…
[14:27:13] ComfyUI 进程退出 code=1
[14:27:18] ComfyUI 已停止
[14:27:18] ⑥ 重新拉起 Qwen3.8
[14:27:18] 启动 Qwen3.8 (llama-server)…
[14:28:29] Qwen3.8 就绪
[14:28:29] ==== 流程结束 ====
```

> `code=1` 是 Windows 上 `/F` 强制终止的正常表现，不是错误码（见 `orchestrator.mjs` 的 `killTree`）。
> 桌面输出路径已隐去，避免暴露个人信息。提示词正文只保留开头，理由同上。

---

## 从这个时间线能读出的三件事 / Three things this tells you

1. **"88 秒"是出图段，不是总时长。** 本次出图 80 秒，但整轮 401 秒——**约 4/5 的时间不在出图上**。
   **The "88 s" is the render stage, not the total.** Render took 80 s here, but the round took 401 s —
   roughly **four fifths of the time is not rendering**.
2. **提示词生成（217 s）是本机最慢的一段。** 约 4 tok/s 的生成速度直接决定它；这也是为什么默认把
   思考等级设为 `off`（思考链会和正式回答抢同一份 token 预算）。
   **Prompt authoring (217 s) is the slowest stage here**, driven directly by ~4 tok/s. That is exactly why
   the thinking level defaults to `off` (the reasoning chain competes for the same token budget).
3. **模型换回来的代价是 71 秒。** 如果你只是要对话，用纯对话总控台（8091）长期驻留，
   不要每轮都付这笔钱。
   **Reloading the LLM costs 71 s.** If you only want to chat, use the resident chat console (8091) instead of
   paying this on every round.

---

## 另一轮：模型直接拒绝了 / Another run: the model refused

同一份日志里的另一轮（`14:57:16` → `15:03:26`），给了一张与裸露相关的参考图，模型的回答是：

```text
[15:00:21] ──── 【Qwen3.8 输出·提示词】 ────
[15:00:21]   📝 I can't fulfill that request. The image depicts nudity, which I can't engage with.
            I can help create a prompt for a new, appropriate image based on the color you mentioned
            if you'd like.
[15:00:21] ──── 【输出结束】 共 186 字符 ────
```

这条记录是 README 中"**本地部署不会移除模型的安全对齐**"这一条的直接证据：对齐在权重里，
本地运行不会让它消失。本项目不提供规避手段。

This excerpt is direct evidence for the README claim that **local deployment does not remove the model's
safety alignment**: the alignment lives in the weights and does not disappear when you run locally.
This project provides no way around it.

---

## 如何得到你自己的可比数字 / Getting your own comparable numbers

总控台默认把每一轮写进 `C:\ComfyUI\logs\orchestrator.log`。跑一轮之后按上面的阶段标记取时间即可。
比对时请同时核对 [`MODELS.md`](MODELS.md) 里的文件哈希与启动参数，否则数字不可比。

The console appends every round to `C:\ComfyUI\logs\orchestrator.log`. Run one round and read the stage
markers. When comparing, also check the file hashes and flags in [`MODELS.md`](MODELS.md) — otherwise the
numbers are not comparable.
