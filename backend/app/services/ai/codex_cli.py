"""CodexCLIService: runs the locally installed OpenAI Codex CLI (`codex exec`) as the AI provider.

Codex is signed in with the user's ChatGPT account (`codex login`, done once by the user in a terminal).
FrameMind never reads or stores credentials and never passes API keys to Codex.

Every run is locked down using only documented CLI options (verified against codex-cli 0.165.0):
- `codex exec` (non-interactive) with the prompt on stdin and images attached with `--image`,
- `--output-schema` (strict JSON answer) + `--output-last-message` (answer written to a file),
- `--ignore-user-config` / `--ignore-rules` (no user MCP servers, plugins or rules), `--ephemeral` (no session files),
- a permissions profile passed with `-c`: the whole filesystem is denied (`":root" = "deny"`) except the run's own
  temp folder (read-only) and the minimal system paths Codex needs; no writes, no network, approvals "never",
- shell / exec / image viewing / image generation / browser / computer-use / apps / plugins disabled with `--disable`,
- the working directory is a fresh temp folder outside the project holding only copies of the frames to analyse.

With a connected Unity project (services/unity_project.py) the profile also allows reading that project's Assets/,
ProjectSettings/ and Packages/ folders, and the shell tool stays on so Codex can search them (rg, grep, cat…). It is
still read-only and offline, everything else stays denied, and such a run never falls back to Codex's built-in
`:read-only` profile (that one can read the whole disk).
"""

import json
import logging
import os
import re
import shutil
import signal
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple

from pydantic import ValidationError

from app.core.config import get_settings
from app.schemas.analysis import AIAnalysisOutput
from app.services.ai.prompt import OUTPUT_JSON_SCHEMA

logger = logging.getLogger(__name__)

PROVIDER = "codex_cli"
# Oldest version whose CLI options and permission profiles were verified for this integration.
MIN_VERSION: Tuple[int, int, int] = (0, 165, 0)
REQUIRED_EXEC_OPTIONS = (
    "--image",
    "--output-schema",
    "--output-last-message",
    "--ephemeral",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--cd",
    "--disable",
    "--config",
)
# Shell tools: off for a visual-only review, on (sandboxed, read-only) when Codex may read a Unity project.
SHELL_FEATURES = ("shell_tool", "unified_exec")
DISABLED_FEATURES = (
    *SHELL_FEATURES,
    "view_image",
    "image_generation",
    "browser_use",
    "computer_use",
    "apps",
    "plugins",
)
# Never handed to the child process, so Codex can't silently switch to API-key billing.
SCRUBBED_ENV = ("OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORG_ID", "OPENAI_PROJECT")
PROFILE = "framemind_analysis"
PROBE_TTL_SECONDS = 60
MAX_ANSWER_BYTES = 1024 * 1024

# Process/lookup hooks, so tests can fake Codex without affecting other subprocess users (FFmpeg).
_which = shutil.which
_run_process = subprocess.run
_popen = subprocess.Popen

if os.name == "nt":
    # Windows has no process groups to signal: end the whole process tree (the npm `codex.cmd` shim, node and
    # Codex) at once. Console programs ignore a polite taskkill, so /F is used straight away.
    def _killpg(pid: int, sig: int) -> None:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, check=False)

    NEW_PROCESS_GROUP: Dict[str, int] = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    STOP_SIGNALS: Tuple[int, ...] = (signal.SIGTERM,)
else:
    _killpg = os.killpg
    NEW_PROCESS_GROUP = {"start_new_session": True}
    STOP_SIGNALS = (signal.SIGTERM, signal.SIGKILL)

_VERSION_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)")
_SECRET_RE = re.compile(r"(sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.-]+|Bearer\s+\S+)")


