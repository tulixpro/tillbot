# TILLBOT Core training data

## What may be included

Use only text you wrote yourself, public-domain material, or material whose specific
license/terms explicitly permit machine-learning training. Keep the original source,
license, attribution requirements, retrieval date, and a record of your review.

Do not include private chats, messages from friends, personal data, passwords, school
records, account details, scraped copyrighted books, or content with unclear rights.
Do not assume that content being visible online means it is permitted for model training.

## Audit before preparation

Run `python core_model/audit_dataset.py --source-dir ./reviewed_text` first. Review flagged files manually, remove private or sensitive information, and investigate duplicates. The audit is not a legal review and cannot guarantee that all personal data has been removed.

## Preparing a corpus

Put reviewed UTF-8 plain-text documents in a separate folder, one source document per
file. Aim for varied, high-quality examples rather than repeating templates. The
preparation script creates a reproducible split by whole source files:

```bash
python core_model/prepare_dataset.py --source-dir ./reviewed_text --out-dir ./prepared_data --confirm-licensed-data
```

Review `manifest.json` and retain the actual license evidence. The script records file
hashes and names but **cannot verify legal permission**. The validation documents must
not be included in training.

## Current starter set

`seed_dialogues.txt` is a small collection of original project-authored examples. It is
only for checking that the code runs; it is far too small to teach useful conversation.
The initial model is randomly initialized, byte-level, and expected to produce poor
text. It is not a ChatGPT-level model.
