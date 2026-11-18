"""根拠の足のチャート画像（Issue #12 の AC-3・5・6・8・9・KEEP-1・KEEP-2、ADR-0006）。

作成は ``POST /api/trades`` の multipart（部分 ``record`` + ``entryChart`` / ``exitChart``）、差し替え・外す・読み戻しは
``/api/trades/{id}/charts/{slot}``。保存先 2 つ（記憶・エミュレーターの Firestore）で同じテストを回す。
画像は合成（見出しだけ本物の形）、値はすべて架空。
"""

import tempfile

import pytest
import werkzeug.formparser
from helpers.charts import (
    CHART_MARKER,
    chart_count,
    chart_jpeg,
    chart_parts,
    chart_png,
    encode_multipart,
    jpeg,
    png,
    post_multipart,
    post_with_charts,
    stored_chart,
)
from helpers.records import load_fixture, t1

from loss_note_api import charts
from loss_note_api.app import create_app

A = "chartUserA"


def e1(iid: str, **over) -> dict:
    """設計書 5.6 #20 の形（エントリー時 4 時間足・決済時 日足）。値は架空"""
    return t1(iid, entryChartTimeframe="4h", exitChartTimeframe="1d", **over)


def chart_url(tid: str, slot: str) -> str:
    return f"/api/trades/{tid}/charts/{slot}"


@pytest.fixture
def iid(api):
    return api.instrument(A)["id"]


# ---- 純関数（P-1） ----


@pytest.mark.parametrize(
    ("data", "ctype", "want"),
    [
        (png(2000, 10, size=500_000), "image/png", None),
        (jpeg(10, 2000, size=500_000), "image/jpeg", None),
        (png(2000, 10, size=500_001), "image/png", "imageBytes"),
        (b"GIF89a" + b"\x00" * 100, "image/gif", "imageFormat"),
        (jpeg(3000, 10, size=5_000), "image/jpeg", "imageDimensions"),
        (b"", "image/png", "imageFormat"),
        (png(800, 600, size=1_000), "image/jpeg", "imageFormat"),
    ],
)
def test_check_chart(data, ctype, want):
    assert charts.check_chart(data, ctype) == want


def test_chart_timeframe_issues():
    assert charts.chart_timeframe_issues({"entryChartTimeframe": "4h"}, set()) == [
        {"field": "entryChartTimeframe", "kind": "noChart"}
    ]
    assert charts.chart_timeframe_issues({"entryChartTimeframe": "4h"}, {"entry"}) == []
    assert charts.chart_timeframe_issues({}, set()) == []
    assert charts.chart_timeframe_issues({"entryChartTimeframe": "4h", "exitChartTimeframe": "1d"}, {"entry"}) == [
        {"field": "exitChartTimeframe", "kind": "noChart"}
    ]


def test_slot_and_doc_id():
    assert charts.valid_slot("entry") and charts.valid_slot("exit")
    for bad in ("Entry", "", "x", "entry/", "..", "exit\x00"):
        assert not charts.valid_slot(bad)
    assert charts.chart_doc_id("abc123", "exit") == "abc123-exit"
    with pytest.raises(ValueError):
        charts.chart_doc_id("abc", "../x")


def test_content_type_and_meta():
    data = chart_png()
    doc = charts.chart_doc(data)
    assert doc == {"contentType": "image/png", "data": data}
    assert charts.chart_meta(doc) == {"contentType": "image/png", "size": len(data)}
    assert charts.charts_summary({"exit": doc}) == {"exit": {"contentType": "image/png", "size": len(data)}}


# ---- 作成（API-1） ----


def test_create_with_two_charts_and_read_back(api, iid):
    """AC-9・E1: 2 枚つきで作る → 応答に形式と大きさ、読み戻しは送ったバイト列・形式のまま"""
    entry, exit_ = chart_png(), chart_jpeg()
    res = post_with_charts(api, A, e1(iid), {"entry": (entry, "image/png"), "exit": (exit_, "image/jpeg")})
    assert res.status_code == 201, res.get_json()
    body = res.get_json()
    assert body["charts"] == {
        "entry": {"contentType": "image/png", "size": len(entry)},
        "exit": {"contentType": "image/jpeg", "size": len(exit_)},
    }
    assert body["record"]["entryChartTimeframe"] == "4h" and body["record"]["exitChartTimeframe"] == "1d"
    assert chart_count(api, A) == 2
    tid = body["id"]
    for slot, data, ctype in (("entry", entry, "image/png"), ("exit", exit_, "image/jpeg")):
        got = api.get(chart_url(tid, slot), A)
        assert got.status_code == 200
        assert got.data == data
        assert got.headers["Content-Type"] == ctype
        assert got.headers["Cache-Control"] == "no-store"
        assert got.headers["X-Content-Type-Options"] == "nosniff"
    # 取引の 1 件読み・一覧も同じ要約を持ち、バイト列を含まない
    one = api.get(f"/api/trades/{tid}", A).get_json()
    assert one == body
    listed = api.trades(A)
    assert listed == [body]
    assert CHART_MARKER.decode() not in api.get("/api/trades", A).get_data(as_text=True)


