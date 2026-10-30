"""Windows process handling in codex_cli, checked on any OS by loading a private copy of the module as if on Windows."""

import importlib.util
import os
import subprocess

import pytest

from app.services.ai import codex_cli as codex_module


@pytest.fixture
def windows_codex_cli(monkeypatch):
    monkeypatch.setattr(os, "name", "nt")
    monkeypatch.setattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200, raising=False)
    spec = importlib.util.spec_from_file_location("codex_cli_windows_copy", codex_module.__file__)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_codex_gets_its_own_process_group(windows_codex_cli):
    assert windows_codex_cli.NEW_PROCESS_GROUP == {"creationflags": 0x200}
    assert len(windows_codex_cli.STOP_SIGNALS) == 1


def test_stopping_ends_the_whole_process_tree(windows_codex_cli, monkeypatch):
    ran = []
    monkeypatch.setattr(subprocess, "run", lambda args, **kw: ran.append(args))

    class Proc:
        pid = 4242

        def wait(self, timeout=None):
            return 1

    windows_codex_cli.CodexCLIService._terminate(Proc())
    assert ran == [["taskkill", "/PID", "4242", "/T", "/F"]]
