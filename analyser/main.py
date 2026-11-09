"""
Веб-сервис классификации новостей по отраслям и географии (трек «Новостная аналитика»).

Новость приходит в JSON-теле запроса. Сервис отправляет её нейросети через
OpenAI-совместимый шлюз организаторов вместе с промптом и файлом industries.csv
и возвращает отрасли (только из industries.csv), страну, а для России — регион и город.

Запуск:  uvicorn main:app --port 8000
Настройки — в файле .env рядом с main.py (см. README.md).
"""
import csv
import io
import json
import logging
import os
import re
from pathlib import Path
from typing import List, Optional, Union

import httpx
from fastapi import Body, FastAPI, Header, HTTPException
from openai import APIConnectionError, APIStatusError, OpenAI
from pydantic import BaseModel

logger = logging.getLogger("news_classifier")
logging.basicConfig(level=logging.INFO)


# ---------- Загрузка .env (без внешних зависимостей) ----------
def load_env_file(path: Path) -> bool:
    """Читает .env сам, не завися от папки запуска и флагов uvicorn.
    Понимает BOM и UTF-16 (так Блокнот Windows иногда сохраняет файл), кавычки и 'export '."""
    if not path.is_file():
        return False
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("utf-16")
    for line in text.splitlines():
        line = line.strip().lstrip("\ufeff")
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:]
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and not os.environ.get(key):
            os.environ[key] = value
    return True


ENV_FILE_LOADED = None
for _candidate in (Path(__file__).resolve().parent / ".env", Path.cwd() / ".env"):
    if load_env_file(_candidate):
        ENV_FILE_LOADED = str(_candidate)
        break


# ---------- Настройки ----------
# Модели, выданные организаторами (названия нужно писать точно)
ALLOWED_MODELS = [
    "google/gemma-4-26b-a4b-it",
    "z-ai/glm-5.3-flash",
    "qwen/qwen3.6-35b-a3b",
    "deepseek/deepseek-v4.1-flash",
    "qwen/qwen3-vl-30b-a3b-instruct",
    "moonshotai/kimi-k2.6",
]
DEFAULT_MODEL = os.getenv("LLM_MODEL", ALLOWED_MODELS[0])

# Основной шлюз. Если запрос не прошёл (нет связи / ошибка 5xx),
# можно добавить запасной URL через переменную окружения LLM_BASE_URL.
DEFAULT_BASE_URLS = [
    "https://changellenge.up.railway.app/v1",
]


def _normalize_base(url: str) -> str:
    url = url.strip().rstrip("/")
    return url if url.endswith("/v1") else url + "/v1"


def _build_base_urls() -> List[str]:
    custom = [u for u in os.getenv("LLM_BASE_URL", "").split(",") if u.strip()]  # можно несколько через запятую
    result: List[str] = []
    for u in custom + DEFAULT_BASE_URLS:
        u = _normalize_base(u)
        if u not in result:
            result.append(u)
    return result


BASE_URLS = _build_base_urls()
KEY_ENV_VARS = ("LLM_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY")
# Принудительный JSON-режим ответа; включайте (LLM_JSON_MODE=1), если модель его поддерживает
JSON_MODE = os.getenv("LLM_JSON_MODE", "0") == "1"
REQUEST_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "120"))
MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "4000"))  # с запасом на «рассуждения» моделей
INDUSTRIES_PATH = Path(os.getenv("INDUSTRIES_PATH", Path(__file__).resolve().parent / "industries.csv"))
MAX_NEWS_CHARS = 30_000

