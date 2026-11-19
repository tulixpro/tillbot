"""Tests for the deterministic TILLBOT byte-level BPE tokenizer."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tokenizer import ByteBPETokenizer


class ByteBPETokenizerTests(unittest.TestCase):
    def test_round_trip_preserves_unicode_text(self):
        text = "Grüße aus Köln! ß, ÄÖÜ, 😀 — TILLBOT"
        tokenizer = ByteBPETokenizer.train([text * 20], vocab_size=300)
        self.assertEqual(tokenizer.decode(tokenizer.encode(text)), text)

    def test_training_is_deterministic(self):
        corpus = ["TILLBOT Core lernt Deutsch. " * 20, "Ein zweites Dokument. " * 20]
        first = ByteBPETokenizer.train(corpus, vocab_size=300)
        second = ByteBPETokenizer.train(corpus, vocab_size=300)
        self.assertEqual(first.to_dict(), second.to_dict())

    def test_vocab_size_never_exceeds_requested_limit(self):
        tokenizer = ByteBPETokenizer.train(["abcabcabc " * 10], vocab_size=270)
        self.assertLessEqual(tokenizer.vocab_size, 270)
        self.assertGreaterEqual(tokenizer.vocab_size, 256)

    def test_no_merge_below_minimum_frequency(self):
        tokenizer = ByteBPETokenizer.train(["unique"], vocab_size=300, min_frequency=3)
        self.assertEqual(tokenizer.vocab_size, 256)

    def test_save_and_load_preserve_encoding(self):
        text = "TILLBOT lernt Schritt für Schritt."
        tokenizer = ByteBPETokenizer.train([text * 30], vocab_size=320)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tokenizer.json"
            tokenizer.save(path)
            restored = ByteBPETokenizer.load(path)
            self.assertEqual(restored.to_dict(), tokenizer.to_dict())
            self.assertEqual(restored.encode(text), tokenizer.encode(text))
            self.assertEqual(restored.decode(restored.encode(text)), text)

    def test_invalid_token_id_is_rejected(self):
        tokenizer = ByteBPETokenizer()
        with self.assertRaisesRegex(ValueError, "out of range"):
            tokenizer.decode([256])

    def test_invalid_merge_order_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "earlier vocabulary"):
            ByteBPETokenizer([(256, 65)])

    def test_invalid_tokenizer_format_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            path.write_text(json.dumps({"format": "other", "format_version": 1}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unsupported"):
                ByteBPETokenizer.load(path)


if __name__ == "__main__":
    unittest.main()
