# TILLBOT Core — from-scratch research prototype

TILLBOT Core is a small decoder-only Transformer initialized from random weights.
It uses a UTF-8 byte tokenizer and does not load Groq, OpenAI, Qwen, or other pretrained
model weights. It is **not** connected to the live TILLBOT chat.

## Honest status

- Architecture and training code: implemented.
- Trained model weights: **not included**; CI runs only a tiny two-step CPU smoke test to verify the training code, not to create a useful model.
- Starter dialogues: original project-authored examples for a smoke test only.
- Useful conversational ability: **not achieved**.
- Production readiness: **not ready**.

A random small model does not know German, facts, or instruction following. Meaningful
training requires a large, varied, legally usable corpus, compute, repeated training,
held-out evaluation, and safety testing. This prototype is not comparable to ChatGPT.

## German-first development milestone

The first language target is German, with a general-purpose assistant scope. See
[`GERMAN_FIRST_MILESTONE.md`](GERMAN_FIRST_MILESTONE.md) for the data-rights
requirements, corpus composition, hardware limits, and release gates.

An original German evaluation-only set is stored at
[`data/german_eval.jsonl`](data/german_eval.jsonl). It is a held-out quality
check, not training material. Do not merge it into the training corpus.

## Dataset split and provenance validation

After preparing a source-level split, validate it before fitting the tokenizer or
starting training:

```bash
python core_model/validate_dataset.py --train ./core_model/data/prepared/train.txt --validation ./core_model/data/prepared/val.txt --manifest ./core_model/data/prepared/manifest.json --source-dir ./reviewed_sources --min-chars 300
```

The validator checks train/validation document overlap after whitespace and
case normalization, split-file disjointness, manifest inventory consistency,
source paths and (when `--source-dir` is supplied) original source SHA-256 hashes.
It does not verify licenses, consent, copyright status or guarantee that personal
information is absent; those still require human review. Do not put private user
conversations, credentials or personal data into a training corpus.

## Strict training preflight

For prepared train/validation corpora, the trainer can enforce the provenance and
leakage checks immediately before any model initialization or optimizer work. This
requires the manifest produced by the dataset preparation pipeline:

```bash
python core_model/train.py --profile laptop --device cpu \
  --train-data ./prepared_data/train.txt \
  --val-data ./prepared_data/val.txt \
  --dataset-manifest ./prepared_data/manifest.json \
  --source-dir ./reviewed_sources \
  --min-document-chars 300 \
  --strict-data-validation --steps 2000
```

If the strict preflight detects duplicate documents, overlapping source assignments,
missing or changed source files, invalid manifest entries, or paths escaping the
source directory, training stops before model construction. Omitting `--source-dir`
still checks split overlap and manifest structure but does not re-hash the original
source files. This is a structural safeguard, not a license or privacy approval.
Legacy smoke-test commands remain available without strict mode.

## Reproducible dataset and checkpoint identity

The dataset preparation manifest records SHA-256 hashes of both prepared split files
as well as the original source files. Strict validation checks the split-file hashes
before training, so editing `train.txt` or `val.txt` after preparation invalidates
the manifest. Keep the manifest with the exact prepared files.

Checkpoints record the corpus hash, strict manifest hash (when strict validation is
enabled), tokenizer hash, model configuration, and training settings. `--resume`
refuses to continue when the dataset, manifest, tokenizer, model shape, seed, split
fraction, or key optimizer/evaluation settings differ. Start a fresh run when any of
these inputs change; do not silently mix experiments.

## Byte-level BPE tokenizer integration

The deterministic byte-level BPE tokenizer is now connected to the Transformer,
training batches, generation, chat, probes and benchmarks. The model's embedding
and output layers use the tokenizer vocabulary size. Historical checkpoints without
tokenizer metadata continue to load as UTF-8 byte models.

Build a tokenizer **only from the approved training split** (never validation/test text):