SYSTEM_PROMPT = """Ты — аналитик новостей. Тебе дают текст новости и справочник отраслей \
в виде прикреплённого файла industries.csv.

Определи:
1. Отрасли, к которым относится новость. Выбирай ТОЛЬКО из справочника industries.csv \
и возвращай их id и названия ровно так, как они указаны в файле. Указывать необходимо подробный ОКВЭД. Выбирай ВСЕ действительно \
релевантные отрасли (их может быть несколько). Если подходящих нет — верни пустой список.
Если новость имеет крупный общеэкономический характер - верни абсолютно все отрасли из справочника. Если отрасль не указана в справочнике - не придумывай ее.
Если новость не имеет крупного отраслегового или экономического значения - верни пустой список. 
2. Страну, к которой относится новость (название на русском и код ISO 3166-1 alpha-2).
3. Если страна — Россия: регион (субъект РФ, например «Свердловская область») и город. \
Если страна не Россия — region и city должны быть null.
Если какой-то параметр невозможно определить из текста, ставь null. Ничего не выдумывай.
4. Краткую выжимку новости (3–6 предложений, только факты из текста, без оценок и домыслов). 
   Одна строка, без переносов строк внутри значения (используй пробелы вместо \\n).
5. Источник новости (он будет указан в соответсвующем поле).
Верни ТОЛЬКО валидный JSON без пояснений и markdown-обёртки в формате:
{
  "industry_id_list": [<id1>, <id2>, ...],
  "region": <строка или null>,
  "city": <строка или null>,
  "country": <строка или null>,
  "source": <строка>,
  "text": <строка>
}"""


# ---------- Разбор входного JSON ----------
TEXT_KEYS = ("text", "content", "body", "article", "description", "summary")
TITLE_KEYS = ("title", "headline", "name")
SOURCE_KEYS = ("source", "source_name", "publisher", "site", "domain", "url")
SERVICE_KEYS = ("api_key", "id", "model") + SOURCE_KEYS


def extract_news(payload: dict) -> tuple:  # (title, text, source)
    """Достаёт заголовок и текст новости из JSON-тела запроса.

    Поддерживает разные названия полей (text/content/body/..., title/headline/...)
    и вложенность {"news": {...}}. Источник ищется в полях source/source_name/publisher/
    site/domain/url (на верхнем уровне или внутри "news"); допустим и объект {"name": "..."}.
    Если текстового поля нет, модели отправляется весь JSON целиком (без служебных полей).
    """
    data = payload.get("news") if isinstance(payload.get("news"), dict) else payload

    def first_str(keys):
        for k in keys:
            v = data.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return None

    title, text = first_str(TITLE_KEYS), first_str(TEXT_KEYS)
    source = None
    for container in (data, payload):
        for k in SOURCE_KEYS:
            v = container.get(k)
            if isinstance(v, dict):
                v = v.get("name") or v.get("title") or v.get("url")
            if isinstance(v, str) and v.strip():
                source = " ".join(v.split())[:500]
                break
        if source:
            break
    if not text:
        clean = {k: v for k, v in data.items() if k not in SERVICE_KEYS}
        if not clean:
            raise HTTPException(422, "В JSON-теле нет данных новости")
        text = json.dumps(clean, ensure_ascii=False)
        title = None
    return title, text, source


# ---------- Модель ответа ----------
class ClassificationResponse(BaseModel):
    id: Optional[Union[str, int]] = None  # id новости из запроса (если был передан)
    industry_id_list: List[str]
    region: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    source: Optional[str] = None
    text: str = ""


# ---------- Справочник отраслей (ОКВЭД) ----------
CODE_RE = re.compile(r"^\d{1,2}(\.\d+)*$")  # 62, 62.01, 62.01.1, 62.01.11
FULL_CODE_RE = re.compile(r"^\d{2}\.\d+(\.\d+)*$")  # полный (подробный) код: 62.01, 62.01.1, 62.01.11
ID_HEADERS = {"id", "code", "код", "код оквэд", "оквэд", "okved", "подробный оквэд", "полный оквэд"}
NAME_HEADERS = {"name", "название", "наименование", "title", "описание", "description", "вид деятельности"}


def normalize_code(value) -> str:
    """Приводит код к каноничному виду: '62,01' -> '62.01', 'ОКВЭД 62.01.' -> '62.01'."""
    code = str(value).strip().strip('"').strip("'").lstrip("\ufeff")
    code = re.sub(r"(?i)^(оквэд|okved)\s*[:\-]?\s*", "", code)
    return code.replace(",", ".").replace(" ", "").rstrip(".")


