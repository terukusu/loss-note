"""取引の保存にレッグを足す（Issue #116。設計書 4.7・C46・C52・C54・K15・ADR-0020 の決定 1〜3・6・7 の (b)・9）。

- 共有の合成の fixture ``tests/fixtures/records/option-legs.json``（TS のテスト
  ``tests/ui/option-legs-fixture.test.ts`` が作る）のレッグつきの取引が、POST / GET / PUT / 範囲の一覧で値と型を
  変えずに往復する（EPIC #120 の終了条件 4）
- 守り (b): 保存済みにレッグがある取引へ ``legs`` の無い本文で PUT すると 409（何も書かない）。前からの取引
  （レッグの無い取引）にレッグを足す PUT は 400。チャートの PUT / DELETE はレッグを変えない。レッグの無い取引の版は
  1 のまま（4b）
- レッグ・``riskPlan``・``lcLossPlanYen``・``expiry`` の検査（400。issues は既知の道筋と種類だけ）

保存先 2 つ（記憶・エミュレーターの Firestore）で同じテストを回す。値・名前・画像はすべて架空。
"""

import copy
import json
import logging

import pytest
from helpers.charts import chart_parts, chart_png, encode_multipart
from helpers.records import load_fixture, put_default_account, same_typed, t1

from loss_note_api import charts, logs, schema, trade_version

A = "legsUserA"
B = "legsUserB"
PLACEHOLDER = "INSTRUMENT"
LEGS_MISSING = {"error": "conflict", "reason": "legsMissing"}
FIXTURE = load_fixture("option-legs.json")
ITEMS = {x["name"]: x for x in FIXTURE["items"]}


# ── 道具 ──


def trade_ref(api, uid: str, tid: str):
    return api.store._db().collection("users").document(uid).collection("trades").document(tid)


def raw_trade(api, uid: str, tid: str) -> dict:
    if api.kind == "memory":
        return json.loads(json.dumps(api.store.users[uid]["trades"][tid], sort_keys=True))
    return json.loads(json.dumps(trade_ref(api, uid, tid).get().to_dict(), sort_keys=True, default=str))


def add_instrument(api, uid: str, body: dict) -> str:
    """銘柄を足す（同じ名前の銘柄があればその ID。fixture の P1〜P3 は同じ銘柄）"""
    for it in api.get("/api/instruments", uid).get_json()["items"]:
        if it["name"] == body["name"]:
            return it["id"]
    res = api.post("/api/instruments", uid, body)
    assert res.status_code == 201, res.get_json()
    return res.get_json()["id"]


def body_of(item: dict, iid: str) -> dict:
    sent = copy.deepcopy(item["record"])
    assert sent["instrumentId"] == PLACEHOLDER
    sent["instrumentId"] = iid
    return sent


def create(api, name: str, uid: str = A) -> tuple[str, str, dict]:
    """fixture の 1 件を作る。(取引の ID, 銘柄の ID, 送った record)"""
    item = ITEMS[name]
    iid = add_instrument(api, uid, item["instrument"])
    put_default_account(api, uid, item["settings"])
    sent = body_of(item, iid)
    res = api.post("/api/trades", uid, sent)
    assert res.status_code == 201, (name, res.get_json())
    return res.get_json()["id"], iid, sent


def issues_of(res) -> list[dict]:
    assert res.status_code == 400, res.get_json()
    body = res.get_json()
    assert body["error"] == "invalid"
    return body["issues"]


def p1_body(iid: str, **over) -> dict:
    body = body_of(ITEMS["P1"], iid)
    body.update(over)
    return body


@pytest.fixture
def option_iid(api):
    put_default_account(api, A, ITEMS["P1"]["settings"])
    return add_instrument(api, A, ITEMS["P1"]["instrument"])


# ── 往復（AC-1。EPIC 終了条件 4） ──