def test_charts_are_stored_at_trade_slot(api, iid):
    """置き場は users/{uid}/charts/{tradeId}-{slot}（形式とバイト列だけ）"""
    data = chart_png()
    tid = post_with_charts(api, A, t1(iid), {"exit": (data, "image/png")}).get_json()["id"]
    assert stored_chart(api, A, f"{tid}-exit") == {"contentType": "image/png", "data": data}
    assert stored_chart(api, A, f"{tid}-entry") is None


def test_create_without_charts_keeps_shape(api, iid):
    """KEEP-2: チャートの無い取引の応答は今と同じ形（charts の鍵なし）。multipart で record だけでも同じ"""
    res = api.post("/api/trades", A, t1(iid))
    assert res.status_code == 201
    assert set(res.get_json()) == {"id", "schemaVersion", "createdAt", "updatedAt", "snapshot", "record"}
    res = post_multipart(api, A, chart_parts(t1(iid)))
    assert res.status_code == 201, res.get_json()
    assert "charts" not in res.get_json()
    assert chart_count(api, A) == 0


def test_e6_charts_without_timeframes(api, iid):
    """AC-3・E6: 2 枚つきで時間足を選ばずに記録できる（本文に *ChartTimeframe なし）"""
    res = post_with_charts(api, A, t1(iid), {"entry": (chart_png(), "image/png"), "exit": (chart_png(), "image/png")})
    assert res.status_code == 201
    rec = res.get_json()["record"]
    assert "entryChartTimeframe" not in rec and "exitChartTimeframe" not in rec


def test_e8_timeframe_without_chart_is_rejected(api, iid):
    """AC-3・E8: チャートの無い枠に時間足 → 400 noChart、何も保存しない（JSON・multipart とも）"""
    res = api.post("/api/trades", A, t1(iid, entryChartTimeframe="4h"))
    assert res.status_code == 400
    assert res.get_json() == {"error": "invalid", "issues": [{"field": "entryChartTimeframe", "kind": "noChart"}]}
    res = post_with_charts(api, A, e1(iid), {"entry": (chart_png(), "image/png")})
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "exitChartTimeframe", "kind": "noChart"}]
    assert api.trades(A) == []
    assert chart_count(api, A) == 0


def test_e8_update_checks_stored_charts(api, iid):
    """API-3: 取引の PUT でも、保存済みのチャートの無い枠に時間足 → 400。ある枠なら直せて、要約は保つ"""
    created = post_with_charts(api, A, t1(iid), {"entry": (chart_png(), "image/png")}).get_json()
    tid = created["id"]
    res = api.put(f"/api/trades/{tid}", A, t1(iid, exitChartTimeframe="1d"))
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "exitChartTimeframe", "kind": "noChart"}]
    assert api.get(f"/api/trades/{tid}", A).get_json() == created
    res = api.put(f"/api/trades/{tid}", A, t1(iid, entryChartTimeframe="1h"))
    assert res.status_code == 200
    assert res.get_json()["record"]["entryChartTimeframe"] == "1h"
    assert res.get_json()["charts"] == created["charts"]
    # チャートの無い取引の PUT も同じ規則
    plain = api.post("/api/trades", A, t1(iid)).get_json()
    assert api.put(f"/api/trades/{plain['id']}", A, t1(iid, entryChartTimeframe="4h")).status_code == 400


# ---- 上限（AC-8・E13） ----

OUTSIDE = [
    ("600,000 B", png(1200, 800, size=600_000), "image/png", "imageBytes"),
    ("GIF", b"GIF89a" + b"\x00" * 2_000, "image/gif", "imageFormat"),
    ("長辺 3,000 px", jpeg(3000, 800, size=5_000), "image/jpeg", "imageDimensions"),
    ("0 B", b"", "image/png", "imageFormat"),
    ("形式と署名の違い", chart_png(), "image/jpeg", "imageFormat"),
]


