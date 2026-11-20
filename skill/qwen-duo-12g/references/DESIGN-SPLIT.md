# Split-script feasibility

Sources read for this note:

- Attached checklist dated 2026-11-19 15:15 America/Los_Angeles, expanded 2026-11-19 15:31 America/Los_Angeles.
- Packaging, re-read 2026-11-19: scripts are written unchanged to a temporary file, run, and removed; each script cannot read other files in the package. Splitting logic under the 20KB review guideline does not create a shared runtime.
- How agents load skills, fetched 2026-11-19: `get_skill` returns SKILL.md and an index; one file is fetched on demand; the agent is told not to save the skill; a script is not saved into the project.
- Creator FAQ, fetched 2026-11-19: the agent may build project files from templates it loads. The skill, including scripts and templates, is not kept. That is agent-written output, not a promise that the next temporary script sees the same directory.
- Review and approval, fetched 2026-11-19: no official multi-script scheduler sample is on that page. Dangerous-command failures include `shell=True` and piping a download into a shell.
- What you can sell and Security, fetched 2026-11-19: delivery is MCP skill text. Plugins that must be installed on the buyer machine are not sold yet. Permissions are listed on a card; a card is not a GPU or process-lifetime guarantee.
- use-a-skill is quoted from the 15:31 checklist ("The skill loads into your chat and your agent does the work."). It was not re-fetched in the implementation pass that wrote this file.

## Three entries

(A) SKILL.md is the marketplace entry. The agent fetches each stage script and runs that file alone. This matches the published load and temporary-file rules. It is not a platform scheduler. Argument, stdin, stdout, exit code, timeout, and working-directory behavior are not documented platform APIs. This package defines a candidate stdout JSON object and tests it with local Node only.

(B) A program dispatcher that imports, reads, or launches a sibling package script does not meet the temporary-file rule. The stage scripts do not launch `orchestrator/orchestrator.mjs` either. That would move the pipeline outside the script instead of implementing the stage.

(C) `orchestrator/orchestrator.mjs` remains available for an operator who runs the checkout directly. It is not the marketplace entry.

## Success path

Prompt and image stages start the executable named in the user config, speak the local HTTP calls used by the repository orchestrator, write the service output into the authorized artifact directory, and stop only the pid they started. Handoff checks that the prompt port is closed and does not signal anyone. Outputs checks the PNG bytes and hash. Cleanup signals a pid only when an owned record in that directory matches the process command.

If the executable is missing, a port is already open, the artifact directory was not authorized, or the service fails, the stage exits 5. Lack of an Agensi certification is not itself that failure. `liveHardwareVerified` stays false. A response with `fixture: true` is recorded as `controlled-fixture` and `realModelOutput` stays false.

## What was rejected

Calling the repository orchestrator from a stage script was rejected. It would bypass the self-contained rule by executing out-of-package code. Reimplementing the whole web console inside every script was rejected. Each script contains only its stage.

## Stage boundaries in this repository

The local CLI in `orchestrator/orchestrator.mjs` does this in one process: `startLlama`, `writePrompt`, `stopLlama`, `startComfy`, `uploadImage`, `render`, `deliverImage`, `stopComfy`, then either `stopLlama` (`QWEN_RELEASE_ON_EXIT=1`) or `startLlama` (historical reload). The packaged stages perform the same HTTP steps in separate processes. Each service stage starts its own executable and stops that pid before it exits, so no child-process object is handed to the next temporary script.

`chat-console.mjs` is a second local console. It is not a stage. The PowerShell fetchers, firewall tools, pagefile tool, and reboot script are not stages and are not invoked.

## Candidate protocol, tested locally only

Each script prints one JSON object. A later script accepts `--input-json` up to 16KB, rejects secret-like keys and token-shaped values, and echoes only a fixed set of short fields. Stdin is not read. No test here is an Agensi agent run. Cross-script cwd, a persistent filesystem, timeouts, and Windows GPU lifecycle remain unverified. If a shared user directory is not shown with `--workspace` and `--confirm-write`, the pipeline stays blocked.

## Isolation test

Copy one script to an empty directory whose path contains a space and a non-ASCII character. Place a sibling file that writes a marker if executed. Run the copied script with Node's permission mode allowing reads of that script and, when needed, the user config only. The sibling marker must not appear, and the script must not import or spawn another package file. The same test is implemented in `tests/skill-package.test.mjs`.