def test_fixture_round_trip(api):
    """POST → GET → PUT → 範囲の一覧で、record が送ったまま（値と型）。版は 2、snapshot は fixture の期待どおり"""
    assert list(ITEMS) == ["P1", "P2", "P3", "P4"]
    sent_by_id: dict[str, dict] = {}
    for name, item in ITEMS.items():
        tid, _iid, sent = create(api, name)
        got = api.get(f"/api/trades/{tid}", A).get_json()
        assert got["schemaVersion"] == 2, name
        assert got["record"] == sent and same_typed(got["record"], sent), name
        assert got["snapshot"] == item["snapshot"] and same_typed(got["snapshot"], item["snapshot"]), name
        # 直す（レッグを知る画面の本文 = legs を含む）: 総評とレッグの決済値を変える
        edited = copy.deepcopy(sent)
        edited["exit"]["review"] = "直した総評（架空）"
        edited["legs"][0]["exit"]["price"] = edited["legs"][0]["exit"]["price"] + 0.5
        res = api.put(f"/api/trades/{tid}", A, edited)
        assert res.status_code == 200, (name, res.get_json())
        put_back = res.get_json()
        assert put_back["schemaVersion"] == 2, name
        assert put_back["record"] == edited and same_typed(put_back["record"], edited), name
        again = api.get(f"/api/trades/{tid}", A).get_json()
        assert again["record"] == edited and same_typed(again["record"], edited), name
        sent_by_id[tid] = edited
    times = [x["record"]["exit"]["time"] for x in ITEMS.values()]
    res = api.get(f"/api/trades?exitFrom={min(times)}&exitTo={max(times) + 1}", A)
    assert res.status_code == 200, res.get_json()
    listed = res.get_json()["items"]
    assert {t["id"] for t in listed} == set(sent_by_id)
    for t in listed:
        assert t["schemaVersion"] == 2
        assert t["record"] == sent_by_id[t["id"]] and same_typed(t["record"], sent_by_id[t["id"]])
    # 一覧（全件・ページ分け）でも同じ
    for t in api.trades(A):
        assert t["record"] == sent_by_id[t["id"]]
    page = api.get("/api/trades?limit=10", A).get_json()["items"]
    assert {t["id"]: t["record"] for t in page} == sent_by_id


def test_multipart_create_with_charts(api, option_iid):
    """チャートつきの作成（multipart）でもレッグを受ける"""
    rec = p1_body(option_iid, entryChartTimeframe="1h")
    body, ctype = encode_multipart(chart_parts(rec, {"entry": (chart_png(), "image/png")}))
    res = api.call("POST", "/api/trades", A, raw=body, content_type=ctype)
    assert res.status_code == 201, res.get_json()
    got = res.get_json()
    assert got["schemaVersion"] == 2 and got["record"] == rec and set(got["charts"]) == {"entry"}


# ── 守り (b)（AC-4。EPIC 終了条件 4b） ──


def test_legacy_edit_body_conflict(api):
    """今の直す画面（レッグを知らない）が作る本文（fixture の legacyEdit）の PUT は 409 で、文書は前のまま"""
    assert FIXTURE["legacyEdit"]["of"] == "P1"
    tid, iid, _sent = create(api, "P1")
    before = raw_trade(api, A, tid)
    legacy = copy.deepcopy(FIXTURE["legacyEdit"]["body"])
    assert "legs" not in legacy
    legacy["instrumentId"] = iid
    res = api.put(f"/api/trades/{tid}", A, legacy)
    assert res.status_code == 409 and res.get_json() == LEGS_MISSING
    assert raw_trade(api, A, tid) == before


def test_no_legs_put_conflicts_on_every_path(api):
    """付け替え・?snapshot=current・multipart（チャートの差し替え・外す）も、legs が無ければ 409。
    取引もチャートも前のまま"""
    item = ITEMS["P1"]
    iid = add_instrument(api, A, item["instrument"])
    put_default_account(api, A, item["settings"])
    rec = p1_body(iid, entryChartTimeframe="1h", exitChartTimeframe="1h")
    imgs = {"entry": (chart_png(), "image/png"), "exit": (chart_png(), "image/png")}
    body, ctype = encode_multipart(chart_parts(rec, imgs))
    tid = api.call("POST", "/api/trades", A, raw=body, content_type=ctype).get_json()["id"]
    before = raw_trade(api, A, tid)
    no_legs = {k: v for k, v in rec.items() if k not in ("legs", "lcLossPlanYen")}
    acc = api.post("/api/accounts", A, {"name": "架空の口座B", "capitalYen": 2_000_000}).get_json()
    res = api.put(f"/api/trades/{tid}", A, {**no_legs, "accountId": acc["id"]})
    assert res.status_code == 409 and res.get_json() == LEGS_MISSING
    res = api.put(f"/api/trades/{tid}?snapshot=current", A, no_legs)
    assert res.status_code == 409 and res.get_json() == LEGS_MISSING
    rec2 = {k: v for k, v in no_legs.items() if k != "exitChartTimeframe"}
    parts = chart_parts(rec2, {"entry": (chart_png(b"NEW-3a"), "image/png")})
    parts.append((charts.REMOVE_PART, "exit", None, None))
    body, ctype = encode_multipart(parts)
    res = api.call("PUT", f"/api/trades/{tid}", A, raw=body, content_type=ctype)
    assert res.status_code == 409 and res.get_json() == LEGS_MISSING
    assert raw_trade(api, A, tid) == before


