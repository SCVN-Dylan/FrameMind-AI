"""Connected Unity project (chosen next to Analyze).

Each analysis can be for a different project, so the projects used before are remembered with their ticked folders
and switching back to one restores them. When a Unity project folder is connected, Analyze lets Codex read it (read-only) to tie its feedback to real scenes,
prefabs, materials and scripts. Nothing is connected by default, and then analysis works exactly as before.

Codex may read ONLY the folders the user ticks after connecting (e.g. `Assets/Scenes`), each inside `Assets/`,
`ProjectSettings/` or `Packages/`. Everything else (the rest of the project, `Library/`, `Temp/`, `.git/`, the rest of
the computer) stays hidden by Codex's sandbox profile. No folder ticked = the analysis uses the videos only.
Supported on macOS only: that is where the sandbox profile was verified to block everything else.
"""

import json
import logging
import os
import re
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence

from app.core.errors import AppError
from app.services import app_settings

logger = logging.getLogger(__name__)

SETTING_KEY = "unity_project_path"
FOLDERS_KEY = "unity_project_folders"  # JSON list of project-relative folders Codex may read
# JSON list of {"path", "folders"}: projects used before (most recent first), so switching back restores their folders.
RECENT_KEY = "unity_project_recent"
MAX_RECENT = 10
# Top-level folders a chosen folder must be inside.
READABLE_DIRS = ("Assets", "ProjectSettings", "Packages")
MAX_FOLDERS = 50
MAX_LISTED = 500
MAX_PATH_CHARS = 1024
CHOOSE_TIMEOUT_SECONDS = 300

_VERSION_RE = re.compile(r"^m_EditorVersion:\s*(\S+)", re.M)
_SERIALIZATION_RE = re.compile(r"m_SerializationMode:\s*(\d+)")

# Hooks so tests can fake the platform and the folder dialog.
_platform = sys.platform
_run_process = subprocess.run
_choose_lock = threading.Lock()


@dataclass(frozen=True)
class UnityProject:
    root: Path
    name: str
    unity_version: Optional[str]
    # True = Force Text (scenes/prefabs are readable YAML), False = binary or mixed, None = unknown.
    text_serialization: Optional[bool]
    # Chosen folders, project-relative ("Assets/Scenes"), and the absolute folders Codex may read (those that exist).
    folders: List[str] = field(default_factory=list)
    missing_folders: List[str] = field(default_factory=list)
    readable_dirs: List[Path] = field(default_factory=list)


def supported() -> bool:
    return _platform == "darwin"


def _invalid(message: str) -> AppError:
    return AppError(422, "unity_project_invalid", message)


def _read_text(path: Path, limit: int = 64 * 1024) -> Optional[str]:
    try:
        with path.open("rb") as handle:
            return handle.read(limit).decode("utf-8", errors="replace")
    except OSError:
        return None


def _text_serialization(root: Path) -> Optional[bool]:
    text = _read_text(root / "ProjectSettings" / "EditorSettings.asset")
    if text is None:
        return None
    if not text.startswith("%YAML"):
        return False  # the settings file itself is binary
    match = _SERIALIZATION_RE.search(text)
    return None if match is None else match.group(1) == "2"


def _hidden(name: str) -> bool:
    # Unity itself ignores dot folders and folders ending with "~".
    return name.startswith(".") or name.endswith("~")


def resolve_folder(root: Path, relative: str) -> Path:
    """The absolute folder for a project-relative path inside Assets/, ProjectSettings/ or Packages/.
    Raises AppError(422, "unity_project_folder_invalid") for anything else (.., absolute, links leaving the project)."""
    text = (relative or "").strip().strip("/")
    parts = text.split("/") if text else []
    if (
        not parts
        or len(text) > MAX_PATH_CHARS
        or "\x00" in text
        or "\\" in text
        or parts[0] not in READABLE_DIRS
        or any(part in ("", ".", "..") or _hidden(part) for part in parts)
    ):
        raise AppError(422, "unity_project_folder_invalid", f"{relative!r} is not a folder inside Assets, ProjectSettings or Packages.")
    try:
        path = (root / Path(*parts)).resolve(strict=True)
    except (OSError, RuntimeError):
        raise AppError(422, "unity_project_folder_invalid", f"The folder {text} does not exist.") from None
    if not path.is_dir() or path != root and root not in path.parents:
        raise AppError(422, "unity_project_folder_invalid", f"{text} is not a folder inside the project.")
    return path


