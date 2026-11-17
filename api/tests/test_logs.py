"""ログに記録の中身とメールアドレスを出さない（AC-16・R6・設計書 10.1）。値はすべて架空。"""

import json
import logging

import pytest
from helpers.records import t1

from loss_note_api import logs

MARKER = "MARKER-ログの印-a91c"
EMAIL = "fictional.user@example.com"


class Boom(Exception):
    pass


@pytest.fixture
def capture(caplog, monkeypatch):
    # 根のロガーを DEBUG にし、API のロガーも根に流して caplog で拾う（標準エラーは capfd で拾う）
    caplog.set_level(logging.DEBUG)
    monkeypatch.setattr(logs.logger, "propagate", True)
    return caplog


def test_logs_have_no_record_content_or_email(api, capture, capfd):
    def headers(uid):
        return api.headers(uid, email=EMAIL)

    inst_res = api.call("POST", "/api/instruments", None, {"name": "US30"}, headers=headers("userA"))
    iid = inst_res.get_json()["id"]
    body = t1(iid, lc=99.123456, brokenCondition=MARKER, thesis=MARKER,
              exit={"time": 1, "price": 99.123456, "emotion": MARKER})
    created = api.call("POST", "/api/trades", None, body, headers=headers("userA"))
    assert created.status_code == 201
    tid = created.get_json()["id"]
    statuses = [created.status_code]
    statuses.append(api.call("GET", f"/api/trades/{tid}", None, headers=headers("userA")).status_code)
    statuses.append(api.call("GET", "/api/trades", None, headers=headers("userA")).status_code)
    # 400（印を含む本文・知らない項目）
    bad = {**body, "lc": 100.2, MARKER: MARKER}
    statuses.append(api.call("POST", "/api/trades", None, bad, headers=headers("userA")).status_code)
    # 401（期限切れのトークンにメールと印）
    expired = api.headers("userA", email=EMAIL, exp_offset=-60, name=MARKER)
    statuses.append(api.call("GET", f"/api/trades/{tid}", None, headers=expired).status_code)
    # 404（B が A の取引を読む）
    statuses.append(api.call("GET", f"/api/trades/{tid}", None, headers=api.headers("userB", email=EMAIL)).status_code)
    assert statuses == [201, 200, 200, 400, 401, 404]

    out, err = capfd.readouterr()
    everything = capture.text + out + err
    assert everything.strip(), "ログが 1 行も無い"
    for needle in (MARKER, EMAIL, "99.123456", "userA", tid):
        assert needle not in everything, needle


def test_500_log_has_only_exception_type(memory_api, capture, capfd):
    memory_api.store.fail_with = Boom(f"{MARKER} {EMAIL} users/userA/trades/x")
    res = memory_api.call("GET", "/api/trades", None, headers=memory_api.headers("userA", email=EMAIL))
    assert res.status_code == 500
    assert res.get_json() == {"error": "internal"}
    out, err = capfd.readouterr()
    everything = capture.text + out + err + res.get_data(as_text=True)
    assert MARKER not in everything and EMAIL not in everything and "users/userA" not in everything
    events = [json.loads(r.getMessage()) for r in capture.records if r.name == "loss_note_api"]
    assert {"event": "error", "route": "/api/trades", "exc": "Boom"} in events


def test_request_log_shape(memory_api, capture):
    memory_api.call("GET", "/api/trades/abc123", None, headers=memory_api.headers("userA"))
    events = [json.loads(r.getMessage()) for r in capture.records if r.name == "loss_note_api"]
    req = [e for e in events if e["event"] == "request"][-1]
    assert set(req) == {"event", "method", "route", "status", "ms"}
    assert req["route"] == "/api/trades/<path:trade_id>"  # 生のパス（ID）でなくルールの型
    assert req["status"] == 404


def test_log_event_refuses_unknown_keys():
    with pytest.raises(ValueError):
        logs.log_event(event="x", body="中身")
