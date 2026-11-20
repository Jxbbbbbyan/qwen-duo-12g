# Inventory

Packaged means the file is inside the skill folder that the ZIP builds. Invoked means a packaged script runs it. Local-only means the file stays in the source checkout and is not a marketplace script.

| Path | Role | Disposition |
| --- | --- | --- |
| README.md | Human overview | Local-only. Not a second copy of the skill instructions. |
| TECHNICAL_GUIDE.md | Human install, limits, and historical paths | Local-only. Reference-machine paths are not copied into the skill. |
| LICENSE | MIT for this repository's code and docs | Packaged as LICENSE. Does not cover model weights. |
| .gitignore, .gitattributes | Repository hygiene | Not packaged. |
| docs/MODELS.md | Names, bytes, SHA-256, runtime | Local-only. Facts the agent needs are restated in prerequisites. |
| docs/EVIDENCE.md | Measurement record | Local-only. Not re-measured here. |
| docs/OFFLOAD.md | Memory ledger | Local-only. |
| docs/OOM_MITIGATION.md | Troubleshooting notes | Local-only. |
| docs/PREFLIGHT.md | Old development preflight record | Local-only. Not the packaged script. |
| docs/RUN_LOG.md | One historical timeline | Local-only. |
| docs/USE_CASES.md | Human use-case map | Local-only. |
| docs/VERIFY_EXTRACTION.md | Archive extraction notes | Local-only. |
| docs/LONGPATH_PROOF.md | Long-path notes | Local-only. |
| docs/archive/ | Historical plans | Local-only. Not current behavior. |
| orchestrator/orchestrator.mjs | Image console and one-shot CLI | Local full program. Not packaged. Symbols: startLlama, stopLlama, startComfy, stopComfy, writePrompt, uploadImage, buildGraph, render, deliverImage, runFlow. |
| orchestrator/ui.html | Browser UI for the console | Local-only. The CLI does not need it. The packaged flow does not start the server. |
| orchestrator/launch.ps1, start-orchestrator.ps1, qwen-console.cmd | Reference-machine launchers with fixed paths | Local-only. Not relocated by the skill. |
| orchestrator/chat-console.mjs, chat-ui.html, chat-launch.ps1, chat-console.cmd | Chat console on another port | Local-only. Must not run beside an image pass. It can reuse a healthy llama server; the image CLI does not adopt one. |
| comfyui/scripts/stage0_scaffold_api.json | Default graph the local CLI loads | Local-only. User may point config `graph` at it. Not read by packaged scripts unless that user path is set. |
| comfyui/scripts/stage0_scaffold_api_cacheoff.json | Alternate graph | Local-only. Not the default. |
| comfyui/scripts/fetch_comfy.ps1 | Downloads the portable ComfyUI archive | Not invoked. Download permission is unknown. |
| comfyui/scripts/fetch_models.ps1 | Downloads image weights; `-ListOnly` prints the manifest | Not invoked. |
| comfyui/scripts/fetch_patcher.ps1 | Downloads a patched driver package | Not invoked. |
| comfyui/scripts/place_models.ps1 | Copies weights into the portable tree | Not invoked. |
| comfyui/scripts/install_workflows.ps1 | Installs upstream workflow JSON | Not invoked. |
| comfyui/scripts/post_download.ps1 | Extract and smoke sequence | Not invoked. |
| comfyui/scripts/post_boot_resume.ps1 | Startup resume of downloads | Not invoked. |
| comfyui/scripts/advance_pipeline.ps1 | Deployment stage advancer | Not invoked. |
| comfyui/scripts/derive_inpaint.ps1 | Builds an inpaint workflow | Not invoked. |
| comfyui/scripts/ensure_fetch_running.ps1 | Keeps a download running | Not invoked. |
| comfyui/scripts/reboot_when_ready.ps1 | Reboots the machine | Not invoked. |
| comfyui/scripts/run_stage0_gate.ps1 | Stage gate | Not invoked. |
| comfyui/scripts/run_unattended.ps1 | Unattended driver | Not invoked. |
| comfyui/scripts/scan_workflow_refs.ps1 | Workflow path scan | Not invoked. |
| comfyui/scripts/measure_resources.ps1 | Windows performance counters | Not invoked. Hardware-dependent. |
| comfyui/scripts/status.ps1 | Local status | Not invoked. |
| comfyui/start_qwen.bat, stop_qwen.bat | ComfyUI start with a free-RAM gate, and stop | Not invoked. The image CLI does not go through the bat file. |
| tools/fw-on.ps1, tools/fw-off.ps1 | Firewall rules for an offline check | Not invoked. They change system configuration. |
| tools/set-pagefile.ps1 | Pagefile change with backup | Not invoked. It changes system configuration. |
| tools/render-stage-scripts.mjs | Writes the packaged scripts | Maintainer tool. Not packaged. |
| tools/package-qwen-skill.mjs | Checks and zips the skill | Maintainer tool. Not packaged. |
| screenshots/, assets/social-preview.png | Sample and preview images | Not packaged. Agents would not receive the binary pixels as text. |
| skill/qwen-duo-12g/ | Marketplace text | This is the ZIP payload. |

Not in this repository, and not claimed as included: llama-server, ComfyUI portable, embedded Python, the five weight files, NVIDIA drivers, and any user images. Historical notes mention private probe scripts that were never committed.
