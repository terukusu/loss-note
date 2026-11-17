"""設定の画面が作る本文を、本物の API が受ける（Issue #5 AC-1〜AC-7・KEEP-2・KEEP-4）。

共有の合成の fixture ``tests/fixtures/records/settings-bodies.json`` は TS のテスト
（``tests/ui/settings-bodies-fixture.test.ts``）が画面の純関数から作る。画面の偽の API
（``tests/ui/helpers/fake-api.ts``）と本物の形・規則（履歴の増え方・409・既定・snapshot）がずれたら、ここで落ちる。
API のコードは変えない（KEEP-4）。保存先 2 つ（記憶・エミュレーターの Firestore）で回す。値はすべて架空。
"""

from helpers.records import load_fixture, same_typed, t1

A = "userA"
DEFAULTS = {
    "underlyingKind": "other",
    "productForm": "spotCfd",
    "priceCurrency": None,
    "multiplier": 1,
    "quantityStep": 1,
}


def put_settings(api, body: dict) -> dict:
    res = api.put("/api/settings", A, body)
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def test_settings_bodies_are_accepted_as_sent(api):
    items = load_fixture("settings-bodies.json")["settings"]
    assert [x["name"] for x in items] == ["E1", "E2", "E3b", "E7", "KEEP-2"]
    for item in items:
        before = put_settings(api, item["before"])
        got = put_settings(api, item["body"])
        sent = item["body"]
        assert {k: got[k] for k in sent} == sent, item["name"]
        assert same_typed({k: got[k] for k in sent}, sent), item["name"]
        # 履歴は資金が変わったときだけ 1 件増える（R2）
        grew = len(got["capitalHistory"]) - len(before["capitalHistory"])
        assert grew == (1 if sent["capitalYen"] != item["before"]["capitalYen"] else 0), item["name"]
        again = api.get("/api/settings", A).get_json()
        assert {k: again[k] for k in sent} == sent, item["name"]


def test_e3b_keeps_capital_unset_and_history_empty(api):
    """E3b: 未設定のまま許容リスクだけを保存しても、履歴は増えない"""
    item = next(x for x in load_fixture("settings-bodies.json")["settings"] if x["name"] == "E3b")
    got = put_settings(api, item["body"])
    assert got["capitalYen"] is None
    assert got["riskTolerancePct"] == 1.5
    assert got["capitalHistory"] == []


def test_keep2_performance_unit_is_kept(api):
    """KEEP-2: 円にしてある利用者が資金を保存しても、設定の API は円を返す"""
    item = next(x for x in load_fixture("settings-bodies.json")["settings"] if x["name"] == "KEEP-2")
    put_settings(api, item["before"])
    got = put_settings(api, item["body"])
    assert got["performanceUnit"] == "yen"
    assert api.get("/api/settings", A).get_json()["performanceUnit"] == "yen"


def test_e4_e5_capital_history(api):
    """E4: 同じ値では増えない。E5: 1,000,000 → 800,000 → 900,000 で 3 件（API は古い順。画面が逆にする）"""
    base = {"riskTolerancePct": 1, "performanceUnit": "R"}
    for v in (1_000_000, 1_000_000, 800_000, 900_000):
        got = put_settings(api, {"capitalYen": v, **base})
    assert [h["valueYen"] for h in got["capitalHistory"]] == [1_000_000, 800_000, 900_000]
    ats = [h["at"] for h in got["capitalHistory"]]
    assert ats == sorted(ats)


def test_settings_out_of_range_is_rejected(api):
    """画面が先に止める入力は、API も 400 で受けない（E3・E8 の 2 重の守り）"""
    base = {"capitalYen": 1_000_000, "riskTolerancePct": 1, "performanceUnit": "R"}
    put_settings(api, base)
    for bad in ({"capitalYen": 0}, {"capitalYen": -5}, {"riskTolerancePct": 0.4}, {"riskTolerancePct": 3.1}):
        res = api.put("/api/settings", A, {**base, **bad})
        assert res.status_code == 400, bad
    assert api.get("/api/settings", A).get_json()["capitalYen"] == 1_000_000


