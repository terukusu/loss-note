"""データの書き出し ``GET /api/export``（Issue #167 の AC-1〜AC-4・ADR-0025）。

保存先 2 つ（記憶 / エミュレーターの Firestore）で同じテストを回す。値・メールはすべて架空。
"""

import base64
import json
import logging
from datetime import datetime

import pytest
from helpers.charts import CHART_MARKER, chart_png, post_with_charts
from helpers.memory_store import MemoryStore
from helpers.records import BROKEN_CONDITION, t1
from helpers.tokens import bearer, patch_certs, signed_token

from loss_note_api import export, logs
from loss_note_api.allowlist import ALLOWED_EMAILS_VAR
from loss_note_api.app import create_app
from loss_note_api.read_limits import JST
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR

A = "exportUserA"
B = "exportUserB"
PATH = "/api/export"
EMAIL = "fictional.export@example.com"
MARKER = "MARKER-書き出し-5e2b"
KEYS = {"format", "version", "exportedAt", "settings", "emotionTagSettings", "accounts", "instruments", "trades",
        "positionGroups"}


@pytest.fixture
def world(api):
    """E1・E2: A に銘柄 1・設定・取引 2（1 件はエントリー時のチャートと心理のタグ）、B に銘柄 1・取引 1"""
    inst_a = api.instrument(A, "US30")
    api.put("/api/settings", A, {"capitalYen": 1_000_000, "riskTolerancePct": 1, "performanceUnit": "R"})
    with_chart = post_with_charts(api, A, t1(inst_a["id"], thesis=MARKER), {"entry": (chart_png(), "image/png")})
    assert with_chart.status_code == 201, with_chart.get_json()
    plain = api.post("/api/trades", A, t1(inst_a["id"], exit={"time": 1_700_000_500_000, "price": 101}))
    assert plain.status_code == 201
    tagged = api.put("/api/trade-emotions", A, {"tradeIds": [with_chart.get_json()["id"]], "tags": ["fear"]})
    assert tagged.status_code == 200, tagged.get_json()
    inst_b = api.instrument(B, "B-ONLY-INSTRUMENT")
    trade_b = api.post("/api/trades", B, t1(inst_b["id"], brokenCondition="B だけの崩れの条件"))
    assert trade_b.status_code == 201
    return {"api": api, "b_trade": trade_b.get_json()["id"], "b_inst": inst_b["id"]}


def test_ac1_only_own_records(world):
    """AC-1（E1）: B の取引・銘柄・口座の値が A の書き出しに 0 件"""
    api = world["api"]
    res = api.get(PATH, A)
    assert res.status_code == 200
    text = res.get_data(as_text=True)
    for needle in (world["b_trade"], world["b_inst"], "B-ONLY-INSTRUMENT", "B だけの崩れの条件", B):
        assert needle not in text, needle
    body = res.get_json()
    assert len(body["trades"]) == 2
    # B の書き出しには B の 1 件だけ
    b = api.get(PATH, B).get_json()
    assert [t["id"] for t in b["trades"]] == [world["b_trade"]]
    assert MARKER not in json.dumps(b, ensure_ascii=False)


def test_ac2_same_shape_as_list_apis(world):
    """AC-2（E2）: 一覧の API と同じ形・同じ並び。チャートは要約、心理のタグも入る"""
    api = world["api"]
    body = api.get(PATH, A).get_json()
    assert set(body) == KEYS
    assert body["format"] == "loss-note-export" and body["version"] == 1
    assert isinstance(body["exportedAt"], int)
    assert body["trades"] == api.get("/api/trades", A).get_json()["items"]
    assert body["accounts"] == api.get("/api/accounts", A).get_json()["items"]
    assert body["instruments"] == api.get("/api/instruments", A).get_json()["items"]
    assert body["settings"] == api.get("/api/settings", A).get_json()
    assert body["emotionTagSettings"] == api.get("/api/settings/emotion-tags", A).get_json()
    charted = [t for t in body["trades"] if "charts" in t]
    assert len(charted) == 1
    assert charted[0]["charts"] == {"entry": {"contentType": "image/png", "size": len(chart_png())}}
    assert charted[0]["emotionTags"] == ["fear"]


def test_reflection_included(api):
    """#123 の Good / More は取引の一覧の API と同じく取引に入る"""
    inst = api.instrument(A)
    tid = api.post("/api/trades", A, t1(inst["id"])).get_json()["id"]
    body = {"tradeIds": [tid], "good": {"topics": ["cutEarly"], "notes": ["架空の一言"]},
            "more": {"topics": [], "notes": []}}  # fmt: skip
    res = api.put("/api/trade-reflections", A, body)
    assert res.status_code == 200, res.get_json()
    [trade] = api.get(PATH, A).get_json()["trades"]
    assert trade["reflection"] == api.get(f"/api/trades/{tid}", A).get_json()["reflection"]
    assert "架空の一言" in json.dumps(trade, ensure_ascii=False)


def test_ac2_no_image_bytes(world):
    """AC-2: 画像のバイト列（そのまま・base64）が応答に無い"""
    raw = world["api"].get(PATH, A).get_data()
    assert CHART_MARKER not in raw
    assert base64.b64encode(CHART_MARKER) not in raw
    assert base64.b64encode(chart_png()[:30]) not in raw


