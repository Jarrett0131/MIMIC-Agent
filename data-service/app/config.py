import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[2]
DATA_SERVICE_DIR = BASE_DIR / "data-service"


def _load_env_file() -> None:
    env_path = DATA_SERVICE_DIR / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _resolve_candidate_path(configured: str) -> Path:
    raw_path = Path(configured)
    if raw_path.is_absolute():
        return raw_path.resolve()

    data_service_relative = (DATA_SERVICE_DIR / raw_path).resolve()
    if data_service_relative.exists():
        return data_service_relative

    project_relative = (BASE_DIR / raw_path).resolve()
    if project_relative.exists():
        return project_relative

    return data_service_relative


def _normalize_data_dir(path: Path) -> Path:
    if path.name.lower() == "hosp":
        sibling_icu = path.parent / "icu"
        if sibling_icu.exists():
            return path.parent

    return path


def _resolve_data_dir() -> Path:
    configured = os.getenv("MIMIC_DATA_DIR", "").strip() or os.getenv("DATA_DIR", "").strip()
    candidate = _resolve_candidate_path(configured) if configured else BASE_DIR / "data" / "mimic_demo"
    normalized = _normalize_data_dir(candidate)

    if not normalized.exists():
        raise RuntimeError(
            "MIMIC 数据目录不存在："
            f" {normalized}\n"
            "请在 data-service/.env 中设置 MIMIC_DATA_DIR，例如 ../data/mimic_demo 或 ../data/mimic_demo/hosp。"
        )

    hosp_dir = normalized / "hosp"
    icu_dir = normalized / "icu"
    if not hosp_dir.exists() or not icu_dir.exists():
        raise RuntimeError(
            "MIMIC_DATA_DIR 必须指向包含 hosp/ 和 icu/ 子目录的数据根目录，"
            f"当前解析结果为：{normalized}"
        )

    return normalized


def _resolve_chartevents_nrows() -> int:
    configured = os.getenv("CHART_NROWS") or os.getenv("CHARTEVENTS_NROWS")
    if configured is None:
        return 200_000

    try:
        value = int(configured)
    except ValueError:
        return 200_000

    return value if value > 0 else 200_000


def _resolve_port() -> int:
    configured = os.getenv("PORT", "").strip()
    if not configured:
        return 8000

    try:
        value = int(configured)
    except ValueError:
        return 8000

    return value if value > 0 else 8000


def _resolve_external_clinical_import_dir() -> Path:
    configured = os.getenv("EXTERNAL_CLINICAL_IMPORT_DIR", "").strip()
    candidate = (
        _resolve_candidate_path(configured)
        if configured
        else DATA_SERVICE_DIR / "imports" / "clinical-data"
    )
    candidate.mkdir(parents=True, exist_ok=True)
    return candidate


_load_env_file()

DATA_DIR = _resolve_data_dir()
CHARTEVENTS_NROWS = _resolve_chartevents_nrows()
APP_PORT = _resolve_port()
EXTERNAL_CLINICAL_IMPORT_DIR = _resolve_external_clinical_import_dir()

LOCALHOST_ORIGINS = [
    "http://localhost",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
]