@pytest.mark.parametrize(("name", "data", "ctype", "kind"), OUTSIDE, ids=[x[0] for x in OUTSIDE])
def test_e13_create_rejects_outside_limits(api, iid, name, data, ctype, kind):
    res = post_with_charts(api, A, t1(iid), {"exit": (data, ctype)})
    assert res.status_code == 400, name
    assert res.get_json() == {"error": "invalid", "issues": [{"field": "exitChart", "kind": kind}]}
    assert api.trades(A) == []
    assert chart_count(api, A) == 0


@pytest.mark.parametrize(("name", "data", "ctype", "kind"), OUTSIDE, ids=[x[0] for x in OUTSIDE])
def test_e13_replace_rejects_outside_limits(api, iid, name, data, ctype, kind):
    before = chart_png()
    tid = post_with_charts(api, A, t1(iid), {"entry": (before, "image/png")}).get_json()["id"]
    res = api.put(chart_url(tid, "entry"), A, raw=data, content_type=ctype)
    assert res.status_code == 400, name
    assert res.get_json() == {"error": "invalid", "issues": [{"field": "chart", "kind": kind}]}
    assert api.get(chart_url(tid, "entry"), A).data == before
    assert chart_count(api, A) == 1


def test_boundary_is_accepted(api, iid):
    """境目ちょうど（500,000 B・長辺 2,000 px）は受ける"""
    p = png(2000, 2000, size=500_000)
    j = jpeg(10, 2000, size=500_000)
    res = post_with_charts(api, A, t1(iid), {"entry": (p, "image/png"), "exit": (j, "image/jpeg")})
    assert res.status_code == 201, res.get_json()
    tid = res.get_json()["id"]
    assert api.put(chart_url(tid, "exit"), A, raw=p, content_type="image/png").status_code == 200
    assert api.get(chart_url(tid, "exit"), A).data == p


def test_multipart_shape_is_checked(api, iid):
    """知らない部分・重複・record なし・record が JSON でない・部分の数・本文の上限 → 400、何も書かない"""
    rec = t1(iid)
    img = (chart_png(), "image/png")
    cases = [
        ("知らない部分", chart_parts(rec) + [("chartId", "x", None, None)],
         [{"field": "", "kind": "unknownPart"}]),
        ("知らないファイルの部分", chart_parts(rec) + [("otherChart", chart_png(), "c", "image/png")],
         [{"field": "", "kind": "unknownPart"}]),
        ("record がファイル", [("record", b"{}", "r", "application/json")],
         [{"field": "", "kind": "unknownPart"}]),
        ("重複", chart_parts(rec, {"entry": img}) + [("entryChart", chart_png(), "c", "image/png")],
         [{"field": "entryChart", "kind": "duplicate"}]),
        ("record の重複", chart_parts(rec) + chart_parts(rec)[:1] , [{"field": "record", "kind": "duplicate"}]),
        ("record なし", chart_parts(None, {"entry": img}), [{"field": "record", "kind": "required"}]),
        ("record が JSON でない", chart_parts("{not json", {"entry": img}), [{"field": "", "kind": "json"}]),
        # 部分の数の上限は記録 + 枠ごとに 1 つ（#89 で付属の 5 枠を足して 8）。超えたら tooLarge
        ("部分が上限 + 1", chart_parts(rec, {s: img for s in charts.SLOTS}) + [("x", "y", None, None)],
         [{"field": "", "kind": "tooLarge"}]),
        ("record が 64 KiB 超", chart_parts('{"a":"' + "x" * (64 * 1024) + '"}'), [{"field": "", "kind": "tooLarge"}]),
        ("本文全体が上限超え",
         chart_parts(rec, {"entry": (png(1200, 800, size=charts.MAX_MULTIPART_BYTES), "image/png")}),
         [{"field": "", "kind": "tooLarge"}]),
    ]  # fmt: skip
    for name, parts, issues in cases:
        res = post_multipart(api, A, parts)
        assert res.status_code == 400, name
        assert res.get_json() == {"error": "invalid", "issues": issues}, name
    assert api.trades(A) == []
    assert chart_count(api, A) == 0


def test_record_issues_are_returned_from_multipart(api, iid):
    """record の検査は JSON と同じ（知らない項目 → unknownField。送った名前は返さない）"""
    res = post_with_charts(api, A, {**t1(iid), "charts": {"entry": "x"}}, {"entry": (chart_png(), "image/png")})
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "", "kind": "unknownField"}]
    assert chart_count(api, A) == 0


