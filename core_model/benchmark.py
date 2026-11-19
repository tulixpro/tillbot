"""Compare cached and uncached Core decoding on the current machine.

This is a local diagnostic, not a universal speed guarantee. Run:
python core_model/benchmark.py --checkpoint artifacts/tillbot-core.pt
"""
from __future__ import annotations

import argparse
import time

import torch

from model import TillbotCore
from tokenizer_runtime import tokenizer_from_checkpoint, encode_text


def timed_generate(model, prompt, tokens, use_cache, device):
    if device.type == "cuda":
        torch.cuda.synchronize(device)
    started = time.perf_counter()
    with torch.inference_mode():
        result = model.generate(
            prompt, max_new_tokens=tokens, do_sample=False, use_cache=use_cache
        )
    if device.type == "cuda":
        torch.cuda.synchronize(device)
    elapsed = time.perf_counter() - started
    return elapsed, result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", default="artifacts/tillbot-core.pt")
    parser.add_argument("--prompt", default="TILLBOT:")
    parser.add_argument("--tokens", type=int, default=64)
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()
    if args.tokens < 1 or args.repeats < 1:
        parser.error("--tokens and --repeats must be positive")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    state = torch.load(args.checkpoint, map_location=device, weights_only=True)
    tokenizer = tokenizer_from_checkpoint(state)
    model = TillbotCore(**state["config"]).to(device)
    model.load_state_dict(state["model_state"])
    model.eval()
    prompt_ids = encode_text(args.prompt, tokenizer)[-model.context:]
    prompt = torch.tensor(prompt_ids, dtype=torch.long, device=device)[None, :]

    # Warm up both paths so first-call setup does not dominate the comparison.
    timed_generate(model, prompt, min(2, args.tokens), True, device)
    timed_generate(model, prompt, min(2, args.tokens), False, device)

    results = {}
    outputs = {}
    for label, cached in (("cached", True), ("uncached", False)):
        durations = []
        for _ in range(args.repeats):
            elapsed, output = timed_generate(model, prompt, args.tokens, cached, device)
            durations.append(elapsed)
            outputs[label] = output
        mean_time = sum(durations) / len(durations)
        results[label] = {
            "mean_seconds": round(mean_time, 4),
            "tokens_per_second": round(args.tokens / mean_time, 2),
        }

    if not torch.equal(outputs["cached"], outputs["uncached"]):
        raise SystemExit("Greedy outputs differ: investigate cache correctness before comparing speed.")
    print({
        "device": str(device),
        "prompt_tokens": len(prompt_ids),
        "generated_tokens": args.tokens,
        "repeats": args.repeats,
        "results": results,
    })


if __name__ == "__main__":
    main()
