"""記録の API の振る舞い（契約 1。AC-1・11・12・13・14・15）。保存先 2 つで同じテストを回す。値はすべて架空。"""

import json

import pytest
from helpers.records import BROKEN_CONDITION, t1
from helpers.tokens import unsigned_token

A = "userA"
B = "userB"

# 12 操作（取引 5・銘柄 5・設定 2）。ID は形の正しい架空の値
OPERATIONS = [
    ("GET", "/api/trades"),
    ("POST", "/api/trades"),
    ("GET", "/api/trades/abc123"),
    ("PUT", "/api/trades/abc123"),
    ("DELETE", "/api/trades/abc123"),
    ("GET", "/api/instruments"),
    ("POST", "/api/instruments"),
    ("GET", "/api/instruments/abc123"),
    ("PUT", "/api/instruments/abc123"),
    ("DELETE", "/api/instruments/abc123"),
    ("GET", "/api/settings"),
    ("PUT", "/api/settings"),
]

MARKER = "MARKER-本文の印-7d3f"


def bad_auth_headers():
    expired = unsigned_token(A, "demo-loss-note", exp_offset=-120)
    return {
        "なし": {},
        "Bearer でない": {"Authorization": f"Basic {unsigned_token(A)}"},
        "壊れた JWT": {"Authorization": "Bearer not.a.jwt"},
        "期限切れ": {"Authorization": f"Bearer {expired}"},
    }


@pytest.mark.parametrize(("method", "path"), OPERATIONS)
def test_unauthorized_all_operations(api, method, path):
    """AC-1: 12 操作 × 4 種類 → すべて 401、本文は決まった文言だけ、トークン・送った本文の印が無い"""
    body = {"brokenCondition": MARKER, "name": MARKER}
    for label, headers in bad_auth_headers().items():
        res = api.call(method, path, None, body if method in ("POST", "PUT") else None, headers=headers)
        assert res.status_code == 401, label
        assert res.get_json() == {"error": "unauthorized"}, label
        assert res.headers["WWW-Authenticate"] == "Bearer"
        text = res.get_data(as_text=True)
        assert MARKER not in text
        token = headers.get("Authorization", "").split(" ")[-1]
        if token:
            assert token not in text, label


def test_unauthorized_does_not_depend_on_existence(api):
    inst = api.instrument(A)
    tid = api.post("/api/trades", A, t1(inst["id"])).get_json()["id"]
    for path in (f"/api/trades/{tid}", "/api/trades/nonexistent", "/api/trades/..%2Fx"):
        assert api.get(path).status_code == 401


def test_health_and_cache_headers(api):
    res = api.get("/api/health")
    assert res.status_code == 200 and res.get_json() == {"status": "ok"}
    res = api.get("/api/settings", A)
    assert res.headers["Cache-Control"] == "no-store"
    assert api.get("/api/trades").headers["Cache-Control"] == "no-store"


def test_create_and_read_t1(api):
    """E1: 作って読む。読んだ値は送った値と項目ごとに一致（既定を埋めた後）"""
    inst = api.instrument(A)
    api.put("/api/settings", A, {"capitalYen": 1_000_000, "riskTolerancePct": 1, "performanceUnit": "R"})
    res = api.post("/api/trades", A, t1(inst["id"]))
    assert res.status_code == 201
    created = res.get_json()
    got = api.get(f"/api/trades/{created['id']}", A).get_json()
    assert got == created
    assert got["schemaVersion"] == 1
    assert got["record"]["brokenCondition"] == BROKEN_CONDITION
    assert got["record"]["entries"] == [{"price": 100, "quantity": 10000}]
    assert got["record"]["fees"] == [{"label": "手数料", "amountYen": 200}]
    assert got["record"]["exit"] == {
        "time": 1_700_000_000_000, "price": 99.5, "reason": "lc", "orderType": "unknown", "gapSlip": "unanswered"
    }  # fmt: skip
    assert got["snapshot"] == {
        "instrument": {"multiplier": 1, "quantityStep": 1, "priceCurrency": "JPY", "underlyingKind": "other",
                       "productForm": "spotCfd"},
        "capitalYen": 1_000_000,
        "riskTolerancePct": 1,
        "accountCurrency": "JPY",
    }  # fmt: skip


