"""
Parsers for different content types: PDF (docling), HTML.
"""

import logging
import tempfile
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class DoclingParser:
    """Parse PDF documents using docling (OCR + table extraction)."""

    def __init__(self, languages: list = None):
        self.languages = languages or ["cyrillic"]
        self._converter = None

    @property
    def converter(self):
        """Lazy initialization of docling converter."""
        if self._converter is None:
            self._converter = self._create_converter()
        return self._converter

    def _create_converter(self):
        """Create docling DocumentConverter with OCR enabled."""
        try:
            from docling.datamodel.base_models import InputFormat
            from docling.datamodel.pipeline_options import (
                PdfPipelineOptions,
                RapidOcrOptions,
                TableFormerMode,
            )
            from docling.document_converter import DocumentConverter, PdfFormatOption

            options = PdfPipelineOptions()
            options.do_ocr = True
            options.ocr_options = RapidOcrOptions(
                lang=self.languages,
                force_full_page_ocr=True,
            )
            options.do_table_structure = True
            options.table_structure_options.mode = TableFormerMode.ACCURATE
            options.generate_picture_images = False
            options.enable_remote_services = False

            return DocumentConverter(
                format_options={
                    InputFormat.PDF: PdfFormatOption(pipeline_options=options)
                }
            )
        except ImportError as e:
            logger.error(f"Docling not available: {e}")
            raise

    def parse(self, pdf_content: bytes) -> str:
        """
        Parse PDF bytes and return markdown text.

        Args:
            pdf_content: Raw PDF bytes

        Returns:
            Extracted text as markdown
        """
        # Write to temp file (docling needs a file path)
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
            tmp.write(pdf_content)
            tmp_path = tmp.name

        try:
            result = self.converter.convert(tmp_path)
            markdown = result.document.export_to_markdown()
            return markdown
        except Exception as e:
            logger.error(f"Docling parse failed: {e}")
            raise
        finally:
            # Cleanup temp file
            try:
                os.unlink(tmp_path)
            except:
                pass

    def parse_file(self, pdf_path: str) -> str:
        """Parse PDF from file path."""
        try:
            result = self.converter.convert(pdf_path)
            return result.document.export_to_markdown()
        except Exception as e:
            logger.error(f"Docling parse failed for {pdf_path}: {e}")
            raise


class HTMLParser:
    """Parse and clean HTML content."""

    def __init__(self):
        from bs4 import BeautifulSoup
        self.BeautifulSoup = BeautifulSoup

    def parse(self, html: str, selector: Optional[str] = None) -> str:
        """
        Extract text from HTML.

        Args:
            html: Raw HTML string
            selector: Optional CSS selector to target specific element

        Returns:
            Clean text content
        """
        soup = self.BeautifulSoup(html, "html.parser")

        if selector:
            element = soup.select_one(selector)
            if element:
                return element.get_text(separator="\n", strip=True)
            return ""

        # Remove script/style elements
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()

        return soup.get_text(separator="\n", strip=True)

    def extract_article(self, html: str, config: dict) -> dict:
        """
        Extract article metadata from HTML using configured selectors.

        Args:
            html: Raw HTML
            config: Selector config with title_selector, date_selector, etc.

        Returns:
            Dict with title, content, date, etc.
        """
        soup = self.BeautifulSoup(html, "html.parser")
        result = {}

        # Title
        title_sel = config.get('title_selector')
        if title_sel:
            elem = soup.select_one(title_sel)
            result['title'] = elem.get_text(strip=True) if elem else ''

        # Date
        date_sel = config.get('date_selector')
        if date_sel:
            elem = soup.select_one(date_sel)
            result['published_at'] = elem.get_text(strip=True) if elem else ''

        # Content
        content_sel = config.get('selector')
        if content_sel:
            elem = soup.select_one(content_sel)
            result['content'] = elem.get_text(separator="\n", strip=True) if elem else ''
        else:
            # Fallback: get all text
            for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
                tag.decompose()
            result['content'] = soup.get_text(separator="\n", strip=True)

        return result