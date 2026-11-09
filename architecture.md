# Архитектура проекта «Новостная аналитика»

Эталонное описание архитектуры. Обновляется при согласованных изменениях.

---

## 1. Общая схема (Multi-container)

```
┌──────────────────────────┐     HTTP/JSON      ┌──────────────────────────┐
│      Backend Container   │ ─────────────────▶ │       Model A Service    │
│                          │  POST /v1/process  │  (external, own host)    │
│  ┌────────────────────┐  │                    └──────────────────────────┘
│  │    Backend (Go)    │  │
│  │      :8080         │  │                    ┌──────────────────────────┐
│  │  ┌──────────────┐  │  │                    │       Model B Service    │
│  │  │ /api/news    │  │  │  HTTP/JSON         │  (external API)          │
│  │  │ /api/push    │  │  │  (API Key)         │  changellenge.up         │
│  │  │ /api/chat    │  │  ├──────────────────▶│  .railway.app/v1         │
│  │  └──────────────┘  │  │                    └──────────────────────────┘
│  └─────────┬──────────┘  │
│            │            │
│  ┌─────────▼──────────┐  │
│  │  News Daemon       │  │
│  │  (Python)          │  │
│  │  - poll sources   │  │
│  │  - docling OCR    │  │
│  │  - POST /api/news │  │
│  └────────────────────┘  │
└─────────────┬────────────┘
              │
              │  PostgreSQL protocol
              ▼
┌──────────────────────────┐
│    PostgreSQL Container  │
│                          │
│  users_db  |  news_db    │
└──────────────────────────┘
```

**Порты:**
- **Backend**: 8080 (вход: daemon, frontend) — один порт, 3 эндпоинта
- **PostgreSQL**: 5432 (внутренняя сеть docker)
- **Model A**: внешний URL (настраивается в `.env`)
- **Model B**: `https://changellenge.up.railway.app/v1` (фиксирован)

---

## 2. Компоненты

### 2.1 News Daemon (Python)
- **Запуск**: в том же контейнере что и бэк (supervisor / systemd / goroutine), отдельный процесс
- **Конфиг**: `news-listener/sources.yaml` — список источников (stub, заполним позже)
- **Цикл**: по расписанию (cron в конфиге) опрашивает источники
- **Источники**: RSS / HTML / API (селекторы/хедеры в конфиге)
- **PDF**: сканированные страницы → `docling` (OCR + таблицы) → markdown → текст
- **Выход**: `POST http://localhost:8080/api/news` с **сырым текстом новости**:
  ```json
  {"raw_text": "...", "source_url": "...", "source_name": "РБК"}
  ```
  *Не вызывает Model A напрямую — это делает бэк.*

### 2.2 Backend (Go)
**Один порт (8080), три эндпоинта:**
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/news` | Приём от демона → вызов **Model A** → сохранение в news_db |
| GET  | `/api/push?user_id=...` | Пуш при входе → сборка промпта → **Model B** → `{push_flag, text}` |
| POST | `/api/chat` | Вкладка: `{user_id, query?}` → промпт + query → **Model B** → `{text}` |

**Внутренние модули:**
- `config` — парсинг `.env`
- `model_a` — HTTP клиент к Model A (`MODEL_A_URL` из env)
- `model_b` — HTTP клиент к Model B (`MODEL_B_BASE_URL` + API Key из env)
- `user_profile` — загрузка профиля компании/группы из users_db
- `news_digest` — CRUD для news_db
- `prompt` — сборка универсального промпта для Model B (профиль + новости + query)

### 2.3 Model A (внешняя, другой человек)
- **Интерфейс**: HTTP, JSON request/response
- **Настройки**: `MODEL_A_URL`, `MODEL_A_MODEL` — в `.env`
- **Request format** (договорённость с командой Model A):
  ```json
  {"raw_text": "...", "source_url": "...", "source_name": "..."}
  ```
- **Response format**: см. `backend/examples/modelA_response_format.json`

### 2.4 Model B (внешний API)
- **Endpoint**: `https://changellenge.up.railway.app/v1` (фиксирован)
- **Auth**: `Authorization: Bearer <API_KEY>` (из env)
- **Model**: выбирается в env (`MODEL_B_MODEL`), список допустимых — в `.env.example`
- **Request**: универсальный промпт (контекст компании + массив новостей + user_query)
- **Response formats**: см. `backend/examples/modelB_push_response_format.json` и `modelB_chat_response_format.json`

