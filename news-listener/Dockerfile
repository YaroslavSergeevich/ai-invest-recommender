# News Listener Daemon - standalone container
FROM python:3.11-slim

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
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Application code
COPY *.py /app/
COPY config/ /app/config/

# Environment
ENV PYTHONPATH=/usr/local/lib/python3.11/site-packages:/app
ENV DAEMON_SOURCES_CONFIG=/app/config/sources.yaml

# Run daemon
CMD ["python", "main.py"]