def test_e8_empty_user(api):
    """E8: 何も無い利用者は空の配列と既定の設定（既定の口座は口座を読む入口と同じく作られる）"""
    body = api.get(PATH, A).get_json()
    assert body["trades"] == [] and body["instruments"] == []
    assert [a["id"] for a in body["accounts"]] == ["default"]
    assert body["settings"]["capitalYen"] is None
    assert body["emotionTagSettings"] == {"hidden": []}


def test_emotion_tag_choices_included(api):
    """#163 の選択肢の設定（出さないタグ）も書き出す。B の設定は A に入らない"""
    assert api.put("/api/settings/emotion-tags", A, {"hidden": ["fear"]}).status_code == 200
    assert api.put("/api/settings/emotion-tags", B, {"hidden": ["hope"]}).status_code == 200
    assert api.get(PATH, A).get_json()["emotionTagSettings"] == {"hidden": ["fear"]}


def test_headers_download_and_no_store(memory_api, clock):
    # 日本時間 2026-11-24 の 0:30（UTC では 11-23 の 15:30）→ 日本時間の日付の名前
    at = int(datetime(2026, 11, 24, 0, 30, tzinfo=JST).timestamp() * 1000)
    assert export.file_name(at) == "loss-note-20261124.json"
    res = memory_api.get(PATH, A)
    assert res.status_code == 200
    assert res.headers["Cache-Control"] == "no-store"
    disposition = res.headers["Content-Disposition"]
    assert disposition.startswith('attachment; filename="loss-note-') and disposition.endswith('.json"')
    assert res.mimetype == "application/json"


def test_export_body_is_pure():
    trades = [{"id": "t"}]
    body = export.export_body(1, {"capitalYen": None}, [], [], trades, {"hidden": []}, [])
    assert body["trades"] == trades and body["trades"] is not trades


# ── AC-3: 門（401 / 403・保存先に触れない） ──


class CountingStore:
    """保存先の呼び出しを数える包み"""

    def __init__(self, inner: MemoryStore):
        self.inner = inner
        self.calls: list[str] = []

    def __getattr__(self, name):
        target = getattr(self.inner, name)
        if not callable(target):
            return target

        def wrapped(*args, **kwargs):
            self.calls.append(name)
            return target(*args, **kwargs)

        return wrapped


@pytest.fixture
def prod(monkeypatch):
    for name in (AUTH_EMULATOR, FIRESTORE_EMULATOR):
        monkeypatch.delenv(name, raising=False)
    patch_certs(monkeypatch)
    store = CountingStore(MemoryStore())
    app = create_app({"GOOGLE_CLOUD_PROJECT": "example-prod", ALLOWED_EMAILS_VAR: "owner@example.com"}, store=store)
    return app.test_client(), store


def test_ac3_unauthenticated_401(prod):
    client, store = prod
    res = client.get(PATH)
    assert res.status_code == 401
    assert res.get_json() == {"error": "unauthorized"}
    assert store.calls == []


def test_ac3_not_allowed_403(prod):
    client, store = prod
    tok = signed_token("otherUid1", "example-prod", email="other@example.com", email_verified=True)
    res = client.get(PATH, headers=bearer(tok))
    assert res.status_code == 403
    assert res.get_json() == {"error": "forbidden"}
    assert store.calls == []


def test_ac3_allowed_200(prod):
    client, store = prod
    tok = signed_token("ownerUid1", "example-prod", email="owner@example.com", email_verified=True)
    res = client.get(PATH, headers=bearer(tok))
    assert res.status_code == 200
    assert set(res.get_json()) == KEYS


def test_unconfigured_is_503(monkeypatch):
    for name in (AUTH_EMULATOR, FIRESTORE_EMULATOR):
        monkeypatch.delenv(name, raising=False)
    res = create_app({}).test_client().get(PATH)
    assert res.status_code == 503


# ── AC-4: ログに中身・メール・uid を出さない ──


@pytest.fixture
def capture(caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)
    monkeypatch.setattr(logs.logger, "propagate", True)
    return caplog


def test_ac4_logs_have_no_content(api, capture, capfd):
    inst = api.call("POST", "/api/instruments", None, {"name": "US30"}, headers=api.headers(A, email=EMAIL))
    iid = inst.get_json()["id"]
    created = api.call("POST", "/api/trades", None, t1(iid, thesis=MARKER, lc=99.123456),
                       headers=api.headers(A, email=EMAIL))  # fmt: skip
    tid = created.get_json()["id"]
    capture.clear()
    capfd.readouterr()
    res = api.call("GET", PATH, None, headers=api.headers(A, email=EMAIL))
    assert res.status_code == 200
    out, err = capfd.readouterr()
    everything = capture.text + out + err
    assert everything.strip(), "ログが 1 行も無い"
    for needle in (MARKER, EMAIL, A, tid, "99.123456", BROKEN_CONDITION, "US30"):
        assert needle not in everything, needle
    events = [json.loads(r.getMessage()) for r in capture.records if r.name == "loss_note_api"]
    assert {"event", "method", "route", "status", "ms"} == set(next(e for e in events if e["event"] == "request"))