---

## 3. Структура папок (backend/)

```
backend/
├── go.mod                    # Go module definition
├── go.sum                    # Dependencies checksums (после go mod tidy)
├── .env.example              # Шаблон переменных окружения (в репозиторий)
├── .env                      # Локальные секреты (НЕ в репозиторий, в .gitignore)
├── architecture.md           # Этот файл (копия из корня проекта для удобства)
├── Dockerfile                # Мультистадийная сборка: daemon + backend
├── docker-compose.yml        # Локальный запуск: app + postgres
├── README.md                 # Инструкция по сборке и запуску
├── cmd/
│   └── backend/
│       └── main.go           # Точка входа: инициализация config, DB, роутер, запуск HTTP сервера + daemon goroutine
├── internal/                 # Приватные пакеты (не импортируются внешне)
│   ├── config/               # Загрузка и валидация .env (viper/envconfig)
│   ├── db/                   # Подключение к PG, пулы соединений, миграции (sqlx/pgx)
│   ├── model_a/              # HTTP клиент для Model A (request/response DTO, retries, timeout)
│   ├── model_b/              # HTTP клиент для Model B (API key auth, streaming при необходимости)
│   ├── user_profile/         # Репозиторий профилей: companies, groups, additional_sectors
│   ├── news_digest/          # Репозиторий выжимок новостей: CRUD, поиск последних N
│   ├── prompt/               # Сборка универсального промпта для Model B (template + данные)
│   └── handler/              # HTTP хендлеры (Chi/Gin): /api/news, /api/push, /api/chat
├── news-listener/               # Python код демона (отдельный entrypoint)
│   ├── sources.yaml          # Конфиг источников (stub, заполняется позже)
│   ├── main.py               # Точка входа демона: scheduler + fetcher + parser
│   ├── fetcher/              # Получение контента: RSS, HTML, API
│   ├── parser/               # Парсинг: docling для PDF, BeautifulSoup для HTML
│   └── client/               # HTTP клиент для POST /api/news на бэк
├── migrations/               # SQL миграции (golang-migrate format)
│   ├── 0001_init_users_db.up.sql
│   ├── 0001_init_users_db.down.sql
│   ├── 0002_init_news_db.up.sql
│   └── 0002_init_news_db.down.sql
└── scripts/                  # Вспомогательные скрипты (не в бинари)
    ├── load_csv.py           # Загрузка target_companies.csv / target_groups.csv в users_db
    └── init-databases.sh     # Создание users_db и news_db в postgres entrypoint
```

**Принцип:** `internal/` — изолированная бизнес-логика, `cmd/` — сборка бинарников, `news-listener/` — отдельный Python-процесс, `migrations/` — версионируемая схема БД.

---

## 4. База данных

