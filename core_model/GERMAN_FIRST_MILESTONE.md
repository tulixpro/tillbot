# TILLBOT Core — German-first milestone

## Goal

The first language milestone is **German**. The first product target is a general-purpose assistant that can hold a simple conversation, explain everyday topics, follow clear instructions, summarize text supplied by the user, and admit uncertainty.

This is a research milestone, not a promise of ChatGPT-level performance. The current model is a small randomly initialized Transformer. It has no useful German ability until a suitable corpus has been reviewed and training and evaluation have been completed.

## Data policy (must be completed before training)

Do not download, scrape, import, or train on a corpus until its terms and permitted machine-learning uses have been checked by a human. A website being publicly readable does not automatically grant training rights.

For every proposed source, record:

- Exact dataset/work title and version
- Publisher or responsible organization
- Canonical source URL and download date
- License name and version, plus a saved copy or link to the license text
- Whether commercial ML training, redistribution, and modification are allowed
- Attribution, share-alike, notice, or other obligations
- Known restrictions, exclusions, and provenance
- Reviewer and review date
- Decision: approved, rejected, or needs legal review

Do not use private chats, personal records, credentials, private messages, or material with unclear rights. Do not treat a checkbox or command-line confirmation as proof of permission. Keep original source files and license evidence outside Git; do not commit raw corpora or trained weights.

## German corpus composition

Build a balanced, deduplicated collection of German text with permission for the intended training use. Prefer clearly licensed, documented sources and original material created for this project. Aim for variety rather than repeating one source:

1. Everyday written German: natural, varied prose and dialogue
2. Explanatory text: science, culture, technology, and practical knowledge
3. Instruction following: requests, constraints, lists, and step-by-step explanations
4. Summarization and transformation: short source passages paired with concise summaries, where rights permit
5. Reasoning and numeracy: basic arithmetic, comparisons, and explaining simple concepts
6. Language quality: spelling, grammar, punctuation, and standard German phrasing

Track source proportions so one source cannot silently dominate the corpus. Keep a held-out validation split and a separate evaluation set. Do not train on the evaluation prompts or their expected criteria.

## First milestone gates

- [ ] Each source has a completed rights/provenance record and an explicit approval.
- [ ] The corpus passes UTF-8, duplicate, personal-data screening, source-hash, and train/validation leakage checks.
- [ ] Train/validation files and manifest are generated reproducibly and stored together.
- [ ] Tokenizer is fitted only on the approved training split.
- [ ] A small CPU smoke run completes and produces a checkpoint and metrics.
- [ ] German evaluation prompts are run on the checkpoint and scored against the rubric.
- [ ] Results are reviewed before any model is connected to the hosted TILLBOT chat.

A passing data-integrity check is not a license review, privacy guarantee, or quality score.

## Hardware reality

Start with CPU smoke tests and very small experiments only. The legacy GeForce GT 555M is not a suitable target for modern PyTorch CUDA training. A laptop-sized toy model can validate the pipeline, but it will not become a capable general assistant simply by running for longer. Larger-scale training requires suitable compute and substantially more reviewed data.

## Immediate next action

Prepare the source register and collect candidate datasets for a human rights review. No dataset is selected or approved by this document. Once the source list and license evidence have been reviewed, place only approved UTF-8 documents in a local folder outside the repository and use the existing preparation, audit, strict validation, and training tools.
