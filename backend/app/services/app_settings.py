"""Local app preferences stored in SQLite (`app_settings`). Survive backend restarts."""

from typing import Optional

from app.db.database import SessionLocal
from app.db.models import AppSetting

CODEX_MODEL = "codex_model"


def get(key: str) -> Optional[str]:
    with SessionLocal() as db:
        row = db.get(AppSetting, key)
        return row.value if row else None


def is_set(key: str) -> bool:
    with SessionLocal() as db:
        return db.get(AppSetting, key) is not None


def put(key: str, value: Optional[str]) -> None:
    with SessionLocal() as db:
        row = db.get(AppSetting, key)
        if row is None:
            db.add(AppSetting(key=key, value=value))
        else:
            row.value = value
        db.commit()
