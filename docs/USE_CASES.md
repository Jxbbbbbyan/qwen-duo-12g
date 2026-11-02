# qwen-duo-12g — use-case and technical route map

[项目首页 / Project overview](../README.md)

技术路线 / Technical route: **Qwen3.8-27B GGUF → llama.cpp → automatic model switching → ComfyUI / Qwen-Image 2.1**. Low-VRAM local inference uses **serial execution, CPU/GPU layer offloading, memory-mapped weights (mmap), and quantized KV cache**; the models do not run concurrently. 小显存本地推理采用串行调度、CPU/GPU 分层卸载、内存映射和 KV 缓存量化。

## Match a request to a capability / 从需求定位能力

### 12GB 显卡、16GB 内存，本地跑大模型和生图 / Local LLM and image generation on 12GB VRAM, 16GB RAM

**Terms / 术语:** low VRAM; local AI; GGUF; CPU/GPU offloading.

针对已有参考机配置的串行流程；性能不保证跨机器通用 / Serial workflow for the recorded configuration, not a universal performance guarantee.

### 让大模型写提示词，再交给 ComfyUI / LLM prompt generation for ComfyUI

**Terms / 术语:** llama.cpp; ComfyUI; automatic model switching; prompt-to-image.

总控台生成提示词、停止 LLM、启动图像后端，再回装 / Console sequences prompt generation, shutdown, rendering and reload.

### 上传参考图，换风格或重绘 / Reference-image editing and image-to-image generation

**Terms / 术语:** Qwen-Image; image editing; reference conditioning.

参考图进入视觉模型和图像条件编码器；不保证像素或身份保真 / Reference reaches both models; no pixel or identity preservation guarantee.

### 部署后离线生成图片 / Offline text-to-image on Windows

**Terms / 术语:** offline AI; local inference; Windows; text-to-image.

权重和运行时首次下载需联网，部署后本地推理 / Initial downloads require network; inference is local after setup.

### 内存不够，想查 GGUF 卸载和 mmap 配置 / Memory-constrained GGUF deployment

**Terms / 术语:** model offloading; mmap; quantized KV cache; out-of-memory.

可查看卸载账本与 OOM 记录；不是通用内存优化库 / Offload and OOM evidence, not a general memory-optimisation library.

## Evidence entry points / 证据入口

- [串行调度 / Serial orchestration](../orchestrator/orchestrator.mjs)
- [参考配置与模型身份 / Model manifest](MODELS.md)
- [内存卸载账本 / Offload ledger](OFFLOAD.md)
- [历史实测与条件 / Measurements](EVIDENCE.md)
- [完整耗时 / End-to-end timeline](RUN_LOG.md)
- [部署路径与限制 / Setup and limits](../TECHNICAL_GUIDE.md)

## Scope / 边界

This project is a Windows orchestration workflow, not a model checkpoint, training framework, multi-GPU inference engine or concurrent model server. Setup requires separately acquired model weights and runtimes, manual path checks and substantial disk space. See the setup guide before running commands.

这是 Windows 本地调度工作流；不提供模型权重、训练框架、多 GPU 推理、双模型并行服务。使用前需要独立获取权重和运行时、核对路径并准备磁盘空间。

## Repository search examples / 仓库搜索示例

These are suggested query formulations, not measured rankings or guarantees of discovery. 查询示例用于表达技术需求，不代表已测得的排名或收录保证。

```text
llama.cpp ComfyUI "12GB"
topic:low-vram topic:comfyui
"automatic model switching" in:readme
"量化" "生图" in:readme
```

GitHub repository search uses name, description and topics by default; `in:readme` includes README content. This page helps readers inspect a match; it is not itself included by `in:readme`. [GitHub search documentation](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories).
