"""両建てのまとまり（Issue #266・設計書 C75・C76・C80・4.8・6.5・ADR-0027）の保存と入口。

``users/{uid}/positionGroups/{id}`` と取引の文書の最上位の逆参照 ``positionGroupId``。結ぶ・直す・解く・一覧、
取引の PUT・DELETE・範囲の一覧・書き出しの追従。AC-1〜AC-12・KEEP-1。
保存先 2 つ（記憶・エミュレーターの Firestore）で回す。値はすべて架空（本玉 = 先物 L、決済の代わり = CFD S）。
"""

import copy
import json

import pytest
from helpers.charts import chart_png
from helpers.records import load_fixture, put_default_account, t1

from loss_note_api import position_groups, schema

A = "groupUserA"
B = "groupUserB"
PATH = "/api/position-groups"
H = 3_600_000
# 金曜の夜に固定して月曜に外した（架空の時刻）
FRI = 1_763_700_000_000
MON = FRI + 60 * H


# ── 道具 ──


def group_ref(api, uid: str, gid: str):
    return api.store._db().collection("users").document(uid).collection("positionGroups").document(gid)


def trade_ref(api, uid: str, tid: str):
    return api.store._db().collection("users").document(uid).collection("trades").document(tid)


def raw_trade(api, uid: str, tid: str) -> dict | None:
    if api.kind == "memory":
        doc = api.store.users.get(uid, {}).get("trades", {}).get(tid)
    else:
        snap = trade_ref(api, uid, tid).get()
        doc = snap.to_dict() if snap.exists else None
    return None if doc is None else json.loads(json.dumps(doc, sort_keys=True))


def raw_groups(api, uid: str) -> dict[str, dict]:
    if api.kind == "memory":
        return copy.deepcopy(api.store.users.get(uid, {}).get("positionGroups", {}))
    col = api.store._db().collection("users").document(uid).collection("positionGroups")
    return {s.id: s.to_dict() for s in col.stream()}


def set_group_version(api, uid: str, gid: str, version) -> None:
    extra = {"schemaVersion": version, "futureField": {"kind": "x"}}
    if api.kind == "memory":
        api.store.users[uid]["positionGroups"][gid].update(extra)
    else:
        group_ref(api, uid, gid).update(extra)


@pytest.fixture
def iids(api):
    return setup_iids(api)


def setup_iids(api) -> dict:
    """先物（乗数 1,000）と CFD（乗数 10）の銘柄"""
    put_default_account(api, A, {"capitalYen": 30_000_000, "riskTolerancePct": 1})
    fut = api.instrument(A, "XYZ 先物", productForm="future", multiplier=1000)["id"]
    cfd = api.instrument(A, "XYZ CFD", productForm="spotCfd", multiplier=10)["id"]
    return {"fut": fut, "cfd": cfd}


def future(iid: str, **over) -> dict:
    """本玉: 先物 L 1 枚・イン 38,000・LC 37,700・月曜の寄りで決済"""
    body = t1(iid, lc=37_700, entries=[{"time": FRI - 10 * H, "price": 38_000, "quantity": 1, "lc": 37_700}],
              exit={"time": MON, "price": 38_400, "reason": "other"}, statementPnlYen=400_000)  # fmt: skip
    body.update(over)
    return body


def cfd(iid: str, side: str = "S", **over) -> dict:
    """決済の代わり: CFD S 100 を金曜の夜に 38,450 で建て、月曜の寄りで外した"""
    body = t1(iid, side=side, lc=None, lcDecidedBeforeEntry=False,
              entries=[{"time": FRI, "price": 38_450, "quantity": 100}],
              exit={"time": MON + 1000, "price": 38_400, "reason": "other"}, statementPnlYen=50_000)  # fmt: skip
    body.pop("lc")
    body.update(over)
    return body


def make(api, body: dict, uid: str = A) -> str:
    res = api.post("/api/trades", uid, body)
    assert res.status_code == 201, res.get_json()
    return res.get_json()["id"]


def pair(api, iids) -> tuple[str, str]:
    return make(api, future(iids["fut"])), make(api, cfd(iids["cfd"]))


def members(*pairs: tuple[str, str]) -> list[dict]:
    return [{"tradeId": tid, "role": role} for tid, role in pairs]


def link(api, mems: list[dict], uid: str = A, **extra):
    return api.post(PATH, uid, {"members": mems, **extra})


def linked(api, mems: list[dict], **extra) -> dict:
    res = link(api, mems, **extra)
    assert res.status_code == 201, res.get_json()
    return res.get_json()


