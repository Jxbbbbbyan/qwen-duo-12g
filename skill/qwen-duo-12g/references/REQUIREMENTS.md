# Requirement map

Dates are America/Los_Angeles. The attached checklist was created 2026-11-19 15:15 and expanded 2026-11-19 15:31. Packaging, how-agents-load-skills, creator FAQ, review and approval, what you can sell, and security were fetched on 2026-11-19 during implementation. use-a-skill is cited from the 15:31 checklist, not from a second fetch. Nothing here was uploaded.

| Topic | Source | Status | This package |
| --- | --- | --- | --- |
| Marketplace identity | https://www.agensi.io/docs | Confirmed 15:15 | Skills for agents. No other site is used. |
| Frontmatter | https://www.agensi.io/docs/packaging and the 2026-04-27 security article | Confirmed | `name` and `description`, plus summary, version, tags, keywords, use_cases. `docs_url` is omitted. |
| ZIP layout conflict | packaging vs security article | Both cited | One top-level folder `qwen-duo-12g/` with `SKILL.md` at its root. One skill, not a pack. |
| Script runtime | packaging; how-agents-load-skills | Confirmed | Eight self-contained scripts. SKILL.md orders them. No script reads a sibling. |
| 20KB logic guideline | packaging | Guideline, not a hard cap | Measured per script, inline JSON excluded. |
| Windows GPU and services | packaging, submit, sell; 15:31 addendum | Unknown | Pipeline blocked. Local orchestrator is separate and not launched. |
| Downloads and system changes | packaging; security article; review page | Confirmed as scan concerns | Scripts refuse `allowDownloads` and `allowSystemChanges`. They do not install or download. |
| ZIP limits | packaging; submit | Confirmed | Text only, no weights, no binaries, no `node_modules`. |
| Free listing and GitHub | pricing, use-a-skill, sell, submit | Free listing confirmed; arbitrary promo URLs unknown | Draft has no promotional URL and is not submitted. |
| Project files vs temp scripts | creator FAQ; how-agents-load-skills | Confirmed distinction | Scripts do not delete user files. Probe removal is limited to the probe this script created. |
| Parameter and stdout API | 15:31 addendum | Unknown | Candidate JSON only. `protocolGuaranteedByAgensi` is false. |
| Shared workspace and large artifacts | 15:31 addendum | Unknown | Workspace must be passed and write-confirmed, or the pipeline stays blocked. Weights and images are not put in JSON. |
| Official multi-script sample | review page and the pages fetched | Not found | No claim that Agensi published a pipeline sample. |

Submission of this ZIP is not authorized by these notes.
