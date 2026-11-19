"""Regression tests for dataset and checkpoint provenance integrity."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from train import validate_resume_metadata
from validate_dataset import validate


class DatasetIntegrityTests(unittest.TestCase):
    def _fixture(self, root: Path):
        source_dir = root / "sources"
        source_dir.mkdir()
        train_source = source_dir / "train.txt"
        val_source = source_dir / "val.txt"
        train_text = "A sufficiently long and unique training document for integrity checks."
        val_text = "A separate validation document that is not present in training data."
        train_source.write_text(train_text, encoding="utf-8")
        val_source.write_text(val_text, encoding="utf-8")
        train_path = root / "train.txt"
        val_path = root / "val.txt"
        train_path.write_text(train_text, encoding="utf-8")
        val_path.write_text(val_text, encoding="utf-8")
        manifest_path = root / "manifest.json"
        manifest = {
            "train_files": ["train.txt"],
            "validation_files": ["val.txt"],
            "train_sha256": hashlib.sha256(train_path.read_bytes()).hexdigest(),
            "validation_sha256": hashlib.sha256(val_path.read_bytes()).hexdigest(),
            "sources": [
                {"file": "train.txt", "sha256": hashlib.sha256(train_source.read_bytes()).hexdigest()},
                {"file": "val.txt", "sha256": hashlib.sha256(val_source.read_bytes()).hexdigest()},
            ],
        }
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        return train_path, val_path, manifest_path, source_dir

    def test_manifest_binds_prepared_split_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            train, val, manifest, sources = self._fixture(Path(tmp))
            report = validate(train, val, manifest, sources, min_chars=10)
            self.assertEqual(report["status"], "ok")
            val.write_text("Changed validation content after manifest creation.", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "validation split SHA-256"):
                validate(train, val, manifest, sources, min_chars=10)

    def test_resume_rejects_changed_dataset(self):
        saved = {
            "corpus_sha256": "old-corpus",
            "dataset_manifest_sha256": "manifest",
            "tokenizer_sha256": "tokenizer",
            "config": {"width": 32, "heads": 4, "layers": 2, "context": 64, "vocab_size": 256},
            "training_config": {"seed": 42},
        }
        with self.assertRaisesRegex(SystemExit, "dataset differs"):
            validate_resume_metadata(
                saved, "new-corpus", "tokenizer", "manifest",
                {"width": 32, "heads": 4, "layers": 2, "context": 64, "vocab_size": 256},
                {"seed": 42},
            )


if __name__ == "__main__":
    unittest.main()