def trade(api, tid: str, uid: str = A) -> dict:
    res = api.get(f"/api/trades/{tid}", uid)
    assert res.status_code == 200
    return res.get_json()


def body_of(stored: dict) -> dict:
    """取引の応答 → 取引の PUT の本文（record をそのまま）"""
    return copy.deepcopy(stored["record"])


def assert_nothing_linked(api, *tids: str) -> None:
    assert raw_groups(api, A) == {}
    for tid in tids:
        assert position_groups.KEY not in raw_trade(api, A, tid)


# ── 検査の純関数 ──


def test_validate_accepts_members_and_exit():
    value, issues, bad = schema.validate_position_group(
        {"members": members(("t1", "main"), ("t2", "hedge")), "exit": {"price": 38_440, "orderType": "stop"}}
    )
    assert (issues, bad) == ([], False)
    want = {"members": members(("t1", "main"), ("t2", "hedge")), "exit": {"price": 38_440, "orderType": "stop"}}
    assert value == want


def test_validate_empty_exit_is_dropped():
    value, _, _ = schema.validate_position_group({"members": members(("t1", "main"), ("t2", "hedge")), "exit": {}})
    assert value == {"members": members(("t1", "main"), ("t2", "hedge"))}


@pytest.mark.parametrize(
    ("body", "issue"),
    [
        ({"members": members(("t1", "main"))}, {"field": "members", "kind": "count"}),
        ({"members": members(*[(f"t{i}", "main" if i else "hedge") for i in range(11)])},
         {"field": "members", "kind": "count"}),  # fmt: skip
        ({"members": members(("t1", "main"), ("t1", "hedge"))}, {"field": "members", "kind": "duplicate"}),
        ({"members": members(("t1", "main"), ("t2", "main"))}, {"field": "members", "kind": "roles"}),
        ({"members": members(("t1", "hedge"), ("t2", "hedge"))}, {"field": "members", "kind": "roles"}),
        ({"members": members(("t1", "main"), ("t2", "x"))}, {"field": "members[1].role", "kind": "enum"}),
        ({"members": [{"tradeId": "t1", "role": "main"}, {"role": "hedge"}]},
         {"field": "members[1].tradeId", "kind": "required"}),  # fmt: skip
        ({"members": [{"tradeId": "t1", "role": "main"}, {"tradeId": "t2"}]},
         {"field": "members[1].role", "kind": "required"}),  # fmt: skip
        ({"members": "t1"}, {"field": "members", "kind": "type"}),
        ({}, {"field": "members", "kind": "required"}),
        # AC-12: 上書きの検査
        ({"members": members(("t1", "main"), ("t2", "hedge")), "exit": {"price": 0}},
         {"field": "exit.price", "kind": "range"}),  # fmt: skip
        ({"members": members(("t1", "main"), ("t2", "hedge")), "exit": {"price": "38440"}},
         {"field": "exit.price", "kind": "type"}),  # fmt: skip
        ({"members": members(("t1", "main"), ("t2", "hedge")), "exit": {"orderType": "unknown"}},
         {"field": "exit.orderType", "kind": "enum"}),  # fmt: skip
        ({"members": members(("t1", "main"), ("t2", "hedge")), "exit": {"orderType": "expiry"}},
         {"field": "exit.orderType", "kind": "enum"}),  # fmt: skip
        ({"members": members(("t1", "main"), ("t2", "hedge")), "exit": {"reason": "hedge"}},
         {"field": "exit.reason", "kind": "enum"}),  # fmt: skip
        ({"members": members(("t1", "main"), ("t2", "hedge")), "exit": {"time": 1}},
         {"field": "exit", "kind": "unknownField"}),  # fmt: skip
        ({"members": members(("t1", "main"), ("t2", "hedge")), "x": 1}, {"field": "", "kind": "unknownField"}),
    ],
)
def test_validate_rejects(body, issue):
    value, issues, bad = schema.validate_position_group(body)
    assert value is None and not bad
    assert issue in issues


@pytest.mark.parametrize("bad_id", ["a/b", "..", "x" * 41, 1, ""])
def test_validate_bad_trade_id_is_not_found(bad_id):
    body = {"members": [{"tradeId": "t1", "role": "main"}, {"tradeId": bad_id, "role": "hedge"}]}
    value, issues, bad = schema.validate_position_group(body)
    assert (value, issues, bad) == (None, [], True)


