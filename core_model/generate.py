"""Generate text from a locally trained TILLBOT Core checkpoint."""
import argparse
import torch

from model import TillbotCore


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", default="artifacts/tillbot-core.pt")
    parser.add_argument("--prompt", default="TILLBOT:")
    parser.add_argument("--tokens", type=int, default=160)
    args = parser.parse_args()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    checkpoint = torch.load(args.checkpoint, map_location=device, weights_only=True)
    config = checkpoint["config"]
    model = TillbotCore(**config).to(device)
    model.load_state_dict(checkpoint["model_state"])
    prompt = torch.tensor(list(args.prompt.encode("utf-8")), dtype=torch.long, device=device)[None, :]
    result = model.generate(prompt, max_new_tokens=args.tokens)
    print(result[0].tolist().__class__ and bytes(result[0].tolist()).decode("utf-8", errors="replace"))


if __name__ == "__main__":
    main()
