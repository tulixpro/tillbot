"""Tiny decoder-only Transformer trained from random initialization.

This is an educational baseline, not a production-quality assistant model.
It uses UTF-8 bytes as tokens so German characters need no external tokenizer.
"""
from __future__ import annotations

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
        _, length = tokens.shape
        if length > self.context:
            raise ValueError(f"sequence length {length} exceeds context {self.context}")
        positions = torch.arange(length, device=tokens.device)
        x = self.token_embedding(tokens) + self.position_embedding(positions)[None, :, :]
        logits = self.lm_head(self.final_norm(self.blocks(x)))
        loss = None
        if targets is not None:
            loss = F.cross_entropy(logits.reshape(-1, 256), targets.reshape(-1))
        return logits, loss

    @torch.no_grad()
    def generate(self, tokens: torch.Tensor, max_new_tokens: int = 120,
                 temperature: float = 0.8, top_k: int = 40) -> torch.Tensor:
        self.eval()
        for _ in range(max_new_tokens):
            context = tokens[:, -self.context:]
            logits, _ = self(context)
            logits = logits[:, -1, :] / max(temperature, 1e-5)
            if top_k:
                values, _ = torch.topk(logits, min(top_k, logits.size(-1)))
                logits[logits < values[:, [-1]]] = -float("inf")
            probabilities = F.softmax(logits, dim=-1)
            next_token = torch.multinomial(probabilities, num_samples=1)
            tokens = torch.cat((tokens, next_token), dim=1)
        return tokens
