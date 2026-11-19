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

    def test_rejects_invalid_token_ids_and_shapes(self):
        with self.assertRaisesRegex(ValueError, "byte range"):
            self.model(torch.tensor([[256]], dtype=torch.long))
        with self.assertRaisesRegex(ValueError, "non-empty"):
            self.model(torch.empty((1, 0), dtype=torch.long))
        with self.assertRaisesRegex(ValueError, "match"):
            self.model(torch.ones((1, 4), dtype=torch.long),
                       torch.ones((1, 3), dtype=torch.long))

    def test_greedy_generation_is_deterministic(self):
        prompt = torch.tensor([[65, 66]], dtype=torch.long)
        first = self.model.generate(prompt, max_new_tokens=5, do_sample=False)
        second = self.model.generate(prompt, max_new_tokens=5, do_sample=False)
        self.assertTrue(torch.equal(first, second))

    def test_cached_and_uncached_greedy_generation_match(self):
        prompt = torch.tensor([[65, 66, 67, 68]], dtype=torch.long)
        cached = self.model.generate(prompt, max_new_tokens=6, do_sample=False, use_cache=True)
        plain = self.model.generate(prompt, max_new_tokens=6, do_sample=False, use_cache=False)
        self.assertTrue(torch.equal(cached, plain))

    def test_incremental_cache_matches_full_forward_logits(self):
        prompt = torch.tensor([[10, 20, 30, 40]], dtype=torch.long)
        next_byte = torch.tensor([[50]], dtype=torch.long)
        with torch.no_grad():
            _, _, cache = self.model(prompt, use_cache=True)
            cached_logits, _, _ = self.model(next_byte, past_key_values=cache, use_cache=True)
            full_logits, _, _ = self.model(torch.cat((prompt, next_byte), dim=1))
        self.assertTrue(torch.allclose(cached_logits[:, -1], full_logits[:, -1], atol=1e-5))

    def test_generation_rejects_invalid_sampling_parameters(self):
        prompt = torch.tensor([[65]], dtype=torch.long)
        with self.assertRaisesRegex(ValueError, "temperature"):
            self.model.generate(prompt, temperature=0)
        with self.assertRaisesRegex(ValueError, "top_k"):
            self.model.generate(prompt, top_k=300)
        with self.assertRaisesRegex(ValueError, "repetition_penalty"):
            self.model.generate(prompt, repetition_penalty=0.5)

    def test_zero_token_generation_returns_prompt_unchanged(self):
        prompt = torch.tensor([[65, 66]], dtype=torch.long)
        result = self.model.generate(prompt, max_new_tokens=0)
        self.assertTrue(torch.equal(result, prompt))


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


class DatasetAuditTests(unittest.TestCase):
    def test_detects_duplicates_and_private_data_patterns_without_printing_values(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            source.mkdir()
            first = "A sufficiently long sample document. " * 12
            (source / "one.txt").write_text(first + "\nContact test.person@example.org", encoding="utf-8")
            (source / "two.txt").write_text("  " + first + "\nContact test.person@example.org  ", encoding="utf-8")
            report_path = Path(temp) / "audit.json"
            result = subprocess.run(
                [sys.executable, str(ROOT / "audit_dataset.py"),
                 "--source-dir", str(source), "--report", str(report_path)],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 1)
            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(len(report["normalized_duplicate_groups"]), 1)
            self.assertTrue(any("possible_email_address" in item.get("warnings", [])
                                for item in report["warnings"]))
            self.assertNotIn("test.person@example.org", result.stdout)

    def test_reports_invalid_utf8(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            source.mkdir()
            (source / "broken.txt").write_bytes(b"\xff\xfe")
            report_path = Path(temp) / "audit.json"
            result = subprocess.run(
                [sys.executable, str(ROOT / "audit_dataset.py"),
                 "--source-dir", str(source), "--report", str(report_path)],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 1)
            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(report["documents"][0]["status"], "invalid_utf8")

class JsonlImportTests(unittest.TestCase):
    def test_imports_tillbot_jsonl_and_deduplicates(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "examples.jsonl"
            row = {"messages":[{"role":"user","content":"Was ist KI?"},{"role":"assistant","content":"KI ist ein Forschungsfeld."}]}
            source.write_text(json.dumps(row, ensure_ascii=False)+"\n"+json.dumps(row, ensure_ascii=False)+"\n", encoding="utf-8")
            output = root / "documents"
            result = subprocess.run(
                [sys.executable, str(ROOT / "import_jsonl.py"), "--input", str(source),
                 "--out-dir", str(output), "--confirm-licensed-data"],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((output / "example-000001.txt").is_file())
            self.assertFalse((output / "example-000002.txt").exists())
            manifest = json.loads((output / "import-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["unique_examples"], 1)

    def test_import_requires_rights_confirmation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "examples.jsonl"
            source.write_text(json.dumps({"prompt":"Was ist KI?","completion":"KI ist ein Forschungsfeld."}), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(ROOT / "import_jsonl.py"), "--input", str(source),
                 "--out-dir", str(root / "out")], capture_output=True, text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("--confirm-licensed-data", result.stderr)

    def test_rejects_nonempty_output_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "examples.jsonl"
            source.write_text(json.dumps({"prompt":"Was ist KI?","completion":"KI ist ein Forschungsfeld."}), encoding="utf-8")
            output = root / "out"
            output.mkdir()
            (output / "keep.txt").write_text("keep", encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(ROOT / "import_jsonl.py"), "--input", str(source),
                 "--out-dir", str(output), "--confirm-licensed-data"],
                capture_output=True, text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("must be empty", result.stderr)


class TrainingSmokeTests(unittest.TestCase):
    def test_tiny_cpu_training_writes_checkpoint_and_metrics(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            corpus = root / "corpus.txt"
            corpus.write_text(
                "Erster Beispieldialog mit genügend Text für das Training.\n\n"
                "Zweiter Beispieldialog mit genügend Text für die Validierung.\n\n"
                "Dritter Beispieldialog für einen kleinen Testlauf.\n\n"
                "Vierter Beispieldialog zum Prüfen des Trainingsablaufs.",
                encoding="utf-8",
            )
            checkpoint = root / "model.pt"
            result = subprocess.run(
                [sys.executable, str(ROOT / "train.py"), "--data", str(corpus),
                 "--out", str(checkpoint), "--steps", "2", "--batch-size", "2",
                 "--context", "8", "--width", "8", "--heads", "2", "--layers", "1",
                 "--eval-interval", "1", "--eval-batches", "1", "--patience", "2"],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(checkpoint.is_file())
            self.assertTrue(checkpoint.with_suffix(".metrics.jsonl").is_file())
            self.assertTrue(checkpoint.with_suffix(".last.pt").is_file())
            report = root / "probe.md"
            probe = subprocess.run(
                [sys.executable, str(ROOT / "probe.py"), "--checkpoint", str(checkpoint),
                 "--out", str(report), "--tokens", "2"],
                capture_output=True, text=True,
            )
            self.assertEqual(probe.returncode, 0, probe.stderr)
            self.assertTrue(report.is_file())
            self.assertIn("prompt injection", report.read_text(encoding="utf-8"))



if __name__ == "__main__":
    unittest.main()
