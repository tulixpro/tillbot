"""Tests for prepared dataset validation."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from validate_dataset import validate


class DatasetValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.sources = self.root / "sources"
        self.sources.mkdir()
        self.train = self.root / "train.txt"
        self.val = self.root / "val.txt"
        self.manifest = self.root / "manifest.json"
        (self.sources / "a.txt").write_text("Training document A with enough content.", encoding="utf-8")
        (self.sources / "b.txt").write_text("Validation document B with enough content.", encoding="utf-8")
        self.train.write_text("Training document A with enough content.", encoding="utf-8")
        self.val.write_text("Validation document B with enough content.", encoding="utf-8")
        self.write_manifest()

    def tearDown(self):
        self.temp.cleanup()

    def write_manifest(self):
        rows = []
        for name in ("a.txt", "b.txt"):
            raw = (self.sources / name).read_bytes()
            rows.append({"file": name, "sha256": hashlib.sha256(raw).hexdigest()})
        self.manifest.write_text(json.dumps({
            "train_files": ["a.txt"], "validation_files": ["b.txt"], "sources": rows
        }), encoding="utf-8")

    def test_valid_split_and_source_hashes(self):
        result = validate(self.train, self.val, self.manifest, self.sources)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["source_hashes_verified"], 2)
        self.assertEqual(result["normalized_document_overlap"], 0)

    def test_normalized_duplicate_between_splits_is_rejected(self):
        self.val.write_text("  TRAINING   document A with enough content.  ", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "leakage"):
            validate(self.train, self.val, self.manifest)

    def test_manifest_source_overlap_is_rejected(self):
        data = json.loads(self.manifest.read_text(encoding="utf-8"))
        data["validation_files"] = ["a.txt"]
        self.manifest.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "both splits"):
            validate(self.train, self.val, self.manifest)

    def test_source_hash_mismatch_is_rejected(self):
        (self.sources / "a.txt").write_text("Changed source content.", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            validate(self.train, self.val, self.manifest, self.sources)

    def test_manifest_path_traversal_is_rejected(self):
        data = json.loads(self.manifest.read_text(encoding="utf-8"))
        data["train_files"] = ["../outside.txt"]
        data["sources"][0]["file"] = "../outside.txt"
        self.manifest.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "escapes"):
            validate(self.train, self.val, self.manifest, self.sources)


if __name__ == "__main__":
    unittest.main()