def test_validate_accepts_exit_reasons():
    for reason in schema.EXIT_REASONS:
        value, issues, _ = schema.validate_position_group(
            {"members": members(("t1", "main"), ("t2", "hedge")), "exit": {"reason": reason}}
        )
        assert issues == [] and value["exit"] == {"reason": reason}


def test_span_and_overlaps():
    g = {"members": [{"entryTime": 100, "exitTime": 300}, {"entryTime": None, "exitTime": 200}]}
    assert position_groups.span(g) == (100, 300)
    assert position_groups.overlaps(g, 300, 400)  # 最後の決済ちょうどは範囲の開始に入る
    assert not position_groups.overlaps(g, 301, 400)
    assert position_groups.overlaps(g, 0, 101)
    assert not position_groups.overlaps(g, 0, 100)  # 範囲の終わりは含まない
    assert position_groups.span({"members": []}) is None


def test_after_trade_removed_rules():
    mems = members(("m1", "main"), ("m2", "main"), ("h1", "hedge"))
    g = {"schemaVersion": 1, "updatedAt": 5, "members": mems}
    action, new = position_groups.after_trade_removed(g, "m1", 1)
    assert action == "write" and [m["tradeId"] for m in new["members"]] == ["m2", "h1"] and new["updatedAt"] == 6
    assert position_groups.after_trade_removed(g, "h1", 1) == ("delete", None)
    assert position_groups.after_trade_removed(g, "other", 1) == ("skip", None)
    assert position_groups.after_trade_removed({**g, "schemaVersion": 2}, "m1", 1) == ("skip", None)


# ── 結ぶ（AC-1） ──


def test_link_round_trip(api, iids):
    """R1: まとまりと両方の逆参照が 1 回の要求で保存され、一覧・取引の応答で読み戻せる"""
    f, c = pair(api, iids)
    sf, sc = trade(api, f), trade(api, c)
    got = linked(api, members((f, "main"), (c, "hedge")), exit={"price": 38_440, "orderType": "stop"})
    gid = got["id"]
    assert got["schemaVersion"] == 1
    assert got["members"] == [
        {"tradeId": f, "role": "main", "entryTime": FRI - 10 * H, "exitTime": MON},
        {"tradeId": c, "role": "hedge", "entryTime": FRI, "exitTime": MON + 1000},
    ]
    assert got["exit"] == {"price": 38_440, "orderType": "stop"}
    assert got["createdAt"] == got["updatedAt"]
    # 取引の応答に逆参照。record・snapshot・版は変わらない（AC-8 の一部）
    for tid, before in ((f, sf), (c, sc)):
        after = trade(api, tid)
        assert after[position_groups.KEY] == gid
        assert {k: after[k] for k in ("record", "snapshot", "schemaVersion", "createdAt")} == {
            k: before[k] for k in ("record", "snapshot", "schemaVersion", "createdAt")}  # fmt: skip
        assert after["updatedAt"] > before["updatedAt"]
    # 一覧
    res = api.get(PATH, A)
    assert res.status_code == 200
    assert res.get_json() == {"items": [got], "truncated": False}
    # 保存の形
    stored = raw_groups(api, A)[gid]
    assert set(stored) == {"schemaVersion", "members", "exit", "createdAt", "updatedAt"}


def test_link_three_members_same_account(api, iids):
    """同じ口座・3 件以上・本玉が複数も同じ形（C76）"""
    m1 = make(api, future(iids["fut"]))
    m2 = make(api, future(iids["fut"], entries=[{"price": 38_100, "quantity": 2}]))
    h = make(api, cfd(iids["cfd"]))
    got = linked(api, members((m1, "main"), (h, "hedge"), (m2, "main")))
    assert [m["tradeId"] for m in got["members"]] == [m1, h, m2]  # 結んだ順
    assert got["members"][2]["entryTime"] is None  # エントリーに時刻が無ければ null
    assert "exit" not in got
    for tid in (m1, m2, h):
        assert trade(api, tid)[position_groups.KEY] == got["id"]


def test_list_is_newest_first(api, iids, clock):
    f1, c1 = pair(api, iids)
    f2, c2 = pair(api, iids)
    g1 = linked(api, members((f1, "main"), (c1, "hedge")))
    clock.advance(10)
    g2 = linked(api, members((f2, "main"), (c2, "hedge")))
    assert [g["id"] for g in api.get(PATH, A).get_json()["items"]] == [g2["id"], g1["id"]]


# ── 形の誤り（AC-2） ──