class CodexError(RuntimeError):
    """A failure with a stable code the API and UI can show."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class CodexProbe:
    installed: bool = False
    executable: Optional[str] = None
    version: Optional[str] = None
    version_supported: bool = False
    authenticated: Optional[bool] = None
    auth_mode: Optional[str] = None
    capabilities: Dict[str, bool] = field(
        default_factory=lambda: {
            "non_interactive": False,
            "image_input": False,
            "output_schema": False,
            "restricted_permissions": False,
        }
    )
    error_code: Optional[str] = None
    error: Optional[str] = None

    @property
    def available(self) -> bool:
        return self.error_code is None


def redact(text: str) -> str:
    """Removes anything that looks like a token before text is logged or stored."""
    return _SECRET_RE.sub("[redacted]", text)


FAILURE_LOG_CHARS = 4000
# Codex failing to set up its sandbox or session, before the model is reached. New Codex versions sometimes change
# how their sandbox starts (e.g. 0.165+ re-runs Codex as a sandboxed helper to read AGENTS.md); FrameMind's own
# tighter profile can then break where Codex's built-in one still works.
_SETUP_FAILURE_RE = re.compile(
    r"thread/start|failed to create session|sandbox|operation not permitted|permission profile|default_permissions|"
    r"permissions\.|agents\.md",
    re.I,
)
_FAILURE_LINE_RE = re.compile(r"error|fail|denied|unauthori[sz]ed|forbidden|limit|not found|refused|invalid|panic|timed? ?out", re.I)


def failure_summary(detail: str) -> str:
    """The lines of Codex's output that say why it failed, short enough to show in the UI."""
    lines = [line.strip() for line in detail.splitlines() if line.strip()]
    if not lines:
        return "no output"
    picked = [line for line in lines if _FAILURE_LINE_RE.search(line)][-3:] or lines[-1:]
    return " | ".join(picked)[:600]


def _install_dirs(exe: str) -> List[Path]:
    """The folders holding the Codex executable, as launched and with symlinks resolved."""
    path = Path(exe)
    if not path.is_absolute():
        return []
    return [path.parent, path.resolve().parent]


def _tail(path: Path, limit: int) -> str:
    try:
        with path.open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - limit))
            return redact(handle.read().decode("utf-8", errors="replace"))
    except OSError:
        return ""


def _is_auth_failure(detail: str) -> bool:
    lowered = detail.lower()
    return "401" in lowered or "unauthorized" in lowered or "not logged in" in lowered or "token" in lowered and "expired" in lowered


def _child_env() -> Dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in SCRUBBED_ENV}
    env["NO_COLOR"] = "1"
    return env


# Account-billed sign-ins FrameMind refuses by default (see CODEX_ALLOW_API_KEY_AUTH).
BILLED_AUTH_MODES = ("api_key", "bedrock")


def parse_login_status(text: str) -> Tuple[Optional[bool], Optional[str]]:
    """(authenticated, auth_mode) from `codex login status`. Only the mode is kept: the output may contain a
    masked key, which is never stored or returned. Unknown wording gives (None, None) rather than a guess."""
    lowered = text.lower()
    if "not logged in" in lowered:
        return False, None
    if "logged in using chatgpt" in lowered:
        return True, "chatgpt"
    if "logged in using bedrock" in lowered or "amazon bedrock" in lowered:
        return True, "bedrock"
    if "logged in" in lowered and "api key" in lowered:
        return True, "api_key"
    if "logged in using" in lowered and "access token" in lowered:
        return True, "access_token"
    if "logged in using workload identity" in lowered:
        return True, "workload_identity"
    return None, None


def parse_version(text: str) -> Optional[Tuple[int, int, int]]:
    match = _VERSION_RE.search(text or "")
    return tuple(int(part) for part in match.groups()) if match else None  # type: ignore[return-value]


def parse_answer(raw: str) -> AIAnalysisOutput:
    """Parses Codex's final message. Raises CodexError("codex_invalid_output") if it isn't valid feedback JSON."""
    text = raw.strip()
    # Structured output should be bare JSON; tolerate a Markdown code fence just in case.
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.DOTALL)
    if fenced:
        text = fenced.group(1)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise CodexError("codex_invalid_output", f"Codex did not return valid JSON ({exc.msg}).") from exc
    try:
        return AIAnalysisOutput.model_validate(data)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first.get("loc", ()))
        raise CodexError("codex_invalid_output", f"Codex JSON does not match the feedback schema at {where}: {first['msg']}") from exc


