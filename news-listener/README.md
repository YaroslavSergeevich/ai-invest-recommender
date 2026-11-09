# News Listener — демон сбора новостей

Автономный Python-сервис, который периодически опрашивает настроенные источники (RSS, HTML-страницы, JSON API), извлекает текст новостей и отправляет их в Backend API (`POST /api/news`) для дальнейшей обработки (классификация Model A, сохранение, персонализация Model B).

---

## Архитектура

```
┌──────────────────┐     cron (UTC)      ┌──────────────────┐
│  News Listener   │ ──────────────────▶ │  Источники       │
│  (Python daemon) │  fetch + parse      │  RSS / HTML / API│
└────────┬─────────┘                     └──────────────────┘
         │ raw text + meta
         │ POST /api/news
         ▼
┌──────────────────┐
│   Backend (Go)   │ ──▶ Model A (классификация) ──▶ PostgreSQL (news_db)
│   :8080          │
└──────────────────┘
```

---

## Компоненты

| Файл | Назначение |
|------|------------|
| `main.py` | Точка входа: планировщик (APScheduler), цикл обработки источников |
| `fetcher.py` | `RSSFetcher`, `HTMLFetcher`, `APIFetcher` — получение контента |
| `parser.py` | `DoclingParser` (PDF → markdown, OCR), `HTMLParser` (очистка, селекторы) |
| `client.py` | `BackendClient` — HTTP-клиент с ретраями (tenacity, до 3 попыток, эксп. backoff) |
| `config/sources.yaml` | Список источников, типы, расписания, селекторы |
| `requirements.txt` | Python-зависимости |
| `Dockerfile` | Образ для автономного контейнера |

---

## Конфигурация источников (`config/sources.yaml`)

Каждый источник — объект с полями:

```yaml
sources:
  - name: "RBK"                    # уникальное имя → попадает в source_name
    type: "rss"                    # rss | html | api
    url: "https://rssexport.rbc.ru/rbcnews/news/20/full.rss"
    schedule: "*/15 * * * *"       # cron (UTC), как часто опрашивать
    pdf: false                     # true — если источник отдаёт PDF (Docling)
    # для HTML:
    list_selector: "article"       # селектор списка статей
    link_selector: "a[href]"       # селектор ссылки на статью
    title_selector: "h1"           # селектор заголовка
    date_selector: "time"          # селектор даты
    selector: "article"            # селектор полного текста статьи
    # для API:
    headers:                       # опциональные заголовки
      Authorization: "Bearer ${TOKEN}"
```

**Типы источников:**
- **rss** — `feedparser`, берёт `title`, `summary/description`, `link`, `published/updated`
- **html** — `httpx` + `BeautifulSoup`, CSS-селекторы из конфига
- **api** — `httpx`, ожидает JSON-массив объектов с полями `title`, `url`, `content`, `published_at`

---

## Запуск

### 1. Локально (Python 3.11+)

```bash
cd news-listener
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Переменные окружения
export BACKEND_URL=http://localhost:8080
export DAEMON_SOURCES_CONFIG=./config/sources.yaml

python main.py
```

### 2. Docker (автономный контейнер)

```bash
# Сборка
docker build -t news-listener .

# Запуск (backend должен быть доступен)
docker run --rm --name news-listener \
  --env-file ../.env \
  -e BACKEND_URL=http://host.docker.internal:8080 \
  news-listener
```

### 3. В одной сети с backend

```bash
docker network create biz-net

# Backend
docker run -d --name backend --network biz-net -p 8080:8080 \
  --env-file ../.env backend-image

# Listener
docker run --rm --name news-listener --network biz-net \
  --env-file ../.env \
  -e BACKEND_URL=http://backend:8080 \
  news-listener
```

---

## Переменные окружения

| Переменная | Обязательна | По умолчанию | Описание |
|---|---|---|---|
| `BACKEND_URL` | **да** | `http://localhost:8080` | URL Backend API для `POST /api/news` |
| `DAEMON_SOURCES_CONFIG` | нет | `/app/config/sources.yaml` | Путь к YAML конфигурации источников |
| `PYTHONPATH` | нет | `/app` | Установлен в Dockerfile |

> **Backend не требует** `MODEL_A_URL`, `MODEL_B_*`, `POSTGRES_*` — демон только отправляет сырые новости.

---

## Логи и мониторинг

```bash
# Логи контейнера
docker logs -f news-listener

# Пример нормального старта
2026-11-09 12:00:00 [INFO] __main__: Starting News Daemon
2026-11-09 12:00:00 [INFO] __main__:   Config: /app/config/sources.yaml
2026-11-09 12:00:00 [INFO] __main__:   Backend: http://backend:8080
2026-11-09 12:00:00 [INFO] __main__: Loaded 42 sources from /app/config/sources.yaml
2026-11-09 12:00:00 [INFO] __main__: Scheduled RBK with cron: */15 * * * *
...
2026-11-09 12:00:01 [INFO] __main__: News daemon started
2026-11-09 12:00:01 [INFO] __main__: Processing source: RBK (rss)
2026-11-09 12:00:02 [INFO] __main__:   Fetched 15 items from RBK
2026-11-09 12:00:02 [INFO] __main__: Sent news from RBK: "Заголовок новости..."
```

---

## Обработка ошибок

- **Сеть / 5xx / timeout** — ретраи (3 попытки, экспоненциальный backoff 2→4→8с)
- **Ошибка парсинга источника** — логируется `WARNING`, источник пропускается, остальные продолжают работу
- **Backend недоступен** — клиент ретраит, демон не падает, следующая итерация по cron попробует снова
- **SIGTERM / SIGINT** — graceful shutdown: остановка планировщика, ожидание текущих задач

---

## Добавление нового источника

1. Откройте `config/sources.yaml`
2. Добавьте запись в массив `sources` (см. примеры выше)
3. Для HTML — проверьте селекторы в DevTools браузера на целевом сайте
4. Перезапустите демон (или отправьте `SIGHUP` — планировщик перечитает конфиг при следующем запуске задачи)

---

## Зависимости (requirements.txt)

```
docling>=2.0.0          # PDF → markdown (OCR, таблицы)
beautifulsoup4>=4.12.0  # HTML парсинг
feedparser>=6.0.10      # RSS/Atom
httpx>=0.27.0           # HTTP клиент
pyyaml>=6.0.1           # YAML конфиг
apscheduler>=3.10.4     # Cron-планировщик
tenacity>=8.3.0         # Ретраи
lxml>=5.0.0             # Быстрый парсер для BS4
```

Системные зависимости (в Dockerfile):
- `poppler-utils` — PDF → изображения для Docling
- `tesseract-ocr` + `tesseract-ocr-rus/eng` — OCR русского/английского

---

## Структура отправляемого payload'а

```json
POST /api/news
{
  "raw_text": "Заголовок\n\nПолный текст новости...",
  "source_url": "https://example.com/news/123",
  "source_name": "RBK"
}
```

Backend принимает, вызывает Model A (классификация по ОКВЭД/географии), сохраняет в `news_db.digests`.

---

## Лицензия

Внутренний компонент проекта «Новостная аналитика для принятия бизнес-решений». Не предназначен для самостоятельного распространения.