def test_trade_keeps_capital_snapshot(api):
    """AC-11: 記録した後に資金を直しても、取引の資金は記録したときのまま。資金の履歴は 2 件・時刻つき"""
    inst = api.instrument(A)
    api.put("/api/settings", A, {"capitalYen": 1_000_000, "riskTolerancePct": 1, "performanceUnit": "R"})
    tid = api.post("/api/trades", A, t1(inst["id"])).get_json()["id"]
    res = api.put("/api/settings", A, {"capitalYen": 500_000, "riskTolerancePct": 1, "performanceUnit": "R"})
    assert res.status_code == 200
    settings = res.get_json()
    assert [h["valueYen"] for h in settings["capitalHistory"]] == [1_000_000, 500_000]
    assert all(isinstance(h["at"], int) for h in settings["capitalHistory"])
    assert settings["capitalHistory"][0]["at"] <= settings["capitalHistory"][1]["at"]
    trade = api.get(f"/api/trades/{tid}", A).get_json()
    assert trade["snapshot"]["capitalYen"] == 1_000_000
    assert trade["snapshot"]["riskTolerancePct"] == 1
    # 資金も許容リスクも変えずに直しても、履歴は増えない
    res = api.put("/api/settings", A, {"capitalYen": 500_000, "riskTolerancePct": 2, "performanceUnit": "yen"})
    assert len(res.get_json()["capitalHistory"]) == 2
    assert api.get(f"/api/trades/{tid}", A).get_json()["snapshot"]["riskTolerancePct"] == 1


def test_trade_keeps_instrument_snapshot(api):
    """AC-12（D0 の読み替え）: 乗数を 1 → 10 に直す → 直す前の取引は 1、直した後に作った取引は 10"""
    inst = api.instrument(A)
    before = api.post("/api/trades", A, t1(inst["id"])).get_json()["id"]
    res = api.put(f"/api/instruments/{inst['id']}", A, {"name": "US30", "priceCurrency": "JPY", "multiplier": 10})
    assert res.status_code == 200 and res.get_json()["multiplier"] == 10
    after = api.post("/api/trades", A, t1(inst["id"])).get_json()["id"]
    assert api.get(f"/api/trades/{before}", A).get_json()["snapshot"]["instrument"]["multiplier"] == 1
    assert api.get(f"/api/trades/{after}", A).get_json()["snapshot"]["instrument"]["multiplier"] == 10


def test_put_keeps_snapshot_unless_instrument_changes(api):
    inst = api.instrument(A)
    other = api.instrument(A, "JP225", multiplier=100, priceCurrency="JPY")
    api.put("/api/settings", A, {"capitalYen": 1_000_000, "riskTolerancePct": 1, "performanceUnit": "R"})
    tid = api.post("/api/trades", A, t1(inst["id"])).get_json()["id"]
    api.put("/api/settings", A, {"capitalYen": 300_000, "riskTolerancePct": 2, "performanceUnit": "R"})
    api.put(f"/api/instruments/{inst['id']}", A, {"name": "US30", "multiplier": 5})
    res = api.put(f"/api/trades/{tid}", A, t1(inst["id"], brokenCondition="書き換えた"))
    snap = res.get_json()["snapshot"]
    assert snap["instrument"]["multiplier"] == 1 and snap["capitalYen"] == 1_000_000
    # 別の銘柄に変えたときだけ、その銘柄の今の値で写し直す（資金・許容リスクは変えない）
    res = api.put(f"/api/trades/{tid}", A, t1(other["id"]))
    snap = res.get_json()["snapshot"]
    assert snap["instrument"]["multiplier"] == 100
    assert snap["capitalYen"] == 1_000_000 and snap["riskTolerancePct"] == 1


