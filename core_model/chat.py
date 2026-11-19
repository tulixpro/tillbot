"""Interactive terminal chat for a locally trained TILLBOT Core checkpoint.

This runs only a local checkpoint. It does not connect to the hosted TILLBOT API.
"""
from __future__ import annotations

import argparse

import torch

from model import TillbotCore
from tokenizer_runtime import tokenizer_from_checkpoint, encode_text, decode_tokens


def main() -> None:
    parser = argparse.ArgumentParser(description="Chat with a local TILLBOT Core checkpoint")
    parser.add_argument("--checkpoint", default="artifacts/tillbot-core.pt")
    parser.add_argument("--max-new-tokens", type=int, default=180)
    parser.add_argument("--temperature", type=float, default=0.8)
    parser.add_argument("--top-k", type=int, default=40)
    args = parser.parse_args()

    if args.max_new_tokens < 1 or args.max_new_tokens > 1024:
        raise SystemExit("--max-new-tokens must be between 1 and 1024")
    if not 0.1 <= args.temperature <= 2.0:
        raise SystemExit("--temperature must be between 0.1 and 2.0")
    if args.top_k < 0 or args.top_k > 256:
        raise SystemExit("--top-k must be between 0 and 256")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    try:
        checkpoint = torch.load(args.checkpoint, map_location=device, weights_only=True)
    except FileNotFoundError:
        raise SystemExit(
            f"Checkpoint not found: {args.checkpoint}. Train the model first; "
            "see core_model/README.md."
        )

    tokenizer = tokenizer_from_checkpoint(checkpoint)
    config = checkpoint["config"]
    model = TillbotCore(**config).to(device)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()

    print("TILLBOT Core — lokaler Modell-Prototyp")
    print("Hinweis: Die Antwortqualität hängt vollständig vom Trainingsstand ab.")
    print("Beenden mit /exit.\n")

    history = ""
    while True:
        try:
            user_text = input("Du: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nTILLBOT Core beendet.")
            break
        if not user_text:
            continue
        if user_text.lower() in {"/exit", "/quit"}:
            print("TILLBOT Core beendet.")
            break

        prompt = history + f"\nNutzer: {user_text}\nTILLBOT:"
        prompt_ids = encode_text(prompt, tokenizer)
        # Keep the prompt within the model's context window.
        prompt_ids = prompt_ids[-config["context"]:]
        tokens = torch.tensor(prompt_ids, dtype=torch.long, device=device)[None, :]
        with torch.no_grad():
            output = model.generate(
                tokens,
                max_new_tokens=args.max_new_tokens,
                temperature=args.temperature,
                top_k=args.top_k,
            )
        continuation = decode_tokens(output[0, len(prompt_ids):].tolist(), tokenizer).strip()
        print(f"TILLBOT: {continuation or '(keine Ausgabe)'}\n")

        history += f"\nNutzer: {user_text}\nTILLBOT: {continuation}"
        # Retain only recent context so the next turn fits in the model window.
        history = history[-max(1, config["context"] // 2):]


if __name__ == "__main__":
    main()
