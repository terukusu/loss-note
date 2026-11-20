"""編集の画面のチャートの変更と付属のチャート（Issue #89 の AC-3・AC-5・AC-7・KEEP-1・KEEP-2、ADR-0006）。

取引の直し ``PUT /api/trades/{id}`` が multipart（部分 ``record`` + 差し替え・足す画像 ``{slot}Chart`` + 外す枠
``removeChart``）を受け、取引とチャートを 1 トランザクションで書く。付属のチャートは枠 ``x1``〜``x5``（最大 5 枚）で、
並び・時間足・一言は記録の ``extraCharts``。保存先 2 つ（記憶・エミュレーターの Firestore）で同じテストを回す。
画像は合成、値はすべて架空。
"""

import json

import pytest
from helpers.charts import (
    chart_count,
    chart_jpeg,
    chart_parts,
    chart_png,
    encode_multipart,
    post_multipart,
    post_with_charts,
    stored_chart,
)
from helpers.records import t1

from loss_note_api import charts, schema

A = "editChartUserA"
B = "editChartUserB"


def e1(iid: str, **over) -> dict:
    """エントリー時 4 時間足・決済時 4 時間足（値は架空）"""
    return t1(iid, **{"entryChartTimeframe": "4h", "exitChartTimeframe": "4h", **over})


def put_parts(record: dict, charts_: dict | None = None, removes: tuple[str, ...] = ()):
    parts = chart_parts(record, charts_)
    parts += [(charts.REMOVE_PART, s, None, None) for s in removes]
    return parts


def put_multipart(api, uid: str, tid: str, parts, query: str = ""):
    body, ctype = encode_multipart(parts)
    return api.call("PUT", f"/api/trades/{tid}{query}", uid, raw=body, content_type=ctype)


@pytest.fixture
def iid(api):
    return api.instrument(A)["id"]


def created_with(api, iid, record=None, imgs=None):
    imgs = imgs if imgs is not None else {"entry": (chart_png(), "image/png"), "exit": (chart_png(), "image/png")}
    res = post_with_charts(api, A, record or e1(iid), imgs)
    assert res.status_code == 201, res.get_json()
    return res.get_json()


# ---- 純関数 ----


def test_extra_issues():
    rec = {"extraCharts": [{"slot": "x1"}]}
    assert charts.chart_timeframe_issues(rec, {"x1"}) == []
    assert charts.chart_timeframe_issues(rec, set()) == [{"field": "extraCharts", "kind": "noChart"}]
    assert charts.chart_timeframe_issues({}, {"x2"}) == [{"field": "x2Chart", "kind": "noEntry"}]


def test_schema_extra_charts():
    base = t1("inst1")
    ok, issues = schema.validate_trade({**base, "extraCharts": [{"slot": "x2", "timeframe": "1d", "note": "上位足"},
                                                                 {"slot": "x1"}]})  # fmt: skip
    assert issues == [] and ok["extraCharts"] == [{"slot": "x2", "timeframe": "1d", "note": "上位足"}, {"slot": "x1"}]
    # 空の並び・空の一言は持たない
    ok, _ = schema.validate_trade({**base, "extraCharts": []})
    assert "extraCharts" not in ok
    ok, _ = schema.validate_trade({**base, "extraCharts": [{"slot": "x1", "note": ""}]})
    assert ok["extraCharts"] == [{"slot": "x1"}]
    bad = [
        ([{"slot": "x6"}], "extraCharts[0].slot", "enum"),
        ([{"slot": "entry"}], "extraCharts[0].slot", "enum"),
        ([{"slot": "x1", "note": "あ" * 41}], "extraCharts[0].note", "length"),
        ([{"slot": "x1", "timeframe": "2h"}], "extraCharts[0].timeframe", "enum"),
        ([{"slot": "x1"}, {"slot": "x1"}], "extraCharts[1].slot", "duplicate"),
        ([{"slot": f"x{i}"} for i in range(1, 6)] + [{"slot": "x1"}], "extraCharts", "length"),
        ([{"slot": "x1", "chart": "users/a"}], "extraCharts[0]", "unknownField"),
        ({"slot": "x1"}, "extraCharts", "type"),
    ]
    for value, field, kind in bad:
        rec, issues = schema.validate_trade({**base, "extraCharts": value})
        assert rec is None and {"field": field, "kind": kind} in issues, value
    ok, issues = schema.validate_trade({**base, "extraCharts": [{"slot": "x1", "note": "あ" * 40}]})
    assert issues == []