def test_capital_history_keeps_latest_1000(memory_api):
    api = memory_api
    for i in range(1003):
        res = api.put("/api/settings", A, {"capitalYen": 1000 + i, "riskTolerancePct": 1, "performanceUnit": "R"})
        assert res.status_code == 200
    history = api.get("/api/settings", A).get_json()["capitalHistory"]
    assert len(history) == 1000
    assert history[0]["valueYen"] == 1003 and history[-1]["valueYen"] == 2002


def test_settings_default(api):
    assert api.get("/api/settings", A).get_json() == {
        "capitalYen": None, "riskTolerancePct": 1, "performanceUnit": "R", "capitalHistory": []
    }  # fmt: skip


def test_trade_without_settings_has_null_capital(api):
    inst = api.instrument(A)
    trade = api.post("/api/trades", A, t1(inst["id"])).get_json()
    assert trade["snapshot"]["capitalYen"] is None and trade["snapshot"]["riskTolerancePct"] == 1


# ── AC-13: 形に合わない本文 ─────────────────────
def _invalid_bodies(iid: str) -> dict:
    def drop(key):
        b = t1(iid)
        del b[key]
        return b

    return {
        "E14 LC 100.20": t1(iid, lc=100.2),
        "E14 LC = イン": t1(iid, lc=100),
        "E15 時間足を変えたか が無い": drop("timeframeChange"),
        "E16 知らない項目 uid": t1(iid, uid=MARKER),
        "E16 列挙外の決済の理由": t1(iid, exit={"time": 1_700_000_000_000, "price": 99.5, "reason": MARKER}),
        "E16 数の欄に true": t1(iid, statementPnlYen=True),
        "E17 計画中": t1(iid, status="planned"),
        "崩れの条件 201 文字": t1(iid, brokenCondition="あ" * 201),
        "根拠 2001 文字": t1(iid, thesis="x" * 2001),
        "感情 501 文字": t1(iid, entryEmotion="x" * 501),
        "限月 17 文字": t1(iid, contractMonth="x" * 17),
        "手数料の欄の名前 41 文字": t1(iid, fees=[{"label": "x" * 41, "amountYen": 1}]),
        "エントリー 21": t1(iid, entries=[{"price": 100, "quantity": 1}] * 21),
        "手数料の欄 21": t1(iid, fees=[{"amountYen": 1}] * 21),
        "絶対値 1e12 超": t1(iid, statementPnlYen=1e12 + 1),
        "時点 2100 年超": t1(iid, plannedAt=4_102_444_800_001),
    }


def test_invalid_body_is_rejected_and_nothing_saved(api):
    inst = api.instrument(A)
    for label, body in _invalid_bodies(inst["id"]).items():
        res = api.post("/api/trades", A, body)
        assert res.status_code == 400, label
        data = res.get_json()
        assert data["error"] == "invalid" and data["issues"], label
        text = res.get_data(as_text=True)
        assert MARKER not in text and "100.2" not in text and '"uid"' not in text, label
    assert api.trades(A) == []


@pytest.mark.parametrize(
    ("raw", "ctype", "label"),
    [
        ('{"lc": NaN}', "application/json", "NaN"),
        ('{"lc": Infinity}', "application/json", "Infinity"),
        ("not json", "application/json", "JSON でない"),
        ("{}", "text/plain", "Content-Type 違い"),
        ("[]", "application/json", "配列"),
    ],
)
def test_invalid_body_raw(api, raw, ctype, label):
    res = api.post("/api/trades", A, raw=raw, content_type=ctype)
    assert res.status_code == 400, label
    assert res.get_json()["error"] == "invalid"
    assert api.trades(A) == []


def test_invalid_body_infinity_by_exponent(api):
    inst = api.instrument(A)
    raw = json.dumps(t1(inst["id"])).replace('"price": 100,', '"price": 1e400,')
    assert "1e400" in raw
    assert api.post("/api/trades", A, raw=raw).status_code == 400
    assert api.trades(A) == []


def test_invalid_body_too_large(api):
    inst = api.instrument(A)
    body = t1(inst["id"], thesis="x" * 1000)
    raw = json.dumps(body).replace('"x', '"' + "y" * (70 * 1024) + "x", 1)
    assert len(raw.encode()) > 64 * 1024
    res = api.post("/api/trades", A, raw=raw)
    assert res.status_code == 400
    assert res.get_json() == {"error": "invalid", "issues": [{"field": "", "kind": "tooLarge"}]}
    assert api.trades(A) == []


