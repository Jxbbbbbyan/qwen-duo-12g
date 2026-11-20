---
name: qwen-duo-12g
description: "Use when running a user-configured local serial prompt-then-image workflow one stage at a time. Each stage script starts only the executable named in that user's config, writes into a directory the user authorizes, and stops that process before exiting. Do not use it to download weights, change the system, or claim that a live GPU run or an Agensi buyer session has been verified."
summary: "Runs a local prompt-then-image workflow as separate stage scripts. Each service stage starts only the user's configured executable, writes into an authorized directory, and stops that process. Missing files, a busy port, or a failed service stops the run. Live Windows GPU execution is not certified."
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
  - "Run a configured local prompt service and keep only its text hash"
  - "Render through the configured image service into an authorized directory"
  - "Stop a stage when its executable, port, or artifact directory is not ready"
---

# Qwen Duo 12G local pipeline check

Requires: Node.js 18 or newer on the machine where scripts are executed. Windows, an NVIDIA GPU, llama.cpp, and ComfyUI are not confirmed requirements of the Agensi buyer session.

This file is the only marketplace entry. It tells the agent which script to fetch and run next. It is not a workflow engine, and it does not make the scripts share a process, a working directory, or a filesystem.

Read [the design boundary](references/DESIGN-SPLIT.md) and [the requirement map](references/REQUIREMENTS.md) before running anything. Model names, sizes, hashes, and licences are in [prerequisites](references/PREREQUISITES.md). The step map is [traceability](references/TRACEABILITY.md). The repository inventory is [inventory](references/INVENTORY.md). A listing draft that has not been submitted is [here](references/LISTING-DRAFT.md).

## Unresolved submission blocker

Windows GPU, llama.cpp, ComfyUI, and a shared buyer-session workspace are not established for an Agensi buyer session. The stage scripts still contain the local success path. They block when the files, free ports, or authorized directory required by that path are missing. `liveHardwareVerified` is always false. A service that labels itself `fixture: true` is a controlled fixture, not a real model result. No upload is part of these instructions.

`marketplaceApproved` is always false. `protocolGuaranteedByAgensi` is always false. Stdout JSON is a candidate handoff this repository tests with Node. It is not a documented Agensi argument, stdin, stdout, or exit-code API.

## How to run a script

Fetch one script by its path and run that file alone. The host may write it to a temporary file and remove that temporary file later. Do not expect another package file to sit beside it. Do not rewrite the script. Do not save the script into the user's project. Do not pass secrets, tokens, or credentials in arguments or in JSON. Do not put image bytes or model weights in `--input-json`; that payload must stay under 16KB and must not contain secret-like fields.

These scripts do not delete user images. Removing a temporary copy of a script is the host's job. The dependencies script creates one probe file only when `--confirm-write` is set, and removes that probe if the write stayed inside the directory. If that name already exists, it is left untouched.

Stop when a script exits non-zero or stdout is not one JSON object. Do not install software, download weights, or change system settings. Do not pass secrets. Do not put image bytes or model weights in `--input-json`.

Pass the previous script's stdout as `--input-json` only when it is smaller than 16KB and has no secret-like fields. The prompt text and the image stay in the artifact directory. The agent passes the directory path and the hashes.

## Steps

### preflight

Run `01-preflight.mjs` with no config. Exit 0 means the host report was written. `liveHardwareVerified` is false. Continue only when exit code is 0.

### validate-config

Ask the user for an absolute config path. `02-validate-config.mjs --print-example-config` prints the empty shape. The human-readable copy is [the example file](templates/config.example.json); the script does not read it.

Run `02-validate-config.mjs --config <absolute-file>`. You may pass preflight's stdout as `--input-json`. Exit 0 means the shape is valid. Exit 3 means the file is missing. Exit 4 means it is invalid or contains a sensitive field. Stop on 3 or 4.

### dependencies

Run `03-dependencies.mjs --config <absolute-file> --artifact-dir <absolute-dir> --confirm-write` after validate-config exits 0. Pass that stdout as `--input-json`.

This script stats the configured files and connects to the two loopback ports. A listening port sets `dependencyOk` false and is not closed. The artifact directory is verified only with `--confirm-write`. Exit 0 means the files exist, the ports are free, and the directory accepted a probe write. Exit 5 means stop. `hostPlatform` is recorded and is not itself a failure.

### prompt-model

Run `04-prompt-model.mjs` with the same config and artifact directory, `--confirm-write`, `--task <text>`, and the dependencies stdout. The script starts `llamaExe` itself, requests one prompt, writes `prompt.txt`, and stops that process before it exits. It does not stop a server it did not start. Exit 0 means the text file and its hash are in the artifact directory. `serviceDeclaredFixture: true` means the service labeled the text as a fixture. `realModelOutput` stays false.

### gpu-handoff

Run `05-gpu-handoff.mjs` with the prompt-model stdout. It continues only when the recorded process start time is no longer running and the llama port is closed. A closed port by itself is not release evidence, and this script does not measure VRAM or signal a process.

### image-stage

Run `06-image-stage.mjs` with the handoff stdout and `--service-timeout-ms` when a shorter bound is wanted. The script requires graph node 5 and writes the task prompt into it before submitting. It starts `python` with the configured ComfyUI entry. If `--image` is an absolute file of at most 30MB, the script uploads that file and wires it into the graph before the submit. It copies a PNG only from the history entry's `type`, `subfolder`, and `filename` after a realpath containment check. It then stops that process. A missing node, a rejected path, or a missing service file exits 5. An older file that the history entry names for this prompt id can still be the right cached output.

### outputs

Run `07-outputs.mjs` with the image-stage stdout. It checks that `service-output.png` is inside the artifact directory, begins with the PNG signature, and matches `imageSha256`. It does not create a replacement image.

### cleanup

Run `08-cleanup.mjs` with the outputs stdout. It stops a process only when an `owned-*.json` record in the artifact directory names that pid and the process command matches the recorded executable. An open port without that match is reported and left running. The PNG is not deleted.

## Local program, not a marketplace script

The repository file `orchestrator/orchestrator.mjs` remains a separate local program. The stage scripts do not launch it. An operator who already has that checkout can still run `node <checkout>/orchestrator/orchestrator.mjs --run "<task>"`. Reference-image upload remains on that command. The packaged image stage checks an optional `--image` file but submits the text prompt. That local command is not Agensi-guaranteed execution.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The check finished. It does not mean an image was produced. |
| 2 | Usage error. |
| 3 | A required config or input JSON value is missing. |
| 4 | The config or input JSON is invalid, or it contains a sensitive field. |
| 5 | Blocked. Stop. Do not start the next model stage. |
