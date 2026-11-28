"""知らない版の取引の文書を直させない守り（Issue #115。ADR-0020 の決定 7 の (a)・設計書 4.7）。

保存済みの ``schemaVersion`` がこの版の知る値（``trade_version.SCHEMA_VERSION``。#116 から 2）より大きい
取引への書き込み = 取引の PUT（口座の付け替え・
``?snapshot=current``・multipart のチャートの変更を含む同じ入口）・チャートの PUT・DELETE を 409 で拒む。
版の確かめは保存先のトランザクションの中で、読んだ文書に対して行う（銘柄・口座を読む前・mutate の前）。
保存先 2 つ（記憶・エミュレーターの Firestore）で同じテストを回す。値・画像はすべて架空。
"""

import json
import logging

import pytest
from helpers.charts import chart_parts, chart_png, encode_multipart, post_with_charts
from helpers.records import t1

from loss_note_api import charts, logs, trade_version
from loss_note_api.store import UnknownSchemaVersion

A = "versionUserA"
B = "versionUserB"
CONFLICT = {"error": "conflict", "reason": "unknownSchemaVersion"}
# この版の知らない版（#116 でこの版は足の版 2 を知るので、知らない版は 3）
NEWER = trade_version.SCHEMA_VERSION + 1


# ── 生の文書の読み書き（API を通さない） ──


def trade_ref(api, uid: str, tid: str):
    return api.store._db().collection("users").document(uid).collection("trades").document(tid)


def raw_trade(api, uid: str, tid: str) -> dict:
    if api.kind == "memory":
        return json.loads(json.dumps(api.store.users[uid]["trades"][tid], sort_keys=True))
    return json.loads(json.dumps(trade_ref(api, uid, tid).get().to_dict(), sort_keys=True, default=str))


def raw_charts(api, uid: str) -> dict:
    if api.kind == "memory":
        col = api.store.users.get(uid, {}).get("charts", {})
        return {k: bytes(v["data"]) for k, v in col.items()}
    col = api.store._db().collection("users").document(uid).collection("charts")
    return {s.id: bytes(s.to_dict()["data"]) for s in col.stream()}


def set_version(api, uid: str, tid: str, version, legs: bool = True) -> None:
    """保存済みの取引を新しい版の文書に見立てる（版と、この版の知らない欄）"""
    extra = {"futureField": [{"kind": "put", "side": "S"}]} if legs else {}
    if api.kind == "memory":
        api.store.users[uid]["trades"][tid].update({"schemaVersion": version, **extra})
    else:
        trade_ref(api, uid, tid).update({"schemaVersion": version, **extra})


def e1(iid: str, **over) -> dict:
    return t1(iid, **{"entryChartTimeframe": "4h", "exitChartTimeframe": "4h", **over})


@pytest.fixture
def iid(api):
    return api.instrument(A)["id"]


@pytest.fixture
def newer(api, iid):
    """チャート 2 枚つきの取引を作り、版をこの版の知らない版（NEWER）にする。
    (取引の ID, 前の取引の文書, 前のチャート)"""
    imgs = {"entry": (chart_png(), "image/png"), "exit": (chart_png(), "image/png")}
    res = post_with_charts(api, A, e1(iid), imgs)
    assert res.status_code == 201, res.get_json()
    tid = res.get_json()["id"]
    set_version(api, A, tid, NEWER)
    return tid, raw_trade(api, A, tid), raw_charts(api, A)


def unchanged(api, newer) -> bool:
    tid, doc, chart_docs = newer
    return raw_trade(api, A, tid) == doc and raw_charts(api, A) == chart_docs


def put_multipart(api, tid: str, parts, query: str = ""):
    body, ctype = encode_multipart(parts)
    return api.call("PUT", f"/api/trades/{tid}{query}", A, raw=body, content_type=ctype)


# ── 純関数（AC-6） ──


@pytest.mark.parametrize("version", [2, 1, 0])
def test_known_versions(version):
    assert trade_version.is_known({"schemaVersion": version})


@pytest.mark.parametrize("version", [3, 99, "1", "2", 1.0, 2.0, True, None])
def test_unknown_versions(version):
    """int（bool を除く）で 2 以下のときだけ知る版。形の崩れた値も知らない版として上書きしない"""
    assert not trade_version.is_known({"schemaVersion": version})


def test_missing_version_is_unknown():
    assert not trade_version.is_known({})