def test_invalid_put_keeps_original(api):
    inst = api.instrument(A)
    created = api.post("/api/trades", A, t1(inst["id"])).get_json()
    res = api.put(f"/api/trades/{created['id']}", A, t1(inst["id"], lc=100.2))
    assert res.status_code == 400
    assert api.get(f"/api/trades/{created['id']}", A).get_json() == created


def test_trade_with_unknown_instrument_is_400(api):
    res = api.post("/api/trades", A, t1("doesNotExist1"))
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "instrumentId", "kind": "notFound"}]


# ── AC-14: 銘柄の名前 ──────────────────────────
def test_instrument_name_unique_per_user(api):
    assert api.post("/api/instruments", A, {"name": "US30"}).status_code == 201
    assert api.post("/api/instruments", B, {"name": "US30"}).status_code == 201
    for name in ("US30", " us30 ", "ＵＳ３０"):
        res = api.post("/api/instruments", A, {"name": name})
        assert res.status_code == 409, name
        assert res.get_json() == {"error": "conflict", "reason": "duplicateName"}
    other = api.post("/api/instruments", A, {"name": "JP225"}).get_json()
    res = api.put(f"/api/instruments/{other['id']}", A, {"name": "US30"})
    assert res.status_code == 409
    assert api.get(f"/api/instruments/{other['id']}", A).get_json()["name"] == "JP225"
    # 自分の名前のままで直すのは重複ではない
    assert api.put(f"/api/instruments/{other['id']}", A, {"name": "jp225"}).status_code == 200
    assert [i["name"] for i in api.get("/api/instruments", A).get_json()["items"]] == ["jp225", "US30"]


def test_instrument_in_use_cannot_be_deleted(api):
    inst = api.instrument(A)
    tid = api.post("/api/trades", A, t1(inst["id"])).get_json()["id"]
    res = api.delete(f"/api/instruments/{inst['id']}", A)
    assert res.status_code == 409 and res.get_json() == {"error": "conflict", "reason": "inUse"}
    assert api.delete(f"/api/trades/{tid}", A).status_code == 204
    assert api.delete(f"/api/instruments/{inst['id']}", A).status_code == 204
    assert api.get(f"/api/instruments/{inst['id']}", A).status_code == 404


def test_instrument_response_has_no_name_key(api):
    inst = api.instrument(A, underlying="Dow", underlyingKind="index")
    assert "nameKey" not in inst
    assert set(inst) == {"id", "name", "underlying", "underlyingKind", "productForm", "priceCurrency",
                         "multiplier", "quantityStep", "createdAt", "updatedAt"}  # fmt: skip


# ── AC-15: 直す・消す ───────────────────────────
def test_update_keeps_created_at(api, clock):
    inst = api.instrument(A)
    created = api.post("/api/trades", A, t1(inst["id"])).get_json()
    res = api.put(f"/api/trades/{created['id']}", A, t1(inst["id"], brokenCondition="100.00 を割ったら崩れる"))
    assert res.status_code == 200
    updated = res.get_json()
    assert updated["createdAt"] == created["createdAt"]
    assert updated["updatedAt"] > created["updatedAt"]
    assert updated["record"]["brokenCondition"] == "100.00 を割ったら崩れる"
    # 時計が戻っても直した時刻は進む
    clock.advance(-60_000)
    again = api.put(f"/api/trades/{created['id']}", A, t1(inst["id"])).get_json()
    assert again["updatedAt"] > updated["updatedAt"]


def test_delete_then_404(api):
    inst = api.instrument(A)
    tid = api.post("/api/trades", A, t1(inst["id"])).get_json()["id"]
    res = api.delete(f"/api/trades/{tid}", A)
    assert res.status_code == 204 and res.get_data() == b""
    assert api.get(f"/api/trades/{tid}", A).status_code == 404
    assert api.put(f"/api/trades/{tid}", A, t1(inst["id"])).status_code == 404
    assert api.delete(f"/api/trades/{tid}", A).status_code == 404
    assert api.trades(A) == []


