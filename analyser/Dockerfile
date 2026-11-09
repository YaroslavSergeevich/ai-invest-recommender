FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Сначала зависимости: этот слой кэшируется, пока requirements.txt не изменился
COPY requirements.txt .
RUN pip install -r requirements.txt

# Код и справочник. Файл .env в образ НЕ копируется (см. .dockerignore):
# ключ передаётся при запуске через --env-file или переменные окружения
COPY main.py industries.csv ./

# Запуск не от root
RUN useradd --create-home --uid 1000 appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
