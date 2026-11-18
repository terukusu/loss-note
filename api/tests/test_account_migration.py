"""既定の口座の移し替え（Issue #47 PR-1。AC-9・例 M1〜M3・R2・ADR-0012）。
保存先 2 つ（記憶・エミュレーターの Firestore）で
同じテストを回す。値はすべて架空。

移し替え = 口座を読む・使う入口で ``accounts/default`` が無ければ、トランザクションの外で決まった ID の create で
設定から 1 回だけ作る（ADR-0012）。
本番には実データがあるので、ここで固定すること:
- 取引・設定の文書を書き換えない（読む前後で同じ）
- 何度・同時に走っても口座は 1 つだけ（決まった ID）
- 取引の 1R・リスク（%）は snapshot から出すので、移し替えの前後で同じ
"""

import json
import threading

import pytest
from helpers.records import t1

from loss_note_api import accounts
from loss_note_api.accounts import DEFAULT_ACCOUNT_ID, account_id_of, default_account, next_capital_history

A = "userA"
SETTINGS = {"capitalYen": 1_000_000, "riskTolerancePct": 1.5, "performanceUnit": "R"}


def raw_docs(api, uid: str, name: str) -> dict:
    """保存先の文書をそのまま（API の応答の形でなく。書き換えが無いことをバイトの並びまで見る）"""
    if api.kind == "memory":
        return json.loads(json.dumps(api.store.users.get(uid, {}).get(name, {}), sort_keys=True))
    col = api.store._db().collection("users").document(uid).collection(name)
    return json.loads(json.dumps({s.id: s.to_dict() for s in col.stream()}, sort_keys=True, default=str))


def legacy_world(api, clock) -> list[dict]:
    """M1: 移す前の利用者（設定 = 資金 1,000,000・許容 1.5%・履歴 2 件、取引 2 件、口座の文書は無い）を作る"""
    inst = api.instrument(A, "架空指数A")
    api.put("/api/settings", A, {**SETTINGS, "capitalYen": 800_000})
    clock.advance(1000)
    api.put("/api/settings", A, SETTINGS)
    trades = [api.post("/api/trades", A, t1(inst["id"])).get_json() for _ in range(2)]
    # 移す前の版は口座を知らない: 取引の作成で作られた既定の口座を消して、移す前の状態にそろえる
    if api.kind == "memory":
        api.store.users[A].pop("accounts", None)
        api.store.default_created = 0
    else:
        api.store._db().collection("users").document(A).collection("accounts").document("default").delete()
    assert raw_docs(api, A, "accounts") == {}
    return trades


# ── 純関数 ───────────────────────────────────


def test_default_account_from_settings():
    """M1・M2 の値: 名前「口座 1」・資金と許容リスクと履歴は設定から（無ければ資金 null・1%・[]）。入力を書き換えない"""
    settings = {**SETTINGS, "capitalHistory": [{"valueYen": 800_000, "at": 1}, {"valueYen": 1_000_000, "at": 2}]}
    before = json.dumps(settings)
    doc = default_account(settings, 99)
    assert doc == {
        "name": "口座 1",
        "nameKey": "口座 1",
        "capitalYen": 1_000_000,
        "riskTolerancePct": 1.5,
        "capitalHistory": [{"valueYen": 800_000, "at": 1}, {"valueYen": 1_000_000, "at": 2}],
        "createdAt": 99,
        "updatedAt": 99,
    }
    assert json.dumps(settings) == before
    doc["capitalHistory"].append({"valueYen": 1, "at": 3})
    assert len(settings["capitalHistory"]) == 2
    assert default_account({"riskTolerancePct": 2, "performanceUnit": "yen"}, 5)["capitalYen"] is None
    assert default_account({"riskTolerancePct": 2}, 5)["riskTolerancePct"] == 2
    empty = default_account(None, 5)
    assert (empty["capitalYen"], empty["riskTolerancePct"], empty["capitalHistory"]) == (None, 1, [])


@pytest.mark.parametrize(
    ("record", "want"),
    [({}, "default"), ({"accountId": "accA"}, "accA"), ({"accountId": "default"}, "default"), ({"accountId": ""},
                                                                                                "default")],
)  # fmt: skip
def test_account_id_of_same_table_as_ts(record, want):
    """core/record.ts の accountIdOf と同じ表（tests/ui/accounts.test.ts）"""
    assert account_id_of(record) == want
    assert DEFAULT_ACCOUNT_ID == "default"