def test_list_order_newest_exit_first(api):
    inst = api.instrument(A)
    times = [1_700_000_000_000, 1_700_000_300_000, 1_700_000_100_000]
    for t in times:
        body = t1(inst["id"])
        body["exit"] = {**body["exit"], "time": t}
        api.post("/api/trades", A, body)
    assert [x["record"]["exit"]["time"] for x in api.trades(A)] == sorted(times, reverse=True)


def test_method_not_allowed(api):
    assert api.call("PATCH", "/api/trades", A).status_code == 405
    assert api.call("DELETE", "/api/settings", A).status_code == 405


@pytest.mark.parametrize("path", ["/api/trades/a%2Fb", "/api/trades/a.b", "/api/trades/" + "a" * 41])
def test_bad_ids_are_404(api, path):
    assert api.get(path, A).status_code == 404


def test_store_unavailable_is_503(memory_api):
    memory_api.store.unavailable = True
    res = memory_api.get("/api/trades", A)
    assert res.status_code == 503 and res.get_json() == {"error": "unavailable"}


def test_unconfigured_returns_503_for_records(monkeypatch):
    from loss_note_api.app import create_app

    app = create_app({})
    client = app.test_client()
    assert client.get("/api/health").get_json() == {"status": "ok"}
    for method, path in OPERATIONS:
        assert client.open(path, method=method).status_code == 503, (method, path)


def test_cert_fetch_failure_is_503(monkeypatch, capfd):
    """検証モード（本番と同じ設定）で公開鍵を取れない → 503 unavailable。ログは型の名前だけ"""
    import google.auth.exceptions
    import google.oauth2.id_token
    from helpers.memory_store import MemoryStore
    from helpers.tokens import signed_token

    from loss_note_api.app import create_app

    for name in ("FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST",
                 "STORAGE_EMULATOR_HOST"):  # fmt: skip
        monkeypatch.delenv(name, raising=False)

    def fail(_request, _url):
        raise google.auth.exceptions.TransportError(f"{MARKER} certs down")

    monkeypatch.setattr(google.oauth2.id_token, "_fetch_certs", fail)
    app = create_app({"GOOGLE_CLOUD_PROJECT": "example-prod"}, store=MemoryStore())
    token = signed_token(A, "example-prod")
    res = app.test_client().get("/api/trades", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 503
    assert res.get_json() == {"error": "unavailable"}
    out, err = capfd.readouterr()
    assert MARKER not in out + err and token not in out + err
    assert '"event":"auth_unavailable"' in err


def test_aborted_transaction_is_store_unavailable():
    """トランザクションの競合で再試行を使い切った（Aborted）も 503 の側（StoreUnavailable）に写す"""
    from google.api_core import exceptions as gexc

    from loss_note_api.store import StoreUnavailable, _guard

    @_guard
    def contended():
        raise gexc.Aborted(f"{MARKER} contention on users/userA/trades/x")

    with pytest.raises(StoreUnavailable) as e:
        contended()
    assert MARKER not in str(e.value) and "users/" not in str(e.value)


def test_exhausted_commit_retries_are_store_unavailable():
    """commit の再試行を使い切った（SDK は Aborted を原因にした ValueError を上げる）も 503 の側。
    原因が Aborted でない ValueError は写さない（こちらの誤りを隠さない）"""
    from google.api_core import exceptions as gexc

    from loss_note_api.store import StoreUnavailable, _guard

    @_guard
    def exhausted():
        try:
            raise gexc.Aborted(f"{MARKER} contention")
        except gexc.Aborted as last:
            raise ValueError("Failed to commit transaction in 5 attempts.") from last

    with pytest.raises(StoreUnavailable) as e:
        exhausted()
    assert MARKER not in str(e.value)

    @_guard
    def bug():
        raise ValueError("bug")

    with pytest.raises(ValueError):
        bug()


def _race_once(api, inst_id: str, moved_id: str) -> dict:
    """取引の作成・付け替え・銘柄の削除を同時に走らせ、それぞれの状態を返す"""
    import threading

    results: dict = {}
    barrier = threading.Barrier(3)
    calls = {
        "create": lambda c: c.post("/api/trades", json=t1(inst_id), headers=api.headers(A)),
        "move": lambda c: c.put(f"/api/trades/{moved_id}", json=t1(inst_id), headers=api.headers(A)),
        "delete": lambda c: c.delete(f"/api/instruments/{inst_id}", headers=api.headers(A)),
    }

    def run(name):
        client = api.app.test_client()
        barrier.wait()
        results[name] = calls[name](client).status_code

    threads = [threading.Thread(target=run, args=(name,)) for name in calls]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def test_create_trade_and_delete_instrument_race(api):
    """銘柄の削除と取引の作成・付け替えを同時に走らせても、無い銘柄を指す取引が残らない
    （銘柄の確認と取引の書き込みが同じトランザクション）。削除 204 なら作成・付け替えは成功しない"""
    keep = api.instrument(A, "KEEP")
    moved = api.post("/api/trades", A, t1(keep["id"])).get_json()
    for i in range(8):
        inst = api.instrument(A, f"RACE{i}")
        results = _race_once(api, inst["id"], moved["id"])
        assert results["create"] in (201, 400, 503), results
        assert results["move"] in (200, 400, 503), results
        assert results["delete"] in (204, 409, 503), results
        # 不変条件: どの取引も、今ある自分の銘柄を指す
        existing = {x["id"] for x in api.get("/api/instruments", A).get_json()["items"]}
        for trade in api.trades(A):
            assert trade["record"]["instrumentId"] in existing, results
        if results["delete"] == 204:
            assert results["create"] != 201 and results["move"] != 200, results
        # 次の回のために、付け替えた取引を KEEP に戻す
        api.put(f"/api/trades/{moved['id']}", A, t1(keep["id"]))


def test_zwj_emoji_201_and_bidi_override_400(api):
    family = "\U0001f468\u200d\U0001f469\u200d\U0001f467"
    inst = api.instrument(A)
    res = api.post("/api/trades", A, t1(inst["id"], entryEmotion=f"焦り{family}"))
    assert res.status_code == 201
    assert api.get(f"/api/trades/{res.get_json()['id']}", A).get_json()["record"]["entryEmotion"] == f"焦り{family}"
    res = api.post("/api/trades", A, t1(inst["id"], entryEmotion="焦り\u202e逆"))
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "entryEmotion", "kind": "control"}]
    assert len(api.trades(A)) == 1


