"""読み取りの結果の形と、正解のファイルの検査（値はすべて架空）"""

import copy

import pytest
from helpers import answer_row, read_from_answer

from statement_eval import schema


def _result(**row_kw):
    return {"kind": "statement", "rows": [read_from_answer(answer_row(), **row_kw)]}


def test_tool_schema_matches_row_keys():
    items = schema.TOOL_INPUT_SCHEMA["properties"]["rows"]["items"]
    assert tuple(items["properties"]) == schema.READ_ROW_KEYS
    assert items["additionalProperties"] is False
    assert schema.TOOL_INPUT_SCHEMA["additionalProperties"] is False


def test_check_result_accepts_good():
    out = schema.check_result(_result(side_of="position", time_zone="GMT", fees=[38, 3]))
    assert out["kind"] == "statement" and len(out["rows"]) == 1


def test_not_statement_drops_rows():
    r = _result()
    r["kind"] = "not_statement"
    assert schema.check_result(r)["rows"] == []


@pytest.mark.parametrize(
    "mutate,path",
    [
        (lambda r: r.update(extra=1), "result.<unknown>"),
        (lambda r: r.update(kind="other"), "result.kind"),
        (lambda r: r["rows"][0].update(account="x"), "result.rows[0].<unknown>"),
        (lambda r: r["rows"][0].update(side_written="long"), "result.rows[0].side_written"),
        (lambda r: r["rows"][0].update(side_of="open"), "result.rows[0].side_of"),
        (lambda r: r["rows"][0].update(entry_price="38250"), "result.rows[0].entry_price"),
        (lambda r: r["rows"][0].update(qty=True), "result.rows[0].qty"),
        (lambda r: r["rows"][0].update(exit_time="04/03/2026 10:15"), "result.rows[0].exit_time"),
        (lambda r: r["rows"][0].update(fees=[1] * 9), "result.rows[0].fees"),
        (lambda r: r["rows"][0].update(exit_order_type="trailing"), "result.rows[0].exit_order_type"),
        (lambda r: r.update(rows=[r["rows"][0]] * 21), "result.rows"),
    ],
)
def test_check_result_rejects(mutate, path):
    r = _result()
    mutate(r)
    with pytest.raises(schema.Bad) as e:
        schema.check_result(r)
    assert e.value.path == path


def test_symbol_out_of_charset_is_dropped_only():
    out = schema.check_result(_result(symbol="JP225<script>"))
    assert out["rows"][0]["symbol"] is None
    assert out["rows"][0]["pnl_jpy"] == 3600
    assert schema.check_result(_result(symbol="X" * 41))["rows"][0]["symbol"] is None
    assert schema.check_result(_result(symbol="日経225OP 26/04 C 39500"))["rows"][0]["symbol"] is not None


def _answers():
    return {"schema_version": 1, "images": [{"file": "a1.png", "rows": [answer_row(fees=["38", "3"])]}]}


def test_check_answers_accepts():
    assert schema.check_answers(_answers())["images"][0]["rows"][0]["qty"] == "10"


@pytest.mark.parametrize(
    "mutate,path",
    [
        (lambda a: a.update(schema_version=2), "answers.schema_version"),
        (lambda a: a.update(images=[]), "answers.images"),
        (lambda a: a["images"][0].update(file="../x.png"), "images[0].file"),
        (lambda a: a["images"][0]["rows"][0].update(qty=10), "images[0].rows[0].qty"),
        (lambda a: a["images"][0]["rows"][0].update(side="Long"), "images[0].rows[0].side"),
        (lambda a: a["images"][0]["rows"][0].update(exit_time="2026/03/04 10:15"), "images[0].rows[0].exit_time"),
        (lambda a: a["images"][0]["rows"][0].update(fees=["x"]), "images[0].rows[0].fees[0]"),
        (lambda a: a["images"][0]["rows"][0].pop("pnl_jpy"), "images[0].rows[0].pnl_jpy"),
        (lambda a: a["images"][0]["rows"][0].update(memo="x"), "images[0].rows[0].<unknown>"),
        (lambda a: a["images"].append(copy.deepcopy(a["images"][0])), "images[1].file"),
    ],
)
def test_check_answers_rejects_with_position_only(mutate, path):
    a = _answers()
    mutate(a)
    with pytest.raises(schema.Bad) as e:
        schema.check_answers(a)
    assert e.value.path == path
    # メッセージは位置と理由だけ（値を含まない）
    assert "38250" not in str(e.value) and "JP225" not in str(e.value)