```bash
python core_model/tokenizer.py --input ./prepared_data/train.txt --vocab-size 2048 --output ./artifacts/tillbot-tokenizer.json
python core_model/train.py --profile laptop --device cpu --train-data ./prepared_data/train.txt --val-data ./prepared_data/val.txt --tokenizer ./artifacts/tillbot-tokenizer.json --steps 2000
```

Checkpoints embed the tokenizer metadata and a SHA-256 integrity hash. Resume refuses
to continue if the tokenizer differs, even when two tokenizers happen to have the same
vocabulary size. Generation and chat reconstruct the matching tokenizer from the
checkpoint, so a separate tokenizer file is not needed at inference time. BPE IDs must
never be mixed with a byte-token checkpoint. These changes do not include trained
weights or demonstrate useful conversational quality.

## Free local development

Python 3.10+ is recommended. For older laptops, use the explicit CPU-friendly
profile. It selects a 32-wide, 2-layer model with a 64-byte context and batch size 2;
this keeps memory use lower but also limits what the model can learn. It does not
make training fast, and the resulting model remains experimental. Install a PyTorch build suitable for your machine from
the official PyTorch installation selector, then from the repository root:

```bash
python -m pip install -r core_model/requirements.txt
```

Laptop smoke test (the tiny starter set is not useful assistant training):

```bash
python core_model/train.py --profile laptop --device cpu --data core_model/data/seed_dialogues.txt --steps 20 --eval-interval 10 --eval-batches 2
```

The `--profile laptop` settings are a starting point, not a performance guarantee.
For a real experiment, keep the CPU profile initially and increase training time
only after checking temperature, memory use and validation metrics. `--device cpu`
avoids trying to use legacy NVIDIA GPUs that current PyTorch builds may not support.

Standard smoke test only (the tiny starter set is not useful assistant training):

```bash
python core_model/train.py --data core_model/data/seed_dialogues.txt --steps 20 --context 32 --batch-size 2 --eval-interval 10 --eval-batches 2
```

For a real experiment, first place reviewed, licensed UTF-8 text documents in a folder
outside the repository. Do not use private chats, personal data, passwords, scraped
copyrighted books, or material whose license does not permit ML training. Keep source
and license evidence. Prepare a source-level split:

```bash
python core_model/prepare_dataset.py --source-dir ./reviewed_text --out-dir ./prepared_data --confirm-licensed-data
python core_model/train.py --profile laptop --device cpu --train-data ./prepared_data/train.txt --val-data ./prepared_data/val.txt --steps 2000
```

The dataset tool records filenames and hashes in `manifest.json`; it cannot verify
licenses for you. A human must review every source. A CPU run is free but can be very
slow. No cloud GPU, paid service, or background training is provisioned by this project.

The trainer writes the best checkpoint to `artifacts/tillbot-core.pt`, a latest
checkpoint to `artifacts/tillbot-core.last.pt`, and metrics to
`artifacts/tillbot-core.metrics.jsonl`. Continue the best checkpoint with
`--resume`. These artifacts are local and are not committed to Git.

## Schnelltest: Core lokal ausprobieren

Dieser Test prüft nur, ob Training und Chat technisch zusammenlaufen. Er trainiert
ein winziges Demo-Checkpoint ausschließlich mit den eigens für das Projekt
geschriebenen Beispieldialogen. Die Antworten sind voraussichtlich schlecht oder
zufällig und stellen **keine** deutsche Allgemeine KI dar. Der Live-Webchat wird
nicht verändert.

Im Repository-Hauptordner:

```bash
python core_model/try_core.py
```

Der Befehl trainiert kurz auf der CPU und öffnet danach einen lokalen Terminal-Chat.
Beenden mit `/exit`. Optional:

```bash
python core_model/try_core.py --steps 10 --max-new-tokens 32
```

