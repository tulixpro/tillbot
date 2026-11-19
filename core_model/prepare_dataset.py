"""Prepare a reproducible train/validation split from reviewed licensed text files.

Only include documents you have permission to use for machine-learning training.
The script intentionally requires an explicit confirmation flag.
"""
from __future__ import annotations
import argparse, hashlib, json, random
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, help="Directory containing reviewed .txt documents")
    parser.add_argument("--out-dir", default="core_model/data/prepared")
    parser.add_argument("--validation-fraction", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--min-chars", type=int, default=300)
    parser.add_argument("--confirm-licensed-data", action="store_true",
                        help="Confirm every included file is permitted for ML training")
    args = parser.parse_args()
    if not args.confirm_licensed_data:
        parser.error("Review source rights first, then pass --confirm-licensed-data")
    if not 0.05 <= args.validation_fraction <= 0.4:
        parser.error("--validation-fraction must be between 0.05 and 0.4")
    source = Path(args.source_dir)
    files = sorted(p for p in source.rglob("*.txt") if p.is_file())
    if len(files) < 2:
        raise SystemExit("Provide at least two separate .txt documents for a source-level split.")
    docs, manifest = [], []
    for path in files:
        raw = path.read_bytes()
        try:
            content = raw.decode("utf-8").strip()
        except UnicodeDecodeError as exc:
            raise SystemExit(f"{path} is not valid UTF-8: {exc}") from exc
        if len(content) < args.min_chars:
            print(f"Skipping short file: {path} ({len(content)} characters)")
            continue
        relative_path = path.relative_to(source).as_posix()
        docs.append((relative_path, content))
        manifest.append({"file": relative_path, "sha256": hashlib.sha256(raw).hexdigest(),
                         "characters": len(content),
                         "rights_review": "user-confirmed; verify source license separately"})
    if len(docs) < 2:
        raise SystemExit("Fewer than two documents passed --min-chars; add more reviewed text.")
    order = list(range(len(docs)))
    random.Random(args.seed).shuffle(order)
    val_count = max(1, min(len(docs) - 1, round(len(docs) * args.validation_fraction)))
    val_ids = set(order[:val_count])
    train_docs = [doc for i, doc in enumerate(docs) if i not in val_ids]
    val_docs = [doc for i, doc in enumerate(docs) if i in val_ids]
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "train.txt").write_text("\n\n".join(text for _, text in train_docs), encoding="utf-8")
    (out / "val.txt").write_text("\n\n".join(text for _, text in val_docs), encoding="utf-8")
    report = {"seed": args.seed, "validation_fraction": args.validation_fraction,
              "train_files": [name for name, _ in train_docs],
              "validation_files": [name for name, _ in val_docs], "sources": manifest,
              "warning": "Rights were not independently verified by this script."}
    (out / "manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Prepared {len(train_docs)} train and {len(val_docs)} validation documents in {out}")
    print("Check manifest.json and retain original license evidence. No model was trained.")


if __name__ == "__main__":
    main()
