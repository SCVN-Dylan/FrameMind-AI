"""The standalone page (file://, Origin "null") must present the pairing code; other origins are unchanged."""

import os
import stat

from app.services import standalone

NULL = {"Origin": "null"}


def _code():
    return standalone.pairing_code()


def test_pairing_code_is_stable_and_private(client):
    first = _code()
    assert first == _code() and len(first.replace("-", "")) == 12
    mode = stat.S_IMODE(os.stat(standalone.code_path()).st_mode)
    assert mode == 0o600


def test_health_is_open_but_data_needs_pairing(client):
    health = client.get("/api/health", headers=NULL)
    assert health.status_code == 200
    assert health.headers["access-control-allow-origin"] == "null"

    denied = client.get("/api/sessions", headers=NULL)
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "pairing_required"
    assert denied.headers["access-control-allow-origin"] == "null"  # the page can read the error

    wrong = client.get("/api/sessions", headers={**NULL, standalone.HEADER: "AAAA-BBBB-CCCC"})
    assert wrong.status_code == 403

    ok = client.get("/api/sessions", headers={**NULL, standalone.HEADER: _code().lower()})
    assert ok.status_code == 200


def test_preflight_allows_the_pairing_header(client):
    response = client.options(
        "/api/videos",
        headers={**NULL, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-framemind-pairing"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "null"
    assert "x-framemind-pairing" in response.headers["access-control-allow-headers"].lower()


def test_state_changing_routes_need_pairing_from_null_origin(client):
    assert client.post("/api/ai/provider/logout", headers=NULL).json()["error"]["code"] == "pairing_required"
    assert client.put("/api/ai/provider/model", json={"model": None}, headers=NULL).status_code == 403


def test_other_origins_are_unchanged(client):
    evil = client.get("/api/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in evil.headers
    app_origin = client.get("/api/sessions", headers={"Origin": "http://localhost:3000"})
    assert app_origin.status_code == 200
    assert app_origin.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert client.get("/api/sessions").status_code == 200  # no Origin (curl, same-origin)
