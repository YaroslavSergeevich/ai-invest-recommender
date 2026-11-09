#!/usr/bin/env python3
"""
News Daemon - polls configured sources, extracts content, sends to backend.
"""

import os
import sys
import signal
import logging
from pathlib import Path

# Add daemon directory to path
DAEMON_DIR = Path(__file__).parent
sys.path.insert(0, str(DAEMON_DIR))

from fetcher import RSSFetcher, HTMLFetcher, APIFetcher
from parser import DoclingParser, HTMLParser
from client import BackendClient
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
import yaml

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)


class NewsDaemon:
    def __init__(self, config_path: str, backend_url: str):
        self.config_path = Path(config_path)
        self.backend_url = backend_url.rstrip('/')
        self.scheduler = BackgroundScheduler(timezone="UTC")
        self.client = BackendClient(self.backend_url)
        self.parser = DoclingParser()
        self.html_parser = HTMLParser()
        self.fetchers = {
            'rss': RSSFetcher(),
            'html': HTMLFetcher(),
            'api': APIFetcher(),
        }
        self._load_config()

    def _load_config(self):
        """Load sources configuration from YAML."""
        if not self.config_path.exists():
            logger.warning(f"Config not found: {self.config_path}, using empty config")
            self.sources = []
            return

        with open(self.config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)

        self.sources = config.get('sources', [])
        logger.info(f"Loaded {len(self.sources)} sources from {self.config_path}")

    def _process_source(self, source: dict):
        """Process a single source: fetch, parse, send to backend."""
        name = source.get('name', 'unknown')
        source_type = source.get('type', 'rss')
        url = source.get('url')

        if not url:
            logger.warning(f"Source {name}: no URL, skipping")
            return

        logger.info(f"Processing source: {name} ({source_type})")

        try:
            # Get appropriate fetcher
            fetcher = self.fetchers.get(source_type)
            if not fetcher:
                logger.warning(f"Unknown source type: {source_type}")
                return

            # Fetch raw content
            items = fetcher.fetch(url, source)
            logger.info(f"  Fetched {len(items)} items from {name}")

            # Process each item
            for item in items:
                self._process_item(item, name)

        except Exception as e:
            logger.error(f"Error processing source {name}: {e}", exc_info=True)

    def _process_item(self, item: dict, source_name: str):
        """Process a single news item: extract text, send to backend."""
        title = item.get('title', '')
        content = item.get('content', '')
        url = item.get('url', '')
        published = item.get('published_at', '')

        if not content and not title:
            return

        # Combine title and content
        raw_text = f"{title}\n\n{content}".strip()

        # Send to backend
        payload = {
            "raw_text": raw_text,
            "source_url": url,
            "source_name": source_name
        }

        try:
            self.client.post_news(payload)
            logger.debug(f"Sent news from {source_name}: {title[:80]}...")
        except Exception as e:
            logger.error(f"Failed to send news to backend: {e}")

    def start(self):
        """Start the daemon scheduler."""
        # Schedule each source
        for source in self.sources:
            schedule = source.get('schedule')
            if not schedule:
                logger.warning(f"Source {source.get('name')}: no schedule, skipping")
                continue

            try:
                trigger = CronTrigger.from_crontab(schedule)
                self.scheduler.add_job(
                    self._process_source,
                    trigger,
                    args=[source],
                    id=f"source_{source.get('name')}",
                    replace_existing=True,
                    max_instances=1,
                    coalesce=True,
                )
                logger.info(f"Scheduled {source.get('name')} with cron: {schedule}")
            except Exception as e:
                logger.error(f"Invalid cron for {source.get('name')}: {schedule} - {e}")

        # Initial run on startup (optional)
        for source in self.sources:
            self._process_source(source)

        self.scheduler.start()
        logger.info("News daemon started")

    def stop(self):
        """Stop the daemon."""
        logger.info("Stopping news daemon...")
        self.scheduler.shutdown(wait=True)
        logger.info("News daemon stopped")


def main():
    # Config from environment
    config_path = os.getenv("DAEMON_SOURCES_CONFIG", "./config/sources.yaml")
    backend_url = os.getenv("BACKEND_URL", "http://localhost:8080")

    logger.info(f"Starting News Daemon")
    logger.info(f"  Config: {config_path}")
    logger.info(f"  Backend: {backend_url}")

    daemon = NewsDaemon(config_path, backend_url)

    # Handle signals
    def signal_handler(signum, frame):
        logger.info(f"Received signal {signum}")
        daemon.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        daemon.start()
        # Keep alive
        import time
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        daemon.stop()


if __name__ == "__main__":
    main()