def test_no_legs_put_with_missing_account_writes_nothing(api):
    """legs の無い本文に無い口座を付けても（400 notFound か 409 のどちらでも）何も書かない"""
    tid, _iid, sent = create(api, "P1")
    before = raw_trade(api, A, tid)
    no_legs = {k: v for k, v in sent.items() if k != "legs"}
    no_legs.pop("lcLossPlanYen")
    res = api.put(f"/api/trades/{tid}", A, {**no_legs, "accountId": "noSuchAccount"})
    assert res.status_code in (400, 409)
    assert raw_trade(api, A, tid) == before


def test_legs_with_riskplan_removed_is_users_choice(api):
    """legs を送る画面は riskPlan・lcLossPlanYen も知るので、それらが無い本文は本人が消したと読む（200）"""
    tid, _iid, sent = create(api, "P1")
    edited = {k: v for k, v in sent.items() if k != "lcLossPlanYen"}
    res = api.put(f"/api/trades/{tid}", A, edited)
    assert res.status_code == 200 and "lcLossPlanYen" not in res.get_json()["record"]


@pytest.mark.parametrize("product_form", ["future", "option"])
def test_add_legs_to_legacy_trade(api, product_form):
    """前からの取引（レッグの無い版 1。先物・プレミアムで記録したオプション）にレッグを足す PUT は 400・何も書かない"""
    iid = api.instrument(A, "架空の銘柄", productForm=product_form)["id"]
    tid = api.post("/api/trades", A, t1(iid)).get_json()["id"]
    before = raw_trade(api, A, tid)
    # レッグの形として正しい本文（エントリーの数量 1・満期で消えた売りのレッグ）でも、前からの取引には足せない
    legs = copy.deepcopy(ITEMS["P2"]["record"]["legs"])
    res = api.put(f"/api/trades/{tid}", A, t1(iid, legs=legs, entries=[{"price": 100, "quantity": 1}]))
    assert issues_of(res) == [{"field": "legs", "kind": "legacyTrade"}]
    assert raw_trade(api, A, tid) == before


def test_charts_keep_legs(api):
    """チャートの PUT / DELETE の後も、レッグ・見込み・版が同じ"""
    tid, _iid, sent = create(api, "P1")
    res = api.call("PUT", f"/api/trades/{tid}/charts/entry", A, raw=chart_png(), content_type="image/png")
    assert res.status_code == 200, res.get_json()
    got = res.get_json()
    assert got["schemaVersion"] == 2
    assert got["record"]["legs"] == sent["legs"] and got["record"]["lcLossPlanYen"] == sent["lcLossPlanYen"]
    res = api.call("PUT", f"/api/trades/{tid}/charts/x1", A, raw=chart_png(), content_type="image/png")
    assert res.status_code == 200
    for slot in ("entry", "x1"):
        res = api.delete(f"/api/trades/{tid}/charts/{slot}", A)
        assert res.status_code == 200
        got = res.get_json()
        assert got["schemaVersion"] == 2 and got["record"]["legs"] == sent["legs"]
    assert raw_trade(api, A, tid)["record"]["legs"] == sent["legs"]


def test_riskplan_survives_chart_change(api):
    tid, _iid, sent = create(api, "P3")
    res = api.call("PUT", f"/api/trades/{tid}/charts/exit", A, raw=chart_png(), content_type="image/png")
    assert res.status_code == 200
    assert res.get_json()["record"]["riskPlan"] == "maxLoss" and res.get_json()["record"]["legs"] == sent["legs"]