def test_schema_version_value():
    """この版の知る値は 2（#116。足を持つ取引の版。足の無い取引には今どおり 1 を書く = test_v1_unchanged）"""
    assert trade_version.SCHEMA_VERSION == 2


# ── 取引の PUT（AC-1・AC-2） ──


def test_put_json_conflict(api, iid, newer):
    """AC-1: 本文は正しい（前の版の画面が送る形）が、保存済みが知らない版 → 409・何も書かない"""
    res = api.put(f"/api/trades/{newer[0]}", A, e1(iid, thesis="直した"))
    assert res.status_code == 409
    assert res.get_json() == CONFLICT
    assert unchanged(api, newer)


def test_put_reassign_account_conflict(api, iid, newer):
    """AC-2: 口座の付け替え（別の口座）も同じ入口で 409。付け替え先の口座の値で写し直さない"""
    acc = api.post("/api/accounts", A, {"name": "架空の口座B", "capitalYen": 2_000_000}).get_json()
    before = raw_trade(api, A, newer[0])
    res = api.put(f"/api/trades/{newer[0]}", A, e1(iid, accountId=acc["id"]))
    assert res.status_code == 409 and res.get_json() == CONFLICT
    assert raw_trade(api, A, newer[0]) == before


def test_put_snapshot_current_conflict(api, iid, newer):
    """AC-2: ?snapshot=current（今の値で写し直す）も 409"""
    res = api.put(f"/api/trades/{newer[0]}?snapshot=current", A, e1(iid))
    assert res.status_code == 409 and res.get_json() == CONFLICT
    assert unchanged(api, newer)


def test_put_multipart_conflict(api, iid, newer):
    """AC-2: multipart のチャートの差し替え・外すも 409。取引もチャートも前のまま"""
    rec = e1(iid)
    rec.pop("exitChartTimeframe")
    parts = chart_parts(rec, {"entry": (chart_png(b"NEW-9f"), "image/png")})
    parts.append((charts.REMOVE_PART, "exit", None, None))
    res = put_multipart(api, newer[0], parts)
    assert res.status_code == 409 and res.get_json() == CONFLICT
    assert unchanged(api, newer)


def test_put_conflict_before_missing_instrument_and_account(api, iid, newer):
    """AC-4: 銘柄・口座を読む前に止める（無い銘柄・無い口座の本文でも 400 notFound でなく 409。既定の口座も作らない）"""
    res = api.put(f"/api/trades/{newer[0]}", A, e1("noSuchInstrument"))
    assert res.status_code == 409 and res.get_json() == CONFLICT
    res = api.put(f"/api/trades/{newer[0]}", A, e1(iid, accountId="noSuchAccount"))
    assert res.status_code == 409 and res.get_json() == CONFLICT
    assert unchanged(api, newer)


# ── チャートの PUT・DELETE（AC-3） ──


def test_put_chart_conflict(api, newer):
    res = api.call("PUT", f"/api/trades/{newer[0]}/charts/entry", A, raw=chart_png(b"NEW-9f"),
                   content_type="image/png")  # fmt: skip
    assert res.status_code == 409 and res.get_json() == CONFLICT
    assert unchanged(api, newer)


def test_put_chart_new_slot_conflict(api, newer):
    """付属の枠（まだ無い枠）を足すのも 409"""
    res = api.call("PUT", f"/api/trades/{newer[0]}/charts/x1", A, raw=chart_png(), content_type="image/png")
    assert res.status_code == 409 and res.get_json() == CONFLICT
    assert unchanged(api, newer)


@pytest.mark.parametrize("slot", ["exit", "x1"])
def test_delete_chart_conflict(api, newer, slot):
    """チャートのある枠も、無い枠も、知らない版なら 409（枠の有無より先に版を見る）"""
    res = api.delete(f"/api/trades/{newer[0]}/charts/{slot}", A)
    assert res.status_code == 409 and res.get_json() == CONFLICT
    assert unchanged(api, newer)


@pytest.mark.parametrize("version", [99, "2"])
def test_other_unknown_versions_conflict(api, iid, newer, version):
    """AC-6: もっと大きい版や形の崩れた版も 409"""
    set_version(api, A, newer[0], version)
    before = raw_trade(api, A, newer[0])
    assert api.put(f"/api/trades/{newer[0]}", A, e1(iid)).status_code == 409
    assert api.delete(f"/api/trades/{newer[0]}/charts/exit", A).status_code == 409
    assert raw_trade(api, A, newer[0]) == before


