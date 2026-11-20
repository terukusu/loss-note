"""オプションの行の採点と正解の検査（Issue #118）。値はすべて架空"""

import copy

import pytest
from helpers import answer_row, read_from_answer

from statement_eval import schema, synthetic
from statement_eval.score import FIELDS, OPTION_FIELDS, aggregate, compare_row, match_rows, score_image

OPT = {"underlying": "日経225OP", "expiry": "2027-01", "put_call": "put", "strike": "37000"}


def _answer(**opt_kw) -> dict:
    a = dict(answer_row(entry_time="2026-12-08T10:05", exit_time="2026-12-22T11:30"))
    a["option"] = {**OPT, **opt_kw}
    return a


def _read(a: dict, **opt_kw) -> dict:
    r = read_from_answer({k: v for k, v in a.items() if k != "option"})
    r["option"] = {"underlying": "日経225OP", "expiry_year": None, "expiry_month": 1, "put_call": "put",
                   "strike": 37000, **opt_kw}
    return r


def test_year_less_month_is_resolved_from_opened_day():
    a = _answer()
    s = compare_row(a, _read(a))
    assert s.option_matches == (True,) * len(OPTION_FIELDS) and s.n_matched == len(FIELDS)
    # 年を書かれたまま 2 桁で返しても同じ
    assert compare_row(a, _read(a, expiry_year=27)).option_matches == (True,) * 4
    # 年を誤って建てた年（2026）にすると限月だけ外れる
    assert compare_row(a, _read(a, expiry_year=2026)).option_matches == (True, False, True, True)


def test_year_less_month_uses_exchange_day_like_api():
    """建てた日は API と同じ取引所の日付（日本時間）: GMT の 11-30 16:00 = 日本時間 12-01 → 年の無い 11 月限は翌年"""
    a = _answer(expiry="2027-11")
    a["entry_time"] = "2026-11-30T16:00"
    r = _read(a, expiry_month=11)
    r["time_zone"] = "GMT"
    assert compare_row(a, r).option_matches[1] is True
    r["time_zone"] = "unknown"  # 時間帯が読めなければ書かれた日（11 月 → 同じ年）
    assert compare_row(a, r).option_matches[1] is False


def test_option_field_mismatches_and_missing():
    a = _answer()
    assert compare_row(a, _read(a, put_call="call", strike=37500)).option_matches == (True, True, False, False)
    r = _read(a)
    r["option"] = None
    assert compare_row(a, r).option_matches == (False,) * 4
    assert compare_row(a, None).option_matches == (False,) * 4
    # オプションでない正解の行は数えない
    assert compare_row(answer_row(), read_from_answer(answer_row())).option_matches is None


def test_match_rows_uses_option_fields_to_pair_legs():
    """行使価格だけが違う 2 本のレッグは、オプションの欄で対応づける"""
    a1, a2 = _answer(strike="37000"), _answer(strike="36500")
    reads = [_read(a2, strike=36500), _read(a1, strike=37000)]
    assert match_rows([a1, a2], reads) == [(0, 1), (1, 0)]


def test_aggregate_option_denominator():
    a = _answer()
    img = {"rows": [a, answer_row()]}
    s = score_image(img, {"kind": "statement", "rows": [_read(a), read_from_answer(answer_row())]})
    t = aggregate([s, s], [], [], "m")
    assert t.n_answer_rows == 4 and t.n_option_rows == 2
    assert t.rate("option_strike") == 1.0 and t.rate("qty") == 1.0
    assert aggregate([], [], [], "m").rate("option_expiry") is None


def _answers(opt) -> dict:
    row = answer_row()
    row["option"] = opt
    return {"schema_version": 1, "images": [{"file": "a1.png", "rows": [row]}]}


@pytest.mark.parametrize(
    "mutate,path",
    [
        (lambda o: o.update(expiry="2027-13"), "images[0].rows[0].option.expiry"),
        (lambda o: o.update(put_call="P"), "images[0].rows[0].option.put_call"),
        (lambda o: o.update(strike=37000), "images[0].rows[0].option.strike"),
        (lambda o: o.pop("underlying"), "images[0].rows[0].option.underlying"),
        (lambda o: o.update(memo="x"), "images[0].rows[0].option.<unknown>"),
    ],
)
def test_check_answers_option(mutate, path):
    assert schema.check_answers(_answers(dict(OPT)))["images"][0]["rows"][0]["option"] == OPT
    o = copy.deepcopy(OPT)
    mutate(o)
    with pytest.raises(schema.Bad) as e:
        schema.check_answers(_answers(o))
    assert e.value.path == path


def test_synthetic_option_statements():
    """s17〜s19: まとまり（同じ原資産・同じ建てた日）・年の無い限月・先物の混ざった明細・原資産の違う同じ日"""
    by_file = {s.file: s for s in synthetic.STATEMENTS}
    assert {"s17.png", "s18.png", "s19.png"} <= set(by_file)
    assert "option_position_legs" in synthetic.scenes_of(by_file["s17.png"])
    s18 = synthetic.scenes_of(by_file["s18.png"])
    assert "option_month_no_year" in s18 and "option_position_legs" in s18
    assert [t.option is None for t in by_file["s18.png"].trades] == [False, False, True]
    assert all(t.option.expiry == "2027-01" for t in by_file["s18.png"].trades[:2])
    assert "option_position_legs" not in synthetic.scenes_of(by_file["s19.png"])
    # オプションの行は銘柄の名前に P / C と行使価格が写っている
    for s in synthetic.STATEMENTS:
        for t in s.trades:
            if t.option is not None:
                assert f" {t.option.put_call[0].upper()} {t.option.strike}" in t.symbol
