# TILLBOT Core — from-scratch research prototype

TILLBOT Core is a small decoder-only Transformer initialized from random weights.
It uses a UTF-8 byte tokenizer and does not load Groq, OpenAI, Qwen, or other pretrained
model weights. It is **not** connected to the live TILLBOT chat.

## Honest status

- Architecture and training code: implemented.
- Trained model weights: **not included**; no training run has been completed here.
- Starter dialogues: original project-authored examples for a smoke test only.
- Useful conversational ability: **not achieved**.
- Production readiness: **not ready**.

A random small model does not know German, facts, or instruction following. Meaningful
training requires a large, varied, legally usable corpus, compute, repeated training,
held-out evaluation, and safety testing. This prototype is not comparable to ChatGPT.

## Free local development

Python 3.10+ is recommended. Install a PyTorch build suitable for your machine from
the official PyTorch installation selector, then from the repository root:

```bash
python -m pip install -r core_model/requirements.txt
```

Smoke test only (the tiny starter set is not useful assistant training):

```bash
python core_model/train.py --data core_model/data/seed_dialogues.txt --steps 20 --context 32 --batch-size 2 --eval-interval 10 --eval-batches 2
```

For a real experiment, first place reviewed, licensed UTF-8 text documents in a folder
outside the repository. Do not use private chats, personal data, passwords, scraped
copyrighted books, or material whose license does not permit ML training. Keep source
and license evidence. Prepare a source-level split:

```bash
python core_model/prepare_dataset.py --source-dir ./reviewed_text --out-dir ./prepared_data --confirm-licensed-data
python core_model/train.py --train-data ./prepared_data/train.txt --val-data ./prepared_data/val.txt --steps 2000 --context 128 --batch-size 8
```

The dataset tool records filenames and hashes in `manifest.json`; it cannot verify
licenses for you. A human must review every source. A CPU run is free but can be very
slow. No cloud GPU, paid service, or background training is provisioned by this project.

The trainer writes the best checkpoint to `artifacts/tillbot-core.pt`, a latest
checkpoint to `artifacts/tillbot-core.last.pt`, and metrics to
`artifacts/tillbot-core.metrics.jsonl`. Continue the best checkpoint with
`--resume`. These artifacts are local and are not committed to Git.

## Local generation and chat

After a checkpoint exists:

```bash
python core_model/generate.py --checkpoint artifacts/tillbot-core.pt --prompt "TILLBOT:"
python core_model/chat.py --checkpoint artifacts/tillbot-core.pt
```

The terminal client is a developer tool, not a safety layer.

## Evaluation and integration

See `EVALUATION.md` for release gates. Validation loss alone does not measure answer
quality. Do not expose this checkpoint to public users or replace the current hosted
provider until held-out quality, safety, memory, and latency tests pass. Keep production
and Core isolated throughout development.