def test_legacy_trades_stay_version_1(api):
    """レッグの無い取引の作成・PUT・付け替え・?snapshot=current で版は 1 のまま（文書も）"""
    iid = api.instrument(A)["id"]
    created = api.post("/api/trades", A, t1(iid)).get_json()
    tid = created["id"]
    assert created["schemaVersion"] == 1
    assert api.put(f"/api/trades/{tid}", A, t1(iid, thesis="直した")).get_json()["schemaVersion"] == 1
    acc = api.post("/api/accounts", A, {"name": "架空の口座B", "capitalYen": 2_000_000}).get_json()
    res = api.put(f"/api/trades/{tid}?snapshot=current", A, t1(iid, accountId=acc["id"]))
    assert res.status_code == 200 and res.get_json()["schemaVersion"] == 1
    assert raw_trade(api, A, tid)["schemaVersion"] == 1


def test_other_users_trade_is_not_found(api):
    """ほかの利用者のレッグつきの取引は 404（409 で存在を漏らさない）"""
    tid, _iid, sent = create(api, "P1")
    biid = add_instrument(api, B, ITEMS["P1"]["instrument"])
    assert api.put(f"/api/trades/{tid}", B, {**sent, "instrumentId": biid}).status_code == 404
    no_legs = {k: v for k, v in sent.items() if k not in ("legs", "lcLossPlanYen")}
    assert api.put(f"/api/trades/{tid}", B, {**no_legs, "instrumentId": biid}).status_code == 404


# ── 版の値 ──


def test_version_of():
    assert trade_version.SCHEMA_VERSION == 2
    assert trade_version.version_of({"side": "L"}) == 1
    assert trade_version.version_of({"legs": [{}]}) == 2


# ── 検査（AC-3） ──


def leg(**over) -> dict:
    base = copy.deepcopy(ITEMS["P1"]["record"]["legs"][0])
    base.update(over)
    return base


def p1_legs() -> list[dict]:
    return copy.deepcopy(ITEMS["P1"]["record"]["legs"])


P1 = ITEMS["P1"]["record"]
OPEN = P1["entries"][0]["time"]
CLOSE = P1["exit"]["time"]


def with_leg0(**over) -> list[dict]:
    legs = p1_legs()
    legs[0] = {**legs[0], **over}
    return legs


