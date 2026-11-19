---
name: qwen-duo-12g
description: "Use when checking a user-supplied local serial prompt-then-image setup before any model starts. Run the packaged stage scripts one at a time and stop when a script reports a blocker. Do not use this skill to download weights, change the system, or claim that an Agensi buyer session can host llama.cpp or ComfyUI."
summary: "Reports whether a user-owned serial prompt-then-image setup has the files and workspace a local run would need. The packaged scripts stop without downloading weights or starting GPU services. A Windows llama.cpp and ComfyUI run is a separate local program, not marketplace-approved execution."
version: "0.1.0"
tags:
  - local-check
  - preflight
  - serial-pipeline
keywords:
  - config-check
  - stage-scripts
  - workspace-probe
use_cases:
  - "Check a user-supplied config without starting models"
  - "Report missing files, ports, and an unverified workspace"
  - "Stop before a local GPU pipeline whose platform support is not established"
---

# Qwen Duo 12G local pipeline check

Requires: Node.js 18 or newer on the machine where scripts are executed. Windows, an NVIDIA GPU, llama.cpp, and ComfyUI are not confirmed requirements of the Agensi buyer session.

This file is the only marketplace entry. It tells the agent which script to fetch and run next. It is not a workflow engine, and it does not make the scripts share a process, a working directory, or a filesystem.

Read [the design boundary](references/DESIGN-SPLIT.md) and [the requirement map](references/REQUIREMENTS.md) before running anything. Model names, sizes, hashes, and licences are in [prerequisites](references/PREREQUISITES.md). The step map is [traceability](references/TRACEABILITY.md). The repository inventory is [inventory](references/INVENTORY.md). A listing draft that has not been submitted is [here](references/LISTING-DRAFT.md).

## Unresolved submission blocker

Windows GPU, llama.cpp, ComfyUI, background-process lifetime, cross-script working directories, and a shared artifact store are not established for an Agensi buyer session. Packaged scripts therefore cannot generate an image. They must not be described as platform-approved or as a completed listing. No upload is part of these instructions.

`marketplaceApproved` is always false. `protocolGuaranteedByAgensi` is always false. Stdout JSON is a candidate handoff this repository tests with Node. It is not a documented Agensi argument, stdin, stdout, or exit-code API.

## How to run a script

Fetch one script by its path and run that file alone. The host may write it to a temporary file and remove that temporary file later. Do not expect another package file to sit beside it. Do not rewrite the script. Do not save the script into the user's project. Do not pass secrets, tokens, or credentials in arguments or in JSON. Do not put image bytes or model weights in `--input-json`; that payload must stay under 16KB and must not contain secret-like fields.

These scripts do not delete user images or other user files. Removing a temporary copy of a script is the host's job. The dependencies script, and only when the user passes both `--workspace` and `--confirm-write`, creates one probe file and removes that probe file if the write stayed inside the workspace. If a file with the probe name already exists, the script leaves it untouched.

Stop the sequence when a script exits non-zero, when stdout is not one JSON object, or when `stopPipeline` is true and the next file would be a model stage. Do not install software, download weights, or change system settings to make a check pass.

## Steps

### preflight

Run `01-preflight.mjs` with no config. A finished report exits 0 and sets `checksMayContinue` true. It also sets `stopPipeline` and `pipelineBlocked` true. That means the model stages must not run. The only later scripts allowed after a zero exit are `02-validate-config.mjs` and, if that also exits 0, `03-dependencies.mjs`.

### validate-config

If preflight did not exit 0, stop. Otherwise ask the user for an absolute config path. The empty shape is printed by `02-validate-config.mjs --print-example-config`. The same shape is in [the example file](templates/config.example.json) for a human reader; the script does not read that file.

Run `02-validate-config.mjs --config <absolute-file>`. Optionally pass preflight's stdout as `--input-json` when it is small and contains no secrets. Exit 0 means the JSON shape is valid, not that the machine can render. Exit 3 means the file is missing. Exit 4 means it is invalid. Stop on 3 or 4.

### dependencies

Run `03-dependencies.mjs --config <absolute-file>` only after validate-config exits 0. Pass validate-config's stdout as `--input-json` only when it is small and non-secret. This script stats paths the user named. It does not hash multi-gigabyte files and it does not start servers.

A shared directory is not assumed. Add `--workspace <absolute-dir> --confirm-write` only when the user names a directory they authorize for a write probe. Without that pair, `workspaceVerified` stays false. This script exits 5. `dependencyOk` and `workspaceVerified` are separate fields. Exit 5 means stop. Do not run the model-stage scripts.

### prompt-model

Do not run `04-prompt-model.mjs` when `stopPipeline` is true. If it is run anyway, pass the previous stdout as `--input-json`. The script exits 5, starts nothing, and does not return a prompt. In the local program this stage is `startLlama` then `writePrompt` inside one process. That program is not launched here.

### gpu-handoff

Do not run `05-gpu-handoff.mjs` when `stopPipeline` is true. The script exits 5 and does not stop or signal any process. The local program's handoff is `stopLlama`, which waits until the server it started no longer answers. That is not a VRAM measurement, and this script does not perform it.

### image-stage

Do not run `06-image-stage.mjs` when `stopPipeline` is true. The script exits 5 and does not start ComfyUI. The local program's image stage is `startComfy`, optional `uploadImage`, then `render`, still in the same process as the prompt stage. Image bytes are not accepted through `--input-json`.

### outputs

Do not run `07-outputs.mjs` when `stopPipeline` is true. The script exits 5 and does not copy an image. The local program writes with `deliverImage`. A rendered image is too large to return through this conversation. Do not claim an output path unless a verified workspace already contains the file.

### cleanup

Do not run `08-cleanup.mjs` when `stopPipeline` is true. The script exits 5, kills nothing, and deletes nothing. The local one-shot flag `QWEN_RELEASE_ON_EXIT=1` stops ComfyUI and the llama process that same process started. The historical console path reloads llama instead. Neither path is invoked by this skill.

## Local program, not a marketplace script

The repository file `orchestrator/orchestrator.mjs` remains the full local program. An operator who already has that checkout, the weights, and a Windows GPU can run it themselves:

```text
node <checkout>/orchestrator/orchestrator.mjs --run "<task>" --mode 1080p
```

Optional flags are `--mode 2k` and `--image <file>`. That command is not a packaged script, not an Agensi-guaranteed run, and not something these stage scripts launch. Do not download the repository from inside a stage script. Chat-only `chat-console.mjs` shares the language-model port; do not start it beside an image run. PowerShell fetchers, firewall scripts, pagefile scripts, and reboot scripts are not part of this sequence.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The check finished. It does not mean an image was produced. |
| 2 | Usage error. |
| 3 | A required config or input JSON value is missing. |
| 4 | The config or input JSON is invalid, or it contains a sensitive field. |
| 5 | Blocked. Stop. Do not start the next model stage. |
