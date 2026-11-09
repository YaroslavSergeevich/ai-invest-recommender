"""
Fetchers for different source types: RSS, HTML, API.
"""

import logging
from typing import List, Dict, Any
import feedparser
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


class RSSFetcher:
    """Fetch news from RSS/Atom feeds."""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    def fetch(self, url: str, source_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Fetch and parse RSS feed."""
        logger.debug(f"Fetching RSS: {url}")

        try:
            feed = feedparser.parse(url)

            if feed.bozo and feed.bozo_exception:
                logger.warning(f"RSS parse warning for {url}: {feed.bozo_exception}")

            items = []
            for entry in feed.entries:
                item = {
                    'title': entry.get('title', ''),
                    'content': entry.get('summary', entry.get('description', '')),
                    'url': entry.get('link', ''),
                    'published_at': entry.get('published', entry.get('updated', '')),
                }
                # Clean HTML from content
                item['content'] = self._clean_html(item['content'])
                items.append(item)

            return items

        except Exception as e:
            logger.error(f"RSS fetch failed for {url}: {e}")
            return []

    def _clean_html(self, text: str) -> str:
        """Strip HTML tags from text."""
        if not text:
            return ""
        soup = BeautifulSoup(text, "html.parser")
        return soup.get_text(separator=" ", strip=True)


class HTMLFetcher:
    """Fetch news from HTML pages using CSS selectors."""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.client = httpx.Client(timeout=timeout, follow_redirects=True)

    def fetch(self, url: str, source_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Fetch HTML page and extract articles using selectors."""
        logger.debug(f"Fetching HTML: {url}")

        list_selector = source_config.get('list_selector')
        link_selector = source_config.get('link_selector')
        title_selector = source_config.get('title_selector')
        date_selector = source_config.get('date_selector')
        content_selector = source_config.get('selector')

        if not list_selector:
            logger.warning(f"HTML source {url}: no list_selector configured")
            return []

        try:
            response = self.client.get(url)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")

            article_elements = soup.select(list_selector)
            items = []

            for elem in article_elements:
                # Extract link
                link_elem = elem.select_one(link_selector) if link_selector else elem
                link = link_elem.get('href', '') if link_elem else ''
                if link and not link.startswith('http'):
                    # Make absolute URL
                    from urllib.parse import urljoin
                    link = urljoin(url, link)

                # Extract title
                title_elem = elem.select_one(title_selector) if title_selector else link_elem
                title = title_elem.get_text(strip=True) if title_elem else ''

                # Extract date
                date_elem = elem.select_one(date_selector) if date_selector else None
                published = date_elem.get_text(strip=True) if date_elem else ''

                # Extract full content if content_selector provided and we have a link
                content = ''
                if content_selector and link:
                    content = self._fetch_article_content(link, content_selector)

                items.append({
                    'title': title,
                    'content': content,
                    'url': link,
                    'published_at': published,
                })

            return items

        except Exception as e:
            logger.error(f"HTML fetch failed for {url}: {e}")
            return []

    def _fetch_article_content(self, url: str, selector: str) -> str:
        """Fetch full article content from article URL."""
        try:
            response = self.client.get(url)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")
            content_elem = soup.select_one(selector)
            if content_elem:
                return content_elem.get_text(separator="\n", strip=True)
            return ''
        except Exception as e:
            logger.debug(f"Failed to fetch article content from {url}: {e}")
            return ''


class APIFetcher:
    """Fetch news from JSON APIs."""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.client = httpx.Client(timeout=timeout, follow_redirects=True)

    def fetch(self, url: str, source_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Fetch JSON from API endpoint."""
        logger.debug(f"Fetching API: {url}")

        headers = source_config.get('headers', {})

        try:
            response = self.client.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()

            # Expect data to be a list of objects
            if isinstance(data, dict):
                # Try common keys for list
                for key in ['items', 'articles', 'news', 'data', 'results']:
                    if key in data and isinstance(data[key], list):
                        data = data[key]
                        break
                else:
                    data = [data]

            if not isinstance(data, list):
                logger.warning(f"API {url}: expected list, got {type(data)}")
                return []

            items = []
            for obj in data:
                if not isinstance(obj, dict):
                    continue

                # Map common fields
                item = {
                    'title': obj.get('title', obj.get('headline', obj.get('name', ''))),
                    'content': obj.get('content', obj.get('body', obj.get('description', obj.get('summary', '')))),
                    'url': obj.get('url', obj.get('link', obj.get('href', ''))),
                    'published_at': obj.get('published_at', obj.get('published', obj.get('date', obj.get('created_at', '')))),
                }
                items.append(item)

            return items

        except Exception as e:
            logger.error(f"API fetch failed for {url}: {e}")
            return []