def normalize_folders(root: Path, folders: Sequence[str]) -> List[str]:
    """Validated, de-duplicated, sorted folders; a folder inside another chosen folder is dropped (already covered)."""
    clean: List[str] = []
    for folder in folders:
        resolve_folder(root, folder)
        clean.append(folder.strip().strip("/"))
    unique = sorted(set(clean))
    kept = [f for f in unique if not any(f.startswith(other + "/") for other in unique if other != f)]
    if len(kept) > MAX_FOLDERS:
        raise AppError(422, "unity_project_folder_invalid", f"Choose at most {MAX_FOLDERS} folders.")
    return kept


def _stored_folders() -> List[str]:
    try:
        value = json.loads(app_settings.get(FOLDERS_KEY) or "[]")
    except json.JSONDecodeError:
        return []
    return [f for f in value if isinstance(f, str)] if isinstance(value, list) else []


def inspect(raw_path: str, folders: Sequence[str] = ()) -> UnityProject:
    """Checks that `raw_path` is a Unity project folder and resolves the chosen `folders` (missing ones are reported,
    not readable). Raises AppError(422, "unity_project_invalid")."""
    text = (raw_path or "").strip()
    if not text:
        raise _invalid("Choose a Unity project folder.")
    if len(text) > MAX_PATH_CHARS or "\x00" in text:
        raise _invalid("That folder path is not valid.")
    path = Path(os.path.expanduser(text))
    if not path.is_absolute():
        raise _invalid("Use the full folder path, e.g. /Users/you/Projects/MyGame.")
    try:
        root = path.resolve(strict=True)
    except (OSError, RuntimeError):
        raise _invalid(f"The folder {text} does not exist or cannot be opened.") from None
    if not root.is_dir():
        raise _invalid(f"{text} is not a folder.")
    if not (root / "Assets").is_dir() or not (root / "ProjectSettings" / "ProjectVersion.txt").is_file():
        raise _invalid(
            f"{root.name} is not a Unity project: choose the folder that contains Assets/ and ProjectSettings/."
        )
    version_text = _read_text(root / "ProjectSettings" / "ProjectVersion.txt") or ""
    match = _VERSION_RE.search(version_text)
    readable: List[Path] = []
    missing: List[str] = []
    for folder in folders:
        try:
            readable.append(resolve_folder(root, folder))
        except AppError:
            missing.append(folder)
    return UnityProject(
        root=root,
        name=root.name,
        unity_version=match.group(1) if match else None,
        text_serialization=_text_serialization(root),
        folders=list(folders),
        missing_folders=missing,
        readable_dirs=list(dict.fromkeys(readable)),
    )


def connected_path() -> Optional[str]:
    return app_settings.get(SETTING_KEY) or None


def connected() -> Optional[UnityProject]:
    """The connected project, or None when nothing is connected. Raises AppError(409, "unity_project_unavailable")
    if a project is connected but its folder can't be used any more (moved, deleted, unmounted)."""
    path = connected_path()
    if not path:
        return None
    if not supported():
        raise AppError(409, "unity_project_unsupported", "Reading a Unity project is only supported on macOS. Disconnect it next to Analyze.")
    try:
        return inspect(path, _stored_folders())
    except AppError as exc:
        raise AppError(
            409,
            "unity_project_unavailable",
            f"The connected Unity project can't be read any more ({exc.message}) Choose it again or switch project next to Analyze.",
        ) from exc


