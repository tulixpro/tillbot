"""Train TILLBOT Core on a UTF-8 corpus with a held-out validation set.

This is a small educational from-scratch model. Training does not make it a
reliable assistant unless the corpus is large, diverse, licensed and evaluated.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
from pathlib import Path

import torch

from model import TillbotCore
from tokenizer import ByteBPETokenizer


def read_bytes(path: str) -> tuple[torch.Tensor, str]:
    file = Path(path)
    if not file.is_file():
        raise SystemExit(f"Corpus not found: {file}")
    raw = file.read_bytes()
    if not raw:
        raise SystemExit(f"Corpus is empty: {file}")
    try:
        raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SystemExit(f"{file} must be valid UTF-8: {exc}") from exc
    return torch.tensor(list(raw), dtype=torch.long), hashlib.sha256(raw).hexdigest()


def split_documents(data: torch.Tensor, validation_fraction: float, seed: int):
    """Split on blank-line document boundaries to reduce train/validation leakage."""
    text = bytes(data.tolist()).decode("utf-8")
    docs = [part.strip() for part in text.split("\n\n") if part.strip()]
    if len(docs) < 2:
        raise SystemExit(
            "A single --data file needs at least two blank-line-separated documents. "
            "Prefer --train-data and --val-data from the licensed dataset builder."
        )
    order = list(range(len(docs)))
    random.Random(seed).shuffle(order)
    val_count = max(1, min(len(docs) - 1, round(len(docs) * validation_fraction)))
    val_ids = set(order[:val_count])
    train_text = "\n\n".join(doc for i, doc in enumerate(docs) if i not in val_ids)
    val_text = "\n\n".join(doc for i, doc in enumerate(docs) if i in val_ids)
    return torch.tensor(list(train_text.encode("utf-8"))), torch.tensor(list(val_text.encode("utf-8")))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", default="core_model/data/seed_dialogues.txt",
                        help="Legacy combined corpus; split by blank-line-separated documents")
    parser.add_argument("--train-data", help="Explicit training text file")
    parser.add_argument("--val-data", help="Explicit held-out validation text file")
    parser.add_argument("--out", default="artifacts/tillbot-core.pt")
    parser.add_argument("--profile", choices=("standard", "laptop"), default="standard",
                        help="laptop uses a smaller CPU-friendly model configuration")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto",
                        help="auto uses CUDA when available; choose cpu for older GPUs")
    parser.add_argument("--steps", type=int, default=1000)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--context", type=int, default=128)
    parser.add_argument("--width", type=int, default=128)
    parser.add_argument("--heads", type=int, default=4)
    parser.add_argument("--layers", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--validation-fraction", type=float, default=0.1)
    parser.add_argument("--eval-interval", type=int, default=100)
    parser.add_argument("--eval-batches", type=int, default=10)
    parser.add_argument("--patience", type=int, default=10,
                        help="Stop after this many evaluations without validation improvement")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--tokenizer", help="Optional trained byte-BPE JSON; fit it on training data only")
    args = parser.parse_args()

    if args.profile == "laptop":
        # Small enough for CPU experimentation on older laptops; still a toy model.
        args.batch_size, args.context = 2, 64
        args.width, args.heads, args.layers = 32, 4, 2

    if bool(args.train_data) != bool(args.val_data):
        parser.error("--train-data and --val-data must be supplied together")
    if args.steps < 1 or args.batch_size < 1 or args.context < 8:
        parser.error("--steps/--batch-size must be positive and --context at least 8")
    if args.width < 8 or args.heads < 1 or args.width % args.heads:
        parser.error("--width must be >= 8 and divisible by --heads")
    if args.layers < 1 or args.learning_rate <= 0 or args.eval_interval < 1:
        parser.error("layers, learning rate and eval interval must be positive")
    if args.eval_batches < 1 or args.patience < 1:
        parser.error("--eval-batches and --patience must be positive")
    if not 0.05 <= args.validation_fraction <= 0.4:
        parser.error("--validation-fraction must be between 0.05 and 0.4")

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    if args.device == "cuda" and not torch.cuda.is_available():
        raise SystemExit("CUDA was requested but is not available in this PyTorch installation.")
    device_name = ("cuda" if torch.cuda.is_available() else "cpu") if args.device == "auto" else args.device
    device = torch.device(device_name)

    if args.train_data:
        train_data, train_hash = read_bytes(args.train_data)
        val_data, val_hash = read_bytes(args.val_data)
        corpus_hash = hashlib.sha256((train_hash + val_hash).encode()).hexdigest()
    else:
        combined, corpus_hash = read_bytes(args.data)
        train_data, val_data = split_documents(combined, args.validation_fraction, args.seed)

    tokenizer = ByteBPETokenizer.load(args.tokenizer) if args.tokenizer else None
    if tokenizer is None:
        tokenizer_metadata = {"type": "utf8-byte-v1"}
        vocab_size = 256
        train_ids, val_ids = train_data, val_data
    else:
        tokenizer_metadata = tokenizer.to_dict()
        vocab_size = tokenizer.vocab_size
        train_ids = torch.tensor(tokenizer.encode(bytes(train_data.tolist()).decode("utf-8")), dtype=torch.long)
        val_ids = torch.tensor(tokenizer.encode(bytes(val_data.tolist()).decode("utf-8")), dtype=torch.long)
    tokenizer_hash = hashlib.sha256(json.dumps(tokenizer_metadata, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    for label, data in (("training", train_ids), ("validation", val_ids)):
        if len(data) < args.context + 2:
            raise SystemExit(
                f"{label.title()} corpus has {len(data)} tokens; need at least "
                f"{args.context + 2}. Add more licensed text or lower --context."
            )

    def batch(source):
        starts = torch.randint(0, len(source) - args.context - 1, (args.batch_size,))
        x = torch.stack([source[i:i + args.context] for i in starts]).to(device)
        y = torch.stack([source[i + 1:i + args.context + 1] for i in starts]).to(device)
        return x, y

    config = {"width": args.width, "heads": args.heads, "layers": args.layers,
              "context": args.context, "vocab_size": vocab_size}
    model = TillbotCore(**config).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    best_val = math.inf
    start_step = 0

    if args.resume:
        if not output.is_file():
            raise SystemExit(f"Cannot resume: checkpoint not found: {output}")
        saved = torch.load(output, map_location=device, weights_only=True)
        saved_config = dict(saved.get("config", {}))
        saved_config.setdefault("vocab_size", 256)
        if saved_config != config:
            raise SystemExit("Checkpoint model config differs from current training arguments.")
        saved_tokenizer = saved.get("tokenizer_metadata", {"type": "utf8-byte-v1"})
        saved_hash = saved.get("tokenizer_sha256", hashlib.sha256(json.dumps(
            saved_tokenizer, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")).hexdigest())
        if saved_hash != tokenizer_hash:
            raise SystemExit("Checkpoint tokenizer differs from the current tokenizer; refusing unsafe resume.")
        model.load_state_dict(saved["model_state"])
        if "optimizer_state" in saved:
            optimizer.load_state_dict(saved["optimizer_state"])
        best_val = float(saved.get("validation_loss", math.inf))
        start_step = int(saved.get("training_steps", 0))
        print(f"Resuming at step {start_step}; best validation loss={best_val:.4f}")

    log_path = output.with_suffix(".metrics.jsonl")
    stale_evaluations = 0
    for step in range(start_step + 1, start_step + args.steps + 1):
        model.train()
        x, y = batch(train_ids)
        _, loss = model(x, y)
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()

        if step == start_step + 1 or step % args.eval_interval == 0 or step == start_step + args.steps:
            model.eval()
            values = []
            with torch.no_grad():
                for _ in range(args.eval_batches):
                    vx, vy = batch(val_ids)
                    _, val_loss = model(vx, vy)
                    values.append(val_loss.item())
            mean_val = sum(values) / len(values)
            improved = mean_val < best_val
            if improved:
                best_val = mean_val
                stale_evaluations = 0
            else:
                stale_evaluations += 1

            record = {"step": step, "train_loss": loss.item(),
                      "validation_loss": mean_val, "best_validation_loss": best_val,
                      "device": str(device), "corpus_sha256": corpus_hash}
            print(json.dumps(record, ensure_ascii=False))
            with log_path.open("a", encoding="utf-8") as log:
                log.write(json.dumps(record, ensure_ascii=False) + "\n")

            state = {
                "model_state": model.state_dict(),
                "optimizer_state": optimizer.state_dict(),
                "config": config,
                "training_steps": step,
                "validation_loss": best_val,
                "tokenizer": "byte-bpe-v1" if tokenizer is not None else "utf8-byte-v1",
                "tokenizer_metadata": tokenizer_metadata,
                "tokenizer_sha256": tokenizer_hash,
                "corpus_sha256": corpus_hash,
            }
            if improved or not output.exists():
                torch.save(state, output)
                print(f"saved best checkpoint: {output}")
            torch.save(state, output.with_suffix(".last.pt"))
            if stale_evaluations >= args.patience:
                print("Early stopping: validation loss did not improve.")
                break

    print("Training run finished. Review held-out quality tests before using any checkpoint.")


if __name__ == "__main__":
    main()