def test_json_body_limit_is_unchanged(api, iid):
    """multipart の上限は作成の multipart だけ。JSON の本文は 64 KiB のまま"""
    raw = b'{"a":"' + b"x" * (64 * 1024) + b'"}'
    res = api.post("/api/trades", A, raw=raw)
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "", "kind": "tooLarge"}]


# ---- 後始末（AC-5・E10〜E11） ----


def test_e10_delete_trade_removes_charts(api, iid):
    tid = post_with_charts(api, A, e1(iid), {"entry": (chart_png(), "image/png"),
                                             "exit": (chart_png(), "image/png")}).get_json()["id"]  # fmt: skip
    assert chart_count(api, A) == 2
    assert api.delete(f"/api/trades/{tid}", A).status_code == 204
    assert chart_count(api, A) == 0
    for slot in charts.SLOTS:
        assert api.get(chart_url(tid, slot), A).status_code == 404


def test_e11_replace_and_remove(api, iid):
    """E11: エントリー時を差し替える → 前の画像は残らない（枚数は同じ）・その枠の時間足は選び直し（消える）。
    決済時を外す → 枚数 1・決済時の時間足も消える"""
    old, new = chart_png(filler=b"old-"), chart_png(filler=b"new-", size=4_000)
    created = post_with_charts(api, A, e1(iid), {"entry": (old, "image/png"),
                                                 "exit": (chart_png(), "image/png")}).get_json()  # fmt: skip
    tid = created["id"]
    res = api.put(chart_url(tid, "entry"), A, raw=new, content_type="image/png")
    assert res.status_code == 200
    body = res.get_json()
    assert body["charts"]["entry"] == {"contentType": "image/png", "size": len(new)}
    assert "entryChartTimeframe" not in body["record"]  # 差し替えた枠の時間足は消す（古い足で誤って B にしない）
    assert body["record"]["exitChartTimeframe"] == "1d"
    assert body["updatedAt"] > created["updatedAt"]
    assert api.get(chart_url(tid, "entry"), A).data == new
    assert stored_chart(api, A, f"{tid}-entry")["data"] == new
    assert chart_count(api, A) == 2

    res = api.delete(chart_url(tid, "exit"), A)
    assert res.status_code == 200
    body = res.get_json()
    assert body["charts"] == {"entry": {"contentType": "image/png", "size": len(new)}}
    assert "exitChartTimeframe" not in body["record"]
    assert chart_count(api, A) == 1
    assert api.get(chart_url(tid, "exit"), A).status_code == 404
    assert api.delete(chart_url(tid, "exit"), A).status_code == 404
    assert api.get(f"/api/trades/{tid}", A).get_json() == body
    # 最後の 1 枚を外すと、取引は charts の鍵の無い形に戻る
    body = api.delete(chart_url(tid, "entry"), A).get_json()
    assert "charts" not in body
    assert chart_count(api, A) == 0


def test_replace_adds_chart_to_empty_slot(api, iid):
    """差し替えの入口は、チャートの無い枠に置くこともできる（#9 の画面が使う）"""
    tid = api.post("/api/trades", A, t1(iid)).get_json()["id"]
    res = api.put(chart_url(tid, "exit"), A, raw=chart_jpeg(), content_type="image/jpeg")
    assert res.status_code == 200
    assert res.get_json()["charts"] == {"exit": {"contentType": "image/jpeg", "size": len(chart_jpeg())}}
    assert chart_count(api, A) == 1


def test_missing_trade_or_slot_is_404(api, iid):
    tid = api.post("/api/trades", A, t1(iid)).get_json()["id"]
    assert api.get(chart_url(tid, "entry"), A).status_code == 404
    assert api.delete(chart_url(tid, "entry"), A).status_code == 404
    for path in (chart_url("nosuchtrade", "entry"), chart_url(tid, "middle"), chart_url(tid, "Entry")):
        assert api.get(path, A).status_code == 404
        assert api.put(path, A, raw=chart_png(), content_type="image/png").status_code == 404
        assert api.delete(path, A).status_code == 404
    assert chart_count(api, A) == 0


def test_chart_routes_need_token(api, iid):
    tid = post_with_charts(api, A, t1(iid), {"entry": (chart_png(), "image/png")}).get_json()["id"]
    for res in (api.get(chart_url(tid, "entry")),
                api.put(chart_url(tid, "entry"), raw=chart_png(), content_type="image/png"),
                api.delete(chart_url(tid, "entry")),
                post_multipart(api, None, chart_parts(t1(iid), {"entry": (chart_png(), "image/png")}))):  # fmt: skip
        assert res.status_code == 401
        assert res.get_json() == {"error": "unauthorized"}
    assert chart_count(api, A) == 1