# ---- 例 1・3: 差し替えを取引と 1 要求で ----


def test_replace_exit_chart_with_record_in_one_put(api, iid):
    created = created_with(api, iid)
    tid = created["id"]
    new = chart_jpeg(filler=b"new-", size=4_000)
    rec = e1(iid, exitChartTimeframe="1d")
    res = put_multipart(api, A, tid, put_parts(rec, {"exit": (new, "image/jpeg")}))
    assert res.status_code == 200, res.get_json()
    got = res.get_json()
    assert got["record"]["exitChartTimeframe"] == "1d"
    assert got["charts"]["exit"] == {"contentType": "image/jpeg", "size": len(new)}
    assert got["charts"]["entry"] == created["charts"]["entry"]
    assert api.get(f"/api/trades/{tid}/charts/exit", A).data == new
    assert chart_count(api, A) == 2


def test_failure_keeps_trade_and_charts(memory_api):
    api = memory_api
    iid = api.instrument(A)["id"]
    created = created_with(api, iid)
    tid = created["id"]
    old_exit = api.get(f"/api/trades/{tid}/charts/exit", A).data
    api.store.fail_charts = True
    parts = put_parts(e1(iid, exitChartTimeframe="1d", lc=99), {"exit": (chart_jpeg(), "image/jpeg")})
    res = put_multipart(api, A, tid, parts)
    assert res.status_code == 503
    api.store.fail_charts = False
    assert api.get(f"/api/trades/{tid}", A).get_json() == created
    assert api.get(f"/api/trades/{tid}/charts/exit", A).data == old_exit


# ---- 例 4〜6: 外す・足す・チャートの無い枠の時間足 ----


def test_remove_exit_and_its_timeframe(api, iid):
    created = created_with(api, iid, e1(iid, exitChartTimeframe="1d"))
    tid = created["id"]
    # 外す枠の時間足を本文に残すと 400（外した後にチャートが無い）
    res = put_multipart(api, A, tid, put_parts(e1(iid, exitChartTimeframe="1d"), removes=("exit",)))
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "exitChartTimeframe", "kind": "noChart"}]
    rec = t1(iid, entryChartTimeframe="4h")
    res = put_multipart(api, A, tid, put_parts(rec, removes=("exit",)))
    assert res.status_code == 200, res.get_json()
    got = res.get_json()
    assert "exit" not in got["charts"] and "exitChartTimeframe" not in got["record"]
    assert api.get(f"/api/trades/{tid}/charts/exit", A).status_code == 404
    assert stored_chart(api, A, f"{tid}-exit") is None
    assert chart_count(api, A) == 1


def test_add_chart_to_trade_without_charts(api, iid):
    tid = api.post("/api/trades", A, t1(iid)).get_json()["id"]
    res = put_multipart(api, A, tid, put_parts(t1(iid, exitChartTimeframe="1h"), {"exit": (chart_png(), "image/png")}))
    assert res.status_code == 200, res.get_json()
    got = res.get_json()
    assert got["record"]["exitChartTimeframe"] == "1h" and list(got["charts"]) == ["exit"]
    # JSON の直しは今のまま（チャートはそのまま）
    res = api.put(f"/api/trades/{tid}", A, t1(iid, exitChartTimeframe="1d"))
    assert res.status_code == 200 and res.get_json()["charts"] == got["charts"]


# ---- 付属のチャート（例 7〜11） ----


def test_create_with_extra_charts(api, iid):
    rec = e1(iid, extraCharts=[{"slot": "x1", "timeframe": "1d", "note": "上位足の環境"}])
    img = (chart_png(), "image/png")
    created = created_with(api, iid, rec, {"entry": img, "exit": img, "x1": img})
    assert created["record"]["extraCharts"] == [{"slot": "x1", "timeframe": "1d", "note": "上位足の環境"}]
    assert list(created["charts"]) == ["entry", "exit", "x1"]
    assert api.get(f"/api/trades/{created['id']}/charts/x1", A).status_code == 200


