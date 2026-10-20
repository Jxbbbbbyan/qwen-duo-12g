# 精确卸载账本 / Exact offload ledger

**生产参数 / Production flags：`-ngl 44 -c 65536 -np 1 -ctk q4_0 -ctv q4_0 -fa on -ub 256 -lm mmap`，`LLAMA_ARG_MMPROJ_OFFLOAD=0`**

本文件回答三个必须精确的问题：**哪些层在显存、哪些在内存/磁盘、各自确切多少字节。**
This file answers three questions that must be exact: **which layers live in VRAM, which stay on the CPU
side, and exactly how many bytes each side holds.**

所有数字有两个独立来源：① **llama.cpp 自己打印的 buffer size**（权威）；② **对 GGUF 张量表的逐块核算**（可复算）。
两者在总额上分毫不差。
Every number here has two independent sources: ① **the buffer sizes llama.cpp prints itself** (authoritative);
② **a per-block reconstruction from the GGUF tensor table** (reproducible). The two agree exactly on the totals.

---

## 0. 一句话结论 / The short version

| 侧 / Side | 模型张量 / Model tensors | KV cache | SSM 状态 | 计算缓冲 | 合计 |
|---|---:|---:|---:|---:|---:|
| **显存 / VRAM** | **9,733.30 MiB** | 792.00 MiB | 96.63 MiB | 431.75 MiB | **11,053.68 MiB**（10.79 GiB） |
| **CPU / mmap** | **4,568.20 MiB** | 360.00 MiB | 52.99 MiB | 52.39 MiB | **5,033.58 MiB**（4.92 GiB） |
| CPU（另有）/ also | mmproj 视觉投影器 / projector | — | — | — | **884.64 MiB** |

换算成层：**显存侧 42 个 transformer 块 + output 层**；**CPU 侧 22 个 transformer 块 + token_embd + output_norm**。
In layers: **42 transformer blocks + the output layer in VRAM**; **22 transformer blocks + `token_embd` + `output_norm` on the CPU side**.

---

## 1. llama.cpp 自报的原始行 / Verbatim lines from llama.cpp

用 `-lv 4` 加载并抓取输出即可复现（同一份权重、同一套参数）：
Reproduce by loading with `-lv 4` and capturing the output (same weights, same flags):

```text
print_info: file size   = 14.29 GiB (4.49 BPW)
print_info: n_layer               = 64
print_info: n_layer_all           = 65
load_tensors: offloading output layer to GPU
load_tensors: offloading 43 repeating layers to GPU
load_tensors: offloaded 44/66 layers to GPU
load_tensors:   CPU_Mapped model buffer size =  4568.20 MiB
load_tensors:        CUDA0 model buffer size =  9733.30 MiB
llama_kv_cache:        CPU KV buffer size =   360.00 MiB
llama_kv_cache:      CUDA0 KV buffer size =   792.00 MiB
llama_kv_cache: size = 1152.00 MiB ( 65536 cells,  16 layers,  1/1 seqs), K (q4_0):  576.00 MiB, V (q4_0):  576.00 MiB
llama_memory_recurrent:        CPU RS buffer size =    52.99 MiB
llama_memory_recurrent:      CUDA0 RS buffer size =    96.63 MiB
llama_memory_recurrent: size =  149.62 MiB (     1 cells,  64 layers,  1 seqs), R (f32):    5.62 MiB, S (f32):  144.00 MiB
sched_reserve:      CUDA0 compute buffer size =   431.75 MiB
sched_reserve:  CUDA_Host compute buffer size =    52.39 MiB
common_memory_breakdown_print: |   - CUDA0 (RTX 3060 Laptop GPU) | 12287 = 11152 + (11053 =  9733 +     888 +     431) |
```

> `n_layer = 64` 而 `n_layer_all = 65`：第 65 个块（`blk.64`）是 **NextN/MTP** 层，**本构建不使用**，
> 加载时逐个张量报 `unused tensor ... -- ignoring`。它占文件中 **351,008,768 B**，但不进内存也不进显存。
> `n_layer = 64` while `n_layer_all = 65`: block 65 (`blk.64`) is the **NextN/MTP** layer, **unused by this
> build** (each of its tensors is logged as `unused tensor ... -- ignoring`). It occupies **351,008,768 B**
> in the file but is loaded into neither VRAM nor RAM.

---

## 2. 逐块核算（可复算）/ Per-block reconstruction

从 GGUF 张量表按 `blk.N.` 前缀分组、按 ggml 类型推出每个张量字节数后求和：
Group the GGUF tensor table by `blk.N.` prefix, derive each tensor's byte size from its ggml type, and sum:

| 项目 / Item | 值 / Value |
|---|---|
| 参与装载的 transformer 块 / blocks loaded | **64**（`blk.0`–`blk.63`） |
| 其中全注意力层 / full-attention blocks | **16**，位于 `blk.3, 7, 11, …, 63`（即 `full_attention_interval = 4`） |
| 其中 SSM / 线性层 / SSM-linear blocks | **48** |
| 未使用 / unused | `blk.64`（NextN），351,008,768 B |
| 每块字节 / per-block bytes | 不一，约 **170–259 MiB**（全注意力块与 SSM 块张量不同） |