@pytest.mark.parametrize("fx", [0, -1, "abc", True])
def test_fx_rate_must_be_positive_number(api, fx):
    """#47 AC-16（F12）: 為替 0・負・文字・真偽は 400（field exit.fxRate）。取引は作らない"""
    inst = api.instrument(A, "架空指数U", priceCurrency="USD")
    body = t1(inst["id"], exit={"time": 1_700_000_000_000, "price": 99.5, "reason": "lc", "fxRate": fx})
    res = api.post("/api/trades", A, body)
    assert res.status_code == 400
    assert [i["field"] for i in res.get_json()["issues"]] == ["exit.fxRate"]
    assert api.trades(A) == []
    ok = t1(inst["id"], exit={"time": 1_700_000_000_000, "price": 99.5, "reason": "lc", "fxRate": 150})
    assert api.post("/api/trades", A, ok).status_code == 201


def test_settings_history_rows_have_no_currency(api):
    """#47 KEEP-6: 設定の資金の履歴の行は {valueYen, at} だけ（口座の通貨は口座の履歴にだけ書く）"""
    api.put("/api/settings", A, {"capitalYen": 1_000_000, "riskTolerancePct": 1, "performanceUnit": "R"})
    got = api.put("/api/settings", A, {"capitalYen": 500_000, "riskTolerancePct": 1, "performanceUnit": "yen"})
    assert got.status_code == 200
    assert all(set(h) == {"valueYen", "at"} for h in got.get_json()["capitalHistory"])
    assert got.get_json()["performanceUnit"] == "yen"