def test_next_capital_history():
    """資金が変わったときだけ末尾に足し、末尾の 1000 件に切る。入力を書き換えない"""
    h = [{"valueYen": 1, "at": 1}]
    assert next_capital_history(h, 1, 1, 9) == h
    got = next_capital_history(h, 1, 2, 9)
    assert got == [{"valueYen": 1, "at": 1}, {"valueYen": 2, "at": 9}] and len(h) == 1
    assert next_capital_history([], None, None, 9) == []
    assert next_capital_history([], 5, None, 9) == [{"valueYen": None, "at": 9}]
    long = [{"valueYen": i, "at": i} for i in range(1000)]
    assert next_capital_history(long, 999, 5000, 9)[0]["valueYen"] == 1


# ── M1〜M3（API）────────────────────────────


def test_m1_migrates_settings_without_touching_trades(api, clock, capfd):
    """M1: 口座は 1 つ（口座 1・1,000,000・1.5%・履歴 2 件）。取引・設定の文書は読む前後で同じ（書き換えない）"""
    trades = legacy_world(api, clock)
    trades_before = raw_docs(api, A, "trades")
    settings_before = raw_docs(api, A, "settings")
    capfd.readouterr()
    items = api.get("/api/accounts", A).get_json()["items"]
    assert len(items) == 1
    one = items[0]
    assert (one["id"], one["name"], one["capitalYen"], one["riskTolerancePct"]) == ("default", "口座 1", 1_000_000,
                                                                                    1.5)  # fmt: skip
    assert [h["valueYen"] for h in one["capitalHistory"]] == [800_000, 1_000_000]
    assert raw_docs(api, A, "trades") == trades_before
    assert raw_docs(api, A, "settings") == settings_before
    # 取引は口座 1 に属して見え（accountId 無し = 既定）、snapshot は移す前のまま（1R・リスク（%）・判定が同じ）
    for t in trades:
        got = api.get(f"/api/trades/{t['id']}", A).get_json()
        assert got == t
        assert account_id_of(got["record"]) == "default"
    # ログは作ったときに 1 回だけ（真偽と件数だけ。金額・名前・uid を出さない）
    _out, err = capfd.readouterr()
    lines = [json.loads(x) for x in err.splitlines() if "default_account_created" in x]
    assert lines == [{"event": "default_account_created", "fromSettings": True, "history": 2}]
    assert "1000000" not in err and "口座" not in err and A not in err
    # 2 回目は書かない
    api.get("/api/accounts", A)
    _out, err = capfd.readouterr()
    assert "default_account_created" not in err


@pytest.mark.parametrize("settings", [None, {"capitalYen": None, "riskTolerancePct": 2, "performanceUnit": "yen"}])
def test_m2_no_capital_or_no_settings(api, settings):
    """M2: 設定に資金が無い / 設定そのものが無い（新しい利用者）→ 口座 1 つ（資金 未設定・許容は設定の値か 1%）"""
    if settings is not None:
        api.put("/api/settings", A, settings)
    items = api.get("/api/accounts", A).get_json()["items"]
    assert len(items) == 1
    assert items[0]["name"] == "口座 1" and items[0]["capitalYen"] is None
    assert items[0]["riskTolerancePct"] == (1 if settings is None else 2)
    # 設定は書かない（無かった利用者には設定の文書を作らない）
    assert (raw_docs(api, A, "settings") == {}) == (settings is None)


def test_m3_repeated_entries_make_one_account(api, clock):
    """M3: 口座を読む・使う入口を何度通っても既定の口座は 1 つ（作った時刻も最初のまま）"""
    legacy_world(api, clock)
    first = api.get("/api/accounts/default", A).get_json()
    clock.advance(1000)
    inst = api.instrument(A, "架空指数B")
    api.post("/api/trades", A, t1(inst["id"]))
    api.post("/api/accounts", A, {"name": "口座 B"})
    api.get("/api/accounts", A)
    items = api.get("/api/accounts", A).get_json()["items"]
    assert [x["id"] for x in items].count("default") == 1
    assert next(x for x in items if x["id"] == "default") == first


