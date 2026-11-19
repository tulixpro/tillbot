"""Regression tests for tokenizer/checkpoint coupling and legacy compatibility."""
import hashlib
import json
import unittest

from tokenizer import ByteBPETokenizer
from tokenizer_runtime import tokenizer_from_checkpoint, encode_text, decode_tokens


class TokenizerRuntimeTests(unittest.TestCase):
    def checkpoint(self, metadata, vocab_size):
        digest = hashlib.sha256(json.dumps(
            metadata, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")).hexdigest()
        return {
            "config": {"vocab_size": vocab_size},
            "tokenizer_metadata": metadata,
            "tokenizer_sha256": digest,
        }

    def test_legacy_checkpoint_uses_byte_codec(self):
        self.assertIsNone(tokenizer_from_checkpoint({"config": {"context": 32}}))
        self.assertEqual(encode_text("ä", None), list("ä".encode("utf-8")))
        self.assertEqual(decode_tokens(list("ä".encode("utf-8")), None), "ä")

    def test_bpe_checkpoint_round_trips_text(self):
        text = "TILLBOT Grüße 😀 " * 10
        trained = ByteBPETokenizer.train([text], vocab_size=280)
        metadata = trained.to_dict()
        loaded = tokenizer_from_checkpoint(self.checkpoint(metadata, trained.vocab_size))
        self.assertEqual(decode_tokens(encode_text(text, loaded), loaded), text)

    def test_tampered_metadata_hash_is_rejected(self):
        tokenizer = ByteBPETokenizer.train(["abc " * 20], vocab_size=270)
        checkpoint = self.checkpoint(tokenizer.to_dict(), tokenizer.vocab_size)
        checkpoint["tokenizer_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "hash"):
            tokenizer_from_checkpoint(checkpoint)

    def test_model_and_tokenizer_vocab_mismatch_is_rejected(self):
        tokenizer = ByteBPETokenizer.train(["abc " * 20], vocab_size=270)
        with self.assertRaisesRegex(ValueError, "does not match"):
            tokenizer_from_checkpoint(self.checkpoint(tokenizer.to_dict(), 256))


if __name__ == "__main__":
    unittest.main()
