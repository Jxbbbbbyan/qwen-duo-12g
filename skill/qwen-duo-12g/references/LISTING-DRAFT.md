# Listing draft

This draft has not been submitted. It is not an approved listing.

- Name: Qwen Duo 12G local check
- Price intent: Free. A payout method is not required for a free skill. This draft does not set a price.
- Summary: the SKILL.md summary, which stays under 300 characters.
- Compatibility: Node.js 18 or newer can run the check scripts. Windows, NVIDIA GPU, llama.cpp, ComfyUI, a shared workspace, and long-running processes are not confirmed for the buyer session. The scripts stop instead of starting those services.
- Docs link: leave blank. An optional docs field exists on the submit form. A promotional repository URL in the listing body is not confirmed as allowed, so this draft does not include one. A creator profile can list GitHub separately; that profile field is not this listing.
- What it does: validates a user config and reports file, port, host, and workspace blockers for a serial local pipeline.
- What it does not do: download weights, install runtimes, change the system, start llama.cpp or ComfyUI, or return an image.
- Result sample: a preflight JSON object with `marketplaceApproved` false and `pipelineBlocked` true, followed by a blocked dependencies object. That sample is a local Node run, not an Agensi agent transcript.

Do not paste secrets, local paths, or generated images into a public listing.
