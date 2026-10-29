"""Codex CLI account (login / logout) and model selection, driven only by the CLI's own commands.

Verified against codex-cli 0.165.0:
- `codex login` starts the official ChatGPT sign-in: it runs a callback server on localhost, opens the browser and
  prints "If your browser did not open, navigate to this URL to authenticate:" followed by the URL; it prints
  "Successfully logged in." and exits 0 when done. FrameMind only starts it and watches its exit; the user signs in
  on OpenAI's page. Passwords and tokens never pass through FrameMind.
- `codex logout` removes the stored credentials ("Successfully logged out"); success is confirmed afterwards with
  `codex login status`, never assumed.
- `codex debug models` prints the model catalog as JSON, refreshed for the signed-in account; `--bundled` gives the
  catalog shipped with the binary. It is a debug command, so its format may change: parsing is defensive and the
  source is reported to the UI.
Account details such as e-mail or plan are not exposed by any CLI command, so only the sign-in mode is shown.
"""

import json
import re
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from app.core.config import get_settings
from app.services import app_settings
from app.services.ai import codex_cli as cli
from app.services.ai.codex_cli import CodexError, codex_cli

LOGIN_TIMEOUT_SECONDS = 10 * 60
CATALOG_TTL_SECONDS = 10 * 60
_URL_RE = re.compile(r"https://[^\s\"'<>]+")


# ---------- Login flow ----------


@dataclass
class LoginFlow:
    state: str = "idle"  # idle | running | succeeded | failed | cancelled
    login_url: Optional[str] = None
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    error: Optional[str] = None
    process: Optional[subprocess.Popen] = field(default=None, repr=False)


