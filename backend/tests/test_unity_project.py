"""Connected Unity project: validation, connect/disconnect API, and how Analyze uses it. Codex is mocked."""

import subprocess
from pathlib import Path

import pytest

from app.services import app_settings, unity_project
from app.services.ai.codex_cli import CodexCLIService, CodexError
from app.services.ai.prompt import ProjectContext, PromptFrame, build_prompt
from tests.conftest import needs_ffmpeg
from tests.test_analysis import (  # noqa: F401  (fixtures)
    SANDBOX_START_FAILURE,
    _frame_pair,
    _run,
    codex,
    inline_jobs,
)


def make_project(base: Path, name: str = "MyGame", force_text: bool = True) -> Path:
    root = base / name
    (root / "Assets" / "Scenes").mkdir(parents=True)
    (root / "Assets" / "Scripts" / "Camera").mkdir(parents=True)
    (root / "Assets" / ".hidden").mkdir()
    (root / "Assets" / "Ignored~").mkdir()
    (root / "ProjectSettings").mkdir()
    (root / "Packages").mkdir()
    (root / "Library").mkdir()
    (root / "ProjectSettings" / "ProjectVersion.txt").write_text("m_EditorVersion: 2022.3.20f1\nm_EditorVersionWithRevision: x\n")
    mode = 2 if force_text else 1
    (root / "ProjectSettings" / "EditorSettings.asset").write_text(f"%YAML 1.1\nEditorSettings:\n  m_SerializationMode: {mode}\n")
    return root


@pytest.fixture
def mac(monkeypatch):
    monkeypatch.setattr(unity_project, "_platform", "darwin")


@pytest.fixture(autouse=True)
def disconnected(client):  # the client starts the app, which creates the tables
    def clear():
        unity_project.disconnect()
        app_settings.put(unity_project.RECENT_KEY, None)

    clear()
    yield
    clear()


# ---------- Validation ----------


def test_inspect_reads_name_version_and_serialization(tmp_path):
    root = make_project(tmp_path)
    project = unity_project.inspect(str(root))
    assert project.name == "MyGame" and project.unity_version == "2022.3.20f1"
    assert project.text_serialization is True
    assert project.readable_dirs == []  # nothing is readable until folders are chosen
    chosen = unity_project.inspect(str(root), ["Assets/Scenes", "Assets/Gone"])
    assert chosen.readable_dirs == [(root / "Assets" / "Scenes").resolve()] and chosen.missing_folders == ["Assets/Gone"]
    assert unity_project.inspect(str(make_project(tmp_path, "Binary", force_text=False))).text_serialization is False


@pytest.mark.parametrize("path", ["", "relative/folder", "/no/such/folder/anywhere"])
def test_inspect_rejects_bad_paths(path):
    with pytest.raises(Exception) as info:
        unity_project.inspect(path)
    assert info.value.code == "unity_project_invalid"


def test_inspect_rejects_folder_that_is_not_a_unity_project(tmp_path):
    (tmp_path / "Assets").mkdir()
    with pytest.raises(Exception) as info:
        unity_project.inspect(str(tmp_path))
    assert info.value.code == "unity_project_invalid" and "not a Unity project" in info.value.message


@pytest.mark.parametrize(
    "folder",
    ["", "Library", "Assets/../Library", "/etc", "Assets/.hidden", "Assets/Ignored~", "Assets/Nope", "Assets\\Scenes", "Temp"],
)
def test_resolve_folder_rejects_anything_outside_the_allowed_folders(tmp_path, folder):
    root = make_project(tmp_path).resolve()
    with pytest.raises(Exception) as info:
        unity_project.resolve_folder(root, folder)
    assert info.value.code == "unity_project_folder_invalid"


def test_resolve_folder_rejects_links_leaving_the_project(tmp_path):
    root = make_project(tmp_path).resolve()
    outside = tmp_path / "Secrets"
    outside.mkdir()
    (root / "Assets" / "Link").symlink_to(outside)
    with pytest.raises(Exception):
        unity_project.resolve_folder(root, "Assets/Link")


def test_normalize_drops_folders_already_covered(tmp_path):
    root = make_project(tmp_path).resolve()
    assert unity_project.normalize_folders(root, ["Assets/Scripts/Camera", "Assets/Scripts", "Assets/Scenes/", "Assets/Scenes"]) == [
        "Assets/Scenes",
        "Assets/Scripts",
    ]


