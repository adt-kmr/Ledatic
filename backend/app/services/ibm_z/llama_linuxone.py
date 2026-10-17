"""Self-hosted quantised LLaMA 3.3 on LinuxONE.

The FIU case-report investigator runs a quantised LLaMA 3.3 served locally on
LinuxONE instead of a third-party cloud API, so case data never leaves the
bank's trust boundary. This module is the *design-target* client for that
endpoint: it probes for a local OpenAI-compatible server (vLLM / llama.cpp
served on LinuxONE) and falls back to the existing rule-based investigator
when unavailable.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

try:
    import httpx  # type: ignore
    _HTTPX_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    httpx = None  # type: ignore
    _HTTPX_AVAILABLE = False


class LlamaLinuxOne:
    """Client for a self-hosted LLaMA 3.3 instance on LinuxONE."""

    def __init__(self) -> None:
        self._base_url = os.environ.get(
            "LLAMA_LINUXONE_URL", "http://localhost:8080/v1"
        )
        self._model = os.environ.get("LLAMA_LINUXONE_MODEL", "llama-3.3-70b-instruct")
        self._available = False
        # Design-target: a real probe would GET /models; we never block startup.
        logger.info(
            "LLaMA on LinuxONE configured at %s (model=%s) - "
            "availability probed lazily", self._base_url, self._model
        )

    @property
    def available(self) -> bool:
        return self._available

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def model(self) -> str:
        return self._model

    def probe(self) -> bool:
        """Lazily probe the LinuxONE LLaMA endpoint."""
        if not _HTTPX_AVAILABLE:
            return False
        try:
            with httpx.Client(timeout=2.0) as c:  # type: ignore[union-attr]
                r = c.get(f"{self._base_url}/models")
                self._available = r.status_code == 200
        except Exception:  # pragma: no cover - network
            self._available = False
        return self._available

    def generate(self, prompt: str, max_tokens: int = 512,
                 temperature: float = 0.2) -> Dict[str, Any]:
        """Generate text from the self-hosted model (design-target)."""
        if not self._available and not self.probe():
            return {
                "available": False,
                "text": "",
                "note": "LinuxONE LLaMA endpoint unavailable - use rule-based investigator.",
            }
        try:
            with httpx.Client(timeout=30.0) as c:  # type: ignore[union-attr]
                r = c.post(
                    f"{self._base_url}/chat/completions",
                    json={
                        "model": self._model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": max_tokens,
                        "temperature": temperature,
                    },
                )
                r.raise_for_status()
                data = r.json()
                text = data["choices"][0]["message"]["content"]
                return {"available": True, "text": text, "model": self._model}
        except Exception as exc:  # pragma: no cover - network
            logger.warning("LinuxONE LLaMA generation failed: %s", exc)
            return {"available": False, "text": "", "error": str(exc)}

    def status(self) -> Dict[str, Any]:
        return {
            "available": self._available,
            "base_url": self._base_url,
            "model": self._model,
            "httpx_available": _HTTPX_AVAILABLE,
            "note": "Design target for self-hosted LLaMA 3.3 on LinuxONE; inactive on this host.",
        }


llama_linuxone = LlamaLinuxOne()


def get_status() -> Dict[str, Any]:
    return llama_linuxone.status()