### users_db (профили из CSV)
```sql
-- companies (target_companies.csv)
CREATE TABLE companies (
    synthetic_u       TEXT PRIMARY KEY,
    org_type          TEXT,
    okfs_name         TEXT,
    company_age_years_gradation TEXT,
    eco_mark_label    TEXT,
    mainokved_code    TEXT,
    mainokved_name    TEXT,
    amount_workers_fns_gradation TEXT,
    cl_type           TEXT,
    cl_product_rko_mark BOOLEAN,
    cl_product_gar_mark BOOLEAN,
    cl_product_loa_mark BOOLEAN,
    cl_product_lea_mark BOOLEAN,
    cl_product_dep_mark BOOLEAN,
    cl_product_zpp_mark BOOLEAN,
    fts_country_name  TEXT,
    factoring_mark    BOOLEAN,
    revenue_company   BIGINT,
    group_id          TEXT,
    city              TEXT,
    region            TEXT,
    business_size_fns TEXT,
    additional_sectors JSONB  -- массив двузначных ОКВЭД
);

-- groups (target_groups.csv)
CREATE TABLE groups (
    group_id              TEXT PRIMARY KEY,
    target_company_ids    JSONB,      -- массив synthetic_u
    revenue_sum           BIGINT,
    business_size_bank    TEXT,
    own_sectors           JSONB,      -- массив двузначных ОКВЭД
    mainokved_codes       JSONB,
    regions               JSONB,
    cities                JSONB,
    fts_countries         JSONB,
    ownership_forms       JSONB,
    development_stages    JSONB,
    mainokved_names       JSONB,      -- объект {code: [names]}
    additional_sectors    JSONB
);
```
> CSV загружаются один раз скриптом при инициализации (разделитель `;`, кодировка `utf-8-sig`, JSON-поля парсятся).

### news_db (выжимки новостей)
```sql
CREATE TABLE digests (
    id              BIGSERIAL PRIMARY KEY,
    industry_id_list JSONB,      -- массив кодов отраслей
    region          TEXT,         -- код субъекта РФ или NULL
    city            TEXT,         -- NULL если нет
    country         TEXT,         -- страна, напр. "США (US)"
    source          TEXT,         -- "Внутренняя аналитика" | "РБК" | ...
    text            TEXT,         -- содержание выжимки
    created_at      TIMESTAMPTZ DEFAULT now()
);
```
> Поля соответствуют **Model A response** (id генерирует БД).

---

## 4. Конфигурация

### `.env.example` (все параметры)
```bash
# Backend
PORT=8080

# PostgreSQL (single instance, two databases)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
USERS_DB=users_db
NEWS_DB=news_db

# Model A (external, another team)
MODEL_A_URL=http://host.docker.internal:8081/v1/process
MODEL_A_MODEL=gemma-4-26b-a4b-it

# Model B (external API)
MODEL_B_BASE_URL=https://changellenge.up.railway.app/v1
MODEL_B_API_KEY=           # заполнить при деплое
MODEL_B_MODEL=             # выбрать из списка ниже

# Доступные модели Model B (копировать точно):
# google/gemma-4-26b-a4b-it
# z-ai/glm-5.3-flash
# qwen/qwen3.6-35b-a3b
# deepseek/deepseek-v4.1-flash
# qwen/qwen3-vl-30b-a3b-instruct
# moonshotai/kimi-k2.6

# Daemon
DAEMON_POLL_INTERVAL=300   # секунд, базовый интервал
DAEMON_SOURCES_CONFIG=./news-listener/sources.yaml
```

### `news-listener/sources.yaml` (stub — синтаксис)
```yaml
# Конфигурация новостных источников для демона
# Каждый источник опрашивается независимо по своему расписанию.
# Демон извлекает текст новости и шлёт на бэк: POST /api/news
# {raw_text, source_url, source_name}
# Поля:
#   name        - уникальное имя источника (попадает в поле source_name)
#   type        - rss | html | api
#   url         - URL для опроса (RSS feed, страница, API endpoint)
#   schedule    - cron-выражение (UTC), как часто опрашивать
#   headers     - опционально, HTTP заголовки (для api)
#   selector    - CSS-селектор для извлечения текста статьи (для html)
#   list_selector - селектор списка статей на странице (для html)
#   link_selector - селектор ссылки на полную статью (для html)
#   date_selector - селектор даты публикации (для html)
#   title_selector - селектор заголовка (для html)
#   pdf         - true если источник отдаёт PDF (будет обработан docling)

sources:
  - name: "Example RSS"
    type: "rss"
    url: "https://example.com/rss.xml"
    schedule: "*/10 * * * *"

  - name: "Example HTML"
    type: "html"
    url: "https://example.com/news"
    schedule: "0 * * * *"
    list_selector: ".news-list .item"
    link_selector: "a.title@href"
    title_selector: "a.title"
    date_selector: ".date"
    selector: "article .content"

  - name: "Example API"
    type: "api"
    url: "https://api.example.com/v1/news"
    schedule: "*/5 * * * *"
    headers:
      Authorization: "Bearer ${API_TOKEN}"
    # Ожидается JSON массив объектов с полями: title, url, content, published_at
```

