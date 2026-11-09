# News Listener Daemon - standalone container
FROM python:3.11-slim

# Metadata
LABEL org.opencontainers.image.title="news-listener"
LABEL org.opencontainers.image.description="News fetcher daemon"
LABEL org.opencontainers.image.version="1.0.0"

WORKDIR /app

# System deps for docling (OCR + PDF processing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-rus \
    tesseract-ocr-eng \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app

# Python dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Application code
COPY --chown=appuser:appuser *.py /app/
COPY --chown=appuser:appuser config/ /app/config/

# Environment
ENV PYTHONPATH=/usr/local/lib/python3.11/site-packages:/app
ENV DAEMON_SOURCES_CONFIG=/app/config/sources.yaml
ENV BACKEND_URL=http://backend:8080

USER appuser

# Healthcheck (requires /health endpoint in main.py on port 8081)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8081/health || exit 1

ENTRYPOINT ["python", "main.py"]