INVALID_CASES = [
    ("legs empty", {"legs": []}, {"field": "legs", "kind": "count"}),
    ("legs 11", {"legs": [leg(id=f"l{i % 10 + 1}") for i in range(11)]}, {"field": "legs", "kind": "count"}),
    ("legs not list", {"legs": {"l1": {}}}, {"field": "legs", "kind": "type"}),
    ("id format", {"legs": with_leg0(id="x1")}, {"field": "legs[0].id", "kind": "format"}),
    ("id l11", {"legs": with_leg0(id="l11")}, {"field": "legs[0].id", "kind": "format"}),
    ("id duplicate", {"legs": with_leg0(id="l2")}, {"field": "legs[1].id", "kind": "duplicate"}),
    # 末尾の改行（正規表現の $ は改行の前でも当たる。#116 のレビュー N1）
    ("id trailing newline", {"legs": with_leg0(id="l1\n")}, {"field": "legs[0].id", "kind": "format"}),
    ("month trailing newline", {"legs": with_leg0(contractMonth="2027-01\n")},
     {"field": "legs[0].contractMonth", "kind": "format"}),
    ("account trailing newline", {"accountId": "default\n"}, {"field": "accountId", "kind": "format"}),
    # 有限でない・巨大な・型の違う数（#116 のレビュー N3。JSON に NaN は書けないので巨大な値・bool・小数の時刻）
    ("quantity huge", {"legs": with_leg0(quantity=1e300)}, {"field": "legs[0].quantity", "kind": "range"}),
    ("strike bool", {"legs": with_leg0(strike=True)}, {"field": "legs[0].strike", "kind": "type"}),
    ("entry time fraction", {"legs": with_leg0(entry={"price": 300, "time": 1.5})},
     {"field": "legs[0].entry.time", "kind": "type"}),
    ("exit price huge", {"legs": with_leg0(exit={"price": 1e13, "kind": "closed"})},
     {"field": "legs[0].exit.price", "kind": "range"}),
    ("plan huge", {"lcLossPlanYen": 1e300}, {"field": "lcLossPlanYen", "kind": "range"}),
    ("month 13", {"legs": with_leg0(contractMonth="2027-13")}, {"field": "legs[0].contractMonth", "kind": "format"}),
    ("month short", {"legs": with_leg0(contractMonth="2027-1")}, {"field": "legs[0].contractMonth", "kind": "format"}),
    ("day 02-30", {"legs": with_leg0(contractMonth="2027-02-30")}, {"field": "legs[0].contractMonth",
                                                                    "kind": "format"}),
    ("option type", {"legs": with_leg0(optionType="X")}, {"field": "legs[0].optionType", "kind": "enum"}),
    ("side", {"legs": with_leg0(side="S")}, {"field": "legs[0].side", "kind": "enum"}),
    ("strike 0", {"legs": with_leg0(strike=0)}, {"field": "legs[0].strike", "kind": "range"}),
    ("quantity 0", {"legs": with_leg0(quantity=0)}, {"field": "legs[0].quantity", "kind": "range"}),
    ("entry price < 0", {"legs": with_leg0(entry={"price": -1})}, {"field": "legs[0].entry.price", "kind": "range"}),
    ("exit price < 0", {"legs": with_leg0(exit={"price": -0.5, "kind": "closed"})},
     {"field": "legs[0].exit.price", "kind": "range"}),
    ("exit kind", {"legs": with_leg0(exit={"price": 1, "kind": "open"})},
     {"field": "legs[0].exit.kind", "kind": "enum"}),
    ("exit missing", {"legs": [{k: v for k, v in leg().items() if k != "exit"}]},
     {"field": "legs[0].exit", "kind": "required"}),
    ("leg unknown field", {"legs": with_leg0(instrumentId="X")}, {"field": "legs[0]", "kind": "unknownField"}),
    ("entry unknown field", {"legs": with_leg0(entry={"price": 1, "fx": 1})},
     {"field": "legs[0].entry", "kind": "unknownField"}),
    ("old fields with legs", {"contractMonth": "2027-01"}, {"field": "contractMonth", "kind": "withLegs"}),
    ("strike with legs", {"strike": 37_000}, {"field": "strike", "kind": "withLegs"}),
    ("option type with legs", {"optionType": "P"}, {"field": "optionType", "kind": "withLegs"}),
    ("two entries", {"entries": [{"price": 38_500, "quantity": 1}, {"price": 38_400, "quantity": 1}]},
     {"field": "entries", "kind": "count"}),
    ("entry quantity 2", {"entries": [{"price": 38_500, "quantity": 2}]}, {"field": "entries[0].quantity",
                                                                          "kind": "range"}),
    ("riskPlan enum", {"riskPlan": "lc"}, {"field": "riskPlan", "kind": "enum"}),
    ("maxLoss with lc", {"riskPlan": "maxLoss", "lcLossPlanYen": None}, {"field": "lc", "kind": "withRiskPlan"}),
    ("maxLoss with plan", {"riskPlan": "maxLoss", "lc": None}, {"field": "lcLossPlanYen", "kind": "withRiskPlan"}),
    ("maxLoss with entry lc", {"riskPlan": "maxLoss", "lc": None, "lcLossPlanYen": None,
                               "entries": [{"price": 38_500, "quantity": 1, "lc": 37_800}]},
     {"field": "entries[0].lc", "kind": "withRiskPlan"}),
    ("plan 0", {"lcLossPlanYen": 0}, {"field": "lcLossPlanYen", "kind": "range"}),
    ("expiry without expired leg", {"exit": {**P1["exit"], "orderType": "expiry"}},
     {"field": "exit.orderType", "kind": "expiry"}),
    ("expiry with expired buy only", {"exit": {**P1["exit"], "orderType": "expiry"},
                                      "legs": with_leg0(exit={"price": 0, "kind": "expired"})},
     {"field": "exit.orderType", "kind": "expiry"}),
    ("closed leg after position exit", {"legs": with_leg0(exit={"price": 1, "time": CLOSE + 1, "kind": "closed"})},
     {"field": "legs[0].exit.time", "kind": "outOfPosition"}),
    ("leg entry before position entry", {"legs": with_leg0(entry={"price": 300, "time": OPEN - 1})},
     {"field": "legs[0].entry.time", "kind": "outOfPosition"}),
    ("leg entry after position exit", {"legs": with_leg0(entry={"price": 300, "time": CLOSE + 1},
                                                         exit={"price": 0, "time": CLOSE + 2, "kind": "expired"})},
     {"field": "legs[0].entry.time", "kind": "outOfPosition"}),
    ("leg exit before leg entry", {"legs": with_leg0(entry={"price": 300, "time": OPEN + 10},
                                                     exit={"price": 1, "time": OPEN + 5, "kind": "closed"})},
     {"field": "legs[0].exit.time", "kind": "legTimeOrder"}),
]  # fmt: skip


