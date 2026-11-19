# TILLBOT CORE — independent model roadmap

## Product definition

TILLBOT CORE is intended to become an independently trained language model. The target is not a wrapper around Groq, Gemini, OpenAI, or another hosted model. Its model architecture, tokenizer, training run, checkpoints, inference runtime, and evaluation artifacts must be owned and reproducible within this project.

This repository currently contains a **research prototype**, not a capable assistant:
- decoder-only Transformer with random initialization;
- UTF-8 byte-level token IDs;
- small experimental training pipeline;
- no useful trained checkpoint;
- no production inference service.

Do not describe the model as trained, intelligent, safe, or production-ready until measured evidence supports the claim.

## Milestones

### M0 — Reproducible baseline (current work)

- Keep the model isolated from the public chat backend.
- Run CPU regression tests and a tiny smoke-training run in CI.
- Record model config, random seed, corpus hashes, training/validation loss, software versions, and checkpoint format.
- Ensure checkpoints are generated locally and are not committed to Git.
- Document hardware and runtime limitations.

**Exit gate:** repeatable CPU tests and a short train/save/load/generate smoke test pass.

### M1 — Data and tokenizer foundations

- Define a documented corpus schema with source, author/owner, license, attribution, retrieval date, language, and review status.
- Accept only material with explicit permission for machine-learning training; preserve evidence outside the model artifacts.
- Exclude private conversations, identifying data, credentials, school records, and data from minors.
- Add document-level deduplication, train/validation/test splits, contamination checks, and a human review checklist.
- Design and test a deterministic subword tokenizer (for example, byte-level BPE) trained from project-approved data. Keep UTF-8 byte mode as a baseline, not the assumed final tokenizer.
- Store tokenizer vocabulary/config and its hash with every checkpoint.

**Exit gate:** tokenizer round-trip tests pass; corpus provenance is reviewable; held-out test sources are not in training.

### M2 — Small from-scratch language model

- Establish a small, fixed baseline config and parameter-count report.
- Train from random initialization on a reviewed corpus; do not mix held-out test data into training.
- Log training and validation loss, total/trainable parameter counts, tokens processed, approximate throughput, peak accelerator memory, and elapsed time.\n- Store model parameter counts in checkpoints; keep run metrics in a separate JSONL artifact.
- Support deterministic resume from a checkpoint and record all hyperparameters.
- Compare at least two seeds or runs before drawing conclusions.

**Exit gate:** training is reproducible, validation loss is stable/improving, and generated samples are reviewed. A lower loss alone is not evidence of assistant quality.

### M3 — Assistant fine-tuning and behavior

- Only after M2, create a separately versioned instruction dataset with clear rights and quality review.
- Separate pretraining, supervised instruction tuning, and evaluation datasets.
- Use curated, original examples; do not ingest real user chats by default.
- Evaluate German first, then any additional supported languages.
- Test instruction following, factual uncertainty, source honesty, privacy, prompt-injection resistance, respectful responses, and refusal behavior.
- Human-review outputs; automated probes are diagnostics, not safety certification.

**Exit gate:** predeclared quality and safety thresholds are met on held-out prompts and independently reviewed examples.

### M4 — Local inference runtime

- Build a separate inference package/process that loads a versioned checkpoint and matching tokenizer.
- Add bounded context/output lengths, request timeouts, concurrency limits, memory checks, structured errors, and health/readiness endpoints.
- Keep model files outside Git and verify hashes before loading.
- Add a small API contract test suite and load/latency measurements on the actual target hardware.
- Do not expose an unauthenticated public endpoint.

**Exit gate:** repeatable local API tests, resource measurements, and security review pass.

### M5 — Shadow integration, never automatic cutover

- Run only internal/offline evaluations first.
- If a hosted TILLBOT service exists, keep its current provider path unchanged while Core is tested separately.
- A future shadow comparison must not send private user conversations to training or evaluation datasets.
- Require explicit human approval, rollback plan, monitoring, and a separate release decision before any production routing change.

**Exit gate:** all prior gates pass and a human explicitly approves a deployment plan.

## Compute reality

The existing laptop preset (width 32, 2 layers, context 64, batch 2) is only a smoke/learning profile. CPU training can be slow and cannot create a competitive general-purpose assistant from a tiny corpus. The legacy GeForce GT 555M is not a supported target for modern CUDA/PyTorch builds; CPU mode is the safe baseline. Do not promise that this machine can train a useful production model.

Start with reproducible experiments and measured limits. Larger training should be considered only after data quality, architecture, and evaluation are established. No paid GPU, cloud service, billing account, or external model API is assumed by this roadmap.

## Release evidence

Every experiment intended for comparison should preserve:
- source and license manifest reference;
- tokenizer and model config hashes;
- code commit SHA;
- seed and full hyperparameters;
- training/validation metrics and compute measurements;
- checkpoint hash and model card;
- held-out evaluation report and human review notes.

Never commit private corpora, credentials, raw user conversations, or model checkpoints to the public repository.
