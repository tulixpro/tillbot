"""CPU-friendly regression tests for the TILLBOT Core prototype.

Run from the repository root with:
    python -m unittest discover -s core_model -p 'test_*.py' -v
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import torch

from model import TillbotCore

ROOT = Path(__file__).resolve().parent


class ModelTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(7)
        self.model = TillbotCore(width=16, heads=4, layers=2, context=16, dropout=0.0)
        self.model.eval()

    def test_forward_logits_and_loss_shapes(self):
        tokens = torch.randint(0, 256, (2, 8), dtype=torch.long)
        logits, loss = self.model(tokens, tokens)
        self.assertEqual(tuple(logits.shape), (2, 8, 256))
        self.assertIsNotNone(loss)
        self.assertTrue(torch.isfinite(loss).item())

    def test_causal_attention_does_not_read_future_tokens(self):
        left = torch.tensor([[1, 2, 3, 4, 5]], dtype=torch.long)
        right = torch.tensor([[1, 2, 3, 90, 91]], dtype=torch.long)
        with torch.no_grad():
            left_logits, _ = self.model(left)
            right_logits, _ = self.model(right)
        self.assertTrue(torch.allclose(left_logits[:, :3], right_logits[:, :3], atol=1e-6))

    def test_generation_preserves_prompt_and_adds_bytes(self):
        prompt = torch.tensor([[84, 73, 76]], dtype=torch.long)
        result = self.model.generate(prompt, max_new_tokens=3, top_k=8)
        self.assertEqual(tuple(result.shape), (1, 6))
        self.assertTrue(torch.equal(result[:, :3], prompt))
        self.assertTrue(torch.all((result >= 0) & (result <= 255)).item())

    def test_context_limit_is_enforced(self):
        too_long = torch.zeros((1, 17), dtype=torch.long)
        with self.assertRaisesRegex(ValueError, "exceeds context"):
            self.model(too_long)


class DatasetPreparationTests(unittest.TestCase):
    def test_requires_explicit_license_confirmation(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            source.mkdir()
            (source / "one.txt").write_text("A" * 400, encoding="utf-8")
            (source / "two.txt").write_text("B" * 400, encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(ROOT / "prepare_dataset.py"),
                 "--source-dir", str(source), "--out-dir", str(Path(temp) / "out")],
                capture_output=True, text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("--confirm-licensed-data", result.stderr)

    def test_creates_reproducible_source_level_split_and_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            source.mkdir()
            for name, letter in (("a.txt", "A"), ("b.txt", "B"), ("c.txt", "C"), ("d.txt", "D")):
                (source / name).write_text(letter * 500, encoding="utf-8")
            out1, out2 = Path(temp) / "out1", Path(temp) / "out2"
            command = [sys.executable, str(ROOT / "prepare_dataset.py"),
                       "--source-dir", str(source), "--confirm-licensed-data",
                       "--validation-fraction", "0.25", "--seed", "19"]
            first = subprocess.run(command + ["--out-dir", str(out1)], capture_output=True, text=True)
            second = subprocess.run(command + ["--out-dir", str(out2)], capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            manifest1 = json.loads((out1 / "manifest.json").read_text(encoding="utf-8"))
            manifest2 = json.loads((out2 / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest1["train_files"], manifest2["train_files"])
            self.assertEqual(manifest1["validation_files"], manifest2["validation_files"])
            self.assertFalse(set(manifest1["train_files"]) & set(manifest1["validation_files"]))
            self.assertEqual(len(manifest1["sources"]), 4)


if __name__ == "__main__":
    unittest.main()