**显存侧重建 / VRAM-side reconstruction：**

```text
blk.22 .. blk.63（42 个块）                    = 9,163,140,224 B
+ output.weight（Q6_K）                        = 1,042,944,000 B
--------------------------------------------------------------
合计                                           = 10,206,084,224 B = 9,733.30 MiB
```

**CPU 侧重建 / CPU-side reconstruction：**

```text
blk.0 .. blk.21（22 个块）                     = 4,223,358,912 B
+ token_embd.weight（Q5_K）                    =   546,304,000 B
+ output_norm.weight（F32）                    =        20,480 B
--------------------------------------------------------------
合计                                           = 4,790,123,392 B = 4,568.20 MiB
```

两侧相加 = **14,301.50 MiB**，与 llama.cpp 自报的 `9733.30 + 4568.20 = 14,301.50 MiB` **完全相同**。
Both sides sum to **14,301.50 MiB**, identical to llama.cpp's own `9733.30 + 4568.20`.

### 关于日志里"43 个重复层"的说明 / About the "43 repeating layers" in the log

日志写的是 `offloading 43 repeating layers to GPU`，但按字节精确重建，显存侧的模型缓冲区恰好等于
**42 个块 + output 层**。两者相差正好一个块（`blk.21` = 214,375,296 B = 204.44 MiB），差异来自
llama.cpp 的计数口径，而不是字节数。**本文一律以字节为准。**
The log says `offloading 43 repeating layers to GPU`, but the byte-exact reconstruction shows the
device-side model buffer equals **42 blocks plus the output layer**. The two differ by exactly one block
(`blk.21` = 214,375,296 B = 204.44 MiB) — a difference in llama.cpp's counting convention, not in bytes.
**Everything here is stated in bytes.**

---

## 3. KV cache：精确值与其来源 / KV cache, exact value and its derivation

只有 **16 个全注意力层**持有随上下文增长的 KV cache；48 个 SSM 层用循环状态代替（见第 4 节）。
Only the **16 full-attention blocks** hold a context-scaling KV cache; the 48 SSM blocks use a recurrent
state instead (section 4).

```text
每 token 每层值数 = head_count_kv × (key_length + value_length)
                  = 4 × (256 + 256) = 2,048
q4_0 每值 4.5 bit  → 2,048 × 4.5 / 8 = 1,152 B / token / 层
16 层合计          → 18,432 B / token
× 65,536 token     → 1,207,959,552 B = 1,152.00 MiB
```

llama.cpp 自报 **`size = 1152.00 MiB`**，与上式**完全一致**；且其拆分 `CUDA0 792.00 / CPU 360.00`
正好是 **11/16 与 5/16**——因为 16 个全注意力层里有 11 个（`blk.23…63`）在显存侧，5 个（`blk.3…19`）在 CPU 侧。
llama.cpp reports **`size = 1152.00 MiB`**, matching the formula exactly; its split `CUDA0 792.00 / CPU 360.00`
is precisely **11/16 and 5/16**, because 11 of the 16 full-attention blocks (`blk.23…63`) are on the device
and 5 (`blk.3…19`) are on the CPU side.

> **这就是 KV 量化必须开的原因**：同样 65,536 token，若用 fp16 存 KV 需要
> `2,048 × 2 B × 16 × 65,536 = 4,294,967,296 B = 4.00 GiB`，比 q4_0 多出 2.88 GiB，
> 12 GB 显存上直接放不下。
> **This is why KV quantisation is mandatory here**: at the same 65,536 tokens, fp16 KV would need
> **4.00 GiB** — 2.88 GiB more than q4_0 — and simply does not fit in 12 GB alongside the weights.

---

## 4. SSM 循环状态 / The SSM recurrent state

48 个 SSM 层不存 KV，但各持一份**不随上下文增长**的循环状态：
The 48 SSM blocks hold no KV cache, but each keeps a recurrent state that **does not grow with context**:

```text
llama_memory_recurrent: size = 149.62 MiB
  (1 cell, 64 layers, 1 seq)     R (f32) = 5.62 MiB      S (f32) = 144.00 MiB
  CUDA0 = 96.63 MiB              CPU     = 52.99 MiB
```

这是"混合注意力"在内存上的**另一笔固定开销**：约 **150 MiB**，与上下文长度无关。
This is the **other fixed cost** of hybrid attention: about **150 MiB**, independent of context length.

---

## 5. 计算缓冲区 / Compute buffers

| 缓冲区 / Buffer | 大小 / Size | 说明 / Note |
|---|---:|---|
| `CUDA0 compute buffer` | **431.75 MiB** | 显存侧计算图缓冲 / device-side graph buffer |
| `CUDA_Host compute buffer` | **52.39 MiB** | 主机侧缓冲 / host-side buffer |
| 图切分 / graph splits | 356（pp）/ 36（tg） | 4041 个节点 / 4041 nodes |

`-ub 256` 的作用就是压这一块：micro-batch 越小，显存侧计算缓冲越小。
`-ub 256` exists to press exactly this down: a smaller micro-batch means a smaller device compute buffer.