Für die geprüfte Vorauswahl möglicher deutscher Quellen siehe
[`GERMAN_DATASET_CANDIDATES.md`](GERMAN_DATASET_CANDIDATES.md).
Diese Kandidaten sind nicht automatisch freigegeben; keine externen Daten werden
mit dem Schnelltest heruntergeladen oder verwendet.

## Local generation and chat

After a checkpoint exists:

```bash
python core_model/generate.py --checkpoint artifacts/tillbot-core.pt --prompt "TILLBOT:"
python core_model/chat.py --checkpoint artifacts/tillbot-core.pt
```

The terminal client is a developer tool, not a safety layer.

## Import from the TILLBOT admin training center

Download the approved JSONL export from the admin training center. Before importing,
review the source rights and privacy of every example. Then convert the JSONL file into
one UTF-8 document per example:

```bash
python core_model/import_jsonl.py --input ./tillbot-training-approved.jsonl --out-dir ./reviewed_text --confirm-licensed-data
```

The converter accepts the admin export's `messages` format and simple
`prompt`/`completion` JSONL rows, removes exact case-insensitive duplicates,
and refuses to overwrite a non-empty output folder. It does not verify rights or
screen out private data. Audit the output and inspect its manifest before training:

```bash
python core_model/audit_dataset.py --source-dir ./reviewed_text --report ./prepared_data/audit-report.json --min-chars 1
python core_model/prepare_dataset.py --source-dir ./reviewed_text --out-dir ./prepared_data --min-chars 1 --confirm-licensed-data
python core_model/train.py --train-data ./prepared_data/train.txt --val-data ./prepared_data/val.txt --steps 2000
```

## Corpus audit before training

Before preparing a reviewed corpus, run this local screening report:

```bash
python core_model/audit_dataset.py --source-dir ./reviewed_text --report ./prepared_data/audit-report.json
```

It flags exact/whitespace-normalized duplicates, invalid UTF-8, short documents, and possible email addresses, phone numbers, or credentials. It prints only file names and flags, not matched values. A non-zero exit means review the report before continuing. This is only a screening aid: it cannot establish data rights or guarantee that personal data is absent.

## Automated tests

Run the CPU regression suite from the repository root:

```bash
python -m unittest discover -s core_model -p 'test_*.py' -v
```

The suite checks tensor shapes and loss, causal attention, cached and uncached generation equivalence,
generation bounds, context limits, a tiny CPU training smoke test, and reproducible source-level
dataset splits with explicit license confirmation. GitHub Actions
runs the same suite for changes to `core_model/`.

## Inference speed benchmark

Core generation now supports an optional per-layer key/value cache. This avoids
recomputing the full prompt for every generated byte; when the context window fills,
the cache is rebuilt from the latest window. The cache path is tested against the
uncached greedy reference, including context-window rollover.

Compare both paths on the machine that will run Core:

```bash
python core_model/benchmark.py --checkpoint artifacts/tillbot-core.pt --tokens 64 --repeats 3
```

The benchmark reports local tokens/second for cached and uncached decoding and
checks that both greedy outputs match. Results depend on hardware, model size,
PyTorch build and prompt length. UTF-8 byte tokenization still generates one byte
at a time, so it is not a high-throughput production tokenizer.

## Behavior probe

After a checkpoint exists, create a repeatable report with 12 prompts covering German
conversation, identity, arithmetic, uncertainty, source honesty, privacy, respectful
responses, formatting, prompt injection, language switching and capability honesty:

```bash
python core_model/probe.py --checkpoint artifacts/tillbot-core.pt --out artifacts/core-probe-report.md
```

The script records raw outputs and a manual 0–2 scoring rubric. It does not automatically
decide whether answers are safe or correct. Review every output; random or undertrained
weights will likely produce meaningless text.

## Evaluation and integration

See `EVALUATION.md` for release gates. Validation loss alone does not measure answer
quality. Do not expose this checkpoint to public users or replace the current hosted
provider until held-out quality, safety, memory, and latency tests pass. Keep production
and Core isolated throughout development.