# ---------- API ----------


def test_connect_status_and_disconnect(client, mac, tmp_path):
    assert client.get("/api/unity-project").json()["connected"] is False
    root = make_project(tmp_path)
    data = client.put("/api/unity-project", json={"path": str(root) + "/"}).json()
    assert data["connected"] is True and data["name"] == "MyGame" and data["path"] == str(root.resolve())
    assert data["unity_version"] == "2022.3.20f1" and data["text_serialization"] is True
    assert client.get("/api/unity-project").json()["path"] == str(root.resolve())

    data = client.delete("/api/unity-project").json()
    assert data["connected"] is False and data["path"] is None
    assert root.exists()  # disconnecting never touches the project


def test_choose_list_and_save_folders(client, mac, tmp_path):
    root = make_project(tmp_path)
    data = client.put("/api/unity-project", json={"path": str(root)}).json()
    assert data["folders"] == []
    top = client.get("/api/unity-project/folders").json()["folders"]
    assert [f["path"] for f in top] == ["Assets", "ProjectSettings", "Packages"]
    assets = client.get("/api/unity-project/folders", params={"parent": "Assets"}).json()["folders"]
    assert [(f["path"], f["has_children"]) for f in assets] == [("Assets/Scenes", False), ("Assets/Scripts", True)]
    assert client.get("/api/unity-project/folders", params={"parent": "Library"}).status_code == 422

    data = client.put("/api/unity-project/folders", json={"folders": ["Assets/Scripts/Camera", "Assets/Scenes"]}).json()
    assert data["folders"] == ["Assets/Scenes", "Assets/Scripts/Camera"]
    assert client.get("/api/unity-project").json()["folders"] == ["Assets/Scenes", "Assets/Scripts/Camera"]
    bad = client.put("/api/unity-project/folders", json={"folders": ["Library"]})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "unity_project_folder_invalid"

    # Connecting it again (after another project) restores its folders.
    assert client.put("/api/unity-project", json={"path": str(root)}).json()["folders"] == ["Assets/Scenes", "Assets/Scripts/Camera"]


def test_switching_projects_remembers_each_ones_folders(client, mac, tmp_path):
    game = make_project(tmp_path / "a", "Game")
    other = make_project(tmp_path / "b", "Other")
    client.put("/api/unity-project", json={"path": str(game)})
    client.put("/api/unity-project/folders", json={"folders": ["Assets/Scenes"]})

    data = client.put("/api/unity-project", json={"path": str(other)}).json()
    assert data["name"] == "Other" and data["folders"] == []  # a new project starts with nothing readable
    assert [(r["name"], r["folder_count"], r["available"]) for r in data["recent"]] == [("Other", 0, True), ("Game", 1, True)]

    data = client.put("/api/unity-project", json={"path": str(game)}).json()
    assert data["folders"] == ["Assets/Scenes"]
    assert [r["name"] for r in data["recent"]] == ["Game", "Other"]

    # Disconnecting keeps the list; a folder deleted meanwhile is dropped when reconnecting.
    data = client.delete("/api/unity-project").json()
    assert data["connected"] is False and [r["name"] for r in data["recent"]] == ["Game", "Other"]
    (game / "Assets" / "Scenes").rmdir()
    assert client.put("/api/unity-project", json={"path": str(game)}).json()["folders"] == []


def test_project_connected_before_the_recent_list_is_kept_when_switching(client, mac, tmp_path):
    old = make_project(tmp_path / "a", "Old")
    new = make_project(tmp_path / "b", "New")
    app_settings.put(unity_project.SETTING_KEY, str(old.resolve()))  # connected by an older FrameMind
    app_settings.put(unity_project.FOLDERS_KEY, '["Assets/Scenes"]')
    assert [r["name"] for r in client.get("/api/unity-project").json()["recent"]] == ["Old"]

    data = client.put("/api/unity-project", json={"path": str(new)}).json()
    assert [(r["name"], r["folder_count"]) for r in data["recent"]] == [("New", 0), ("Old", 1)]
    assert client.put("/api/unity-project", json={"path": str(old)}).json()["folders"] == ["Assets/Scenes"]