def apply_over(body: dict, over: dict) -> dict:
    out = {**body, **over}
    return {k: v for k, v in out.items() if v is not None}


@pytest.mark.parametrize(("name", "over", "issue"), INVALID_CASES, ids=[c[0] for c in INVALID_CASES])
def test_invalid_bodies(api, option_iid, name, over, issue):
    """作成は 400 で、issues に既知の道筋と種類だけ（送った値・知らない欄の名前を返さない）。何も保存しない"""
    res = api.post("/api/trades", A, apply_over(p1_body(option_iid), over))
    issues = issues_of(res)
    assert issue in issues, (name, issues)
    assert all(set(i) == {"field", "kind"} for i in issues)
    assert api.trades(A) == []


@pytest.mark.parametrize(("name", "over", "issue"), INVALID_CASES[:6], ids=[c[0] for c in INVALID_CASES[:6]])
def test_invalid_bodies_on_put(api, name, over, issue):
    """直しも同じ検査で 400・何も書かない"""
    tid, iid, _sent = create(api, "P1")
    before = raw_trade(api, A, tid)
    res = api.put(f"/api/trades/{tid}", A, apply_over(p1_body(iid), over))
    assert issue in issues_of(res), name
    assert raw_trade(api, A, tid) == before


NO_LEGS_CASES = [
    ("riskPlan", {"riskPlan": "maxLoss", "lc": None}, {"field": "riskPlan", "kind": "requiresLegs"}),
    ("lcLossPlanYen", {"lcLossPlanYen": 50_000}, {"field": "lcLossPlanYen", "kind": "requiresLegs"}),
    ("expiry", {"exit": {"time": 1_700_000_000_000, "price": 99.5, "orderType": "expiry"}},
     {"field": "exit.orderType", "kind": "requiresLegs"}),
]  # fmt: skip


@pytest.mark.parametrize(("name", "over", "issue"), NO_LEGS_CASES, ids=[c[0] for c in NO_LEGS_CASES])
def test_new_fields_require_legs(api, name, over, issue):
    """レッグの無い取引に riskPlan・lcLossPlanYen・満期（SQ）は 400（前からの取引の形を変えない）"""
    iid = api.instrument(A)["id"]
    res = api.post("/api/trades", A, apply_over(t1(iid), over))
    assert issue in issues_of(res), name
    # 作った取引の直しでも同じ
    tid = api.post("/api/trades", A, t1(iid)).get_json()["id"]
    res = api.put(f"/api/trades/{tid}", A, apply_over(t1(iid), over))
    assert issue in issues_of(res), name


ACCEPTED_CASES = [
    # 満期で消えた買いの SQ はポジションの決済の時刻より後でよい（範囲を見ない。C54）
    ("expired buy after exit", {"legs": with_leg0(exit={"price": 0, "time": CLOSE + 86_400_000, "kind": "expired"})}),
    # 満期で消えた売りがあれば満期（SQ）を受ける（SQ の日 = ポジションの決済の時刻）
    ("expiry with expired sell", {"exit": {**P1["exit"], "orderType": "expiry"},
                                  "legs": [p1_legs()[0],
                                           {**p1_legs()[1], "exit": {"price": 0, "time": CLOSE, "kind": "expired"}},
                                           p1_legs()[2]]}),
    # レッグの時刻は任意。ポジションの建てた時刻が無ければ下限を見ない
    ("no position entry time", {"entries": [{"price": 38_500, "quantity": 1}],
                                "legs": with_leg0(entry={"price": 300, "time": 1})}),
    ("leg times at the bounds", {"legs": with_leg0(entry={"price": 300, "time": OPEN},
                                                   exit={"price": 520, "time": CLOSE, "kind": "closed"})}),
    ("10 legs", {"legs": [leg(id=f"l{i + 1}") for i in range(10)]}),
    ("weekly month", {"legs": with_leg0(contractMonth="2028-02-29")}),
    ("ITM expired with value", {"legs": with_leg0(exit={"price": 35.5, "kind": "expired"})}),
    ("maxLoss without lc", {"riskPlan": "maxLoss", "lc": None, "lcLossPlanYen": None, "brokenCondition": None}),
    ("lc none without plan", {"lc": None, "lcLossPlanYen": None}),
]  # fmt: skip