class IndustriesFile:
    """Справочник industries.csv: сырой текст (для отправки модели) и словарь код -> название.

    Ожидаемый формат (разделитель определяется автоматически):
        ОКВЭД 2 знака;Подробный ОКВЭД;Вид деятельности
        01;01.11;Выращивание зерновых ...
    Кодом отрасли считается колонка с ПОДРОБНЫМ ОКВЭД; колонка «ОКВЭД 2 знака» служит
    только группировкой и в проверке не участвует.
    """

    def __init__(self, path: Path):
        self.path = path
        self.raw_text = path.read_text(encoding="utf-8-sig")
        self.id_header: Optional[str] = None
        self.items = self._parse(self.raw_text)
        if not self.items:
            raise RuntimeError(f"В файле {path.name} нет ни одной отрасли")
        # Полные коды ОКВЭД = значения колонки с подробным ОКВЭД.
        self.full_codes = {c: n for c, n in self.items.items() if CODE_RE.match(c)}
        if not self.full_codes:
            raise RuntimeError(
                f"В файле {path.name} не найдена колонка с кодами ОКВЭД (вида 62.01 или 62.01.1)."
            )

    def _parse(self, text: str) -> dict:
        lines = [ln for ln in text.splitlines() if ln.strip()]
        if not lines:
            return {}
        delimiter = max(",;\t", key=lines[0].count)
        rows = [r for r in csv.reader(io.StringIO(text), delimiter=delimiter) if any(c.strip() for c in r)]
        width = max(len(r) for r in rows)
        has_header = not CODE_RE.match(normalize_code(rows[0][0]))
        header = [h.strip().lstrip("\ufeff") for h in rows[0]] if has_header else []
        data = rows[1:] if has_header else rows

        def col(r, i):
            return r[i].strip() if i < len(r) else ""

        # колонка с кодом: по заголовку («Подробный ОКВЭД», id, code ...)
        id_idx = next((i for i, h in enumerate(header) if h.lower() in ID_HEADERS), None)
        if id_idx is None:  # иначе — колонка, где больше всего подробных кодов с точкой
            scores = [sum(bool(FULL_CODE_RE.match(normalize_code(col(r, i)))) for r in data) for i in range(width)]
            id_idx = scores.index(max(scores)) if max(scores) > 0 else 0
        # колонка названия: по заголовку, иначе самая «текстовая» из оставшихся
        name_idx = next((i for i, h in enumerate(header) if h.lower() in NAME_HEADERS and i != id_idx), None)
        if name_idx is None:
            others = [i for i in range(width) if i != id_idx]
            name_idx = max(others, key=lambda i: sum(len(col(r, i)) for r in data)) if others else id_idx

        self.id_header = header[id_idx] if header and id_idx < len(header) else None
        return {normalize_code(col(r, id_idx)): col(r, name_idx) for r in data if normalize_code(col(r, id_idx))}

    def id_note(self) -> str:
        """Поясняет модели, какая колонка файла содержит id (если в файле несколько кодовых колонок)."""
        if not self.id_header:
            return ""
        return (
            f"Примечание к файлу: id отрасли — это значение из колонки «{self.id_header}» "
            f"(полный код ОКВЭД, например {next(iter(self.full_codes))}). В industry_id_list возвращай "
            "только такие значения, строками, ровно в том виде, как в файле. Значения других "
            "колонок (например, кода группы из двух цифр) возвращать нельзя."
        )

    def match(self, raw) -> Optional[str]:
        """Строгая проверка: принимается только строка, ТОЧНО совпадающая с полным кодом ОКВЭД
        из справочника (без пробелов по краям). Числа, коды групп, неизвестные коды
        и «ближайшие родители» не принимаются."""
        if not isinstance(raw, str):
            return None
        code = raw.strip().strip('"').strip("'")
        return code if code in self.full_codes else None


industries = IndustriesFile(INDUSTRIES_PATH)


# ---------- Работа со шлюзом: библиотека openai, как в примере организаторов ----------
class LLMError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


EXPECTED_KEYS = ("industry_id_list", "region", "city", "country", "source", "text")
RETRY_MESSAGE = (
    "Твой предыдущий ответ не удалось разобрать как JSON. Ответь ещё раз: только один валидный "
    "JSON-объект с ключами industry_id_list, region, city, country, source, text — без пояснений, "
    "markdown и комментариев. Не используй двойные кавычки внутри строковых значений."
)