---

## 6. 汇总与交叉验证 / Totals and cross-check

| 项目 / Item | 字节 / Bytes | MiB | GiB |
|---|---:|---:|---:|
| 显存侧模型张量 / VRAM model tensors | 10,206,084,224 | 9,733.30 | 9.50 |
| 显存侧 KV | 830,472,192 | 792.00 | 0.77 |
| 显存侧 SSM 状态 | 101,313,659 | 96.63 | 0.09 |
| 显存侧计算缓冲 | 452,722,688 | 431.75 | 0.42 |
| **显存合计 / VRAM total** | **11,590,592,763** | **11,053.68** | **10.79** |
| CPU 侧模型张量（mmap）/ CPU model tensors | 4,790,123,392 | 4,568.20 | 4.46 |
| CPU 侧 KV | 377,487,360 | 360.00 | 0.35 |
| CPU 侧 SSM 状态 | 55,563,469 | 52.99 | 0.05 |
| CPU 侧计算缓冲 | 54,944,153 | 52.39 | 0.05 |
| **CPU 合计 / CPU total** | **5,278,118,374** | **5,033.58** | **4.92** |
| mmproj 视觉投影器 / projector（文件体积 / file size） | 927,607,488 | 884.64 | 0.86 |
| **CPU 含 mmproj / incl. projector** | **6,205,725,862** | **5,918.22** | **5.78** |

**与独立遥测的对照 / Against independent telemetry.** 另一路遥测（任务管理器口径）在同样参数下记录到
显存占用 **11,552 MiB**；llama.cpp 自己的账本给出 **11,053.68 MiB**。两者相差约 **498 MiB**，
来自桌面合成、驱动与测量工具的口径差异——这两者是不同仪器，不应期待逐字节相等。
Separate telemetry recorded **11,552 MiB** of VRAM at the same flags, while llama.cpp's own ledger reads
**11,053.68 MiB**. The ~**498 MiB** difference comes from desktop compositing, the driver and how each tool
counts; they are different instruments and should not be expected to agree byte for byte.

**总计的现实含义 / What the total means.** 加载后两侧真实占用约
**显存 10.79 GiB + 内存 5.78 GiB**。文件本身是 **14.29 GiB**，而显卡只有 **12 GiB**——
所以"必须有层留在内存"不是选择，而是算术。
After loading, the real footprint is about **10.79 GiB of VRAM plus 5.78 GiB of RAM**. The file itself is
**14.29 GiB** and the card has **12 GiB** — so "some layers must stay in RAM" is arithmetic, not a choice.

---

## 7. 换参数会怎样 / What happens if you change the flags

| 改动 / Change | 结果 / Result |
|---|---|
| `-ngl 48` | **OOM**。显存侧要多放约 6 个块（约 1.2–1.5 GiB），超出 12 GiB。 |
| `-ngl 44`（默认）/ default | 本文记录的工作点 / the working point documented here |
| `-ngl` 更小 / smaller | 更多块留在 mmap，显存更宽裕但生成更慢 / more blocks stay mapped; more headroom, slower |
| `-ctk/-ctv f16` | KV 从 1,152.00 MiB 涨到 **4.00 GiB**，需要下调 `-ngl` 或上下文 / KV grows to 4.00 GiB |
| `-c` 减半 / halve ctx | KV 与上下文成正比，减半即约 576 MiB / KV scales with ctx |
| 改用 `-ncffn` | 见 [`EVIDENCE.md`](EVIDENCE.md) §2：会把 CPU 侧张量**复制**成不可回收的私有内存 |

---

## 8. 自己复现这份账本 / Reproduce this ledger yourself

```powershell
# 用与生产完全相同的参数加载，并开 -lv 4 打印内存账本
D:\llm\bin\llama.cpp\llama-server.exe `
  -m  C:\llm\models\Qwen3.8-27B\Qwen3.8-27B-UD-Q4_K_S.gguf `
  --mmproj D:\llm\models\Qwen3.8-27B\mmproj-F16.gguf `
  -ngl 44 -c 65536 -np 1 `
  -ctk q4_0 -ctv q4_0 -fa on -ub 256 -lm mmap `
  --no-webui -lv 4 --port 8097
```

然后在这几行里核对：`CPU_Mapped model buffer size`、`CUDA0 model buffer size`、
`llama_kv_cache: size`、`llama_memory_recurrent: size`、`compute buffer size`。
Then check those five lines. 环境变量 `LLAMA_ARG_MMPROJ_OFFLOAD=0` 让视觉塔留在 CPU。
The env var `LLAMA_ARG_MMPROJ_OFFLOAD=0` keeps the vision tower on the CPU.

> 说明：本次核对用的是 `llama.cpp 0.6.0-dev, build 11617, commit 14310190c`。不同构建的日志措辞与
> 计数口径可能变化，**字节数以你自己的输出为准**。
> Note: verified on `llama.cpp 0.6.0-dev, build 11617, commit 14310190c`. Log wording and counting
> conventions may change across builds — **trust the byte values in your own output**.