@pytest.mark.parametrize(("name", "over"), ACCEPTED_CASES, ids=[c[0] for c in ACCEPTED_CASES])
def test_accepted_bodies(api, option_iid, name, over):
    sent = apply_over(p1_body(option_iid), over)
    res = api.post("/api/trades", A, sent)
    assert res.status_code == 201, (name, res.get_json())
    assert res.get_json()["record"] == sent and res.get_json()["schemaVersion"] == 2


# ── レッグは商品の形がオプションの銘柄だけ（決定 9） ──


@pytest.mark.parametrize("product_form", ["spotCfd", "future"])
def test_legs_need_option_instrument(api, product_form):
    put_default_account(api, A, ITEMS["P1"]["settings"])
    iid = api.instrument(A, "架空の先物", productForm=product_form, multiplier=1000)["id"]
    res = api.post("/api/trades", A, p1_body(iid))
    assert issues_of(res) == [{"field": "legs", "kind": "productForm"}]
    assert api.trades(A) == []


def test_legs_put_to_non_option_instrument(api):
    """直しで銘柄を先物に変える・?snapshot=current で今の銘柄が先物になっていたら 400・何も書かない"""
    tid, iid, sent = create(api, "P1")
    before = raw_trade(api, A, tid)
    fut = api.instrument(A, "架空の先物", productForm="future")["id"]
    res = api.put(f"/api/trades/{tid}", A, {**sent, "instrumentId": fut})
    assert issues_of(res) == [{"field": "legs", "kind": "productForm"}]
    inst = {**ITEMS["P1"]["instrument"], "productForm": "future"}
    assert api.put(f"/api/instruments/{iid}", A, inst).status_code == 200
    res = api.put(f"/api/trades/{tid}?snapshot=current", A, sent)
    assert issues_of(res) == [{"field": "legs", "kind": "productForm"}]
    assert raw_trade(api, A, tid) == before
    # 写し直さなければ、記録したときの snapshot（オプション）のまま直せる
    res = api.put(f"/api/trades/{tid}", A, {**sent, "thesis": "直した"})
    assert res.status_code == 200 and res.get_json()["record"]["legs"] == sent["legs"]


# ── 有限でない数（#116 のレビュー N3） ──


def test_nan_in_legs_body_is_400(api, option_iid):
    """本文の NaN・Infinity は JSON として読まない（400 json）。何も保存しない"""
    for needle, bad in (('"strike": 37000', '"strike": NaN'), ('"quantity": 2', '"quantity": Infinity')):
        raw = json.dumps(p1_body(option_iid)).replace(needle, bad, 1)
        assert bad in raw
        res = api.call("POST", "/api/trades", A, raw=raw.encode())
        assert issues_of(res) == [{"field": "", "kind": "json"}]
    assert api.trades(A) == []


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf"), 1e300])
@pytest.mark.parametrize("key", ["strike", "quantity"])
def test_non_finite_leg_numbers(key, value):
    """検査の関数に直に渡しても、レッグの数の欄の有限でない・巨大な値は range"""
    body = body_of(ITEMS["P1"], "IID")
    body["legs"][0][key] = value
    record, issues = schema.validate_trade(body)
    assert record is None and {"field": f"legs[0].{key}", "kind": "range"} in issues


def test_legs_missing_log(api, caplog, monkeypatch):
    """守り (b) の 409 は決まった語のログを 1 行（ID・uid・本文は出さない）"""
    tid, iid, _sent = create(api, "P1")
    caplog.set_level(logging.DEBUG)
    monkeypatch.setattr(logs.logger, "propagate", True)
    legacy = {**FIXTURE["legacyEdit"]["body"], "instrumentId": iid, "thesis": "MARKER-脚-5d"}
    assert api.put(f"/api/trades/{tid}", A, legacy).status_code == 409
    unique = {(r.created, r.getMessage()) for r in caplog.records}
    events = [json.loads(m) for _c, m in unique if "trade_legs_missing" in m]
    assert events == [{"event": "trade_legs_missing"}]
    assert tid not in caplog.text and A not in caplog.text and "MARKER-脚-5d" not in caplog.text