def _repair_json(s: str) -> str:
    """Чинит типичные поломки: запятая перед закрывающей скобкой, значения без кавычек."""
    s = re.sub(r",\s*([}\]])", r"\1", s)
    s = re.sub(
        r'("(?:region|city|country|source)"\s*:)(?!\s*(?:null\b|"))\s*([^,\n}\]]+)',
        lambda m: m.group(1) + " " + json.dumps(m.group(2).strip(), ensure_ascii=False),
        s,
    )
    return s


def salvage_fields(text: str) -> Optional[dict]:
    """Последний шанс: вытаскивает поля регулярками, даже если JSON целиком сломан."""
    data: dict = {}
    m = re.search(r'"industry_id_list"\s*:\s*\[([^\]]*)\]', text)
    if m:
        data["industry_id_list"] = [a or b for a, b in re.findall(r'"([^"]+)"|([\w.\-]+)', m.group(1))]
    for key in ("region", "city", "country", "source"):
        m = re.search(rf'"{key}"\s*:\s*(null|"([^"]*)"|([^,\n}}]+))', text)
        if m:
            if m.group(2) is not None:
                data[key] = m.group(2)
            elif m.group(1) == "null":
                data[key] = None
            else:
                data[key] = m.group(3).strip()
    m = re.search(r'"text"\s*:\s*"(.*)"\s*\}?\s*$', text.strip(), re.S)
    if m:
        data["text"] = " ".join(m.group(1).split())
    return data if "industry_id_list" in data or len(data) >= 3 else None


def parse_model_json(text: Optional[str]) -> Optional[dict]:
    """Устойчивый разбор ответа модели. Возвращает dict или None, если ничего не извлечь.

    Справляется с markdown-обёрткой, текстом до/после JSON, блоками <think>,
    запятыми в конце, значениями без кавычек и переносами строк внутри строк.
    """
    if not text:
        return None
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S | re.I)
    text = text.replace("```json", "").replace("```", "")
    decoder = json.JSONDecoder(strict=False)

    # 1) строгий разбор: пробуем каждую «{» как начало объекта
    for m in re.finditer(r"\{", text):
        try:
            obj, _ = decoder.raw_decode(text[m.start():])
        except ValueError:
            continue
        if isinstance(obj, dict) and any(k in obj for k in EXPECTED_KEYS):
            return obj

    # 2) разбор после автоматической починки
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            obj = decoder.decode(_repair_json(text[start : end + 1]))
            if isinstance(obj, dict):
                return obj
        except ValueError:
            pass

    # 3) вытаскивание полей регулярками
    return salvage_fields(text)


def with_failover(api_key: str, call):
    """Выполняет call(client) на основном шлюзе, при недоступности — на запасном.

    Переключаемся при ошибках связи и ответах 5xx. Ответы 4xx (неверный ключ,
    исчерпан бюджет, неверная модель) пробрасываются сразу — повтор не поможет.
    """
    last_error: Optional[LLMError] = None
    for base_url in BASE_URLS:
        client = OpenAI(api_key=api_key, base_url=base_url, timeout=REQUEST_TIMEOUT)
        try:
            return call(client)
        except APIConnectionError as e:  # включая таймаут
            logger.warning("Нет связи с %s: %s", base_url, e)
            last_error = LLMError(502, f"Нет связи со шлюзом {base_url}: {e}")
        except APIStatusError as e:
            if e.status_code >= 500:
                logger.warning("Шлюз %s вернул %s", base_url, e.status_code)
                last_error = LLMError(e.status_code, str(e))
            else:
                raise LLMError(e.status_code, str(e))
    raise last_error or LLMError(502, "Нет доступных адресов шлюза")


def build_prompt(title: Optional[str], text: str, source: Optional[str] = None) -> str:
    news = f"Заголовок: {title}\n\n{text}" if title else text
    # Инструкция, файл industries.csv и новость идут одним сообщением —
    # так работает со всеми моделями, в том числе без поддержки system-промпта.
    return (
        f"{SYSTEM_PROMPT}\n\n"
        f'Прикреплённый файл industries.csv:\n<file name="industries.csv">\n'
        f"{industries.raw_text}\n</file>\n"
        f"{industries.id_note()}\n\n"
        f"Источник новости: {source or 'не указан'}\n\n"
        f"Новость:\n<news>\n{news[:MAX_NEWS_CHARS]}\n</news>"
    )