# ── 変えないこと ──


def test_v1_unchanged(api, iid):
    """KEEP-1: 版 1 の取引の PUT・付け替え・?snapshot=current・チャートの PUT / DELETE は今どおり 200"""
    created = post_with_charts(api, A, e1(iid), {"entry": (chart_png(), "image/png"),
                                                  "exit": (chart_png(), "image/png")}).get_json()  # fmt: skip
    tid = created["id"]
    assert created["schemaVersion"] == 1
    res = api.put(f"/api/trades/{tid}", A, e1(iid, thesis="直した"))
    assert res.status_code == 200 and res.get_json()["record"]["thesis"] == "直した"
    acc = api.post("/api/accounts", A, {"name": "架空の口座B", "capitalYen": 2_000_000}).get_json()
    res = api.put(f"/api/trades/{tid}?snapshot=current", A, e1(iid, accountId=acc["id"]))
    assert res.status_code == 200 and res.get_json()["snapshot"]["capitalYen"] == 2_000_000
    res = api.call("PUT", f"/api/trades/{tid}/charts/entry", A, raw=chart_png(b"NEW-9f"), content_type="image/png")
    assert res.status_code == 200
    res = api.delete(f"/api/trades/{tid}/charts/exit", A)
    assert res.status_code == 200 and set(res.get_json()["charts"]) == {"entry"}
    assert res.get_json()["schemaVersion"] == 1


def test_v2_read_and_delete_unchanged(api, newer):
    """KEEP-3: 知らない版の取引の GET・一覧は今のまま読め、取引ごと消すのは今どおり 204
    （知らない欄を落とすことにならない）"""
    tid = newer[0]
    res = api.get(f"/api/trades/{tid}", A)
    assert res.status_code == 200 and res.get_json()["schemaVersion"] == NEWER
    assert [t["id"] for t in api.trades(A)] == [tid]
    assert api.delete(f"/api/trades/{tid}", A).status_code == 204
    assert api.get(f"/api/trades/{tid}", A).status_code == 404


def test_not_found_before_version(api, iid, newer):
    """KEEP-3: 無い取引・ほかの利用者の取引は 404（409 で存在を漏らさない）"""
    api.instrument(B)
    assert api.put(f"/api/trades/{newer[0]}", B, e1(iid)).status_code == 404
    assert api.call("PUT", f"/api/trades/{newer[0]}/charts/entry", B, raw=chart_png(),
                    content_type="image/png").status_code == 404  # fmt: skip
    assert api.delete(f"/api/trades/{newer[0]}/charts/entry", B).status_code == 404
    assert api.put("/api/trades/noSuchTrade", A, e1(iid)).status_code == 404
    assert unchanged(api, newer)


# ── 保存先: トランザクションの中で確かめる（AC-4） ──


def never(*_args):
    raise AssertionError("mutate を呼んではいけない")


def test_store_checks_before_mutate(api, iid, newer):
    """保存先の 3 つの書き込みは、トランザクションの中で読んだ文書の版を見て、mutate を呼ばずに UnknownSchemaVersion を
    投げる（API の入口は保存先の外で版を読まない。読み → 確かめ → 書きが 1 つのトランザクション）。
    エミュレーターの Firestore はトランザクションが読んだ文書をロックするので、途中で外から書き換える試験は
    ロック待ちの時間切れになり作れない（handoff の phase-3.md）"""
    tid = newer[0]
    with pytest.raises(UnknownSchemaVersion):
        api.store.update_trade(A, tid, iid, None, never)
    with pytest.raises(UnknownSchemaVersion):
        api.store.update_trade(A, tid, iid, "other", never, refresh=True, charts={"exit": None})
    with pytest.raises(UnknownSchemaVersion):
        api.store.put_chart(A, tid, "entry", {"data": b"x", "contentType": "image/png"}, never)
    with pytest.raises(UnknownSchemaVersion):
        api.store.delete_chart(A, tid, "exit", never)
    assert unchanged(api, newer)


# ── 確かめを書き込みの外へ移す退行を捕まえる ──