def test_shape_errors_write_nothing(api, iids):
    """R2: 向き・足の誤りは 400 で、まとまりも逆参照も書かない"""
    f, c = pair(api, iids)
    long_cfd = make(api, cfd(iids["cfd"], side="L"))
    short_fut = make(api, future(iids["fut"], side="S", lc=38_300,
                                 entries=[{"price": 38_000, "quantity": 1, "lc": 38_300}]))  # fmt: skip
    cases = [
        (members((f, "main"), (long_cfd, "hedge")), [{"field": "members[1].role", "kind": "side"}]),
        (members((f, "main"), (short_fut, "main"), (c, "hedge")), [{"field": "members", "kind": "mainSide"}]),
    ]
    for mems, issues in cases:
        res = link(api, mems)
        assert res.status_code == 400, res.get_json()
        assert res.get_json() == {"error": "invalid", "issues": issues}
    for body in ({"members": members((f, "main"))}, {"members": members((f, "main"), (f, "hedge"))},
                 {"members": members((f, "main"), (c, "main"))}):  # fmt: skip
        assert link(api, body["members"]).status_code == 400
    assert_nothing_linked(api, f, c, long_cfd, short_fut)


def test_trade_with_legs_cannot_be_member(api, iids):
    fx = load_fixture("option-legs.json")
    item = next(x for x in fx["items"] if x["name"] == "P1")
    opt = api.instrument(A, item["instrument"]["name"], **{k: v for k, v in item["instrument"].items() if k != "name"})
    body = copy.deepcopy(item["record"])
    body["instrumentId"] = opt["id"]
    leg_trade = make(api, body)
    side = trade(api, leg_trade)["record"]["side"]
    other = make(api, cfd(iids["cfd"], side="S" if side == "L" else "L"))
    res = link(api, members((leg_trade, "main"), (other, "hedge")))
    assert res.status_code == 400
    assert {"field": "members[0].tradeId", "kind": "legs"} in res.get_json()["issues"]
    assert_nothing_linked(api, leg_trade, other)


def test_missing_trade_is_not_found(api, iids):
    f, _c = pair(api, iids)
    res = link(api, members((f, "main"), ("noSuchTrade", "hedge")))
    assert res.status_code == 404 and res.get_json() == {"error": "not_found"}
    assert_nothing_linked(api, f)


def test_bad_trade_id_is_not_found(api, iids):
    f, _c = pair(api, iids)
    res = link(api, members((f, "main"), ("a/b", "hedge")))
    assert res.status_code == 404
    assert_nothing_linked(api, f)


# ── 1 つのまとまりにだけ（AC-3） ──


def test_in_other_group_conflicts(api, iids):
    f, c = pair(api, iids)
    g1 = linked(api, members((f, "main"), (c, "hedge")))
    c2 = make(api, cfd(iids["cfd"]))
    f2 = make(api, future(iids["fut"]))
    res = link(api, members((f, "main"), (c2, "hedge")))
    assert res.status_code == 409 and res.get_json() == {"error": "conflict", "reason": "inOtherGroup"}
    assert len(raw_groups(api, A)) == 1 and position_groups.KEY not in trade(api, c2)
    # PUT でほかのまとまりのメンバーを加える
    g2 = linked(api, members((f2, "main"), (c2, "hedge")))
    before = raw_groups(api, A)
    res = api.put(f"{PATH}/{g2['id']}", A, {"members": members((f2, "main"), (c2, "hedge"), (c, "hedge"))})
    assert res.status_code == 409 and res.get_json()["reason"] == "inOtherGroup"
    assert raw_groups(api, A) == before
    assert trade(api, c)[position_groups.KEY] == g1["id"] and trade(api, c2)[position_groups.KEY] == g2["id"]


# ── 利用者の分離（AC-4） ──