# ---- 原子性（AC-6・R4） ----


def test_ac6_chart_failure_saves_nothing(memory_api):
    api = memory_api
    iid = api.instrument(A)["id"]
    api.store.fail_charts = True
    res = post_with_charts(api, A, e1(iid), {"entry": (chart_png(), "image/png"), "exit": (chart_png(), "image/png")})
    assert res.status_code == 503
    assert res.get_json() == {"error": "unavailable"}
    assert api.trades(A) == []
    assert chart_count(api, A) == 0
    # 差し替え・外すの失敗でも取引は変わらない
    api.store.fail_charts = False
    created = post_with_charts(api, A, e1(iid), {"entry": (chart_png(), "image/png"),
                                                 "exit": (chart_png(), "image/png")}).get_json()  # fmt: skip
    api.store.fail_charts = True
    assert api.put(chart_url(created["id"], "entry"), A, raw=chart_jpeg(), content_type="image/jpeg").status_code == 503
    assert api.delete(chart_url(created["id"], "exit"), A).status_code == 503
    assert api.delete(f"/api/trades/{created['id']}", A).status_code == 503
    api.store.fail_charts = False
    assert api.get(f"/api/trades/{created['id']}", A).get_json() == created
    assert chart_count(api, A) == 2


# ---- 一時ファイル・ログ（KEEP-1 の守りをチャートにも） ----


def _no_tempfile(*_a, **_k):
    raise AssertionError("一時ファイルを作った")


def test_multipart_uses_no_temp_files(memory_api, monkeypatch, tmp_path):
    """multipart は記憶の中だけで読む（2 × 500,000 B でも一時ファイルを作らない。チャートも個人の情報）"""
    api = memory_api
    iid = api.instrument(A)["id"]
    parts = chart_parts(t1(iid), {"entry": (png(2000, 10, size=500_000), "image/png"),
                                  "exit": (png(10, 2000, size=500_000), "image/png")})  # fmt: skip
    body, ctype = encode_multipart(parts)
    monkeypatch.setattr(werkzeug.formparser, "SpooledTemporaryFile", _no_tempfile)  # 既定の受け方が使う
    for name in ("SpooledTemporaryFile", "TemporaryFile", "NamedTemporaryFile", "mkstemp", "mkdtemp"):
        monkeypatch.setattr(tempfile, name, _no_tempfile)
    res = api.call("POST", "/api/trades", A, raw=body, content_type=ctype)
    assert res.status_code == 201, res.get_json()
    assert chart_count(api, A) == 2


def test_logs_have_no_chart_bytes(api, iid, capfd, caplog):
    from loss_note_api import logs

    caplog.set_level("DEBUG")
    logs.logger.propagate = True
    try:
        tid = post_with_charts(api, A, e1(iid), {"entry": (chart_png(), "image/png"),
                                                 "exit": (chart_png(), "image/png")}).get_json()["id"]  # fmt: skip
        api.get(chart_url(tid, "entry"), A)
        api.put(chart_url(tid, "entry"), A, raw=chart_png(), content_type="image/png")
        api.delete(chart_url(tid, "exit"), A)
        post_with_charts(api, A, t1(iid), {"entry": (png(1200, 800, size=600_000, filler=CHART_MARKER), "image/png")})
    finally:
        logs.logger.propagate = False
    out, err = capfd.readouterr()
    everything = caplog.text + out + err
    assert everything.strip()
    for needle in (CHART_MARKER.decode(), tid, A, "image/png"):
        assert needle not in everything, needle


# ---- KEEP-1: 明細から作った取引はチャート 0 枚 ----


def test_keep1_statement_entry_saves_no_chart(api):
    item = load_fixture("statement-entry.json")["trades"][0]
    iid = api.instrument(A, item["instrument"]["name"])["id"]
    res = api.post("/api/trades", A, {**item["record"], "instrumentId": iid})
    assert res.status_code == 201
    assert "charts" not in res.get_json()
    assert chart_count(api, A) == 0


# ---- 未設定 ----


def test_unconfigured_chart_routes_are_503():
    client = create_app({}).test_client()
    for method in ("GET", "PUT", "DELETE"):
        assert client.open("/api/trades/abc/charts/entry", method=method).status_code == 503