def test_extra_chart_needs_entry_and_vice_versa(api, iid):
    img = (chart_png(), "image/png")
    res = post_with_charts(api, A, e1(iid), {"entry": img, "exit": img, "x1": img})
    assert res.status_code == 400 and res.get_json()["issues"] == [{"field": "x1Chart", "kind": "noEntry"}]
    res = post_with_charts(api, A, e1(iid, extraCharts=[{"slot": "x2"}]), {"entry": img, "exit": img})
    assert res.status_code == 400 and res.get_json()["issues"] == [{"field": "extraCharts", "kind": "noChart"}]
    assert api.trades(A) == [] and chart_count(api, A) == 0


def test_seven_charts_and_order(api, iid):
    img = (chart_png(), "image/png")
    order = ["x3", "x1", "x5", "x2", "x4"]
    rec = e1(iid, extraCharts=[{"slot": s} for s in order])
    created = created_with(api, iid, rec, {"entry": img, "exit": img, **{s: img for s in order}})
    assert [e["slot"] for e in created["record"]["extraCharts"]] == order
    assert chart_count(api, A) == 7
    # 2 枚目（x1）を外して、空いた枠に 1 枚足す → 並びは追加した順（末尾）
    rec2 = e1(iid, extraCharts=[*({"slot": s} for s in ("x3", "x5", "x2", "x4")), {"slot": "x1", "note": "新"}])
    res = put_multipart(api, A, created["id"], put_parts(rec2, {"x1": (chart_jpeg(), "image/jpeg")}))
    assert res.status_code == 200, res.get_json()
    assert [e["slot"] for e in res.get_json()["record"]["extraCharts"]] == ["x3", "x5", "x2", "x4", "x1"]
    # 外すだけ（x5）
    rec3 = e1(iid, extraCharts=[{"slot": s} for s in ("x3", "x2", "x4", "x1")])
    res = put_multipart(api, A, created["id"], put_parts(rec3, removes=("x5",)))
    assert res.status_code == 200 and chart_count(api, A) == 6
    # 全部外す（並びは空 = 鍵ごと無い）
    res = put_multipart(api, A, created["id"], put_parts(e1(iid), removes=("x3", "x2", "x4", "x1")))
    assert res.status_code == 200, res.get_json()
    assert "extraCharts" not in res.get_json()["record"] and chart_count(api, A) == 2


def test_json_put_without_extra_charts_keeps_them(api, iid):
    """古い画面の JSON の直し（extraCharts なし）は、保存済みの付属の並びを保つ（KEEP-1）"""
    rec = e1(iid, extraCharts=[{"slot": "x1", "note": "上位足"}])
    img = (chart_png(), "image/png")
    created = created_with(api, iid, rec, {"entry": img, "exit": img, "x1": img})
    res = api.put(f"/api/trades/{created['id']}", A, e1(iid, lc=99))
    assert res.status_code == 200
    assert res.get_json()["record"]["extraCharts"] == [{"slot": "x1", "note": "上位足"}]


def test_multipart_put_shape(api, iid):
    created = created_with(api, iid)
    tid = created["id"]
    img = (chart_png(), "image/png")
    cases = [
        ("同じ枠に画像と外す", put_parts(e1(iid), {"exit": img}, removes=("exit",)),
         [{"field": "removeChart", "kind": "conflict"}]),
        ("知らない枠を外す", put_parts(e1(iid), removes=("x9",)), [{"field": "removeChart", "kind": "enum"}]),
        ("外すの重複", put_parts(e1(iid), removes=("exit", "exit")), [{"field": "removeChart", "kind": "duplicate"}]),
        ("知らない部分", put_parts(e1(iid)) + [("chartId", "x", None, None)], [{"field": "", "kind": "unknownPart"}]),
        ("record なし", chart_parts(None, {"exit": img}), [{"field": "record", "kind": "required"}]),
    ]  # fmt: skip
    for name, parts, issues in cases:
        res = put_multipart(api, A, tid, parts)
        assert res.status_code == 400, name
        assert res.get_json() == {"error": "invalid", "issues": issues}, name
    assert api.get(f"/api/trades/{tid}", A).get_json() == created
    # 作成の multipart は外すの部分を受けない
    res = post_multipart(api, A, put_parts(e1(iid), {"entry": img, "exit": img}, removes=("x1",)))
    assert res.status_code == 400 and res.get_json()["issues"] == [{"field": "", "kind": "unknownPart"}]