class CodexCLIService:
    def __init__(self) -> None:
        self._probe: Optional[CodexProbe] = None
        self._probe_at = 0.0
        self._probe_lock = threading.Lock()
        self._slots: Optional[threading.BoundedSemaphore] = None
        self._slots_lock = threading.Lock()
        # Running `codex exec` processes, so Clear All Data can stop them. `_stopping` refuses new runs meanwhile.
        self._procs: Set[subprocess.Popen] = set()
        self._procs_lock = threading.Lock()
        self._stopping = False
        self.last_error: Optional[str] = None
        # Codex versions (by version string) that could not start with FrameMind's own profile, so they go straight
        # to Codex's built-in read-only profile.
        self._builtin_profile_versions: Set[str] = set()

    # ---------- Detection ----------

    def _executable(self) -> Optional[str]:
        configured = get_settings().codex_cli_path
        if os.sep in configured:
            return configured if os.path.isfile(configured) and os.access(configured, os.X_OK) else None
        return _which(configured)

    def _run_quick(self, args: Sequence[str]) -> subprocess.CompletedProcess:
        return _run_process(list(args), capture_output=True, text=True, timeout=20, env=_child_env(), check=False)

    def probe(self, force: bool = False) -> CodexProbe:
        """Checks install, version, documented options and login state. Cached for a minute."""
        with self._probe_lock:
            if not force and self._probe and time.monotonic() - self._probe_at < PROBE_TTL_SECONDS:
                return self._probe
            probe = self._detect()
            self._probe, self._probe_at = probe, time.monotonic()
            return probe

    def _detect(self) -> CodexProbe:
        probe = CodexProbe()
        exe = self._executable()
        if not exe:
            probe.error_code, probe.error = "codex_not_installed", "Codex CLI was not found. Install it with `npm install -g @openai/codex`."
            return probe
        probe.installed, probe.executable = True, exe
        try:
            version = self._run_quick([exe, "--version"])
            parsed = parse_version(version.stdout)
            probe.version = ".".join(map(str, parsed)) if parsed else None
            probe.version_supported = bool(parsed and parsed >= MIN_VERSION)

            help_text = self._run_quick([exe, "exec", "--help"]).stdout
            probe.capabilities = {
                "non_interactive": "--output-last-message" in help_text,  # `codex exec` exists
                "image_input": "--image" in help_text,
                "output_schema": "--output-schema" in help_text and "--output-last-message" in help_text,
                "restricted_permissions": all(opt in help_text for opt in REQUIRED_EXEC_OPTIONS),
            }

            login = self._run_quick([exe, "login", "status"])
            status_text = f"{login.stdout}\n{login.stderr}".lower()
            probe.authenticated, probe.auth_mode = parse_login_status(status_text)
        except (OSError, subprocess.TimeoutExpired) as exc:
            probe.error_code, probe.error = "codex_probe_failed", f"Could not run Codex CLI: {exc}"
            return probe

        if not probe.version_supported:
            probe.error_code = "codex_version_unsupported"
            minimum = ".".join(map(str, MIN_VERSION))
            probe.error = f"Codex CLI {probe.version or 'unknown'} is too old; {minimum} or newer is required (`codex update`)."
        elif not all(probe.capabilities.values()):
            missing = ", ".join(k for k, ok in probe.capabilities.items() if not ok)
            probe.error_code, probe.error = "codex_capability_missing", f"This Codex CLI lacks required options: {missing}."
        elif probe.authenticated is False:
            probe.error_code, probe.error = "codex_not_authenticated", "Codex CLI is not signed in. Run `codex login` in a terminal."
        elif probe.auth_mode in BILLED_AUTH_MODES and not get_settings().codex_allow_api_key_auth:
            probe.error_code = "codex_api_key_auth"
            probe.error = "Codex CLI is signed in with an API key or cloud credentials, which bill that account. Sign in with ChatGPT (`codex login`)."
        return probe

    def invalidate(self) -> None:
        """Forget the cached probe (after login/logout or an auth failure)."""
        with self._probe_lock:
            self._probe = None

    def ensure_available(self) -> CodexProbe:
        probe = self.probe()
        if not probe.available:
            raise CodexError(probe.error_code or "codex_unavailable", probe.error or "Codex CLI is not available.")
        return probe

    # ---------- Running ----------

    def _job_slots(self) -> threading.BoundedSemaphore:
        with self._slots_lock:
            if self._slots is None:
                self._slots = threading.BoundedSemaphore(max(1, get_settings().codex_max_concurrent_jobs))
            return self._slots

    def build_command(
        self,
        exe: str,
        workdir: Path,
        images: Sequence[Path],
        schema: Path,
        answer: Path,
        model: Optional[str] = None,
        builtin_profile: bool = False,
        project_dirs: Sequence[Path] = (),
    ) -> List[str]:
        """The exact argument list for one locked-down analysis run (no shell, no user text in arguments).
        `model` must already be validated against the Codex model catalog; None = the CLI default model.
        `builtin_profile` uses Codex's own `:read-only` profile instead of FrameMind's tighter one (the fallback
        when a Codex version cannot start with it). Both are read-only, offline, and the shell tool stays off.
        `project_dirs`: Unity project folders Codex may also read; the shell tool is then on so it can search them.
        Never combined with `builtin_profile`, which can read the whole disk."""
        if project_dirs and builtin_profile:
            raise CodexError("codex_bad_input", "A Unity project can only be read with FrameMind's own sandbox profile.")
        if builtin_profile:
            permissions = ["-c", 'default_permissions=":read-only"']
        else:
            # Read-only: the work folder, plus Codex's own install folders. Codex re-runs its executable as a
            # sandboxed helper (e.g. to load AGENTS.md); if that path is hidden, macOS refuses the exec
            # ("sandbox-exec: execvp() of '/opt/homebrew/bin/codex' failed: Operation not permitted").
            readable = [workdir.resolve(), *(Path(d).resolve() for d in project_dirs), *_install_dirs(exe)]
            root = ", ".join(f"{json.dumps(str(path))}=\"read\"" for path in dict.fromkeys(readable))  # TOML keys
            permissions = [
                "-c", f'default_permissions="{PROFILE}"',
                "-c", f'permissions.{PROFILE}.extends=":read-only"',
                "-c", f'permissions.{PROFILE}.filesystem={{":root"="deny", ":minimal"="read", {root}}}',
            ]
        cmd = [
            exe,
            "exec",
            "--ignore-user-config",
            "--ignore-rules",
            "--ephemeral",
            "--skip-git-repo-check",
            "--color", "never",
            "--cd", str(workdir),
            *permissions,
            "-c", 'approval_policy="never"',
            "-c", 'web_search="disabled"',
            # No AGENTS.md: the prompt is the only instruction. Otherwise a `.git` above the temp folder makes
            # Codex read AGENTS.md files in folders the profile denies, and thread start fails.
            "-c", "project_root_markers=[]",
            "-c", "project_doc_max_bytes=0",
        ]
        for feature in DISABLED_FEATURES:
            if project_dirs and feature in SHELL_FEATURES:
                continue
            cmd += ["--disable", feature]
        if model:
            cmd += ["--model", model]
        cmd += ["--output-schema", str(schema), "--output-last-message", str(answer)]
        for image in images:
            cmd += ["--image", str(image)]
        # No positional prompt: `codex exec` reads it from stdin. (`--image` takes several values, so a
        # positional prompt after it would be parsed as another image path.)
        return cmd

    def run(
        self,
        prompt: str,
        images: Sequence[Path],
        workdir: Path,
        model: Optional[str] = None,
        project_dirs: Sequence[Path] = (),
    ) -> AIAnalysisOutput:
        """Runs one analysis. `images` must already be inside `workdir`. `project_dirs` = Unity project folders Codex
        may also read (empty = visual review only). Raises CodexError on any failure."""
        settings = get_settings()
        probe = self.ensure_available()
        workdir = workdir.resolve()
        for image in images:
            if workdir not in image.resolve().parents:
                raise CodexError("codex_bad_input", "Images must be inside the run folder.")

        schema = workdir / "output_schema.json"
        answer = workdir / "answer.json"
        stdout_path, stderr_path = workdir / "stdout.log", workdir / "stderr.log"
        schema.write_text(json.dumps(OUTPUT_JSON_SCHEMA), encoding="utf-8")
        exe, version = probe.executable or "codex", probe.version or "unknown"
        project_dirs = list(project_dirs)
        builtin = version in self._builtin_profile_versions and not project_dirs
        timeout = settings.codex_project_timeout_seconds if project_dirs else settings.codex_timeout_seconds
        cmd = self.build_command(exe, workdir, images, schema, answer, model, builtin_profile=builtin, project_dirs=project_dirs)
        proc = self._execute(cmd, workdir, prompt, stdout_path, stderr_path, timeout)

        limit = settings.codex_output_limit_bytes
        if proc.returncode != 0 and project_dirs:
            detail = (_tail(stderr_path, limit) or _tail(stdout_path, limit)).strip()
            if _SETUP_FAILURE_RE.search(detail) and not _is_auth_failure(detail):
                # No fallback here: Codex's built-in profile would expose the whole disk to the shell tool.
                self.last_error = failure_summary(detail)
                logger.warning("Codex %s could not start its sandbox to read the Unity project: %s", version, self.last_error)
                raise CodexError(
                    "codex_project_sandbox_failed",
                    "This Codex version could not start its sandbox for reading the Unity project. Disconnect the "
                    f"project to analyse the videos only. ({self.last_error})",
                )
        if proc.returncode != 0 and not builtin and not project_dirs:
            detail = (_tail(stderr_path, limit) or _tail(stdout_path, limit)).strip()
            if _SETUP_FAILURE_RE.search(detail) and not _is_auth_failure(detail):
                logger.warning(
                    "Codex %s could not start with FrameMind's sandbox profile (%s); retrying with Codex's built-in "
                    "read-only profile.", version, failure_summary(detail),
                )
                logger.warning("Codex output (last %d chars):\n%s", FAILURE_LOG_CHARS, detail[-FAILURE_LOG_CHARS:])
                self._builtin_profile_versions.add(version)
                cmd = self.build_command(exe, workdir, images, schema, answer, model, builtin_profile=True)
                proc = self._execute(cmd, workdir, prompt, stdout_path, stderr_path, timeout)

        if proc.returncode != 0:
            detail = (_tail(stderr_path, limit) or _tail(stdout_path, limit)).strip()
            last_line = failure_summary(detail)
            auth_failure = _is_auth_failure(detail)
            code = "codex_not_authenticated" if auth_failure else "codex_failed"
            if auth_failure:
                self.invalidate()  # e.g. the ChatGPT sign-in expired: re-check before the next run
            self.last_error = last_line
            logger.warning("Codex exited with %s: %s", proc.returncode, last_line)
            if detail:
                logger.warning("Codex output (last %d chars):\n%s", FAILURE_LOG_CHARS, detail[-FAILURE_LOG_CHARS:])
            raise CodexError(code, f"Codex exited with code {proc.returncode}: {last_line}")

        if not answer.is_file():
            self.last_error = "no answer file"
            raise CodexError("codex_invalid_output", "Codex finished without writing an answer.")
        if answer.stat().st_size > MAX_ANSWER_BYTES:
            raise CodexError("codex_invalid_output", "Codex answer is too large.")
        try:
            result = parse_answer(answer.read_text(encoding="utf-8", errors="replace"))
        except CodexError as exc:
            self.last_error = exc.message
            raise
        self.last_error = None
        return result

    def _execute(
        self, cmd: List[str], workdir: Path, prompt: str, stdout_path: Path, stderr_path: Path, timeout: float
    ) -> subprocess.Popen:
        """Runs one `codex exec` to completion (or kills it after `timeout` seconds / on Clear All Data)."""
        settings = get_settings()
        slots = self._job_slots()
        if not slots.acquire(timeout=settings.codex_timeout_seconds):
            raise CodexError("codex_busy", "Another Codex analysis is still running.")
        try:
            with stdout_path.open("wb") as out, stderr_path.open("wb") as err:
                self._raise_if_stopping()
                proc = _popen(
                    cmd,
                    cwd=str(workdir),
                    stdin=subprocess.PIPE,
                    stdout=out,
                    stderr=err,
                    env=_child_env(),
                    **NEW_PROCESS_GROUP,  # own process group, so a timeout kills Codex and its children
                )
                with self._procs_lock:
                    self._procs.add(proc)
                    stopping = self._stopping
                try:
                    if stopping:  # stop_all() ran between the check above and Popen
                        self._terminate(proc)
                        self._raise_if_stopping()
                    proc.communicate(input=prompt.encode("utf-8"), timeout=timeout)
                except subprocess.TimeoutExpired:
                    self._terminate(proc)
                    self.last_error = f"timed out after {timeout:.0f}s"
                    raise CodexError("codex_timeout", f"Codex did not finish within {timeout:.0f} seconds.")
                finally:
                    with self._procs_lock:
                        self._procs.discard(proc)
        finally:
            slots.release()
        self._raise_if_stopping()  # killed by stop_all(): not a Codex failure
        return proc

    def _raise_if_stopping(self) -> None:
        with self._procs_lock:
            if self._stopping:
                raise CodexError("analysis_cancelled", "The analysis was cancelled because all data is being cleared.")

    def stop_all(self) -> None:
        """Kills every running `codex exec` (and its process group) and refuses new runs until resume().
        Never touches `codex login` flows or the Codex sign-in."""
        with self._procs_lock:
            self._stopping = True
            procs = list(self._procs)
        for proc in procs:
            self._terminate(proc)

    def resume(self) -> None:
        with self._procs_lock:
            self._stopping = False

    @staticmethod
    def _terminate(proc: subprocess.Popen) -> None:
        for sig in STOP_SIGNALS:
            try:
                _killpg(proc.pid, sig)
            except OSError:  # already gone (ProcessLookupError), not ours, or taskkill missing
                pass
            try:
                proc.wait(timeout=5)
                return
            except subprocess.TimeoutExpired:
                continue


codex_cli = CodexCLIService()