def racing(api, uid: str, tid: str, name: str):
    """保存先の書き込みの入口に入った直後（トランザクション / ロックの前）に、別の書き手が版を知らない版にした
    場面を作る。
    API の入口や保存先の外で版を先に読んで確かめる形に退行すると、v1 と見て書いてしまい 200 になる"""
    original = getattr(api.store, name)

    def wrapped(*args, **kw):
        set_version(api, uid, tid, NEWER)
        return original(*args, **kw)

    return wrapped


RACING_CALLS = [
    ("update_trade", lambda api, iid, tid: api.put(f"/api/trades/{tid}", A, e1(iid, thesis="古い版の上書き"))),
    ("put_chart", lambda api, iid, tid: api.call("PUT", f"/api/trades/{tid}/charts/entry", A,
                                                 raw=chart_png(b"NEW-9f"), content_type="image/png")),
    ("delete_chart", lambda api, iid, tid: api.delete(f"/api/trades/{tid}/charts/exit", A)),
]  # fmt: skip


@pytest.mark.parametrize(("name", "call"), RACING_CALLS, ids=[c[0] for c in RACING_CALLS])
def test_version_written_just_before_store_write(api, iid, monkeypatch, name, call):
    """入口の検査の後・保存先の書き込みの前に版が知らない版になっても 409
    （確かめは書き込みと同じ所で読んだ文書に対して）"""
    imgs = {"entry": (chart_png(), "image/png"), "exit": (chart_png(), "image/png")}
    tid = post_with_charts(api, A, e1(iid), imgs).get_json()["id"]
    monkeypatch.setattr(api.store, name, racing(api, A, tid, name))
    before_charts = raw_charts(api, A)
    res = call(api, iid, tid)
    assert res.status_code == 409 and res.get_json() == CONFLICT
    doc = raw_trade(api, A, tid)
    assert doc["schemaVersion"] == NEWER and "futureField" in doc
    assert doc["record"].get("thesis") != "古い版の上書き"
    assert raw_charts(api, A) == before_charts


def test_firestore_reads_trade_in_transaction(api, iid, newer, monkeypatch):
    """Firestore: 版を確かめる取引の読みは、すべてトランザクションつき（transaction= なしの読みへの退行を捕まえる。
    エミュレーターはトランザクションの読みをロックするので、読みと書きの間に外から書き換える試験は作れない）"""
    if api.kind != "firestore":
        pytest.skip("Firestore の読みの形")
    from google.cloud.firestore_v1.document import DocumentReference

    reads: list[bool] = []
    original = DocumentReference.get

    def spy(self, *args, **kw):
        if self.parent.id == "trades":
            reads.append(kw.get("transaction") is not None)
        return original(self, *args, **kw)

    monkeypatch.setattr(DocumentReference, "get", spy)
    tid = newer[0]
    statuses = [
        api.put(f"/api/trades/{tid}", A, e1(iid)).status_code,
        api.call("PUT", f"/api/trades/{tid}/charts/entry", A, raw=chart_png(), content_type="image/png").status_code,
        api.delete(f"/api/trades/{tid}/charts/exit", A).status_code,
    ]
    monkeypatch.undo()
    assert statuses == [409, 409, 409]
    assert reads and all(reads), reads


def test_conflict_logs_count_only(api, iid, newer, caplog, monkeypatch):
    """409 のときは件数を数えるためのログを 1 行（経路の形と方法だけ。取引の ID・uid・本文は出さない）"""
    caplog.set_level(logging.DEBUG)
    monkeypatch.setattr(logs.logger, "propagate", True)
    tid = newer[0]
    api.put(f"/api/trades/{tid}", A, e1(iid, thesis="MARKER-版-7c1"))
    api.delete(f"/api/trades/{tid}/charts/exit", A)
    # 同じ記録が caplog に 2 度入ることがある（ロガーの handler と根の両方に流れる）ので、記録ごとに 1 つに数える
    unique = list({(r.created, r.getMessage()): r for r in caplog.records}.values())
    events = [json.loads(r.getMessage()) for r in unique if "trade_unknown_version" in r.getMessage()]
    assert events == [
        {"event": "trade_unknown_version", "route": "/api/trades/<path:trade_id>", "method": "PUT"},
        {"event": "trade_unknown_version", "route": "/api/trades/<path:trade_id>/charts/<slot>", "method": "DELETE"},
    ]
    assert tid not in caplog.text and A not in caplog.text and "MARKER-版-7c1" not in caplog.text