def test_snapshot_current_with_multipart(api, iid):
    created = created_with(api, iid)
    res = put_multipart(api, A, created["id"], put_parts(e1(iid), removes=("exit",)), "?snapshot=current")
    # 外した枠の時間足が本文に残る → 400（何も書かない）
    assert res.status_code == 400
    res = put_multipart(api, A, created["id"], put_parts(t1(iid, entryChartTimeframe="4h"), removes=("exit",)),
                        "?snapshot=current")  # fmt: skip
    assert res.status_code == 200 and list(res.get_json()["charts"]) == ["entry"]


def test_single_slot_endpoints_for_extra(api, iid):
    """枠ごとの入口も付属の枠で使える: 差し替えは並びに無ければ末尾に足し、時間足は選び直し。外すと並びからも消える"""
    img = (chart_png(), "image/png")
    created = created_with(api, iid, e1(iid, extraCharts=[{"slot": "x1", "timeframe": "1d", "note": "上位足"}]),
                           {"entry": img, "exit": img, "x1": img})  # fmt: skip
    tid = created["id"]
    res = api.put(f"/api/trades/{tid}/charts/x1", A, raw=chart_jpeg(), content_type="image/jpeg")
    assert res.status_code == 200 and res.get_json()["record"]["extraCharts"] == [{"slot": "x1", "note": "上位足"}]
    res = api.put(f"/api/trades/{tid}/charts/x2", A, raw=chart_png(), content_type="image/png")
    assert [e["slot"] for e in res.get_json()["record"]["extraCharts"]] == ["x1", "x2"]
    res = api.delete(f"/api/trades/{tid}/charts/x1", A)
    assert res.status_code == 200 and res.get_json()["record"]["extraCharts"] == [{"slot": "x2"}]
    res = api.delete(f"/api/trades/{tid}/charts/x2", A)
    assert "extraCharts" not in res.get_json()["record"]
    assert api.delete(f"/api/trades/{tid}", A).status_code == 204
    assert chart_count(api, A) == 0


def test_other_user_cannot_put_multipart(api, iid):
    created = created_with(api, iid)
    b_inst = api.instrument(B)["id"]
    res = put_multipart(api, B, created["id"], put_parts(t1(b_inst), removes=("exit",)))
    assert res.status_code == 404 and res.get_json() == {"error": "not_found"}
    assert api.get(f"/api/trades/{created['id']}", A).get_json() == created
    assert json.dumps(created["charts"])


# ---- レビュー後の修正（B2・N5・N9） ----


def test_firestore_chart_write_failure_keeps_trade_and_charts(api, iid):
    """B2: エミュレーターの Firestore で、チャートの文書を書けない（1 MiB を超える文書）トランザクションは
    取引もチャートも前のまま（例 3。記憶の保存先の fail_charts と同じ約束を本物で）"""
    if api.kind != "firestore":
        pytest.skip("エミュレーターの Firestore だけ（記憶の保存先は test_failure_keeps_trade_and_charts）")
    created = created_with(api, iid)
    tid = created["id"]
    old_exit = api.get(f"/api/trades/{tid}/charts/exit", A).data
    too_big = {"contentType": "image/png", "data": b"x" * 1_100_000}

    def mutate(doc, _inst, _acc):
        return {**doc, "updatedAt": doc["updatedAt"] + 1, "record": {**doc["record"], "lc": 99.0}}

    with pytest.raises(Exception):  # noqa: B017 - SDK の例外の型は版で変わる。書けなかったことだけを見る
        api.store.update_trade(A, tid, iid, None, mutate, charts={"exit": too_big, "entry": None})
    assert api.get(f"/api/trades/{tid}", A).get_json() == created
    assert api.get(f"/api/trades/{tid}/charts/exit", A).data == old_exit
    assert api.get(f"/api/trades/{tid}/charts/entry", A).status_code == 200
    assert chart_count(api, A) == 2