def test_other_user_cannot_see_or_touch(api, iids):
    f, c = pair(api, iids)
    g = linked(api, members((f, "main"), (c, "hedge")))
    before_groups, before_f = raw_groups(api, A), raw_trade(api, A, f)
    # B は A の取引の ID で結べない
    b_inst = api.instrument(B, "B の銘柄")["id"]
    b_trade = make(api, cfd(b_inst), uid=B)
    res = link(api, members((f, "main"), (b_trade, "hedge")), uid=B)
    assert res.status_code == 404 and res.get_json() == {"error": "not_found"}
    # B の一覧に A のまとまりは出ない
    assert api.get(PATH, B).get_json() == {"items": [], "truncated": False}
    # B は A のまとまりを直せない・解けない
    res = api.put(f"{PATH}/{g['id']}", B, {"members": members((f, "main"), (c, "hedge"))})
    assert res.status_code == 404 and res.get_json() == {"error": "not_found"}
    res = api.delete(f"{PATH}/{g['id']}", B)
    assert res.status_code == 404 and res.get_json() == {"error": "not_found"}
    # A が A の取引に B の取引を混ぜても 404
    res = link(api, members((f, "main"), (b_trade, "hedge")))
    assert res.status_code == 404
    assert raw_groups(api, A) == before_groups and raw_trade(api, A, f) == before_f
    assert raw_groups(api, B) == {} and position_groups.KEY not in raw_trade(api, B, b_trade)
    # B の範囲の一覧にも出ない
    body = api.get(f"/api/trades?exitFrom={FRI - DAY}&exitTo={MON + DAY}", B).get_json()
    assert body["positionGroups"] == [] and body["groupMembers"] == []


@pytest.mark.parametrize("crafted", ["..%2Fx", "a/b", "x" * 41, "a b"])
def test_crafted_group_ids_are_not_found(api, crafted):
    assert api.put(f"{PATH}/{crafted}", A, {"members": members(("t1", "main"), ("t2", "hedge"))}).status_code == 404
    assert api.delete(f"{PATH}/{crafted}", A).status_code == 404


def test_unauthenticated_is_401(api):
    assert api.get(PATH).status_code == 401
    assert api.post(PATH, None, {"members": []}).status_code == 401
    assert api.delete(f"{PATH}/x").status_code == 401


# ── 直す ──


def test_put_replaces_members_and_exit(api, iids, clock):
    f, c = pair(api, iids)
    c2 = make(api, cfd(iids["cfd"]))
    g = linked(api, members((f, "main"), (c, "hedge")), exit={"price": 38_440})
    clock.advance(5)
    res = api.put(f"{PATH}/{g['id']}", A, {"members": members((f, "main"), (c2, "hedge")),
                                           "exit": {"orderType": "market", "reason": "brokeManual"}})  # fmt: skip
    assert res.status_code == 200, res.get_json()
    got = res.get_json()
    assert [m["tradeId"] for m in got["members"]] == [f, c2]
    assert got["exit"] == {"orderType": "market", "reason": "brokeManual"}
    assert got["createdAt"] == g["createdAt"] and got["updatedAt"] > g["updatedAt"]
    assert position_groups.KEY not in trade(api, c)
    assert trade(api, c2)[position_groups.KEY] == g["id"] and trade(api, f)[position_groups.KEY] == g["id"]
    # 上書きを外す
    got = api.put(f"{PATH}/{g['id']}", A, {"members": members((f, "main"), (c2, "hedge"))}).get_json()
    assert "exit" not in got and "exit" not in raw_groups(api, A)[g["id"]]


def test_put_missing_group_or_trade(api, iids):
    f, c = pair(api, iids)
    assert api.put(f"{PATH}/noSuchGroup", A, {"members": members((f, "main"), (c, "hedge"))}).status_code == 404
    g = linked(api, members((f, "main"), (c, "hedge")))
    before = raw_groups(api, A)
    res = api.put(f"{PATH}/{g['id']}", A, {"members": members((f, "main"), ("noSuchTrade", "hedge"))})
    assert res.status_code == 404
    assert raw_groups(api, A) == before and trade(api, c)[position_groups.KEY] == g["id"]


# ── 解く（AC-5） ──


def test_unlink_keeps_records_and_tags(api, iids):
    f, c = pair(api, iids)
    g = linked(api, members((f, "main"), (c, "hedge")))
    assert api.put("/api/trade-emotions", A, {"tradeIds": [f, c], "tags": ["fear"]}).status_code == 200
    body = {"tradeIds": [c], "good": {"topics": [], "notes": ["固定できた"]}, "more": {"topics": [], "notes": []}}
    assert api.put("/api/trade-reflections", A, body).status_code == 200
    before = {tid: trade(api, tid) for tid in (f, c)}
    res = api.delete(f"{PATH}/{g['id']}", A)
    assert res.status_code == 204
    assert raw_groups(api, A) == {}
    for tid in (f, c):
        after = trade(api, tid)
        assert position_groups.KEY not in after
        assert {k: v for k, v in after.items() if k not in (position_groups.KEY, "updatedAt")} == {
            k: v for k, v in before[tid].items() if k not in (position_groups.KEY, "updatedAt")}  # fmt: skip
    assert api.delete(f"{PATH}/{g['id']}", A).status_code == 404