def test_instrument_bodies_are_accepted_as_sent(api):
    items = load_fixture("settings-bodies.json")["instruments"]
    assert [x["name"] for x in items] == ["E9", "E12", "full", "E13"]
    for item in items:
        if item["before"] is None:
            # E13: 名前だけで足す → 既定は自動で足したときと同じ（R5・C21）
            res = api.post("/api/instruments", A, item["body"])
            assert res.status_code == 201, (item["name"], res.get_json())
            got = res.get_json()
            assert got["name"] == item["body"]["name"]
            assert {k: got[k] for k in DEFAULTS} == DEFAULTS
            assert "underlying" not in got
            continue
        created = api.post("/api/instruments", A, {"name": f"{item['before']['name']}-{item['name']}"})
        assert created.status_code == 201
        iid = created.get_json()["id"]
        sent = {**item["body"], "name": f"{item['body']['name']}-{item['name']}"}
        res = api.put(f"/api/instruments/{iid}", A, sent)
        assert res.status_code == 200, (item["name"], res.get_json())
        got = res.get_json()
        assert {k: got[k] for k in sent} == sent, item["name"]
        assert same_typed({k: got[k] for k in sent}, sent), item["name"]
        if "underlying" not in sent:
            assert "underlying" not in got, item["name"]
        again = api.get(f"/api/instruments/{iid}", A).get_json()
        assert {k: again[k] for k in sent} == sent, item["name"]


def test_e10_duplicate_name_is_409(api):
    """E10: 別の銘柄の名前を「日経２２５ 」（全角数字・末尾の空白）に直すと 409。

    画面は先に止め、API の 409 も同じ文言で扱う
    """
    api.instrument(A, "日経225")
    other = api.instrument(A, "US30")
    body = {"name": "日経２２５ ", **DEFAULTS}
    res = api.put(f"/api/instruments/{other['id']}", A, body)
    assert res.status_code == 409
    assert res.get_json()["reason"] == "duplicateName"
    # 自分自身の名前（大文字小文字の違い）は重複でない
    res = api.put(f"/api/instruments/{other['id']}", A, {"name": "us30", **DEFAULTS})
    assert res.status_code == 200


def test_e14_instrument_change_does_not_touch_recorded_trades(api):
    """E14: 乗数 1 で T1 → 乗数を 100 に → T2。T1 の snapshot は乗数 1 のまま、T2 は 100（C36）"""
    xau = api.instrument(A, "XAU", multiplier=1)
    t_1 = api.post("/api/trades", A, t1(xau["id"])).get_json()
    assert t_1["snapshot"]["instrument"]["multiplier"] == 1
    body = {"name": "XAU", "underlyingKind": "commodity", "productForm": "spotCfd", "priceCurrency": "JPY",
            "multiplier": 100, "quantityStep": 1}  # fmt: skip
    assert api.put(f"/api/instruments/{xau['id']}", A, body).status_code == 200
    t_2 = api.post("/api/trades", A, t1(xau["id"])).get_json()
    assert t_2["snapshot"]["instrument"]["multiplier"] == 100
    again = api.get(f"/api/trades/{t_1['id']}", A).get_json()
    assert again["snapshot"] == t_1["snapshot"]
    assert again["record"] == t_1["record"]


def test_e15_capital_after_trade_is_not_backfilled(api):
    """E15: 資金が未設定のときに T3 → 資金を保存 → T3 は資金 null のまま、後の取引には写る"""
    inst = api.instrument(A, "XAU")
    t3 = api.post("/api/trades", A, t1(inst["id"])).get_json()
    assert t3["snapshot"]["capitalYen"] is None
    put_settings(api, {"capitalYen": 1_000_000, "riskTolerancePct": 1, "performanceUnit": "R"})
    assert api.get(f"/api/trades/{t3['id']}", A).get_json()["snapshot"]["capitalYen"] is None
    t4 = api.post("/api/trades", A, t1(inst["id"])).get_json()
    assert t4["snapshot"]["capitalYen"] == 1_000_000
