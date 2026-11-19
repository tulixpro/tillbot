"""Load and verify the tokenizer stored with a Core checkpoint."""
from __future__ import annotations

import hashlib
import json

from tokenizer import ByteBPETokenizer


def tokenizer_from_checkpoint(checkpoint):
    metadata = checkpoint.get("tokenizer_metadata")
    if metadata is None:
        # Historical checkpoints used raw UTF-8 bytes and had no tokenizer metadata.
        return None
    digest = hashlib.sha256(json.dumps(
        metadata, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")).hexdigest()
    if checkpoint.get("tokenizer_sha256") != digest:
        raise ValueError("checkpoint tokenizer metadata hash is invalid")
    if metadata.get("type") == "utf8-byte-v1":
        vocab_size = 256
        tokenizer = None
    elif metadata.get("format") == "tillbot-byte-bpe":
        tokenizer = ByteBPETokenizer(metadata.get("merges"))
        if metadata.get("vocab_size") != tokenizer.vocab_size:
            raise ValueError("checkpoint tokenizer vocabulary is inconsistent")
        vocab_size = tokenizer.vocab_size
    else:
        raise ValueError("unsupported checkpoint tokenizer")
    if checkpoint.get("config", {}).get("vocab_size", 256) != vocab_size:
        raise ValueError("checkpoint model vocabulary does not match its tokenizer")
    return tokenizer


def encode_text(text: str, tokenizer):
    return tokenizer.encode(text) if tokenizer is not None else list(text.encode("utf-8"))


def decode_tokens(token_ids, tokenizer):
    return tokenizer.decode(token_ids) if tokenizer is not None else bytes(token_ids).decode(
        "utf-8", errors="replace"
    )
