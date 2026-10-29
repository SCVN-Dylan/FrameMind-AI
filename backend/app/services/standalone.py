"""Pairing for the standalone frontend (submission/index.html opened with file://).

Pages opened from disk send `Origin: null`. So do sandboxed iframes on any website, so the origin alone can't tell
FrameMind's own page from an unrelated site. Requests with `Origin: null` must therefore carry a pairing code that
only someone with access to this computer can read: it is generated once, stored in
storage/standalone_pairing_code.txt (owner-only permissions) and printed when the backend starts.
"""

import hmac
import logging
import os
import secrets

from app.core.config import get_settings

logger = logging.getLogger(__name__)

HEADER = "X-FrameMind-Pairing"
# Readable without pairing: lets the page show "backend online, not paired yet". Contains no user data.
OPEN_PATHS = ("/api/health",)
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I


def code_path():
    return get_settings().storage_path / "standalone_pairing_code.txt"


def pairing_code() -> str:
    """The pairing code, created on first use."""
    path = code_path()
    try:
        existing = path.read_text(encoding="utf-8").strip()
        if existing:
            return existing
    except FileNotFoundError:
        pass
    raw = "".join(secrets.choice(_ALPHABET) for _ in range(12))
    code = f"{raw[:4]}-{raw[4:8]}-{raw[8:]}"
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(code + "\n")
    return code


def is_valid(candidate: str) -> bool:
    normalized = candidate.strip().upper().replace(" ", "")
    return bool(normalized) and hmac.compare_digest(normalized.encode(), pairing_code().encode())
