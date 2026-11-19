"""Validate prepared train/validation corpora and their source manifest.

This checks structural integrity and leakage indicators. It cannot establish
copyright, consent, or license permissions; those require human review.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def normalized_digest(text: str) -> str:
    normalized = " ".join(text.split()).casefold()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def read_documents(path: Path, min_chars: int) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ValueError(f"Cannot read valid UTF-8 corpus {path}: {exc}") from exc
    docs = [part.strip() for part in text.split("\n\n") if part.strip()]
    if not docs:
        raise ValueError(f"Corpus has no documents: {path}")
    short = [index for index, doc in enumerate(docs, 1) if len(doc) < min_chars]
    if short:
        raise ValueError(f"{path}: documents below --min-chars at positions {short[:20]}")
    return docs


def validate(train_path: Path, val_path: Path, manifest_path: Path,
             source_dir: Path | None = None, min_chars: int = 1) -> dict:
    train_docs = read_documents(train_path, min_chars)
    val_docs = read_documents(val_path, min_chars)
    train_hashes = {normalized_digest(doc) for doc in train_docs}
    val_hashes = {normalized_digest(doc) for doc in val_docs}
    overlap = train_hashes & val_hashes
    if overlap:
        raise ValueError(f"Train/validation leakage: {len(overlap)} normalized duplicate document(s)")

    try:
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Cannot read dataset manifest: {exc}") from exc

    # Bind the prepared split files to the manifest itself. Source hashes alone
    # are insufficient because a split file could be edited after preparation.
    expected_train_hash = manifest.get("train_sha256")
    expected_val_hash = manifest.get("validation_sha256")
    if not isinstance(expected_train_hash, str) or len(expected_train_hash) != 64:
        raise ValueError("Manifest is missing a valid train_sha256")
    if not isinstance(expected_val_hash, str) or len(expected_val_hash) != 64:
        raise ValueError("Manifest is missing a valid validation_sha256")
    actual_train_hash = hashlib.sha256(train_path.read_bytes()).hexdigest()
    actual_val_hash = hashlib.sha256(val_path.read_bytes()).hexdigest()
    if actual_train_hash != expected_train_hash:
        raise ValueError("Prepared training split SHA-256 does not match manifest")
    if actual_val_hash != expected_val_hash:
        raise ValueError("Prepared validation split SHA-256 does not match manifest")

    train_files = manifest.get("train_files")
    val_files = manifest.get("validation_files")
    sources = manifest.get("sources")
    if not isinstance(train_files, list) or not isinstance(val_files, list) or not isinstance(sources, list):
        raise ValueError("Manifest must contain train_files, validation_files and sources arrays")
    if not all(isinstance(item, str) for item in train_files + val_files):
        raise ValueError("Manifest split file entries must be strings")
    if len(set(train_files)) != len(train_files) or len(set(val_files)) != len(val_files):
        raise ValueError("Manifest contains duplicate source paths")
    file_overlap = set(train_files) & set(val_files)
    if file_overlap:
        raise ValueError(f"Manifest assigns source files to both splits: {sorted(file_overlap)}")
    source_names = [row.get("file") for row in sources if isinstance(row, dict)]
    if len(source_names) != len(sources) or set(source_names) != set(train_files) | set(val_files):
        raise ValueError("Manifest source inventory does not match its train/validation file lists")
    for row in sources:
        if not isinstance(row.get("sha256"), str) or len(row["sha256"]) != 64:
            raise ValueError(f"Manifest has invalid SHA-256 for source {row.get('file')!r}")

    verified_sources = 0
    if source_dir is not None:
        root = source_dir.resolve()
        for row in sources:
            candidate = (root / row["file"]).resolve()
            if root not in candidate.parents:
                raise ValueError(f"Manifest source path escapes source directory: {row['file']}")
            if not candidate.is_file():
                raise ValueError(f"Manifest source file is missing: {row['file']}")
            actual = hashlib.sha256(candidate.read_bytes()).hexdigest()
            if actual != row["sha256"]:
                raise ValueError(f"Source hash mismatch: {row['file']}")
            verified_sources += 1

    return {
        "status": "ok",
        "train_documents": len(train_docs),
        "validation_documents": len(val_docs),
        "train_source_files": len(train_files),
        "validation_source_files": len(val_files),
        "source_hashes_verified": verified_sources,
        "normalized_document_overlap": 0,
        "rights_notice": "Structural checks passed; license and consent evidence still require human review.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train", required=True)
    parser.add_argument("--validation", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--source-dir", help="Optional original source directory for SHA-256 verification")
    parser.add_argument("--min-chars", type=int, default=1)
    args = parser.parse_args()
    if args.min_chars < 1:
        parser.error("--min-chars must be positive")
    try:
        report = validate(Path(args.train), Path(args.validation), Path(args.manifest),
                          Path(args.source_dir) if args.source_dir else None, args.min_chars)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