def test_unlink_with_missing_member(api, iids):
    """崩れたまとまり（無い取引を指す）も解ける"""
    f, c = pair(api, iids)
    g = linked(api, members((f, "main"), (c, "hedge")))
    # 前の版の API で取引を消した（まとまりを直さない）のに見立てる
    if api.kind == "memory":
        del api.store.users[A]["trades"][c]
    else:
        trade_ref(api, A, c).delete()
    assert api.delete(f"{PATH}/{g['id']}", A).status_code == 204
    assert raw_groups(api, A) == {} and position_groups.KEY not in trade(api, f)


# ── 取引を消す（AC-6） ──


def test_delete_main_keeps_group_with_rest(api, iids):
    m1 = make(api, future(iids["fut"]))
    m2 = make(api, future(iids["fut"]))
    h = make(api, cfd(iids["cfd"]))
    g = linked(api, members((m1, "main"), (m2, "main"), (h, "hedge")))
    assert api.delete(f"/api/trades/{m1}", A).status_code == 204
    stored = raw_groups(api, A)[g["id"]]
    assert [m["tradeId"] for m in stored["members"]] == [m2, h]
    assert stored["updatedAt"] > g["updatedAt"]
    assert trade(api, m2)[position_groups.KEY] == g["id"] and trade(api, h)[position_groups.KEY] == g["id"]


def test_delete_trade_failure_writes_nothing(memory_api):
    """保存先が途中で失敗したら、取引もまとまりも逆参照も前のまま（同じトランザクション）"""
    api = memory_api
    ids = setup_iids(api)
    f, c = pair(api, ids)
    linked(api, members((f, "main"), (c, "hedge")))
    before = (raw_groups(api, A), raw_trade(api, A, f), raw_trade(api, A, c))
    api.store.fail_charts = True
    assert api.delete(f"/api/trades/{c}", A).status_code == 503
    api.store.fail_charts = False
    assert (raw_groups(api, A), raw_trade(api, A, f), raw_trade(api, A, c)) == before


def set_trade_version(api, tid: str, version: int) -> None:
    if api.kind == "memory":
        api.store.users[A]["trades"][tid]["schemaVersion"] = version
    else:
        trade_ref(api, A, tid).update({"schemaVersion": version})


def test_unlinking_unknown_version_trade_writes_nothing(api, iids):
    """逆参照を外す相手が知らない版の取引なら、まとまりの PUT・DELETE は 409、取引の DELETE はまとまりを書かない"""
    f, c = pair(api, iids)
    c2 = make(api, cfd(iids["cfd"]))
    g = linked(api, members((f, "main"), (c, "hedge")))
    set_trade_version(api, c, 99)
    before = (raw_groups(api, A), raw_trade(api, A, c))
    res = api.delete(f"{PATH}/{g['id']}", A)
    assert res.status_code == 409 and res.get_json()["reason"] == "unknownSchemaVersion"
    res = api.put(f"{PATH}/{g['id']}", A, {"members": members((f, "main"), (c2, "hedge"))})
    assert res.status_code == 409 and res.get_json()["reason"] == "unknownSchemaVersion"
    assert (raw_groups(api, A), raw_trade(api, A, c)) == before
    assert position_groups.KEY not in trade(api, c2)
    # 本玉を消すと役割の組は崩れるが、残りの c は知らない版なので、まとまりも c も書かない
    assert api.delete(f"/api/trades/{f}", A).status_code == 204
    assert raw_trade(api, A, f) is None
    assert (raw_groups(api, A), raw_trade(api, A, c)) == before


def test_delete_hedge_dissolves_group(api, iids):
    m1 = make(api, future(iids["fut"]))
    m2 = make(api, future(iids["fut"]))
    h = make(api, cfd(iids["cfd"]))
    linked(api, members((m1, "main"), (m2, "main"), (h, "hedge")))
    assert api.delete(f"/api/trades/{h}", A).status_code == 204
    assert raw_groups(api, A) == {}
    for tid in (m1, m2):
        assert position_groups.KEY not in trade(api, tid)
    assert raw_trade(api, A, h) is None


def test_delete_trade_with_unknown_group_version_keeps_group(api, iids):
    f, c = pair(api, iids)
    g = linked(api, members((f, "main"), (c, "hedge")))
    set_group_version(api, A, g["id"], 2)
    assert api.delete(f"/api/trades/{c}", A).status_code == 204
    assert raw_groups(api, A)[g["id"]]["schemaVersion"] == 2
    assert trade(api, f)[position_groups.KEY] == g["id"]


