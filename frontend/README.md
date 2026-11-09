# AI Invest Recommender

React 18, TypeScript, Vite, React Router 6, TanStack Query, Tailwind и lucide-react. Универсальное SPA для инвестиционных рекомендаций.

## Запуск

Нужен Node.js 20.19+ или 22.12+. Из каталога `frontend`:

```sh
npm ci
cp .env.example .env
npm run dev
```

Открыть [http://127.0.0.1:3000](http://127.0.0.1:3000). Бэкенд для dev-прокси — `http://localhost:8080`. В браузере запросы идут на `/api/*` и `/health`, имя Docker-сервиса `backend` используется только nginx.

Без бэкенда режим `auto` позволяет сразу работать с лентой рекомендаций и чатом. Dev-прокси маркирует ошибку соединения как `PROXY_NETWORK_ERROR`, поэтому она корректно включает fallback. Настоящие HTTP 401/403/500 и тайм-ауты остаются ошибками с возможностью повтора. Чат не генерирует фиктивных ответов: для ответа нужен настоящий `/api/chat`.

Маршруты: `/` — главная страница с Рекомендациями (Лента + Чат), `/settings` — заглушка настроек. Остальные маршруты перенаправляются на главную.

## Переменные окружения

| Переменная              | По умолчанию            | Назначение                                                                                     |
| ----------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `VITE_API_BASE`         | пусто                   | Same-origin API; при внешнем URL серверу нужен CORS с корреляционными заголовками              |
| `VITE_USE_MOCK`         | `auto`                  | `true` — новые маршруты через mock; `auto` — fallback при 404/Network; `false` — только сервер |
| `VITE_ENVIRONMENT`      | `local`                 | `local`, `integration` или `production` в конверте событий                                     |
| `VITE_APP_TITLE`        | `AI Invest Recommender` | Заголовок вкладки                                                                              |
| `VITE_FRONTEND_VERSION` | `1.0.0`                 | Версия фронтенда в событиях                                                                    |

Переменные `VITE_*` подставляются **при сборке**. После изменения нужен перезапуск dev-сервера или пересборка Docker-образа. Бейдж `MOCK` показывает активацию fallback; зелёная/красная точка независимо отражает настоящий `/health`.

Agent-вход:

```text
/?agent=true&run_id=run-1&persona_id=persona-1&seed=42
```

Overrides передаются в чат; разрешение на них определяет сервер. Они не обходят авторизацию. Для человека используется отдельный псевдоним `user_id`, `run_id/persona_id=null`. Timing adapter появляется только при `agent=true` с непустыми `run_id` и `persona_id`:

```js
window.__agentTiming.setPhase('llm_wait');
window.__agentTiming.setPhase('modeled_read');
window.__agentTiming.setPhase('interaction');
window.__agentTiming.setPhase('idle');
```

Он измеряет только фактически видимое время, не создаёт клики и не принимает длительность извне. Для legacy-профиля открыть `/?dev=1` — появится вкладка `Legacy ID`. Выбор влияет только на push и чат.

## Телеметрия и поведение

- События E01, E03–E05, E07–E13 и E15; E02/E06/E14/E16–E20 фронтенд не создаёт.
- E01 — только при agent-входе; E07 — после commit готового/пустого UI; E10 — после раскрытия или активации источника; E11 — после серверного подтверждения либо успешного Clipboard API; E13 — явная отправка опроса с подтверждением `/api/feedback`.
- Очередь в памяти и localStorage: максимум 500 событий / 24 часа. Пакеты до 50 событий / 48 KiB UTF-8. События удаляются только после ACK `accepted_ids`/`duplicate_ids`; постоянные ошибки уходят в quarantine до 100 записей. Retry сохраняет `event_id` и транспортный `operation_id`, использует exponential backoff до 60 секунд.
- Сброс каждые 2 секунды, при размере пакета и при уходе/скрытии через `fetch keepalive`. Неподтверждённые события сохраняются. Недоступный collector не блокирует интерфейс. При mock-collector ACK симулируется, серверная аналитика не заполняется.
- Видимость: ≥50% нормализованной площади, видимый документ, фокус, отсутствие известного модального оверлея, непрерывно ≥1 секунды. IO с сеткой порогов дополняется проверкой геометрии и мгновенными сигналами focus/visibility/route.
- E09 — кумулятивные checkpoints каждые 10 секунд активного времени и на hidden/out-of-view/route/pagehide. Покрытие текста — доля слов, чьи DOM Range попадали в видимую часть текста, с учётом свёрнутых строк. Это покрытие экрана, а не доказательство прочтения. Не суммировать checkpoints.
- Reload сохраняет `journey_id`, новый маршрут/история/BFCache создают новый `page_view_id`; BFCache обновляет `exposure_id`. TTL сессии — 30 минут без активности.
- История чата — только React-память, сохраняется при переключении вкладок и сбрасывается при уходе со страницы. Опросы не перекрывают ленту. «Применю» фиксирует намерение; форма решения B доступна только после сохранения/намерения.
- Никаких движений мыши, содержимого буфера, токенов, cookies, DOM или произвольных HTTP body в событиях. Свободный текст ограничен 500 символами.

## `data-testid`

Селекторы карточки нужно искать **внутри конкретной** `news-card`; идентификаторы и позиции приходят с сервера.

| Селектор                    | Смысл / атрибуты                                              |
| --------------------------- | ------------------------------------------------------------- |
| `recommendations-page`      | Корневой UI главной страницы                                  |
| `settings-page`             | Корневой UI страницы настроек                                 |
| `chat-area`                 | Компонент чата                                                |
| `feed-loading`              | Skeleton ленты                                                |
| `feed-ready`                | Готовая порция ленты                                          |
| `feed-empty`                | Корректный пустой результат                                   |
| `feed-error`                | Ошибка и повтор                                               |
| `news-card`                 | `data-news-id`, `data-position` из ответа                     |
| `news-open`                 | Открыть/свернуть новость, `aria-expanded`                     |
| `news-body`                 | Текст новости                                                 |
| `news-source`               | Ссылка на источник, может повторяться внутри карточки         |
| `recommendation-expand`     | Раскрыть/свернуть шаг, `aria-expanded`                        |
| `recommendation-save`       | Сохранить/отменить, `aria-pressed`                            |
| `recommendation-reject`     | Показать inline-выбор причины; отдельная кнопка подтверждения |
| `recommendation-useful`     | Полезно, `aria-pressed`                                       |
| `recommendation-not-useful` | Неполезно, `aria-pressed`                                     |
| `recommendation-copy`       | Clipboard API; E11 только при успехе                          |
| `recommendation-apply`      | Намерение/отмена, `aria-pressed`                              |
| `readiness-survey`          | Немодальный опрос после изучения рекомендации                 |
| `readiness-value`           | Пять radio; выбирать по `value=1..5`                          |
| `feedback-submit`           | Отправить/обновить готовность                                 |
| `feedback-skip`             | Пропустить без E13                                            |
| `decision-followup`         | Форма B после save/intend_apply                               |
| `decision-summary`          | Текст принятого решения, ≤500 символов                        |
| `decision-usefulness`       | Группа radio 1–5                                              |
| `decision-submit`           | Явная отправка/обновление решения                             |

## Проверки

```sh
npm test
npm run build
npm run lint
npm run format:check
```

Vitest + Testing Library: API-заголовки, fallback/HTTP/timeout, сессия, очередь/ACK/backoff/размер/повтор, видимость/hidden/BFCache, реальные обработчики кнопок, состояния ленты, Clipboard API, опросы и версии ответов. Browser QA — раскрытие, сохранение, чат при недоступном API и мобильные состояния.

## Docker

Из корня репозитория:

```sh
docker build -t ai-invest-recommender:local ./frontend
```

`../docker-compose.frontend.yml` — **дополнительный фрагмент** существующего стека с сервисом `backend` и его healthcheck. Пример, если основной compose находится в корне репозитория:

```sh
docker compose -f docker-compose.yml -f docker-compose.frontend.yml up -d --build frontend
```

Основного compose Go-бэкенда в этом checkout нет. При расположении основного compose в другом каталоге скорректируйте `build.context` относительно каталога первого compose. Сервис фронтенда: `ai-invest-recommender`, порт `3000:80`, ожидание `backend: service_healthy`. В production при обязательном настоящем API задайте build-arg `VITE_USE_MOCK=false`.

nginx сохраняет префикс: `proxy_pass http://backend:8080;` без URI/завершающего слэша. Прямые `/` и `/settings` возвращают SPA; `/health` проксируется отдельно.

Независимая проверка образа со временным backend-fixture, без изменения рабочего стека:

```sh
cd frontend
sh tests/docker-smoke.sh
# SMOKE_PORT=3000 sh tests/docker-smoke.sh  # если порт 3000 свободен
```

Скрипт проверяет nginx, SPA-маршруты, `/health` и неизменный `/api/push?user_id=7`; созданные контейнеры и сеть удаляются через trap.

## Предварительный оценочный запуск

Для сборки без mock используйте `npm run build -- --mode evaluation` (настройки в `.env.evaluation`) или существующие Docker build-args:

```sh
docker build --build-arg VITE_USE_MOCK=false --build-arg VITE_ENVIRONMENT=integration -t ai-invest-recommender:evaluation ./frontend
```

Команда Docker выполняется из корня репозитория. При запуске через основной compose задайте `VITE_USE_MOCK=false` для его build-arg и пересоберите frontend; runtime env не изменяет готовый образ. Seed должен быть безопасным целым числом; пустое/некорректное значение блокирует agent-вход. Каждый опрос подписан названием рекомендации и привязан к паре delivery/recommendation. Эти изменения предназначены для диагностического прогона, а не полной приёмки метрик events-v1/v2.
