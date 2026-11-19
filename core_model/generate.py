"""Generate text from a locally trained TILLBOT Core checkpoint."""
import argparse
import torch

from model import TillbotCore


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", default="artifacts/tillbot-core.pt")
    parser.add_argument("--prompt", default="TILLBOT:")
    parser.add_argument("--tokens", type=int, default=160)
    parser.add_argument("--temperature", type=float, default=0.8)
    parser.add_argument("--top-k", type=int, default=40,
                        help="0 disables top-k filtering; otherwise 1..256")
    parser.add_argument("--repetition-penalty", type=float, default=1.0,
                        help="1.0 disables the byte-level repetition heuristic")
    parser.add_argument("--greedy", action="store_true",
                        help="Use deterministic greedy decoding instead of sampling")
    args = parser.parse_args()
    if args.tokens < 0:
        parser.error("--tokens must be non-negative")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    checkpoint = torch.load(args.checkpoint, map_location=device, weights_only=True)
    config = checkpoint["config"]
    model = TillbotCore(**config).to(device)
    model.load_state_dict(checkpoint["model_state"])
    prompt = torch.tensor(list(args.prompt.encode("utf-8")), dtype=torch.long, device=device)[None, :]
    result = model.generate(
        prompt,
        max_new_tokens=args.tokens,
        temperature=args.temperature,
        top_k=args.top_k,
        repetition_penalty=args.repetition_penalty,
        do_sample=not args.greedy,
    )
    print(bytes(result[0].tolist()).decode("utf-8", errors="replace"))


if __name__ == "__main__":
    main()
