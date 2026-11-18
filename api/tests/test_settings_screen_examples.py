"""設定の画面が作る本文を、本物の API が受ける（Issue #5 AC-1〜AC-7・KEEP-2・KEEP-4、#47 の口座・KEEP-6）。

共有の合成の fixture ``tests/fixtures/records/settings-bodies.json`` は TS のテスト
（``tests/ui/settings-bodies-fixture.test.ts``）が画面の純関数から作る。画面の偽の API
（``tests/ui/helpers/fake-api.ts``）と本物の形・規則（履歴の増え方・409・既定・snapshot）がずれたら、ここで落ちる。
口座（#47）: 設定の画面の足す・直す欄と記録する画面の 2 欄が作る本文を、POST / PUT /api/accounts に通す。
設定（/api/settings）は画面がもう送らないが、表示の単位を保つ形は 1 場面で見る（KEEP-6）。
保存先 2 つ（記憶・エミュレーターの Firestore）で回す。値・名前はすべて架空。
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


def put_default(api, capital, risk=1, name="口座 1") -> dict:
    res = api.put("/api/accounts/default", A, {"name": name, "capitalYen": capital, "riskTolerancePct": risk})
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def test_keep6_settings_body_keeps_performance_unit(api):
    """KEEP-6: 円にしてある利用者の設定の PUT・GET は今と同じ形と値（資金が変われば設定の履歴に 1 件）"""
    items = load_fixture("settings-bodies.json")["settings"]
    assert [x["name"] for x in items] == ["KEEP-6"]
    item = items[0]
    before = put_settings(api, item["before"])
    got = put_settings(api, item["body"])
    sent = item["body"]
    assert {k: got[k] for k in sent} == sent
    assert same_typed({k: got[k] for k in sent}, sent)
    assert len(got["capitalHistory"]) - len(before["capitalHistory"]) == 1
    assert api.get("/api/settings", A).get_json()["performanceUnit"] == "yen"
    assert set(got) == {"capitalYen", "riskTolerancePct", "performanceUnit", "capitalHistory"}


def test_account_bodies_are_accepted_as_sent(api):
    """#47: 画面の口座の本文を本物が受け、送った値がそのまま返る（足す = 201・直す = 200）。
    資金を入れて足すと履歴 1 件"""
    put_settings(api, {"capitalYen": 1_000_000, "riskTolerancePct": 1, "performanceUnit": "R"})
    items = load_fixture("settings-bodies.json")["accounts"]
    assert [x["name"] for x in items] == ["E1", "E2", "E3b", "A7", "F9", "edit", "B5"]
    for item in items:
        sent = item["body"]
        if item["kind"] == "create":
            res = api.post("/api/accounts", A, sent)
            assert res.status_code == 201, (item["name"], res.get_json())
        else:
            res = api.put("/api/accounts/default", A, sent)
            assert res.status_code == 200, (item["name"], res.get_json())
        got = res.get_json()
        assert {k: got[k] for k in sent} == sent, item["name"]
        assert same_typed({k: got[k] for k in sent}, sent), item["name"]
        if item["kind"] == "create":
            # 省いた許容リスクは 1（記録する画面の 2 欄。B5）、資金を入れて足すと履歴 1 件
            assert got["riskTolerancePct"] == sent.get("riskTolerancePct", 1), item["name"]
            assert len(got["capitalHistory"]) == (0 if got["capitalYen"] is None else 1), item["name"]
            # 口座の通貨: 本文に無ければ JPY（記録する画面の 2 欄）、あれば本文の値（#47 PR-2 F9 は USD）
            assert got["currency"] == sent.get("currency", "JPY"), item["name"]
        again = api.get(f"/api/accounts/{got['id']}", A).get_json()
        assert {k: again[k] for k in sent} == sent, item["name"]
    # 直した既定の口座: 設定から写した履歴（1 件）+ 直した資金の 1 件
    one = api.get("/api/accounts/default", A).get_json()
    assert [h["valueYen"] for h in one["capitalHistory"]] == [1_000_000, 800_000]


def test_e4_e5_capital_history(api):
    """E4: 同じ値では増えない。E5: 1,000,000 → 800,000 → 900,000 で 3 件（API は古い順。画面が逆にする）。口座ごと"""
    for v in (1_000_000, 1_000_000, 800_000, 900_000):
        got = put_default(api, v)
    assert [h["valueYen"] for h in got["capitalHistory"]] == [1_000_000, 800_000, 900_000]
    ats = [h["at"] for h in got["capitalHistory"]]
    assert ats == sorted(ats)


def test_account_out_of_range_is_rejected(api):
    """画面が先に止める入力は、API も 400 で受けない（2 重の守り）"""
    put_default(api, 1_000_000)
    for bad in ({"capitalYen": 0}, {"capitalYen": -5}, {"riskTolerancePct": 0.4}, {"riskTolerancePct": 3.1}):
        body = {"name": "口座 1", "capitalYen": 1_000_000, "riskTolerancePct": 1, **bad}
        res = api.put("/api/accounts/default", A, body)
        assert res.status_code == 400, bad
    assert api.get("/api/accounts/default", A).get_json()["capitalYen"] == 1_000_000


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
    """E15: 資金が未設定のときに T3 → 口座の資金を保存 → T3 は資金 null のまま、
    後の取引には写る（#47 で口座「口座 1」に）"""
    inst = api.instrument(A, "XAU")
    t3 = api.post("/api/trades", A, t1(inst["id"])).get_json()
    assert t3["snapshot"]["capitalYen"] is None
    put_default(api, 1_000_000)
    assert api.get(f"/api/trades/{t3['id']}", A).get_json()["snapshot"]["capitalYen"] is None
    t4 = api.post("/api/trades", A, t1(inst["id"])).get_json()
    assert t4["snapshot"]["capitalYen"] == 1_000_000
