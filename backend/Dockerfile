# Stage 1: Go builder
FROM golang:1.27-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git make
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /backend ./cmd/backend

# Stage 2: Python runtime (has Python 3.11 + correct GLIBC)
FROM python:3.11-slim

WORKDIR /app

# System deps for docling + supervisor
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
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# Python deps for daemon
COPY daemon/requirements.txt /app/daemon/requirements.txt
RUN pip install --no-cache-dir -r /app/daemon/requirements.txt

# Copy Go binary
COPY --from=builder /backend /usr/local/bin/backend

# Copy app code
COPY daemon/ /app/daemon/
COPY migrations/ /app/migrations/
COPY scripts/ /app/scripts/
COPY daemon/sources.yaml /app/daemon/sources.yaml
COPY .env /app/.env

# Python path
ENV PYTHONPATH=/usr/local/lib/python3.11/site-packages:/app/daemon

# Entrypoint script (runs both processes, inherits container env)
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]