def test_m3_concurrent_reads_make_one_account(api, clock):
    """M3: 移す前の利用者に 8 本の同時の GET /api/accounts（と取引の作成）→ 口座は 1 つ。取引は書き換えない"""
    trades = legacy_world(api, clock)
    trades_before = {t["id"]: t for t in trades}
    barrier = threading.Barrier(8)
    statuses: list[int] = []
    inst_id = trades[0]["record"]["instrumentId"]

    def run(i: int):
        client = api.app.test_client()
        barrier.wait()
        if i % 4 == 3:
            res = client.post("/api/trades", json=t1(inst_id), headers=api.headers(A))
        else:
            res = client.get("/api/accounts", headers=api.headers(A))
        statuses.append(res.status_code)

    threads = [threading.Thread(target=run, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(set(statuses)) <= [200, 201], statuses
    docs = raw_docs(api, A, "accounts")
    assert list(docs) == ["default"]
    if api.kind == "memory":
        assert api.store.default_created == 1
    for tid, t in trades_before.items():
        assert api.get(f"/api/trades/{tid}", A).get_json() == t
    # 同時に作った取引も既定の口座の値（1,000,000・1.5%）を写す
    for t in api.trades(A):
        assert t["snapshot"]["capitalYen"] == 1_000_000 and t["snapshot"]["riskTolerancePct"] == 1.5


def test_update_default_before_it_exists(api):
    """移す前の利用者が最初に口座 1 を直す（PUT）→ 作って直した値が 1 回で入る"""
    api.put("/api/settings", A, SETTINGS)
    res = api.put("/api/accounts/default", A, {"name": "口座 1", "capitalYen": 900_000, "riskTolerancePct": 1})
    assert res.status_code == 200
    got = res.get_json()
    assert got["capitalYen"] == 900_000
    # 設定の履歴（1 件）を写した上に、直した 1 件が足される
    assert [h["valueYen"] for h in got["capitalHistory"]] == [1_000_000, 900_000]
    assert len(api.get("/api/accounts", A).get_json()["items"]) == 1


def test_build_default_now_uses_current_time():
    doc = accounts.build_default_now(None)
    assert doc["createdAt"] == doc["updatedAt"] and doc["createdAt"] > 1_700_000_000_000


def test_with_default_retries_read_abort_once(monkeypatch):
    """トランザクションの中の読みで出た Aborted（SDK は commit の Aborted しか再試行しない）は 1 回だけやり直し、
    2 回続けば Aborted のまま上げる（_guard が 503 にする）。既定の口座が無ければ作ってからやり直すのは 1 回だけ"""
    from google.api_core import exceptions as gexc

    from loss_note_api.store import FirestoreStore, StoreUnavailable, _NeedDefault

    store = FirestoreStore("demo-loss-note")
    ensured: list[str] = []
    monkeypatch.setattr(store, "_ensure_default", lambda uid, build: ensured.append(uid))

    def run(outcomes):
        seq = list(outcomes)

        def fake_transaction(body):
            o = seq.pop(0)
            if isinstance(o, BaseException):
                raise o
            return o

        monkeypatch.setattr(store, "_transaction", fake_transaction)
        return store._with_default(A, None, None), seq

    # 読みの Aborted → やり直して成功
    assert run([gexc.Aborted("x"), "ok"]) == ("ok", [])
    # 既定の口座が無い → 作る → 読みの Aborted → やり直して成功
    ensured.clear()
    assert run([_NeedDefault(), gexc.Aborted("x"), "ok"]) == ("ok", [])
    assert ensured == [A]
    # Aborted が 2 回続けば上げる
    with pytest.raises(gexc.Aborted):
        run([gexc.Aborted("x"), gexc.Aborted("y"), "unused"])
    # 作った後も既定の口座が無いなら 503 の側
    with pytest.raises(StoreUnavailable):
        run([_NeedDefault(), _NeedDefault(), "unused"])


def test_failed_trade_create_still_leaves_default_account(memory_api):
    """取引の作成がチャートの書き込みで失敗しても、移し替えで作った既定の口座は残る（FirestoreStore と同じ順。
    冪等の 1 文書で、取引・チャートは何も残らない）"""
    from helpers.charts import chart_png, post_with_charts

    api = memory_api
    iid = api.instrument(A)["id"]
    api.store.fail_charts = True
    res = post_with_charts(api, A, t1(iid, entryChartTimeframe="4h"), {"entry": (chart_png(), "image/png")})
    assert res.status_code == 503
    assert api.trades(A) == []
    assert list(api.store.users[A]["accounts"]) == [DEFAULT_ACCOUNT_ID]
    assert api.store.default_created == 1