def test_forget_removes_from_recent_and_disconnects(client, mac, tmp_path):
    game = make_project(tmp_path / "a", "Game")
    other = make_project(tmp_path / "b", "Other")
    client.put("/api/unity-project", json={"path": str(other)})
    client.put("/api/unity-project", json={"path": str(game)})

    data = client.delete("/api/unity-project/recent", params={"path": str(other.resolve())}).json()
    assert data["connected"] is True and [r["name"] for r in data["recent"]] == ["Game"]
    data = client.delete("/api/unity-project/recent", params={"path": str(game.resolve())}).json()
    assert data["connected"] is False and data["recent"] == []
    assert game.exists() and other.exists()


def test_recent_marks_missing_projects(client, mac, tmp_path):
    import shutil

    game = make_project(tmp_path / "a", "Game")
    client.put("/api/unity-project", json={"path": str(game)})
    client.delete("/api/unity-project")
    shutil.rmtree(game)
    assert client.get("/api/unity-project").json()["recent"][0]["available"] is False


def test_folders_need_a_connected_project(client, mac):
    response = client.put("/api/unity-project/folders", json={"folders": ["Assets"]})
    assert response.status_code == 409 and response.json()["error"]["code"] == "unity_project_not_connected"


def test_connect_invalid_folder_is_refused(client, mac, tmp_path):
    response = client.put("/api/unity-project", json={"path": str(tmp_path)})
    assert response.status_code == 422 and response.json()["error"]["code"] == "unity_project_invalid"
    assert client.get("/api/unity-project").json()["connected"] is False


def test_connect_is_refused_off_macos(client, monkeypatch, tmp_path):
    monkeypatch.setattr(unity_project, "_platform", "win32")
    response = client.put("/api/unity-project", json={"path": str(make_project(tmp_path))})
    assert response.status_code == 422 and response.json()["error"]["code"] == "unity_project_unsupported"
    assert client.get("/api/unity-project").json()["supported"] is False


def test_moved_project_is_reported(client, mac, tmp_path):
    root = make_project(tmp_path)
    client.put("/api/unity-project", json={"path": str(root)})
    root.rename(tmp_path / "Moved")
    data = client.get("/api/unity-project").json()
    assert data["connected"] is True and data["error_code"] == "unity_project_unavailable"


def test_connect_requires_local_origin(client, mac, tmp_path):
    response = client.put("/api/unity-project", json={"path": str(make_project(tmp_path))}, headers={"Origin": "https://evil.example"})
    assert response.status_code == 403


def test_choose_folder_returns_path_or_none(client, mac, monkeypatch):
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, "/Users/me/MyGame/\n", "")

    monkeypatch.setattr(unity_project, "_run_process", fake_run)
    assert client.post("/api/unity-project/choose").json() == {"path": "/Users/me/MyGame"}
    assert calls[0][0] == "/usr/bin/osascript"

    monkeypatch.setattr(unity_project, "_run_process", lambda args, **kw: subprocess.CompletedProcess(args, 1, "", "execution error: User canceled. (-128)"))
    assert client.post("/api/unity-project/choose").json() == {"path": None}


# ---------- Codex command and prompt ----------


def test_build_command_with_project_reads_only_its_folders_and_enables_shell(tmp_path):
    root = make_project(tmp_path)
    project = unity_project.inspect(str(root), ["Assets", "ProjectSettings", "Packages"])
    work = tmp_path / "work"
    work.mkdir()
    cmd = CodexCLIService().build_command("/usr/local/bin/codex", work, [], work / "s.json", work / "a.json", project_dirs=project.readable_dirs)
    filesystem = next(arg for arg in cmd if ".filesystem=" in arg)
    assert '":root"="deny"' in filesystem
    for name in ("Assets", "ProjectSettings", "Packages"):
        assert f'"{(root / name).resolve()}"="read"' in filesystem
    assert f'"{root.resolve()}"="read"' not in filesystem and "Library" not in filesystem
    assert "shell_tool" not in cmd and "unified_exec" not in cmd
    for feature in ("view_image", "browser_use", "computer_use", "apps", "plugins"):
        assert feature in cmd
    assert 'approval_policy="never"' in cmd and 'web_search="disabled"' in cmd

    plain = CodexCLIService().build_command("/usr/local/bin/codex", work, [], work / "s.json", work / "a.json")
    assert "shell_tool" in plain and "unified_exec" in plain

    with pytest.raises(CodexError):
        CodexCLIService().build_command("/usr/local/bin/codex", work, [], work / "s.json", work / "a.json", builtin_profile=True, project_dirs=project.readable_dirs)


