"""Start a tiny local TILLBOT Core smoke test, then open its terminal chat.

This trains only on the original, tiny project-authored seed dialogues. It does
not create a capable assistant. The random/small checkpoint is for checking
that the local training and inference pipeline runs end-to-end.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "core_model"
CHECKPOINT = ROOT / "artifacts" / "tillbot-core-demo.pt"


def run(command: list[str]) -> None:
    print("\n$", " ".join(str(part) for part in command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=20,
                        help="Tiny smoke-test training steps (default: 20)")
    parser.add_argument("--max-new-tokens", type=int, default=64)
    parser.add_argument("--train-only", action="store_true",
                        help="Train the demo checkpoint but do not start chat")
    args = parser.parse_args()
    if not 1 <= args.steps <= 100:
        parser.error("--steps must be between 1 and 100 for this smoke test")
    if not 1 <= args.max_new_tokens <= 128:
        parser.error("--max-new-tokens must be between 1 and 128")

    print("TILLBOT CORE — lokaler Pipeline-Test")
    print("WICHTIG: Das ist kein fertig trainierter Assistent.")
    print("Es werden nur die kleinen, projektinternen Beispieldialoge verwendet.")
    print("Die Antworten können unsinnig sein. Es wird nichts am Live-Chat geändert.")

    run([
        sys.executable, str(CORE / "train.py"),
        "--profile", "laptop", "--device", "cpu",
        "--data", str(CORE / "data" / "seed_dialogues.txt"),
        "--out", str(CHECKPOINT),
        "--steps", str(args.steps),
        "--eval-interval", str(min(10, args.steps)),
        "--eval-batches", "2",
    ])
    if not args.train_only:
        run([
            sys.executable, str(CORE / "chat.py"),
            "--checkpoint", str(CHECKPOINT),
            "--max-new-tokens", str(args.max_new_tokens),
        ])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
