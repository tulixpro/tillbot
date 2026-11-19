"""Audit a local TILLBOT Core corpus before training.

Reports document sizes, exact/normalized duplicates and likely personal-data
patterns without printing matched text. It does not verify copyright or licenses.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

EMAIL = re.compile(r"(?i)\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b")
PHONE = re.compile(r"(?<!\\w)(?:\\+?\\d[\\d ()/-]{7,}\\d)(?!\\w)")
SECRET = re.compile(r"(?i)\\b(password|passwort|api[_ -]?key|secret|token)\\s*[:=]\\s*[^\\s]{4,}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--min-chars", type=int, default=300)
    parser.add_argument("--report", default="core_model/data/audit-report.json")
    args = parser.parse_args()
    root = Path(args.source_dir)
    if not root.is_dir():
        raise SystemExit(f"Source directory not found: {root}")
    files = sorted(p for p in root.rglob("*.txt") if p.is_file())
    if not files:
        raise SystemExit("No .txt files found.")
    seen: dict[str, str] = {}
    rows = []
    duplicates = []
    warnings = []
    total_chars = 0
    for path in files:
        rel = path.relative_to(root).as_posix()
        raw = path.read_bytes()
        try:
            content = raw.decode("utf-8")
        except UnicodeDecodeError:
            rows.append({"file": rel, "status": "invalid_utf8", "characters": 0})
            warnings.append({"file": rel, "warning": "invalid_utf8"})
            continue
        normalized = " ".join(content.split())
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        if digest in seen:
            duplicates.append({"file": rel, "duplicate_of": seen[digest]})
        else:
            seen[digest] = rel
        flags = []
        if len(content.strip()) < args.min_chars:
            flags.append("too_short")
        if EMAIL.search(content):
            flags.append("possible_email_address")
        if PHONE.search(content):
            flags.append("possible_phone_number")
        if SECRET.search(content):
            flags.append("possible_secret_or_credential")
        if flags:
            warnings.append({"file": rel, "warnings": flags})
        rows.append({"file": rel, "status": "ok", "characters": len(content),
                     "sha256": hashlib.sha256(raw).hexdigest(), "flags": flags})
        total_chars += len(content)
    report = {
        "files_seen": len(files),
        "valid_utf8_files": sum(row["status"] == "ok" for row in rows),
        "total_characters": total_chars,
        "normalized_duplicate_groups": duplicates,
        "warnings": warnings,
        "documents": rows,
        "notice": "This report is a screening aid only; it cannot verify data rights or guarantee absence of personal data."
    }
    out = Path(args.report)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in (
        "files_seen", "valid_utf8_files", "total_characters",
        "normalized_duplicate_groups", "warnings")}, ensure_ascii=False, indent=2))
    print(f"Full report: {out}")
    return 1 if duplicates or warnings else 0


if __name__ == "__main__":
    raise SystemExit(main())
