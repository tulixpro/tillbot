"""Deterministic byte-level BPE tokenizer for TILLBOT Core.

The byte vocabulary (IDs 0..255) guarantees lossless UTF-8 byte coverage.
Merge rules are learned only from the supplied training text; callers must not
fit this tokenizer on validation or test documents.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Iterable


class ByteBPETokenizer:
    FORMAT_VERSION = 1
    BASE_VOCAB_SIZE = 256

    def __init__(self, merges: list[tuple[int, int]] | None = None):
        raw_merges = list(merges or [])
        self.merges = [tuple(pair) if isinstance(pair, (tuple, list)) else pair
                       for pair in raw_merges]
        self._validate_merges()
        self._rank = {pair: self.BASE_VOCAB_SIZE + index
                      for index, pair in enumerate(self.merges)}
        self.vocab_size = self.BASE_VOCAB_SIZE + len(self.merges)
        self._pieces: list[bytes] = [bytes([value]) for value in range(256)]
        for left, right in self.merges:
            self._pieces.append(self._pieces[left] + self._pieces[right])

    def _validate_merges(self) -> None:
        seen = set()
        for index, pair in enumerate(self.merges):
            if (not isinstance(pair, (tuple, list)) or len(pair) != 2
                    or any(not isinstance(value, int) for value in pair)):
                raise ValueError("each merge must contain exactly two integer token IDs")
            left, right = pair
            new_id = self.BASE_VOCAB_SIZE + index
            if not (0 <= left < new_id and 0 <= right < new_id):
                raise ValueError("merge operands must refer to earlier vocabulary tokens")
            if (left, right) in seen:
                raise ValueError("duplicate merge rule")
            seen.add((left, right))

    @classmethod
    def train(cls, texts: Iterable[str | bytes], vocab_size: int = 2048,
              min_frequency: int = 2) -> "ByteBPETokenizer":
        if not isinstance(vocab_size, int) or vocab_size < cls.BASE_VOCAB_SIZE:
            raise ValueError("vocab_size must be at least 256")
        if not isinstance(min_frequency, int) or min_frequency < 2:
            raise ValueError("min_frequency must be at least 2")
        sequences = []
        for text in texts:
            raw = text if isinstance(text, bytes) else text.encode("utf-8")
            if not raw:
                continue
            sequences.append(list(raw))
        if not sequences:
            raise ValueError("at least one non-empty training text is required")

        merges: list[tuple[int, int]] = []
        while cls.BASE_VOCAB_SIZE + len(merges) < vocab_size:
            counts: Counter[tuple[int, int]] = Counter()
            for sequence in sequences:
                counts.update(zip(sequence, sequence[1:]))
            if not counts:
                break
            # Highest frequency wins; lexicographic order makes ties reproducible.
            pair, frequency = min(counts.items(), key=lambda item: (-item[1], item[0]))
            if frequency < min_frequency:
                break
            new_id = cls.BASE_VOCAB_SIZE + len(merges)
            merged_sequences = []
            for sequence in sequences:
                result = []
                cursor = 0
                while cursor < len(sequence):
                    if (cursor + 1 < len(sequence)
                            and (sequence[cursor], sequence[cursor + 1]) == pair):
                        result.append(new_id)
                        cursor += 2
                    else:
                        result.append(sequence[cursor])
                        cursor += 1
                merged_sequences.append(result)
            sequences = merged_sequences
            merges.append(pair)
        return cls(merges)

    def encode(self, text: str | bytes) -> list[int]:
        raw = text if isinstance(text, bytes) else text.encode("utf-8")
        tokens = list(raw)
        while len(tokens) > 1:
            candidates = [(self._rank[pair], index)
                          for index, pair in enumerate(zip(tokens, tokens[1:]))
                          if pair in self._rank]
            if not candidates:
                break
            merge_id, _ = min(candidates)
            pair = self.merges[merge_id - self.BASE_VOCAB_SIZE]
            result = []
            cursor = 0
            while cursor < len(tokens):
                if (cursor + 1 < len(tokens)
                        and (tokens[cursor], tokens[cursor + 1]) == pair):
                    result.append(merge_id)
                    cursor += 2
                else:
                    result.append(tokens[cursor])
                    cursor += 1
            tokens = result
        return tokens

    def decode(self, token_ids: Iterable[int]) -> str:
        output = bytearray()
        for token_id in token_ids:
            if not isinstance(token_id, int) or not 0 <= token_id < self.vocab_size:
                raise ValueError(f"token ID out of range: {token_id!r}")
            output.extend(self._pieces[token_id])
        return output.decode("utf-8", errors="replace")

    def to_dict(self) -> dict:
        return {
            "format": "tillbot-byte-bpe",
            "format_version": self.FORMAT_VERSION,
            "base_vocab_size": self.BASE_VOCAB_SIZE,
            "vocab_size": self.vocab_size,
            "merges": [list(pair) for pair in self.merges],
        }

    def save(self, path: str | Path) -> None:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "ByteBPETokenizer":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if (data.get("format") != "tillbot-byte-bpe"
                or data.get("format_version") != cls.FORMAT_VERSION
                or data.get("base_vocab_size") != cls.BASE_VOCAB_SIZE):
            raise ValueError("unsupported tokenizer file format")
        tokenizer = cls(data.get("merges"))
        if data.get("vocab_size") != tokenizer.vocab_size:
            raise ValueError("tokenizer vocabulary size does not match merge table")
        return tokenizer


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", action="append", required=True,
                        help="Reviewed training text file; may be supplied more than once")
    parser.add_argument("--output", default="artifacts/tillbot-tokenizer.json")
    parser.add_argument("--vocab-size", type=int, default=2048)
    parser.add_argument("--min-frequency", type=int, default=2)
    args = parser.parse_args()
    texts = []
    for filename in args.input:
        raw = Path(filename).read_bytes()
        try:
            texts.append(raw.decode("utf-8"))
        except UnicodeDecodeError as exc:
            parser.error(f"{filename} is not valid UTF-8: {exc}")
    tokenizer = ByteBPETokenizer.train(
        texts, vocab_size=args.vocab_size, min_frequency=args.min_frequency
    )
    tokenizer.save(args.output)
    print(json.dumps({
        "tokenizer": args.output,
        "vocab_size": tokenizer.vocab_size,
        "merge_count": len(tokenizer.merges),
        "notice": "Fit only on reviewed training documents, never validation/test data."
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
