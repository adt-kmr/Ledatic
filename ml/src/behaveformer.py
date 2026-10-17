"""
STDAT BehaveFormer — Spatiotemporal Dual Attention Transformer.
Ref: IEEE Q1 TBIOM 2024.  EER: 1.80-2.95% on Aalto Mobile Keystroke DB.

Architecture:
  Temporal path  — TransformerEncoder over keystroke time steps
  Spatial path   — per-feature statistics projected to embed space
  Fusion         — concat(temporal, spatial) → Linear → LayerNorm → 128-dim embedding
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

logger = logging.getLogger(__name__)

# Where trained weights live. Overridable so local runs / Colab don't need /app.
MODEL_DIR = Path(os.getenv("MODEL_DIR", "/app/models"))


class BehaveFormer(nn.Module):
    """
    Input:  (batch, seq_len, input_dim=6) keystroke feature sequence
    Output: (batch, embed_dim=128) behavioral embedding
    """

    def __init__(
        self,
        input_dim:  int = 6,
        embed_dim:  int = 128,
        num_heads:  int = 4,
        num_layers: int = 2,
    ) -> None:
        super().__init__()
        self.embed_dim  = embed_dim
        self.input_proj = nn.Linear(input_dim, embed_dim)
        self.pos_enc    = nn.Embedding(512, embed_dim)

        # Temporal path
        t_layer = nn.TransformerEncoderLayer(
            d_model=embed_dim, nhead=num_heads,
            dim_feedforward=embed_dim * 4,
            dropout=0.0, batch_first=True, norm_first=True,
        )
        self.temporal = nn.TransformerEncoder(t_layer, num_layers=num_layers)

        # Spatial path — operates on per-feature statistics (mean + std per feature across time)
        self.spatial_proj = nn.Sequential(
            nn.Linear(input_dim * 2, embed_dim),
            nn.GELU(),
            nn.LayerNorm(embed_dim),
        )

        # Dual-path fusion
        self.fusion = nn.Sequential(
            nn.Linear(embed_dim * 2, embed_dim),
            nn.GELU(),
            nn.LayerNorm(embed_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch, seq_len, _ = x.shape
        positions = torch.arange(seq_len, device=x.device).unsqueeze(0)

        # Temporal path
        x_t  = self.input_proj(x) + self.pos_enc(positions)
        x_t  = self.temporal(x_t)
        t_emb = x_t.mean(dim=1)          # (batch, embed_dim)

        # Spatial path — capture cross-feature statistics
        x_stats = torch.cat([x.mean(dim=1), x.std(dim=1)], dim=-1)  # (batch, input_dim*2)
        s_emb   = self.spatial_proj(x_stats)                          # (batch, embed_dim)

        return self.fusion(torch.cat([t_emb, s_emb], dim=-1))


class BehaveFormerEncoder:
    """
    Wraps BehaveFormer with numpy I/O for use in the inference pipeline.
    Runs on CPU; inference ≈ 5ms for seq_len ≤ 128.
    """

    def __init__(self) -> None:
        self.model = BehaveFormer()
        self.model.eval()
        model_path = MODEL_DIR / "behaveformer_finetuned.pth"
        if model_path.exists():
            self.model.load_state_dict(torch.load(model_path, map_location="cpu"))
            logger.info("Loaded BehaveFormer weights from %s", model_path)
        else:
            logger.warning("BehaveFormer: random init — no weights at %s", model_path)

    def encode(self, keystroke_seq: np.ndarray) -> np.ndarray:
        """
        keystroke_seq: (seq_len, 6) float32 from feature_engine.build_keystroke_sequence()
        Returns: (128,) float32 embedding
        """
        if keystroke_seq.shape[0] < 2:
            return np.zeros(self.model.embed_dim, dtype=np.float32)

        with torch.no_grad():
            x   = torch.tensor(keystroke_seq, dtype=torch.float32).unsqueeze(0)
            emb = self.model(x).squeeze(0).numpy()

        norm = np.linalg.norm(emb)
        return (emb / norm) if norm > 1e-8 else emb
