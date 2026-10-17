"""
CNN-LSTM Session Encoder.
Encodes full session mouse trajectory → detects behavioral drift within a session.
Input:  (batch, seq_len, 4) — mouse sequence from feature_engine.build_mouse_sequence()
Output: drift score 0-1 (0 = normal, 1 = high drift / anomaly)
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

logger = logging.getLogger(__name__)

MODEL_DIR = Path(os.getenv("MODEL_DIR", "/app/models"))


class CNNLSTMEncoder(nn.Module):
    """
    1-D CNN for local pattern detection + LSTM for temporal dynamics.
    Input:  (batch, seq_len, 4)
    Output: (batch, 1) drift score (sigmoid-activated)
    """

    def __init__(self, input_dim: int = 4, cnn_channels: int = 32, lstm_hidden: int = 64) -> None:
        super().__init__()

        # CNN block — extract local movement patterns
        self.cnn = nn.Sequential(
            nn.Conv1d(input_dim, cnn_channels, kernel_size=3, padding=1),
            nn.GELU(),
            nn.Conv1d(cnn_channels, cnn_channels, kernel_size=3, padding=1),
            nn.GELU(),
        )

        # LSTM — temporal sequence modeling
        self.lstm = nn.LSTM(
            input_size=cnn_channels,
            hidden_size=lstm_hidden,
            num_layers=1,
            batch_first=True,
        )

        # Classifier head
        self.head = nn.Sequential(
            nn.Linear(lstm_hidden, 32),
            nn.GELU(),
            nn.Linear(32, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq_len, 4)
        x_cnn = x.transpose(1, 2)           # (batch, 4, seq_len) for Conv1d
        x_cnn = self.cnn(x_cnn)             # (batch, cnn_channels, seq_len)
        x_cnn = x_cnn.transpose(1, 2)       # (batch, seq_len, cnn_channels)
        _, (h_n, _) = self.lstm(x_cnn)      # h_n: (1, batch, lstm_hidden)
        return self.head(h_n.squeeze(0))    # (batch, 1)


class SessionDriftDetector:
    """
    Wraps CNNLSTMEncoder with numpy I/O.
    Returns a float drift score in [0, 1].
    """

    def __init__(self) -> None:
        self.model = CNNLSTMEncoder()
        self.model.eval()
        model_path = MODEL_DIR / "cnn_lstm.pth"
        if model_path.exists():
            self.model.load_state_dict(torch.load(model_path, map_location="cpu"))
            logger.info("Loaded CNN-LSTM weights from %s", model_path)
        else:
            logger.warning("CNN-LSTM: random init — no weights at %s", model_path)

    def score(self, mouse_seq: np.ndarray) -> float:
        """
        mouse_seq: (seq_len, 4) float32 from feature_engine.build_mouse_sequence()
        Returns: drift score in [0, 1]
        """
        if mouse_seq.shape[0] < 2:
            return 0.0

        with torch.no_grad():
            x = torch.tensor(mouse_seq, dtype=torch.float32).unsqueeze(0)
            return float(self.model(x).squeeze().item())
