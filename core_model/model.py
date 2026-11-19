"""Tiny decoder-only Transformer trained from random initialization.

Educational baseline, not a production-quality assistant. UTF-8 bytes are tokens.
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

    def forward(self, x: torch.Tensor, past_key_value=None, use_cache: bool = False):
        batch, length, width = x.shape
        q, k, v = self.qkv(x).chunk(3, dim=-1)
        head_width = width // self.heads
        q = q.view(batch, length, self.heads, head_width).transpose(1, 2)
        k = k.view(batch, length, self.heads, head_width).transpose(1, 2)
        v = v.view(batch, length, self.heads, head_width).transpose(1, 2)
        past_length = 0
        if past_key_value is not None:
            past_k, past_v = past_key_value
            if past_k.shape[:2] != (batch, self.heads) or past_k.shape != past_v.shape:
                raise ValueError("invalid attention cache shape")
            past_length = past_k.size(2)
            k = torch.cat((past_k, k), dim=2)
            v = torch.cat((past_v, v), dim=2)
        y = F.scaled_dot_product_attention(
            q, k, v,
            is_causal=(past_length == 0 or length > 1),
            dropout_p=self.attn_dropout if self.training else 0.0,
        )
        y = y.transpose(1, 2).contiguous().view(batch, length, width)
        return self.resid_dropout(self.proj(y)), ((k, v) if use_cache else None)


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

    def forward(self, x: torch.Tensor, past_key_value=None, use_cache: bool = False):
        attended, present = self.attn(self.norm1(x), past_key_value, use_cache)
        x = x + attended
        return x + self.ff(self.norm2(x)), present


class TillbotCore(nn.Module):
    """Small GPT-style language model with 256 possible byte tokens."""

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
        self.blocks = nn.ModuleList([Block(width, heads, dropout) for _ in range(layers)])
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

    def forward(self, tokens: torch.Tensor, targets: torch.Tensor | None = None,
                past_key_values=None, use_cache: bool = False):
        if tokens.ndim != 2 or tokens.size(1) == 0:
            raise ValueError("tokens must be a non-empty [batch, sequence] tensor")
        if tokens.dtype != torch.long:
            raise ValueError("tokens must use torch.long byte IDs")
        _, length = tokens.shape
        if torch.any((tokens < 0) | (tokens > 255)):
            raise ValueError("token IDs must be in the byte range 0..255")
        _, length = tokens.shape
        past_length = 0
        if past_key_values is not None:
            if len(past_key_values) != len(self.blocks):
                raise ValueError("cache layer count does not match model")
            past_length = past_key_values[0][0].size(2)
            if any(pair[0].size(2) != past_length for pair in past_key_values):
                raise ValueError("cache layers have inconsistent sequence lengths")
            if length != 1:
                raise ValueError("cached decoding currently accepts exactly one new token at a time")
        if past_length + length > self.context:
            raise ValueError(f"sequence length {past_length + length} exceeds context {self.context}")
        if targets is not None:
            if past_key_values is not None:
                raise ValueError("targets cannot be supplied with a generation cache")
            if targets.shape != tokens.shape or targets.dtype != torch.long:
                raise ValueError("targets must be torch.long and match the tokens shape")
            if torch.any((targets < 0) | (targets > 255)):
                raise ValueError("target IDs must be in the byte range 0..255")
        positions = torch.arange(past_length, past_length + length, device=tokens.device)
        x = self.token_embedding(tokens) + self.position_embedding(positions)[None, :, :]
        presents = []
        for index, block in enumerate(self.blocks):
            past = past_key_values[index] if past_key_values is not None else None
            x, present = block(x, past, use_cache)
            if use_cache:
                presents.append(present)
        logits = self.lm_head(self.final_norm(x))
        loss = None
        if targets is not None:
            loss = F.cross_entropy(logits.reshape(-1, 256), targets.reshape(-1))
        return (logits, loss, tuple(presents)) if use_cache else (logits, loss)

    @torch.no_grad()
    def generate(self, tokens: torch.Tensor, max_new_tokens: int = 120,
                 temperature: float = 0.8, top_k: int = 40,
                 repetition_penalty: float = 1.0, do_sample: bool = True,
                 use_cache: bool = True) -> torch.Tensor:
        """Generate bytes, using a KV cache for faster token-by-token decoding."""
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
        tokens = tokens[:, -self.context:]
        if use_cache:
            logits, _, cache = self(tokens, use_cache=True)
        else:
            logits, _ = self(tokens)
            cache = None
        for step in range(max_new_tokens):
            scores = logits[:, -1, :].clone() / temperature
            if repetition_penalty > 1.0:
                for row in range(tokens.size(0)):
                    seen = torch.unique(tokens[row, -self.context:])
                    selected = scores[row, seen]
                    scores[row, seen] = torch.where(
                        selected > 0, selected / repetition_penalty,
                        selected * repetition_penalty,
                    )
            if top_k:
                threshold = torch.topk(scores, min(top_k, scores.size(-1)), dim=-1).values[:, -1:]
                scores = scores.masked_fill(scores < threshold, -torch.inf)
            next_token = (torch.multinomial(F.softmax(scores, dim=-1), 1)
                          if do_sample else torch.argmax(scores, dim=-1, keepdim=True))
            tokens = torch.cat((tokens, next_token), dim=1)
            if step + 1 == max_new_tokens:
                break
            if use_cache and cache[0][0].size(2) < self.context:
                logits, _, cache = self(next_token, past_key_values=cache, use_cache=True)
            elif use_cache:
                logits, _, cache = self(tokens[:, -self.context:], use_cache=True)
            else:
                logits, _ = self(tokens[:, -self.context:])
        return tokens