def test_delete_unlinked_trade_unchanged(api, iids):
    """KEEP-1: まとまりの無い取引の削除は前と同じ"""
    f, _c = pair(api, iids)
    assert api.delete(f"/api/trades/{f}", A).status_code == 204
    assert raw_trade(api, A, f) is None and raw_groups(api, A) == {}


# ── 取引を直す（AC-7・AC-8） ──


def test_side_change_conflicts(api, iids):
    f, c = pair(api, iids)
    linked(api, members((f, "main"), (c, "hedge")))
    before_f, before_groups = raw_trade(api, A, f), raw_groups(api, A)
    body = body_of(trade(api, f))
    body.update(side="S", lc=38_300, entries=[{"price": 38_000, "quantity": 1, "lc": 38_300}])
    res = api.put(f"/api/trades/{f}", A, body)
    assert res.status_code == 409 and res.get_json() == {"error": "conflict", "reason": "inPositionGroup"}
    assert raw_trade(api, A, f) == before_f and raw_groups(api, A) == before_groups


def test_edit_refreshes_member_times(api, iids):
    f, c = pair(api, iids)
    g = linked(api, members((f, "main"), (c, "hedge")))
    body = body_of(trade(api, f))
    body["exit"] = {**body["exit"], "time": MON + 2 * H}
    body["entries"] = [{**body["entries"][0], "time": FRI - 20 * H}]
    res = api.put(f"/api/trades/{f}", A, body)
    assert res.status_code == 200, res.get_json()
    assert res.get_json()[position_groups.KEY] == g["id"]
    stored = raw_groups(api, A)[g["id"]]
    assert stored["members"][0] == {"tradeId": f, "role": "main", "entryTime": FRI - 20 * H, "exitTime": MON + 2 * H}
    assert stored["members"][1]["exitTime"] == MON + 1000
    assert stored["updatedAt"] > g["updatedAt"]


def test_edit_other_fields_keeps_group_untouched(api, iids):
    """AC-8: 時刻の変わらない直し・チャート・心理のタグ・Good / More は逆参照を保ち、版は 1 のまま"""
    f, c = pair(api, iids)
    g = linked(api, members((f, "main"), (c, "hedge")))
    before_groups = raw_groups(api, A)
    body = body_of(trade(api, f))
    body["thesis"] = "直した根拠"
    got = api.put(f"/api/trades/{f}", A, body).get_json()
    assert got[position_groups.KEY] == g["id"] and got["schemaVersion"] == 1
    assert raw_groups(api, A) == before_groups  # 写しが同じなら書かない
    res = api.put(f"/api/trades/{f}/charts/entry", A, raw=chart_png(), content_type="image/png")
    assert res.status_code == 200, res.get_json()
    assert res.get_json()[position_groups.KEY] == g["id"]
    res = api.delete(f"/api/trades/{f}/charts/entry", A)
    assert res.status_code == 200 and res.get_json()[position_groups.KEY] == g["id"]
    assert api.put("/api/trade-emotions", A, {"tradeIds": [f], "tags": ["hope"]}).status_code == 200
    body = {"tradeIds": [f], "good": {"topics": [], "notes": ["x"]}, "more": {"topics": [], "notes": []}}
    assert api.put("/api/trade-reflections", A, body).status_code == 200
    after = trade(api, f)
    assert after[position_groups.KEY] == g["id"] and after["schemaVersion"] == 1


def test_side_change_allowed_after_unlink(api, iids):
    f, c = pair(api, iids)
    g = linked(api, members((f, "main"), (c, "hedge")))
    api.delete(f"{PATH}/{g['id']}", A)
    body = body_of(trade(api, f))
    body.update(side="S", lc=38_300, entries=[{"price": 38_000, "quantity": 1, "lc": 38_300}])
    assert api.put(f"/api/trades/{f}", A, body).status_code == 200


# ── 範囲の一覧（AC-9） ──

DAY = 86_400_000


