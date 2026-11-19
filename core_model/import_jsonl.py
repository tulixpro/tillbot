"""Convert reviewed TILLBOT JSONL examples into one UTF-8 text document per pair.

The output can then be audited and passed to prepare_dataset.py for a
source-level train/validation split. This script does not verify licenses.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def extract_pair(row: object, line_number: int) -> tuple[str, str]:
    if not isinstance(row, dict):
        raise ValueError(f"Line {line_number}: expected a JSON object")
    prompt, completion = row.get("prompt"), row.get("completion")
    messages = row.get("messages")
    if isinstance(messages, list):
        user = next((m.get("content") for m in messages
                     if isinstance(m, dict) and m.get("role") == "user"
                     and isinstance(m.get("content"), str)), None)
        assistant = next((m.get("content") for m in reversed(messages)
                          if isinstance(m, dict) and m.get("role") == "assistant"
                          and isinstance(m.get("content"), str)), None)
        prompt, completion = user, assistant
    if not isinstance(prompt, str) or not isinstance(completion, str):
        raise ValueError(f"Line {line_number}: missing user prompt or assistant completion")
    prompt, completion = prompt.strip(), completion.strip()
    if not 3 <= len(prompt) <= 6000 or not 2 <= len(completion) <= 8000:
        raise ValueError(f"Line {line_number}: prompt or completion length is outside allowed bounds")
    return prompt, completion


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Reviewed JSONL file exported from TILLBOT")
    parser.add_argument("--out-dir", required=True, help="New or empty output directory")
    parser.add_argument("--confirm-licensed-data", action="store_true",
                        help="Confirm all examples are legally usable for ML training")
    args = parser.parse_args()
    if not args.confirm_licensed_data:
        parser.error("Review source rights first, then pass --confirm-licensed-data")
    source = Path(args.input)
    if not source.is_file():
        raise SystemExit(f"Input file not found: {source}")
    raw = source.read_bytes()
    if len(raw) > 100_000_000:
        raise SystemExit("Input file exceeds the 100 MB safety limit.")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SystemExit(f"Input must be valid UTF-8: {exc}") from exc
    pairs = []
    seen = set()
    for line_number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            pair = extract_pair(row, line_number)
        except (json.JSONDecodeError, ValueError) as exc:
            raise SystemExit(str(exc)) from exc
        key = (pair[0].casefold(), pair[1].casefold())
        if key not in seen:
            seen.add(key)
            pairs.append(pair)
        if len(pairs) > 50_000:
            raise SystemExit("More than 50,000 unique examples; split the input into smaller files.")
    if not pairs:
        raise SystemExit("No valid examples found in the JSONL file.")
    output = Path(args.out_dir)
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise SystemExit(f"Output directory must be empty: {output}")
    for index, (prompt, completion) in enumerate(pairs, 1):
        document = f"Nutzer: {prompt}\nTILLBOT: {completion}\n"
        (output / f"example-{index:06d}.txt").write_text(document, encoding="utf-8")
    manifest = {
        "input_file": source.name,
        "input_sha256": hashlib.sha256(raw).hexdigest(),
        "unique_examples": len(pairs),
        "rights_review": "user-confirmed; verify source license separately",
        "notice": "This converter does not verify licenses or guarantee absence of personal data."
    }
    (output / "import-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Imported {len(pairs)} unique examples into {output}")
    print("Next: audit the directory, then create a source-level train/validation split.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