def test_seven_near_limit_charts_create_replace_delete(api, iid):
    """N5・N9: 上限近く（各 499,000 B）の 7 枚を作り、7 枚を 1 要求で差し替え、取引を消すとチャートは 0 件"""
    order = list(charts.EXTRA_SLOTS)
    rec = e1(iid, extraCharts=[{"slot": s, "note": f"資料 {i}"} for i, s in enumerate(order)])
    big = {s: (chart_png(filler=s.encode(), size=499_000), "image/png") for s in charts.SLOTS}
    res = post_with_charts(api, A, rec, big)
    assert res.status_code == 201, res.get_json()
    tid = res.get_json()["id"]
    assert chart_count(api, A) == 7
    again = {s: (chart_jpeg(filler=s.encode(), size=499_000), "image/jpeg") for s in charts.SLOTS}
    res = put_multipart(api, A, tid, put_parts(rec, again))
    assert res.status_code == 200, res.get_json()
    assert all(m["contentType"] == "image/jpeg" for m in res.get_json()["charts"].values())
    assert api.get(f"/api/trades/{tid}/charts/x5", A).data == again["x5"][0]
    assert chart_count(api, A) == 7
    assert api.delete(f"/api/trades/{tid}", A).status_code == 204
    assert chart_count(api, A) == 0
    for s in charts.SLOTS:
        assert stored_chart(api, A, f"{tid}-{s}") is None


def test_large_remove_chart_value(api, iid):
    """#151: 文字の部分の上限（MAX_FORM_MEMORY = 128 KiB）は removeChart にも効く。128 KiB までは列挙の検査で 400
    enum、1 B 超えは 400 tooLarge。取引とチャートは変わらない"""
    tid = created_with(api, iid)["id"]
    rec = t1(iid, entryChartTimeframe="4h")
    for size, issues in (
        (charts.MAX_RECORD_PART + 1, [{"field": charts.REMOVE_PART, "kind": "enum"}]),
        (charts.MAX_FORM_MEMORY, [{"field": charts.REMOVE_PART, "kind": "enum"}]),
        (charts.MAX_FORM_MEMORY + 1, [{"field": "", "kind": "tooLarge"}]),
    ):
        parts = chart_parts(rec) + [(charts.REMOVE_PART, "x" * size, None, None)]
        res = put_multipart(api, A, tid, parts)
        assert res.status_code == 400, size
        assert res.get_json() == {"error": "invalid", "issues": issues}, size
    assert api.get(f"/api/trades/{tid}/charts/exit", A).status_code == 200
    assert chart_count(api, A) == 2


def test_crlf_in_image_put_with_remove(api, iid):
    """#151: 直しの multipart（画像の差し替え + removeChart）でも、CR / LF の詰め物の画像が通る。単体の差し替え（生の
    バイト）も同じ画像で通る"""
    tid = created_with(api, iid)["id"]
    rec = t1(iid, entryChartTimeframe="4h")
    first = chart_png(filler=b"\r\n", size=70_000)
    res = put_multipart(api, A, tid, put_parts(rec, {"entry": (first, "image/png")}, removes=("exit",)))
    assert res.status_code == 200, res.get_json()
    assert api.get(f"/api/trades/{tid}/charts/entry", A).data == first
    assert api.get(f"/api/trades/{tid}/charts/exit", A).status_code == 404
    for size in (300_000, charts.MAX_BYTES):
        img = chart_png(filler=b"\r\n", size=size)
        res = put_multipart(api, A, tid, put_parts(rec, {"entry": (img, "image/png")}))
        assert res.status_code == 200, (size, res.get_json())
        assert api.get(f"/api/trades/{tid}/charts/entry", A).data == img
    img = chart_png(filler=b"\n\r", size=charts.MAX_BYTES)
    assert api.put(f"/api/trades/{tid}/charts/exit", A, raw=img, content_type="image/png").status_code == 200
    assert api.get(f"/api/trades/{tid}/charts/exit", A).data == img