class CodexAccountService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._flow = LoginFlow()
        self._catalog: Optional[dict] = None
        self._catalog_at = 0.0

    # --- login ---

    def login_state(self) -> LoginFlow:
        with self._lock:
            return LoginFlow(**{k: v for k, v in vars(self._flow).items() if k != "process"})

    def start_login(self) -> LoginFlow:
        probe = codex_cli.probe(force=True)
        if not probe.installed or not probe.executable:
            raise CodexError("codex_not_installed", probe.error or "Codex CLI is not installed.")
        with self._lock:
            if self._flow.state == "running":
                return LoginFlow(**{k: v for k, v in vars(self._flow).items() if k != "process"})
            if probe.authenticated:
                raise CodexError("codex_already_logged_in", "Codex CLI is already signed in. Log out first to switch accounts.")
            proc = cli._popen(
                [probe.executable, "login"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=cli._child_env(),
                start_new_session=True,
            )
            self._flow = LoginFlow(state="running", started_at=time.time(), process=proc)
        threading.Thread(target=self._watch_login, args=(proc,), name="codex-login", daemon=True).start()
        return self.login_state()

    def _watch_login(self, proc: subprocess.Popen) -> None:
        """Reads the CLI output (kept in memory only, never logged) for the login URL and the result."""
        tail: List[str] = []
        deadline = time.time() + LOGIN_TIMEOUT_SECONDS
        timer = threading.Timer(LOGIN_TIMEOUT_SECONDS, lambda: codex_cli._terminate(proc))
        timer.daemon = True
        timer.start()
        try:
            stream = proc.stdout
            for raw in iter(stream.readline, b"") if stream else []:
                line = raw.decode("utf-8", errors="replace").strip() if isinstance(raw, bytes) else str(raw).strip()
                if not line:
                    continue
                tail = (tail + [cli.redact(line)])[-5:]
                with self._lock:
                    if self._flow.process is proc and self._flow.login_url is None:
                        match = _URL_RE.search(line)
                        if match and "localhost" not in match.group(0):
                            self._flow.login_url = match.group(0)
            proc.wait()
        finally:
            timer.cancel()

        codex_cli.invalidate()
        self.invalidate_models()
        confirmed = proc.returncode == 0 and codex_cli.probe(force=True).authenticated is True
        with self._lock:
            if self._flow.process is not proc or self._flow.state != "running":
                return  # cancelled or replaced
            self._flow.process = None
            self._flow.finished_at = time.time()
            if confirmed:
                self._flow.state, self._flow.error = "succeeded", None
            else:
                self._flow.state = "failed"
                if time.time() >= deadline:
                    self._flow.error = "The sign-in was not completed within 10 minutes."
                else:
                    last = next((line for line in reversed(tail) if line), "")
                    self._flow.error = last[:300] or f"codex login exited with code {proc.returncode}."
            self._flow.login_url = None  # one-time URL: don't keep it around after the flow ends

    def cancel_login(self) -> LoginFlow:
        with self._lock:
            proc = self._flow.process
            if self._flow.state != "running" or proc is None:
                return LoginFlow(**{k: v for k, v in vars(self._flow).items() if k != "process"})
            self._flow = LoginFlow(state="cancelled", finished_at=time.time())
        codex_cli._terminate(proc)
        return self.login_state()

    # --- logout ---

    def logout(self) -> bool:
        """Runs `codex logout` and confirms with `codex login status`. Returns True only if confirmed."""
        probe = codex_cli.probe(force=True)
        if not probe.installed or not probe.executable:
            raise CodexError("codex_not_installed", probe.error or "Codex CLI is not installed.")
        try:
            result = cli._run_process(
                [probe.executable, "logout"], capture_output=True, text=True, timeout=30, env=cli._child_env(), check=False
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise CodexError("codex_logout_failed", f"codex logout could not run: {exc}") from exc
        codex_cli.invalidate()
        self.invalidate_models()
        after = codex_cli.probe(force=True)
        if after.authenticated is False:
            with self._lock:
                self._flow = LoginFlow()
            return True
        output = cli.redact(f"{result.stdout}\n{result.stderr}").strip().splitlines()
        reason = output[-1][:300] if output else f"exit code {result.returncode}"
        raise CodexError("codex_logout_failed", f"Codex CLI still reports a signed-in account ({reason}).")

    # --- models ---

    def invalidate_models(self) -> None:
        with self._lock:
            self._catalog = None

    def _load_catalog(self, exe: str) -> dict:
        """{"source": "codex_catalog" | "bundled_catalog", "models": [...]} or raises CodexError."""
        for source, args in (("codex_catalog", [exe, "debug", "models"]), ("bundled_catalog", [exe, "debug", "models", "--bundled"])):
            try:
                result = cli._run_process(args, capture_output=True, text=True, timeout=30, env=cli._child_env(), check=False)
                if result.returncode != 0:
                    continue
                data = json.loads(result.stdout or "{}")
            except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
                continue
            raw = data.get("models") if isinstance(data, dict) else None
            if not isinstance(raw, list):
                continue
            models = []
            for item in raw:
                if not isinstance(item, dict) or not isinstance(item.get("slug"), str):
                    continue
                if item.get("visibility") not in (None, "list"):
                    continue  # hidden/internal models (e.g. reviewers) are not offered
                modalities = item.get("input_modalities")
                models.append(
                    {
                        "slug": item["slug"],
                        "display_name": str(item.get("display_name") or item["slug"]),
                        "description": str(item.get("description") or "")[:300],
                        "supports_images": isinstance(modalities, list) and "image" in modalities,
                        "priority": item.get("priority") if isinstance(item.get("priority"), int) else 999,
                    }
                )
            models.sort(key=lambda m: (m["priority"], m["slug"]))
            return {"source": source, "models": models}
        raise CodexError("model_catalog_unavailable", "Codex CLI could not list its models (`codex debug models`).")

    def catalog(self, refresh: bool = False) -> dict:
        probe = codex_cli.probe()
        if not probe.installed or not probe.executable:
            raise CodexError("codex_not_installed", probe.error or "Codex CLI is not installed.")
        with self._lock:
            fresh = self._catalog and time.monotonic() - self._catalog_at < CATALOG_TTL_SECONDS
            if fresh and not refresh:
                return self._catalog  # type: ignore[return-value]
        catalog = self._load_catalog(probe.executable)
        with self._lock:
            self._catalog, self._catalog_at = catalog, time.monotonic()
        return catalog

    @staticmethod
    def selected_model() -> Optional[str]:
        """Model chosen in Settings (None = Codex CLI default). Falls back to CODEX_MODEL until one is chosen."""
        if app_settings.is_set(app_settings.CODEX_MODEL):
            return app_settings.get(app_settings.CODEX_MODEL) or None
        return get_settings().codex_model or None

    def validate_model(self, slug: Optional[str], refresh: bool = False) -> Optional[str]:
        """Returns the model to use, or raises CodexError if it can't be used for image analysis."""
        if not slug:
            return None
        try:
            catalog = self.catalog(refresh=refresh)
        except CodexError as exc:
            raise CodexError("model_unverifiable", f"The selected model {slug!r} could not be verified: {exc.message}") from exc
        model: Optional[Dict] = next((m for m in catalog["models"] if m["slug"] == slug), None)
        if model is None:
            raise CodexError(
                "model_unsupported",
                f"Model {slug!r} is not available to this Codex account any more. Choose another model in Settings.",
            )
        if not model["supports_images"]:
            raise CodexError("model_unsupported", f"Model {slug!r} does not accept images, which gameplay analysis needs.")
        return slug

    def set_model(self, slug: Optional[str]) -> Optional[str]:
        model = self.validate_model(slug, refresh=True)
        app_settings.put(app_settings.CODEX_MODEL, model or "")
        return model


codex_account = CodexAccountService()
