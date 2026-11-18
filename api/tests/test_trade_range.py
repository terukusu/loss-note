"""決済の時刻の範囲の引数の検査（Issue #88 AC-3・設計書 C44）の純関数。値はすべて架空"""

import pytest
from werkzeug.datastructures import MultiDict

from loss_note_api import trade_range
from loss_note_api.schema import MAX_TIME_MS
from loss_note_api.trade_pages import PageParamError

T = 1_763_478_000_000  # 架空の時刻（ミリ秒）
DAY = trade_range.DAY_MS


def parse(**kw):
    return trade_range.parse_range_params(MultiDict(kw))


def issue(**kw) -> dict:
    with pytest.raises(PageParamError) as e:
        parse(**kw)
    [only] = e.value.issues
    return only


def test_no_range_is_none():
    assert parse() is None
    assert parse(limit="10") is None


def test_valid_range():
    assert parse(exitFrom=str(T), exitTo=str(T + DAY)) == (T, T + DAY)
    # 長さの上限ちょうど（367 日）は受ける
    assert parse(exitFrom=str(T), exitTo=str(T + 367 * DAY)) == (T, T + 367 * DAY)
    assert parse(exitFrom="0", exitTo="1") == (0, 1)


@pytest.mark.parametrize(
    ("kw", "field", "kind"),
    [
        ({"exitFrom": str(T)}, "exitTo", "required"),
        ({"exitTo": str(T)}, "exitFrom", "required"),
        ({"exitFrom": "abc", "exitTo": str(T)}, "exitFrom", "format"),
        ({"exitFrom": "-1", "exitTo": str(T)}, "exitFrom", "format"),
        ({"exitFrom": str(T), "exitTo": "1.5"}, "exitTo", "format"),
        ({"exitFrom": "", "exitTo": str(T)}, "exitFrom", "format"),
        ({"exitFrom": "+1", "exitTo": str(T)}, "exitFrom", "format"),
        ({"exitFrom": "１２", "exitTo": str(T)}, "exitFrom", "format"),
        ({"exitFrom": "1" * 16, "exitTo": str(T)}, "exitFrom", "format"),
        ({"exitFrom": str(T), "exitTo": str(MAX_TIME_MS + 1)}, "exitTo", "range"),
        ({"exitFrom": str(T), "exitTo": str(T)}, "exitTo", "order"),
        ({"exitFrom": str(T + 1), "exitTo": str(T)}, "exitTo", "order"),
        ({"exitFrom": str(T), "exitTo": str(T + 367 * DAY + 1)}, "exitTo", "span"),
        ({"exitFrom": str(T), "exitTo": str(T + DAY), "limit": "10"}, "limit", "withRange"),
        ({"exitFrom": str(T), "exitTo": str(T + DAY), "cursor": "x"}, "cursor", "withRange"),
        ({"exitFrom": str(T), "exitTo": str(T + DAY), "order": "exit"}, "order", "withRange"),
    ],
)
def test_invalid(kw, field, kind):
    assert issue(**kw) == {"field": field, "kind": kind}


def test_duplicate():
    with pytest.raises(PageParamError) as e:
        trade_range.parse_range_params(MultiDict([("exitFrom", "1"), ("exitFrom", "2"), ("exitTo", "3")]))
    assert e.value.issues == [{"field": "exitFrom", "kind": "duplicate"}]


def test_in_range_boundaries():
    def doc(t):
        return {"record": {"exit": {"time": t}}}

    assert trade_range.in_range(doc(T), T, T + DAY)
    assert trade_range.in_range(doc(T + DAY - 1), T, T + DAY)
    assert not trade_range.in_range(doc(T + DAY), T, T + DAY)
    assert not trade_range.in_range(doc(T - 1), T, T + DAY)
