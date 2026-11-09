#!/bin/bash
set -e

echo "Starting backend..."
/usr/local/bin/backend &
BACKEND_PID=$!

echo "Starting daemon..."
cd /app/news-listener
exec python main.py
EOF