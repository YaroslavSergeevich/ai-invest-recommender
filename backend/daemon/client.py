"""
HTTP client for posting news to backend with retries.
"""

import logging
import time
from typing import Dict, Any
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

logger = logging.getLogger(__name__)


class BackendClient:
    """Client for sending news to backend API."""

    def __init__(self, base_url: str, timeout: int = 30):
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self.client = httpx.Client(timeout=timeout)

    @retry(
        wait=wait_exponential(multiplier=1, min=2, max=30),
        stop=stop_after_attempt(3),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
        reraise=True
    )
    def post_news(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Post news to backend /api/news endpoint.

        Args:
            payload: Dict with raw_text, source_url, source_name

        Returns:
            Response dict with id
        """
        url = f"{self.base_url}/api/news"

        logger.debug(f"Posting news to {url}: {payload.get('source_name')}")

        response = self.client.post(url, json=payload)
        response.raise_for_status()

        return response.json()

    def health_check(self) -> bool:
        """Check if backend is healthy."""
        try:
            response = self.client.get(f"{self.base_url}/health", timeout=5)
            return response.status_code == 200
        except Exception:
            return False

    def close(self):
        """Close HTTP client."""
        self.client.close()


class AsyncBackendClient:
    """Async version for future use."""

    def __init__(self, base_url: str, timeout: int = 30):
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self.client = httpx.AsyncClient(timeout=timeout)

    async def post_news(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.base_url}/api/news"
        response = await self.client.post(url, json=payload)
        response.raise_for_status()
        return response.json()

    async def close(self):
        await self.client.aclose()