def test_prompt_with_project_allows_reading_and_without_forbids_tools():
    frames = [PromptFrame("R1", "reference", 1000), PromptFrame("C1", "current", 2000)]
    plain = build_prompt("p1", "single_frame", frames)
    assert "Do not run commands, open or read files" in plain and "MyGame" not in plain
    context = ProjectContext(name="MyGame", root="/p/MyGame", readable_dirs=["/p/MyGame/Assets"], unity_version="2022.3.20f1", text_serialization=False)
    prompt = build_prompt("p1", "single_frame", frames, project=context)
    assert "Do not run commands" not in prompt
    assert '"MyGame"' in prompt and "/p/MyGame/Assets" in prompt and "2022.3.20f1" in prompt
    assert "Force Text" in prompt and "Only quote values you actually read" in prompt


# ---------- Analyze with and without a project ----------


@needs_ffmpeg
def test_analysis_without_project_is_unchanged(client, codex, session, inline_jobs):
    pair = _frame_pair(client, session)
    _run(client, session, "single_frame", [pair["id"]])
    status = client.get(f"/api/analysis/{session['id']}/status").json()
    assert status["status"] == "completed" and status["unity_project"] is None
    cmd = codex.calls[-1]["cmd"]
    assert "shell_tool" in cmd and "Do not run commands" in codex.calls[-1]["prompt"]


@needs_ffmpeg
def test_connected_project_without_folders_uses_videos_only(client, codex, session, inline_jobs, mac, tmp_path):
    client.put("/api/unity-project", json={"path": str(make_project(tmp_path))})
    pair = _frame_pair(client, session)
    _run(client, session, "single_frame", [pair["id"]])
    status = client.get(f"/api/analysis/{session['id']}/status").json()
    assert status["status"] == "completed" and status["unity_project"] is None
    assert "shell_tool" in codex.calls[-1]["cmd"] and "MyGame" not in codex.calls[-1]["prompt"]


@needs_ffmpeg
def test_analysis_with_project_reads_only_chosen_folders(client, codex, session, inline_jobs, mac, tmp_path):
    root = make_project(tmp_path)
    client.put("/api/unity-project", json={"path": str(root)})
    client.put("/api/unity-project/folders", json={"folders": ["Assets/Scenes"]})
    pair = _frame_pair(client, session)
    _run(client, session, "single_frame", [pair["id"]])
    status = client.get(f"/api/analysis/{session['id']}/status").json()
    assert status["status"] == "completed" and status["unity_project"] == "MyGame"
    call = codex.calls[-1]
    assert "shell_tool" not in call["cmd"]
    filesystem = next(arg for arg in call["cmd"] if ".filesystem=" in arg)
    assert f'"{(root / "Assets" / "Scenes").resolve()}"="read"' in filesystem
    assert f'"{(root / "Assets").resolve()}"="read"' not in filesystem and "Scripts" not in filesystem
    assert str((root / "Assets" / "Scenes").resolve()) in call["prompt"]


@needs_ffmpeg
def test_project_sandbox_failure_never_falls_back_to_builtin_profile(client, codex, session, inline_jobs, mac, tmp_path):
    client.put("/api/unity-project", json={"path": str(make_project(tmp_path))})
    client.put("/api/unity-project/folders", json={"folders": ["Assets"]})
    codex.exec_behaviour = lambda cmd, prompt: (1, None, SANDBOX_START_FAILURE)
    pair = _frame_pair(client, session)
    _run(client, session, "single_frame", [pair["id"]])
    status = client.get(f"/api/analysis/{session['id']}/status").json()
    assert status["status"] == "failed" and status["error_code"] == "codex_project_sandbox_failed"
    assert len(codex.calls) == 1
    assert not any('":read-only"' in arg and "default_permissions" in arg for arg in codex.calls[0]["cmd"])


@needs_ffmpeg
def test_run_refused_when_connected_project_is_gone(client, codex, session, inline_jobs, mac, tmp_path):
    root = make_project(tmp_path)
    client.put("/api/unity-project", json={"path": str(root)})
    root.rename(tmp_path / "Gone")
    pair = _frame_pair(client, session)
    response = _run(client, session, "single_frame", [pair["id"]])
    assert response.status_code == 409 and response.json()["error"]["code"] == "unity_project_unavailable"
    assert codex.calls == []
