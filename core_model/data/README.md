# TILLBOT Core training data

Place a UTF-8 plain-text corpus at `data/train.txt` (or pass `--data PATH`).

Important:
- Use only text you wrote, public-domain material, or material whose license explicitly permits machine-learning training.
- Do not collect private chats, personal data, passwords, or scraped copyrighted books.
- Keep a record of each source and its license before adding it.
- A few paragraphs are only enough to test that the training loop runs. Useful language ability needs a large, varied, high-quality corpus and substantial compute.
- Split evaluation data by document/source, not by randomly mixing fragments from the same private conversation.

The initial model uses UTF-8 bytes (256 tokens), a small decoder-only Transformer, random initialization, and no downloaded pretrained weights. It will initially produce poor text. This is expected and is not a ChatGPT-level model.
