"""Tiny decoder-only Transformer trained from random initialization.

This is an educational baseline, not a production-quality assistant model.
It uses UTF-8 bytes as tokens so German characters need no external tokenizer.
"""
from __future__ import annotations

import math

import torch
from torch import nn
from torch.nn import functional as F


class CausalSelfAttention(nn.Module):
    def __init__(self, width: int, heads: int, dropout: float):
        super().__init__()
        if width % heads:
            raise ValueError("width must be divisible by heads")
        self.heads = heads
        self.qkv = nn.Linear(width, 3 * width, bias=False)
        self.proj = nn.Linear(width, width, bias=False)
        self.attn_dropout = dropout
        self.resid_dropout = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch, length, width = x.shape
        q, k, v = self.qkv(x).chunk(3, dim=-1)
        head_width = width // self.heads
        q = q.view(batch, length, self.heads, head_width).transpose(1, 2)
        k = k.view(batch, length, self.heads, head_width).transpose(1, 2)
        v = v.view(batch, length, self.heads, head_width).transpose(1, 2)
        y = F.scaled_dot_product_attention(
            q, k, v, is_causal=True,
            dropout_p=self.attn_dropout if self.training else 0.0,
        )
        y = y.transpose(1, 2).contiguous().view(batch, length, width)
        return self.resid_dropout(self.proj(y))


class Block(nn.Module):
    def __init__(self, width: int, heads: int, dropout: float):
        super().__init__()
        self.norm1 = nn.LayerNorm(width)
        self.attn = CausalSelfAttention(width, heads, dropout)
        self.norm2 = nn.LayerNorm(width)
        self.ff = nn.Sequential(
            nn.Linear(width, 4 * width), nn.GELU(),
            nn.Linear(4 * width, width), nn.Dropout(dropout),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(self.norm1(x))
        return x + self.ff(self.norm2(x))


class TillbotCore(nn.Module):
    """A small GPT-style language model with 256 possible byte tokens."""

    def __init__(self, width: int = 128, heads: int = 4, layers: int = 4,
                 context: int = 256, dropout: float = 0.1):
        super().__init__()
        if width < 8 or heads < 1 or width % heads:
            raise ValueError("width must be >= 8 and divisible by a positive head count")
        if layers < 1 or context < 2:
            raise ValueError("layers must be positive and context must be at least 2")
        if not 0.0 <= dropout < 1.0:
            raise ValueError("dropout must be in [0, 1)")
        self.context = context
        self.token_embedding = nn.Embedding(256, width)
        self.position_embedding = nn.Embedding(context, width)
        self.blocks = nn.Sequential(*[
            Block(width, heads, dropout) for _ in range(layers)
        ])
        self.final_norm = nn.LayerNorm(width)
        self.lm_head = nn.Linear(width, 256, bias=False)
        self.token_embedding.weight = self.lm_head.weight
        self.apply(self._init_weights)

    @staticmethod
    def _init_weights(module: nn.Module) -> None:
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def forward(self, tokens: torch.Tensor, targets: torch.Tensor | None = None):
        if tokens.ndim != 2 or tokens.size(1) == 0:
            raise ValueError("tokens must be a non-empty [batch, sequence] tensor")
        if tokens.dtype != torch.long:
            raise ValueError("tokens must use torch.long byte IDs")
        if torch.any((tokens < 0) | (tokens > 255)):
            raise ValueError("token IDs must be in the byte range 0..255")
        _, length = tokens.shape
        if length > self.context:
            raise ValueError(f"sequence length {length} exceeds context {self.context}")
        if targets is not None:
            if targets.shape != tokens.shape or targets.dtype != torch.long:
                raise ValueError("targets must be torch.long and match the tokens shape")
            if torch.any((targets < 0) | (targets > 255)):
                raise ValueError("target IDs must be in the byte range 0..255")
        positions = torch.arange(length, device=tokens.device)
        x = self.token_embedding(tokens) + self.position_embedding(positions)[None, :, :]
        logits = self.lm_head(self.final_norm(self.blocks(x)))
        loss = None
        if targets is not None:
            loss = F.cross_entropy(logits.reshape(-1, 256), targets.reshape(-1))
        return logits, loss

    @torch.no_grad()
    def generate(
        self,
        tokens: torch.Tensor,
        max_new_tokens: int = 120,
        temperature: float = 0.8,
        top_k: int = 40,
        repetition_penalty: float = 1.0,
        do_sample: bool = True,
    ) -> torch.Tensor:
        """Append byte tokens with optional top-k sampling and repetition control.

        Set do_sample=False for deterministic greedy decoding. Repetition penalty
        applies to byte IDs observed in the current context window; with a byte
        tokenizer this is a lightweight heuristic, not word-level repetition control.
        """
        if tokens.ndim != 2 or tokens.size(0) < 1 or tokens.size(1) < 1:
            raise ValueError("tokens must be a non-empty [batch, sequence] tensor")
        if tokens.dtype != torch.long or torch.any((tokens < 0) | (tokens > 255)):
            raise ValueError("tokens must contain torch.long byte IDs in 0..255")
        if not isinstance(max_new_tokens, int) or max_new_tokens < 0:
            raise ValueError("max_new_tokens must be a non-negative integer")
        if not math.isfinite(temperature) or temperature <= 0:
            raise ValueError("temperature must be finite and greater than zero")
        if not isinstance(top_k, int) or not 0 <= top_k <= 256:
            raise ValueError("top_k must be between 0 and 256")
        if not math.isfinite(repetition_penalty) or repetition_penalty < 1.0:
            raise ValueError("repetition_penalty must be finite and at least 1.0")

        self.eval()
        for _ in range(max_new_tokens):
            context = tokens[:, -self.context:]
            logits, _ = self(context)
            scores = logits[:, -1, :].clone() / temperature

            if repetition_penalty > 1.0:
                for row in range(tokens.size(0)):
                    seen = torch.unique(context[row])
                    selected = scores[row, seen]
                    scores[row, seen] = torch.where(
                        selected > 0,
                        selected / repetition_penalty,
                        selected * repetition_penalty,
                    )

            if top_k:
                threshold = torch.topk(scores, min(top_k, scores.size(-1)), dim=-1).values[:, -1:]
                scores = scores.masked_fill(scores < threshold, -torch.inf)

            if do_sample:
                next_token = torch.multinomial(F.softmax(scores, dim=-1), num_samples=1)
            else:
                next_token = torch.argmax(scores, dim=-1, keepdim=True)
            tokens = torch.cat((tokens, next_token), dim=1)
        return tokens
