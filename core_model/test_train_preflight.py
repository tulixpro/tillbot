"""Regression test: strict data validation must stop training before model setup."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from train import main


class StrictTrainingPreflightTests(unittest.TestCase):
    def test_duplicate_documents_abort_before_training(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            train = root / "train.txt"
            validation = root / "validation.txt"
            sources = root / "sources"
            sources.mkdir()
            source_a = sources / "a.txt"
            source_b = sources / "b.txt"
            text_a = "A sufficiently long training document for the preflight test."
            text_b = "A sufficiently long validation document for the preflight test."
            source_a.write_text(text_a, encoding="utf-8")
            source_b.write_text(text_b, encoding="utf-8")
            train.write_text(text_a, encoding="utf-8")
            # Same normalized document in both splits must stop the run.
            validation.write_text("  " + text_a.lower() + "  ", encoding="utf-8")
            import hashlib
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({
                "train_files": ["a.txt"],
                "validation_files": ["b.txt"],
                "sources": [
                    {"file": "a.txt", "sha256": hashlib.sha256(source_a.read_bytes()).hexdigest()},
                    {"file": "b.txt", "sha256": hashlib.sha256(source_b.read_bytes()).hexdigest()},
                ],
            }), encoding="utf-8")
            args = [
                "train.py", "--profile", "laptop", "--device", "cpu",
                "--train-data", str(train), "--val-data", str(validation),
                "--dataset-manifest", str(manifest), "--source-dir", str(sources),
                "--strict-data-validation", "--steps", "1",
            ]
            with patch.object(sys, "argv", args):
                with self.assertRaisesRegex(SystemExit, "Strict dataset validation failed"):
                    main()


if __name__ == "__main__":
    unittest.main()
