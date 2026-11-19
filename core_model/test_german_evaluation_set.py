"""Validate the German-first evaluation set stays well-formed and held out."""
import json
import unittest
from pathlib import Path


class GermanEvaluationSetTests(unittest.TestCase):
    def test_cases_are_valid_unique_and_held_out(self):
        path = Path(__file__).parent / "data" / "german_eval.jsonl"
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        self.assertGreaterEqual(len(rows), 15)
        ids = [row["id"] for row in rows]
        self.assertEqual(len(ids), len(set(ids)))
        for row in rows:
            self.assertEqual(row["language"], "de")
            self.assertEqual(row["split"], "evaluation_only")
            self.assertTrue(row["prompt"].strip())
            self.assertTrue(row["scoring_criteria"].strip())


if __name__ == "__main__":
    unittest.main()