---

## 5. Форматы обмена (JSON)

### Model A Request (Backend → Model A)
Бэк вызывает Model A **после** получения `/api/news` от демона:
```json
{
  "raw_text": "полный текст новости",
  "source_url": "https://...",
  "source_name": "РБК"
}
```

### Model A Response → Backend → news_db.digests
```json
{
  "id": null,
  "industry_id_list": ["46.72.2", "07.29.4"],
  "region": "77",
  "city": "Москва",
  "country": "Россия (RU)",
  "source": "РБК",
  "text": "выжимка новости"
}
```

### Model B Push Request (Backend → Model B)
```json
{
  "company_profile": { ... },      // из users_db.companies + groups
  "news_digests": [ { ... }, ... ], // последние N записей из news_db
  "user_query": null                // для push всегда null
}
```

### Model B Push Response
```json
{ "push_flag": true, "text": "персонализированный инсайт" }
```

### Model B Chat Request
```json
{
  "company_profile": { ... },
  "news_digests": [ { ... }, ... ],
  "user_query": "Как новость повлияет на закупки?"
}
```

### Model B Chat Response
```json
{ "text": "развёрнутый ответ с рисками/возможностями" }
```

---

## 6. Запуск (Docker Compose)

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_MULTIPLE_DATABASES: users_db,news_db
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./scripts/init-databases.sh:/docker-entrypoint-initdb.d/init.sh
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    build: .
    environment:
      - POSTGRES_HOST=postgres
      - PORT=8080
      # остальные env из .env
    ports: ["8080:8080"]
    depends_on:
      postgres:
        condition: service_healthy
    # внутри контейнера supervisor запускает: backend (Go) + daemon (Python)

volumes:
  pgdata:
```

> **Model A и Model B — внешние сервисы**, в compose не входят. Подключаются через `MODEL_A_URL` и `MODEL_B_BASE_URL`.

---

## 7. Данные для загрузки (CSV)

Путь к актуальному снапшоту:
```
Библиотека исследований/Выгрузки датафреймов/2026-10-24_13-09-26_907003/
  target_companies.csv  (6 861 строка, sep=';', utf-8-sig)
  target_groups.csv     (4 805 строк, sep=';', utf-8-sig)
```

Парсинг: pandas → JSON-поля (`ADDITIONAL_SECTORS`, `TARGET_COMPANY_IDS`, и др.) → INSERT в БД.
Скрипт загрузки: `scripts/load_csv.py` (или Go-утилита).

---

## 8. Безопасность и ограничения

- **Нет авторизации** — доверяем входящему `user_id` (микросервис внутри периметра организации)
- **API Key Model B** — только в `.env`, в репозиторий не попадает
- **Model A URL** — внутренний, без авторизации (другой контур)
- **PDF/сканы** — docling работает офлайн (`enable_remote_services=False`)
- **Лимиты токенов Model B** — учитывать при формировании промпта (обрезать историю новостей)

---

## 9. Дальнейшие расширения (не в MVP)

- Разделение daemon и backend на **отдельные контейнеры** (через очередь Redis/RabbitMQ)
- Кэширование профилей компаний в памяти (Redis / in-memory с TTL)
- Метрики качества (precision/recall отбора новостей)
- A/B тестирование промптов Model B
- Поддержка вебхуков от источников вместо polling
- Managed PostgreSQL в проде (RDS / Cloud SQL) — убрать postgres из compose

---

## 10. Чек-лист готовности к разработке

- [ ] `.env.example` создан
- [ ] `news-listener/sources.yaml` (stub) создан
- [ ] Go module инициализирован (`go mod init`)
- [ ] Миграции БД написаны
- [ ] Скрипт загрузки CSV готов
- [ ] Dockerfile + docker-compose.yml готовы
- [ ] README с инструкцией по запуску