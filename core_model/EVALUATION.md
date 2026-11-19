# TILLBOT Core — evaluation protocol

A lower next-byte loss is useful for tracking training, but does **not** prove that
answers are correct, helpful, safe, or conversational. Do not connect this model to
public users based on loss alone.

## Required evaluation sets

Keep these as separate, manually reviewed files that are never included in training:
- basic German and English conversation;
- instruction following and formatting;
- arithmetic and simple reasoning;
- factual questions with known answers and questions that require admitting uncertainty;
- privacy and secret-handling prompts;
- respectful handling of insults and sensitive topics;
- prompts that test whether the model invents sources or claims tool access.

Use fresh paraphrases rather than copying training examples. Record each prompt,
expected behavior, model output, and a 0–2 score. Do not put private conversations,
passwords, account details, or identifying personal data in any corpus.

## Release gates

1. Dataset provenance and license evidence reviewed by a human.
2. Train/validation split is by source document, not random adjacent bytes.
3. Validation loss is logged and does not diverge.
4. Held-out behavior tests are scored and reviewed.
5. Safety and privacy tests pass.
6. Model size, memory use, latency, and failure behavior are measured on the actual target host.
7. A separate inference service is tested before any production routing change.

A tiny smoke-test corpus only proves that the training loop executes. It does not
produce a capable assistant. Keep the current hosted provider as production fallback
until every release gate has been met.
