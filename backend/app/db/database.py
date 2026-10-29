"""SQLite connection setup. Tables live in app/db/models.py."""

from typing import Iterator

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    # Required for SQLite when FastAPI uses the connection across threads.
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _enable_foreign_keys(dbapi_connection, _record) -> None:
    # SQLite ignores foreign keys (and ON DELETE CASCADE) unless this is set per connection.
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """Base class for all database models."""


def init_db() -> None:
    """Create any tables that don't exist yet. Call after ensure_storage_dirs().

    Additive only: existing tables and rows are never dropped or altered.
    """
    from app.db import models  # noqa: F401  (registers the tables on Base.metadata)

    Base.metadata.create_all(bind=engine)
    add_missing_columns(engine)


# Columns added to existing tables after their first release: (table, column, SQL type + default).
# create_all() only creates missing tables, so these are added with ALTER TABLE ... ADD COLUMN (never dropped).
ADDED_COLUMNS = (("analysis_jobs", "language", "VARCHAR(5) NOT NULL DEFAULT 'en'"),)


def add_missing_columns(bind) -> None:
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())
    with bind.begin() as conn:
        for table, column, ddl in ADDED_COLUMNS:
            if table in tables and column not in {c["name"] for c in inspector.get_columns(table)}:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))


def check_db() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def get_db() -> Iterator[Session]:
    """FastAPI dependency that provides a database session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