def _recent_entries() -> List[Dict[str, object]]:
    try:
        value = json.loads(app_settings.get(RECENT_KEY) or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(value, list):
        return []
    entries: List[Dict[str, object]] = []
    for item in value:
        if isinstance(item, dict) and isinstance(item.get("path"), str) and item["path"]:
            folders = item.get("folders")
            folders = [f for f in folders if isinstance(f, str)] if isinstance(folders, list) else []
            entries.append({"path": item["path"], "folders": folders})
    return entries


def _remember(path: str, folders: Sequence[str]) -> None:
    """Moves `path` to the front of the recent projects, with its folders."""
    entries = [e for e in _recent_entries() if e["path"] != path]
    entries.insert(0, {"path": path, "folders": list(folders)})
    app_settings.put(RECENT_KEY, json.dumps(entries[:MAX_RECENT]))


def recent() -> List[Dict[str, object]]:
    """Projects used before, most recent first (the connected one included): path, name, folder count, available."""
    entries = _recent_entries()
    current = connected_path()
    if current and not any(e["path"] == current for e in entries):
        entries.insert(0, {"path": current, "folders": _stored_folders()})  # connected before this list existed
    result: List[Dict[str, object]] = []
    for entry in entries[:MAX_RECENT]:
        path = Path(str(entry["path"]))
        result.append(
            {
                "path": str(path),
                "name": path.name,
                "folder_count": len(entry["folders"]),
                "available": (path / "Assets").is_dir(),
            }
        )
    return result


def connect(raw_path: str) -> UnityProject:
    """Connects a project. One used before gets back the folders it had; a new one starts with none."""
    if not supported():
        raise AppError(422, "unity_project_unsupported", "Reading a Unity project is only supported on macOS for now.")
    project = inspect(raw_path)
    root = str(project.root)
    remembered = next((e["folders"] for e in _recent_entries() if e["path"] == root), [])
    folders = [f for f in remembered if _valid_folder(project.root, f)]
    previous = connected_path()
    if previous and previous != root:
        _remember(previous, _stored_folders())  # keeps the project being left in the list, with its folders
    app_settings.put(SETTING_KEY, root)
    app_settings.put(FOLDERS_KEY, json.dumps(folders))
    _remember(root, folders)
    logger.info("Unity project connected: %s (%d folder(s) restored)", project.name, len(folders))
    return inspect(root, folders)


def _valid_folder(root: Path, folder: str) -> bool:
    try:
        resolve_folder(root, folder)
    except AppError:
        return False
    return True


def disconnect() -> None:
    """Analysis goes back to the videos only. The project stays in the recent list."""
    current = connected_path()
    if current:
        _remember(current, _stored_folders())
    app_settings.put(SETTING_KEY, None)
    app_settings.put(FOLDERS_KEY, None)
    logger.info("Unity project disconnected")


def forget(path: str) -> None:
    """Removes a project from the recent list (and disconnects it if it is the connected one)."""
    if path == connected_path():
        app_settings.put(SETTING_KEY, None)
        app_settings.put(FOLDERS_KEY, None)
    entries = [e for e in _recent_entries() if e["path"] != path]
    app_settings.put(RECENT_KEY, json.dumps(entries))
    logger.info("Unity project removed from the recent list")


def _require_connected() -> UnityProject:
    project = connected()
    if project is None:
        raise AppError(409, "unity_project_not_connected", "Connect a Unity project first.")
    return project


def set_folders(folders: Sequence[str]) -> UnityProject:
    """Saves the folders Codex may read (replacing the previous choice). [] = analysis uses the videos only."""
    project = _require_connected()
    kept = normalize_folders(project.root, folders)
    app_settings.put(FOLDERS_KEY, json.dumps(kept))
    _remember(str(project.root), kept)
    logger.info("Unity project folders set: %d folder(s)", len(kept))
    return inspect(str(project.root), kept)


def list_folders(parent: str = "") -> List[Dict[str, object]]:
    """Sub-folders of `parent` (project-relative; "" = the top-level folders that can be chosen)."""
    project = _require_connected()
    if not parent.strip().strip("/"):
        names = [name for name in READABLE_DIRS if (project.root / name).is_dir()]
        base = ""
    else:
        folder = resolve_folder(project.root, parent)
        base = parent.strip().strip("/") + "/"
        try:
            names = sorted(
                (e.name for e in os.scandir(folder) if e.is_dir() and not _hidden(e.name)), key=str.lower
            )[:MAX_LISTED]
        except OSError as exc:
            raise AppError(422, "unity_project_folder_invalid", f"Could not list {parent}: {exc.strerror}") from exc
    result: List[Dict[str, object]] = []
    for name in names:
        path = project.root / (base + name)
        try:
            has_children = any(e.is_dir() and not _hidden(e.name) for e in os.scandir(path))
        except OSError:
            has_children = False
        result.append({"path": base + name, "name": name, "has_children": has_children})
    return result


def choose_folder() -> Optional[str]:
    """Shows the macOS folder picker on this computer. Returns the chosen folder, or None if cancelled."""
    if not supported():
        raise AppError(422, "unity_project_unsupported", "Reading a Unity project is only supported on macOS for now.")
    if not _choose_lock.acquire(blocking=False):
        raise AppError(409, "unity_project_dialog_open", "A folder dialog is already open. Look for it on the screen.")
    try:
        script = [
            "-e", "tell me to activate",
            "-e", 'set f to choose folder with prompt "Choose your Unity project folder (the one with Assets and ProjectSettings)"',
            "-e", "POSIX path of f",
        ]
        try:
            result = _run_process(
                ["/usr/bin/osascript", *script], capture_output=True, text=True, timeout=CHOOSE_TIMEOUT_SECONDS, check=False
            )
        except subprocess.TimeoutExpired:
            return None
        except OSError as exc:
            raise AppError(503, "unity_project_dialog_failed", f"Could not open the folder dialog: {exc}") from exc
        if result.returncode != 0:
            if "-128" in (result.stderr or ""):  # User canceled
                return None
            raise AppError(503, "unity_project_dialog_failed", "Could not open the folder dialog. Paste the folder path instead.")
        chosen = (result.stdout or "").strip()
        return chosen.rstrip("/") or None
    finally:
        _choose_lock.release()