def ranged(api, start: int, end: int, uid: str = A) -> dict:
    res = api.get(f"/api/trades?exitFrom={start}&exitTo={end}", uid)
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def test_range_returns_groups_and_outside_members(api, iids):
    """R9: 先物の決済は範囲の中、CFD の決済は範囲の外 → CFD は groupMembers に"""
    f = make(api, future(iids["fut"], exit={"time": MON, "price": 38_400, "reason": "other"}))
    c = make(api, cfd(iids["cfd"], exit={"time": MON + DAY, "price": 38_400, "reason": "other"}))
    lone = make(api, future(iids["fut"]))
    g = linked(api, members((f, "main"), (c, "hedge")))
    body = ranged(api, MON - DAY, MON + 1)
    assert sorted(t["id"] for t in body["items"]) == sorted([f, lone])
    assert body["positionGroups"] == [g]
    assert [t["id"] for t in body["groupMembers"]] == [c]
    assert body["groupMembers"][0][position_groups.KEY] == g["id"]
    # まとまりの幅（金曜の夜の CFD のエントリー〜CFD の決済）が範囲と重なれば、メンバーが範囲の外でも返す
    body = ranged(api, FRI - 1, FRI + 1)
    assert body["items"] == [] and body["positionGroups"] == [g]
    assert sorted(t["id"] for t in body["groupMembers"]) == sorted([f, c])
    # 幅の外
    body = ranged(api, MON + DAY + 1, MON + 2 * DAY)
    assert body == {"items": [], "truncated": False, "positionGroups": [], "groupMembers": []}


def test_range_counts_members_in_limit(api, iids, monkeypatch):
    """件数の上限はメンバーの取引も数え、超えた分の groupMembers は返さず truncated"""
    from loss_note_api import trade_range

    f = make(api, future(iids["fut"]))
    lone = make(api, future(iids["fut"]))
    c = make(api, cfd(iids["cfd"], exit={"time": MON + DAY, "price": 38_400, "reason": "other"}))
    g = linked(api, members((f, "main"), (c, "hedge")))
    monkeypatch.setattr(trade_range, "MAX_RANGE_ITEMS", 3)
    body = ranged(api, MON - 1, MON + 1)
    assert sorted(t["id"] for t in body["items"]) == sorted([f, lone])
    assert [t["id"] for t in body["groupMembers"]] == [c] and body["truncated"] is False
    monkeypatch.setattr(trade_range, "MAX_RANGE_ITEMS", 2)
    body = ranged(api, MON - 1, MON + 1)
    assert len(body["items"]) == 2 and body["groupMembers"] == [] and body["truncated"] is True
    assert body["positionGroups"] == [g]


def test_range_without_groups_has_empty_lists(api, iids):
    """KEEP-1: まとまりの無い利用者の items は前と同じで、2 つの鍵は空"""
    f = make(api, future(iids["fut"]))
    body = ranged(api, MON - 1, MON + 1)
    assert [t["id"] for t in body["items"]] == [f]
    assert position_groups.KEY not in body["items"][0]
    assert body["positionGroups"] == [] and body["groupMembers"] == []


# ── 知らない版（AC-10） ──


def test_unknown_group_version_conflicts(api, iids):
    f, c = pair(api, iids)
    g = linked(api, members((f, "main"), (c, "hedge")))
    set_group_version(api, A, g["id"], 2)
    before = raw_groups(api, A)
    res = api.put(f"{PATH}/{g['id']}", A, {"members": members((f, "main"), (c, "hedge"))})
    assert res.status_code == 409 and res.get_json() == {"error": "conflict", "reason": "unknownSchemaVersion"}
    res = api.delete(f"{PATH}/{g['id']}", A)
    assert res.status_code == 409 and res.get_json()["reason"] == "unknownSchemaVersion"
    assert raw_groups(api, A) == before
    assert trade(api, f)[position_groups.KEY] == g["id"]


def test_unknown_trade_version_cannot_be_linked(api, iids):
    f, c = pair(api, iids)
    if api.kind == "memory":
        api.store.users[A]["trades"][c]["schemaVersion"] = 99
    else:
        trade_ref(api, A, c).update({"schemaVersion": 99})
    res = link(api, members((f, "main"), (c, "hedge")))
    assert res.status_code == 409 and res.get_json()["reason"] == "unknownSchemaVersion"
    assert raw_groups(api, A) == {}


# ── 書き出し（AC-11） ──


def test_export_includes_groups(api, iids):
    f, c = pair(api, iids)
    lone = make(api, future(iids["fut"]))
    g = linked(api, members((f, "main"), (c, "hedge")))
    body = api.get("/api/export", A).get_json()
    assert body["version"] == 1
    assert body["positionGroups"] == [g]
    by_id = {t["id"]: t for t in body["trades"]}
    assert by_id[f][position_groups.KEY] == g["id"] and by_id[c][position_groups.KEY] == g["id"]
    assert position_groups.KEY not in by_id[lone]
    assert api.get("/api/export", B).get_json()["positionGroups"] == []
