# AI Invest Recommender — Новостная аналитика для инвестиций

Единый Docker Compose проект с 5 сервисами: PostgreSQL, Analyser (Model A), Backend (Go), News Listener, Frontend (React + Nginx).

---

## Архитектура

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  News Listener  │────▶│    Backend      │────▶│    Analyser     │
│  (Python daemon)│     │   (Go, :8080)   │     │  (FastAPI, :8000)│
│  :8081 health   │     │                 │     │                 │
└─────────────────┘     └────────┬────────┘     └────────┬────────┘
                                 │                       │
                          ┌──────┴──────┐         ┌──────┴──────┐
                          │ PostgreSQL  │         │ External LLM │
                          │  :5432      │         │  Gateway     │
                          └─────────────┘         └─────────────┘
                                 │
                          ┌──────┴──────┐
                          │  Frontend   │
                          │ (Nginx, :80)│
                          │  порт 3000  │
                          └─────────────┘
```

### Сервисы

| Сервис | Контейнер | Порт (хост) | Назначение |
|--------|-----------|-------------|------------|
| **postgres** | `ai-invest-recommender-postgres` | 5432 | БД: `users_db`, `news_db` |
| **analyser** | `ai-invest-recommender-analyser` | 8000 | Model A — классификация новостей (ОКВЭД, гео) |
| **backend** | `ai-invest-recommender-backend` | 8080 | API, оркестрация, Model B (LLM), миграции |
| **news-listener** | `ai-invest-recommender-news-listener` | 8081 | Демон сбора новостей (RSS/HTML/API), 52 источника |
| **frontend** | `ai-invest-recommender-frontend` | 3000 | React SPA, проксирует `/api` → backend |

---

## Быстрый старт

### 1. Подготовка `.env`

Скопируйте пример и заполните реальными ключами:

```bash
cp .env.example .env
# Отредактируйте .env — нужны реальные API ключи для LLM
```

**Ключевые переменные** (см. `.env.example`):
- `POSTGRES_PASSWORD` — пароль БД
- `MODEL_B_API_KEY` — ключ для внешнего LLM (Model B)
- `LLM_API_KEY` — ключ для Analyser (Model A)
- `VITE_*` — билд-переменные фронтенда

### 2. Запуск всего стека

```bash
docker compose up --build -d
```

### 3. Проверка

```bash
# Статус контейнеров
docker compose ps

# Логи
docker compose logs -f backend
docker compose logs -f news-listener

# Health checks (все должны быть healthy)
curl http://localhost:8000/health   # Analyser
curl http://localhost:8080/health   # Backend
curl http://localhost:8081/health   # News Listener
curl http://localhost:3000/         # Frontend
```

### 4. Остановка

```bash
docker compose down        # остановка, контейнеры удаляются, volume сохраняется
docker compose down -v     # полная очистка с удалением БД
```

---

## Структура проекта

```
ai-invest-recommender/
├── docker-compose.yml          # Единый compose для всех сервисов
├── .env.example                # Шаблон переменных окружения
├── .env                        # Ваши секреты (НЕ в git)
├── backend/                    # Go сервис
│   ├── Dockerfile              # Multi-stage: builder → alpine
│   ├── cmd/backend/main.go     # Точка входа
│   ├── internal/               # Внутренние пакеты
│   ├── migrations/             # SQL миграции (авто-накат при старте)
│   └── scripts/init-databases.sh  # Инициализация users_db, news_db
├── analyser/                   # Model A (Python/FastAPI)
│   ├── Dockerfile
│   ├── main.py                 # FastAPI + классификация
│   ├── industries.csv          # Справочник ОКВЭД
│   └── requirements.txt
├── news-listener/              # Демон сбора новостей
│   ├── Dockerfile
│   ├── main.py                 # APScheduler + health server :8081
│   ├── fetcher.py              # RSS/HTML/API fetchers
│   ├── parser.py               # Docling (PDF) + BeautifulSoup
│   ├── client.py               # BackendClient с ретраями
│   ├── config/sources.yaml     # 52 источника + cron расписания
│   └── requirements.txt
└── frontend/                   # React + Vite + Nginx
    ├── Dockerfile              # Multi-stage: node build → nginx
    ├── nginx.conf              # Прокси /api → backend:8080
    ├── src/
    └── package.json
```

---

## Переменные окружения (.env)

| Переменная | Описание | Пример |
|------------|----------|--------|
| `POSTGRES_HOST` | Хост БД (в compose — имя сервиса) | `postgres` |
| `POSTGRES_PORT` | Порт PostgreSQL | `5432` |
| `POSTGRES_USER` | Пользователь БД | `postgres` |
| `POSTGRES_PASSWORD` | Пароль БД | `secure_password` |
| `USERS_DB` | Имя БД пользователей | `users_db` |
| `NEWS_DB` | Имя БД новостей | `news_db` |
| `MODEL_B_BASE_URL` | URL внешнего LLM API | `https://api.example.com/v1` |
| `MODEL_B_API_KEY` | Ключ Model B | `sk-...` |
| `MODEL_B_MODEL` | Модель Model B | `deepseek/deepseek-v4.1-flash` |
| `PORT` | Порт Backend | `8080` |
| `LLM_API_KEY` | Ключ Analyser (Model A) | `sk-...` |
| `LLM_MODEL` | Модель Analyser | `google/gemma-4-26b-a4b-it` |
| `LLM_BASE_URL` | URL шлюза для Analyser | `https://api.example.com/v1` |
| `BACKEND_URL` | URL Backend для News Listener | `http://backend:8080` |
| `VITE_USE_MOCK` | Фронтенд: мок/реальный API | `auto` |
| `VITE_API_BASE` | Базовый URL API для фронта | (пусто — относительный) |

---

## Health Checks

Все сервисы имеют встроенные health checks, Docker Compose ждёт `condition: service_healthy`:

```yaml
# Пример зависимостей в compose
depends_on:
  postgres:
    condition: service_healthy
  analyser:
    condition: service_healthy
```

| Сервис | Проверка | Интервал |
|--------|----------|----------|
| postgres | `pg_isready -U postgres` | 5с |
| analyser | `GET /health` (Python urllib) | 10с |
| backend | `GET /health` (wget) | 30с |
| news-listener | `GET /health` (Python urllib) | 10с |
| frontend | nginx статус | — |

---

## Типичные операции

### Просмотр логов конкретного сервиса
```bash
docker compose logs -f backend --tail=100
```

### Перезапуск одного сервиса
```bash
docker compose restart backend
```

### Вход в контейнер (дебаг)
```bash
docker compose exec backend sh
docker compose exec postgres psql -U postgres -d news_db
```

### Пересборка после изменений кода
```bash
docker compose up --build -d backend
```

### Миграции БД
Накатываются автоматически при старте backend (файлы в `backend/migrations/`).

---

## Известные ограничения

1. **Внешний LLM API** — Analyser и Model B требуют рабочие API ключи. С тестовыми ключами (`test_key_for_dev`) внешний шлюз возвращает 404 → весь пайплайн падает с 502.
2. **News Listener health server** — работает на порту 8081 внутри контейнера, не проброшен на хост (не нужен снаружи).
3. **Frontend прокси** — в `nginx.conf` настроен `proxy_pass http://backend:8080` для `/api/`. На хосте доступен на порту 3000.

---

## Лицензия

Внутренний проект. Не предназначен для распространения.