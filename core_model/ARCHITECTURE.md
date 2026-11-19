# TILLBOT CORE — architecture and experiment contract

## Current baseline

The current prototype is a decoder-only Transformer using byte IDs (0–255). This makes encoding simple and reversible, but German text and other languages consume many model positions per word. It is useful for proving the training loop, not an efficient final tokenizer.

The current model is randomly initialized. It has no pretrained weights and no useful language capability until it has been trained and evaluated.

## Intended model pipeline

`approved source documents -> provenance review -> deduplication -> source-level splits -> tokenizer training -> causal language-model pretraining -> checkpoint evaluation -> instruction tuning -> held-out behavior evaluation -> local inference`

Each stage must produce versioned artifacts and must not silently reuse evaluation data for training.

## Tokenizer decision

Keep the byte tokenizer as a correctness baseline. Before scaling model training, prototype a deterministic byte-level BPE tokenizer trained only on approved training text.

Required tokenizer tests:
- encode/decode round-trip for German umlauts, ß, punctuation, emoji, and mixed-language text;
- deterministic vocabulary and merges for a fixed corpus/seed;
- unknown/invalid input behavior is explicit;
- special tokens cannot be confused with ordinary user text;
- tokenizer version/hash is stored in every checkpoint;
- no test-set text is used to fit the vocabulary.

Do not change the active checkpoint format without a versioned migration.

## Model experiment contract

Each run must record:
- architecture name and config (layers, width, heads, context, dropout, parameter count);
- tokenizer identifier and hash;
- corpus manifest identifier and split hashes;
- code commit, Python/PyTorch versions, device;
- seed, optimizer, learning rate/schedule, batch size, gradient accumulation, steps;
- train and validation loss at fixed intervals;
- elapsed time, tokens/second, peak memory, early-stop reason;
- checkpoint SHA-256.

A run without this metadata is not a comparable experiment.

## Training principles

- Train only on sources whose license/terms explicitly allow this use.
- Keep test data held out and never optimize against it.
- Deduplicate before splitting; split by source document to reduce leakage.
- Never use passwords, credentials, private messages, personal records, or private data from minors.
- Do not treat a user-submitted example as permission to train on it.
- Keep model artifacts local or in a controlled artifact store; never check large weights into Git.
- A smoke run verifies code execution only; it does not establish model quality.

## Inference boundary

Inference must be a separate component from training and from the website frontend. It should load an explicitly selected checkpoint and tokenizer, expose a narrow API, validate inputs, enforce resource limits, and report its model version. The existing hosted-provider integration must remain independent until Core passes every release gate.

## Non-goals for the first milestone

- competing with frontier-scale assistants;
- training on live user conversations;
- automatically switching public traffic to an unverified checkpoint;
- requiring a paid cloud GPU or paid API;
- claiming safety from a small benchmark or a passing unit-test suite.