def ask_llm(api_key: str, model: str, title: Optional[str], text: str, source: Optional[str] = None) -> dict:
    """Запрашивает модель; при неразборчивом ответе один раз просит её исправить."""
    messages = [{"role": "user", "content": build_prompt(title, text, source)}]
    extra = {"response_format": {"type": "json_object"}} if JSON_MODE else {}

    for attempt in (1, 2):
        response = with_failover(
            api_key,
            lambda client: client.chat.completions.create(
                model=model, messages=messages, temperature=0, max_tokens=MAX_TOKENS, **extra
            ),
        )
        try:
            content = response.choices[0].message.content
        except (AttributeError, IndexError, TypeError):
            content = None
        if isinstance(content, list):  # некоторые модели отдают список блоков
            content = "".join(c.get("text", "") for c in content if isinstance(c, dict))
        content = content or ""

        data = parse_model_json(content)
        if data is not None:
            return data
        logger.warning("Попытка %s: ответ модели не разобран. Сырой ответ: %r", attempt, content[:1500])
        messages = messages + [
            {"role": "assistant", "content": content or "(пустой ответ)"},
            {"role": "user", "content": RETRY_MESSAGE},
        ]
    raise ValueError("Модель не вернула валидный JSON")


def get_key_info(api_key: str) -> dict:
    """GET /key/info — служебный эндпоинт шлюза (не часть OpenAI API, в SDK его нет)."""
    last_error: Optional[LLMError] = None
    for base_url in BASE_URLS:
        url = base_url[:-3] + "/key/info"
        try:
            resp = httpx.get(url, headers={"Authorization": f"Bearer {api_key}"}, timeout=REQUEST_TIMEOUT)
        except httpx.HTTPError as e:
            last_error = LLMError(502, f"Нет связи со шлюзом {base_url}: {e}")
            continue
        if resp.status_code >= 500:
            last_error = LLMError(resp.status_code, resp.text[:500])
            continue
        if resp.status_code != 200:
            raise LLMError(resp.status_code, resp.text[:500])
        return resp.json()
    raise last_error or LLMError(502, "Нет доступных адресов шлюза")


RUSSIA_NAMES = {"россия", "российская федерация", "рф", "russia", "ru"}


def clean_str(value) -> Optional[str]:
    """Приводит значение к строке; пустое, 'null' и неподставленные <плейсхолдеры> -> None."""
    if value is None:
        return None
    if isinstance(value, dict):  # на случай {"name": "...", "code": "RU"}
        value = value.get("name")
        if value is None:
            return None
    value = str(value).strip()
    if not value or value.lower() in {"null", "none", "n/a", "-"} or value.startswith("<"):
        return None
    return value


def normalize(data: dict, input_source: Optional[str] = None) -> ClassificationResponse:
    """Оставляет только строки, точно совпадающие с полными кодами ОКВЭД справочника, и согласует гео-поля."""
    raw_ids = data.get("industry_id_list")
    if raw_ids is None:
        raw_ids = data.get("industries")  # на случай старого формата ответа
    if not isinstance(raw_ids, list):
        raw_ids = [] if raw_ids in (None, "") else [raw_ids]

    ids: List[str] = []
    for item in raw_ids:
        if isinstance(item, dict):
            item = item.get("id")
        code = industries.match(item)
        if code is None:
            logger.warning("Код отброшен (нет среди полных кодов ОКВЭД справочника): %r", item)
            continue
        if code not in ids:
            ids.append(code)

    country = clean_str(data.get("country"))
    is_russia = bool(country and country.lower() in RUSSIA_NAMES)
    if is_russia:
        country = "Россия"
    return ClassificationResponse(
        industry_id_list=ids,
        region=clean_str(data.get("region")) if is_russia else None,
        city=clean_str(data.get("city")) if is_russia else None,
        country=country,
        source=clean_str(data.get("source")) or input_source,
        text=" ".join(str(data.get("text") or "").split()),
    )


# ---------- API ----------
app = FastAPI(title="News Classifier", version="2.0.0")


