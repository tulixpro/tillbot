"""Train TILLBOT Core from random weights on a UTF-8 text corpus."""
from __future__ import annotations

import argparse
import math
import random
from pathlib import Path

import torch

from model import TillbotCore


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="core_model/data/seed_dialogues.txt")
    parser.add_argument("--out", default="artifacts/tillbot-core.pt")
    parser.add_argument("--steps", type=int, default=5000)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--context", type=int, default=256)
    parser.add_argument("--width", type=int, default=128)
    parser.add_argument("--heads", type=int, default=4)
    parser.add_argument("--layers", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    corpus_path = Path(args.data)
    if not corpus_path.is_file():
        raise SystemExit(f"Training corpus not found: {corpus_path}. See data/README.md.")
    raw = corpus_path.read_text(encoding="utf-8")
    encoded = torch.tensor(list(raw.encode("utf-8")), dtype=torch.long)
    if len(encoded) < args.context + 2:
        raise SystemExit("Corpus is too small. Add substantially more licensed training text.")

    split = int(len(encoded) * 0.95)
    train_data, val_data = encoded[:split], encoded[split:]
    if len(val_data) < args.context + 2:
        val_data = train_data

    def batch(source):
        starts = torch.randint(0, len(source) - args.context - 1, (args.batch_size,))
        x = torch.stack([source[i:i + args.context] for i in starts]).to(device)
        y = torch.stack([source[i + 1:i + args.context + 1] for i in starts]).to(device)
        return x, y

    model = TillbotCore(args.width, args.heads, args.layers, args.context).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    best_val = math.inf
    for step in range(1, args.steps + 1):
        model.train()
        x, y = batch(train_data)
        _, loss = model(x, y)
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()

        if step == 1 or step % 250 == 0:
            model.eval()
            with torch.no_grad():
                vx, vy = batch(val_data)
                _, val_loss = model(vx, vy)
            print(f"step={step} train_loss={loss.item():.4f} val_loss={val_loss.item():.4f}")
            if val_loss.item() < best_val:
                best_val = val_loss.item()
                output = Path(args.out)
                output.parent.mkdir(parents=True, exist_ok=True)
                torch.save({
                    "model_state": model.state_dict(),
                    "config": {
                        "width": args.width, "heads": args.heads,
                        "layers": args.layers, "context": args.context,
                    },
                    "training_steps": step,
                    "validation_loss": best_val,
                    "tokenizer": "utf8-byte-v1",
                }, output)
                print(f"saved best checkpoint: {output}")

    print("Training finished. This prototype is not yet a reliable conversational assistant.")


if __name__ == "__main__":
    main()
