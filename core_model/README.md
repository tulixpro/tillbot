# TILLBOT Core — from-scratch prototype

This directory contains an independently initialized, byte-level decoder-only Transformer. It does **not** load Groq, OpenAI, Qwen, or any pretrained model weights. It is a research prototype and is not connected to the live TILLBOT chat.

## What is genuinely independent

- Transformer architecture and model weights are initialized locally from random values.
- UTF-8 byte tokenizer (256 token IDs), so no external tokenizer/model files are needed.
- Training and local text generation scripts use PyTorch.

## What it cannot do yet

A randomly initialized small model does not know German, facts, reasoning, or how to follow instructions. It needs a large, legally usable training corpus, compute, repeated training, evaluation, and safety testing. The included small configuration is only a starting point. It is not comparable to ChatGPT and must not replace the production provider.

## Run locally

Python 3.10+ is recommended. Install PyTorch for your operating system from the official PyTorch installation selector, then:

```bash
python -m pip install -r core_model/requirements.txt
python core_model/train.py --data data/train.txt --steps 5000
python core_model/generate.py --checkpoint artifacts/tillbot-core.pt --prompt "TILLBOT:"
```

The default corpus path is `data/train.txt` at the repository root. Supply a large, curated, UTF-8 corpus; see `core_model/data/README.md`. For GPU training, install a PyTorch build compatible with the installed CUDA version.

## Integration plan

1. Build and test the model independently from the live service.
2. Collect only licensed, high-quality training data.
3. Track validation loss and held-out benchmarks; test German, instruction following, hallucinations, and safety.
4. Export a checkpoint and build a separate inference service only after measuring memory and latency.
5. Keep the existing hosted AI as fallback until the local model demonstrably passes tests.

Training on the free Render web-service instance is not realistic: its memory/CPU limits and ephemeral filesystem are unsuitable for training or hosting a useful model. No paid infrastructure is provisioned by this prototype.