def resolve_api_key(x_api_key: Optional[str], payload: Optional[dict] = None) -> str:
    """Ключ: заголовок X-API-Key -> поле api_key в JSON -> переменные окружения (.env)."""
    key = x_api_key or (payload or {}).get("api_key")
    if not key:
        for name in KEY_ENV_VARS:
            if os.getenv(name):
                key = os.getenv(name)
                break
    if not key:
        raise HTTPException(401, "Не передан API-ключ (X-API-Key, поле api_key или LLM_API_KEY в .env)")
    key = str(key).strip().strip('"').strip("'")
    if not key.isascii():
        raise HTTPException(
            401, "API-ключ содержит не-латинские символы: вместо настоящего ключа указана подсказка."
        )
    return key


def llm_error_to_http(e: LLMError) -> HTTPException:
    logger.error("Ошибка шлюза: %s %s", e.status, e)
    msg = str(e)
    low = msg.lower()
    if "budget" in low and "exceeded" in low:
        return HTTPException(
            429,
            "Исчерпан дневной бюджет ключа (500 ₽/день на команду, общий для всех моделей). "
            "Бюджет сбрасывается в 3:00 МСК.",
        )
    if e.status in (401, 403) or "authentication" in low or "api key" in low:
        return HTTPException(401, f"Ключ отклонён шлюзом: {msg}")
    if e.status == 429:
        return HTTPException(429, f"Превышен лимит запросов: {msg}")
    return HTTPException(502, f"Ошибка шлюза ({e.status}): {msg}")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "industries_loaded": len(industries.items),
        "industries_file": industries.path.name,
        "full_okved_codes": len(industries.full_codes),
        "default_model": DEFAULT_MODEL,
        "allowed_models": ALLOWED_MODELS,
        "base_urls": BASE_URLS,
        "env_file_loaded": ENV_FILE_LOADED,
        "api_key_configured": any(os.getenv(n) for n in KEY_ENV_VARS),
    }


@app.get("/budget")
def budget(x_api_key: Optional[str] = Header(None)):
    """Остаток бюджета ключа (эндпоинт шлюза /key/info). Сброс бюджета — в 3:00 МСК."""
    try:
        data = get_key_info(resolve_api_key(x_api_key))
    except LLMError as e:
        raise llm_error_to_http(e)
    info = data.get("info", data)
    spend, max_budget = info.get("spend"), info.get("max_budget")
    numeric = isinstance(spend, (int, float)) and isinstance(max_budget, (int, float))
    return {
        "spend": spend,
        "max_budget": max_budget,
        "remaining": (max_budget - spend) if numeric else None,
        "budget_reset_at": info.get("budget_reset_at"),
        "models": info.get("models"),
    }


@app.get("/models")
def list_models(x_api_key: Optional[str] = Header(None)):
    """Модели, доступные ключу на шлюзе."""
    try:
        ids = with_failover(resolve_api_key(x_api_key), lambda client: [m.id for m in client.models.list()])
    except LLMError as e:
        raise llm_error_to_http(e)
    return {"models": ids, "allowed_models": ALLOWED_MODELS}


@app.post("/classify", response_model=ClassificationResponse)
def classify(
    payload: dict = Body(..., description="JSON с новостью"),
    x_api_key: Optional[str] = Header(None, description="API-ключ (если не задан в .env)"),
):
    api_key = resolve_api_key(x_api_key, payload)
    title, text, source = extract_news(payload)

    # Модель можно выбрать полем "model" в запросе, иначе — LLM_MODEL из .env
    model = payload.get("model") or DEFAULT_MODEL
    if payload.get("model") and model not in ALLOWED_MODELS:
        raise HTTPException(422, f"Неизвестная модель {model!r}. Доступные: {', '.join(ALLOWED_MODELS)}")

    try:
        raw = ask_llm(api_key, model, title, text, source)
    except LLMError as e:
        raise llm_error_to_http(e)
    except ValueError:
        logger.exception("Не удалось разобрать ответ модели")
        raise HTTPException(502, "Нейросеть вернула ответ в неверном формате")

    result = normalize(raw, source)
    result.id = payload.get("id")
    return result
