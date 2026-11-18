"""取引の一覧のページ分けの純関数（Issue #87・ADR-0016）。値はすべて架空"""

import base64
import json
import random

import pytest
from werkzeug.datastructures import MultiDict

from loss_note_api import trade_pages as tp


def doc(exit_time: int, created: int) -> dict:
    return {"record": {"exit": {"time": exit_time}}, "createdAt": created}


def walk(items, order, limit):
    """先頭からカーソルをたどってつないだ ID の並び（ページの数も返す）"""
    out, after, pages = [], None, 0
    while True:
        got = tp.page_of(items, order, after, limit)
        assert len(got) <= limit + 1
        page, cursor = tp.split_page(order, got, limit)
        pages += 1
        out += [tid for tid, _ in page]
        if cursor is None:
            return out, pages
        after = tp.decode_cursor(order, cursor)


# 例 #1: a（決済 50）・b（40・作った 2）・c（40・作った 3）・d（40・作った 2）・e（10）
EXAMPLE_1 = [("a", doc(50, 1)), ("b", doc(40, 2)), ("c", doc(40, 3)), ("d", doc(40, 2)), ("e", doc(10, 9))]


def test_example_1_pages():
    page1, c1 = tp.split_page("exit", tp.page_of(EXAMPLE_1, "exit", None, 2), 2)
    assert [t for t, _ in page1] == ["a", "c"] and c1 is not None
    page2, c2 = tp.split_page("exit", tp.page_of(EXAMPLE_1, "exit", tp.decode_cursor("exit", c1), 2), 2)
    assert [t for t, _ in page2] == ["b", "d"] and c2 is not None
    page3, c3 = tp.split_page("exit", tp.page_of(EXAMPLE_1, "exit", tp.decode_cursor("exit", c2), 2), 2)
    assert [t for t, _ in page3] == ["e"] and c3 is None
    assert walk(EXAMPLE_1, "exit", 2)[0] == [t for t, _ in sorted(EXAMPLE_1, key=tp.exit_key)]


def test_example_2_and_3_no_empty_page():
    assert tp.split_page("exit", tp.page_of([], "exit", None, 50), 50) == ([], None)
    three = EXAMPLE_1[:3]
    page, cursor = tp.split_page("exit", tp.page_of(three, "exit", None, 3), 3)
    assert len(page) == 3 and cursor is None


def test_example_7_created_order():
    items = [("x", doc(1, 100)), ("y", doc(2, 300)), ("z", doc(3, 200))]
    page, _ = tp.split_page("created", tp.page_of(items, "created", None, 1), 1)
    assert [t for t, _ in page] == ["y"]
    # 作った時刻が同じなら ID の降順
    ties = [("a1", doc(1, 5)), ("b1", doc(1, 5)), ("c1", doc(1, 4))]
    assert walk(ties, "created", 1)[0] == ["b1", "a1", "c1"]


@pytest.mark.parametrize("seed", range(20))
def test_random_walk_equals_full_order(seed):
    """種つき乱数: 同じ決済・作った時刻の取引を多く含めても、つないだ並び = 全件の並び・重なり 0"""
    rng = random.Random(seed)
    n = rng.randint(0, 40)
    ids = rng.sample([f"t{i:03d}" for i in range(200)], n)
    items = [(i, doc(rng.choice([10, 20, 30]), rng.choice([1, 2, 3]))) for i in ids]
    full_exit = [t for t, _ in sorted(items, key=tp.exit_key)]
    full_created = [t for t, _ in sorted(items, key=lambda it: (-it[1]["createdAt"], tuple(-ord(ch) for ch in it[0])))]
    for limit in (1, 2, 3, 7, 40, 100):
        got, pages = walk(items, "exit", limit)
        assert got == full_exit and len(set(got)) == len(got)
        assert pages == max(1, -(-n // limit))
        assert walk(items, "created", limit)[0] == full_created


def test_cursor_round_trip():
    for order, key in (("exit", (1_700_000_000_000, 1_800_000_000_000, "abcXYZ019")), ("created", (5, "Z"))):
        text = tp.encode_cursor(order, key)
        assert set(text) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        assert tp.decode_cursor(order, text) == key


def raw_cursor(value) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()


@pytest.mark.parametrize(
    "text",
    [
        "zzz",  # JSON でない
        "",
        "a" * 201,
        "ab+/",  # base64url の外の文字
        raw_cursor({"e": 1}),
        raw_cursor(["e", 1, 2]),  # 欄が足りない
        raw_cursor(["e", 1, 2, "a", 3]),  # 欄が多い
        raw_cursor(["e", -1, 2, "a"]),  # 負
        raw_cursor(["e", 1.5, 2, "a"]),  # 整数でない
        raw_cursor(["e", True, 2, "a"]),  # 真偽
        raw_cursor(["e", 4_102_444_800_001, 2, "a"]),  # 時刻の範囲の外
        raw_cursor(["e", 1, 2, "a/b"]),  # ID の形でない（ほかの場所を指せない）
        raw_cursor(["e", 1, 2, "../x"]),
        raw_cursor(["e", 1, 2, "a" * 41]),
        raw_cursor(["e", 1, 2, 3]),
        raw_cursor(["x", 1, 2, "a"]),  # 知らない並び
    ],
)
def test_bad_cursor(text):
    with pytest.raises(tp.PageParamError) as e:
        tp.decode_cursor("exit", text)
    assert e.value.issues[0]["field"] == "cursor"
    assert text not in json.dumps(e.value.issues) or text == ""


def test_cursor_of_other_order_is_error():
    with pytest.raises(tp.PageParamError) as e:
        tp.decode_cursor("exit", tp.encode_cursor("created", (5, "a")))
    assert e.value.issues == [{"field": "cursor", "kind": "order"}]
    with pytest.raises(tp.PageParamError):
        tp.decode_cursor("created", tp.encode_cursor("exit", (1, 5, "a")))


def test_params_absent_is_none():
    assert tp.parse_page_params(MultiDict()) is None
    # 知らないパラメータは今と同じく見ない
    assert tp.parse_page_params(MultiDict({"x": "1"})) is None


def test_params_ok():
    assert tp.parse_page_params(MultiDict({"limit": "50"})) == ("exit", 50, None)
    assert tp.parse_page_params(MultiDict({"limit": "1", "order": "created"})) == ("created", 1, None)
    assert tp.parse_page_params(MultiDict({"limit": "100", "order": "exit"})) == ("exit", 100, None)
    c = tp.encode_cursor("exit", (3, 4, "abc"))
    assert tp.parse_page_params(MultiDict({"limit": "2", "cursor": c})) == ("exit", 2, (3, 4, "abc"))


@pytest.mark.parametrize(
    ("args", "field", "kind"),
    [
        ({"limit": "0"}, "limit", "range"),
        ({"limit": "101"}, "limit", "range"),
        ({"limit": "abc"}, "limit", "range"),
        ({"limit": "-1"}, "limit", "range"),
        ({"limit": "05"}, "limit", "range"),
        ({"limit": "1e2"}, "limit", "range"),
        ({"limit": "１０"}, "limit", "range"),  # 全角の数字
        ({"limit": ""}, "limit", "range"),
        ({"limit": "10", "order": "new"}, "order", "unknown"),
        ({"cursor": "abc"}, "cursor", "requiresLimit"),
        ({"order": "created"}, "order", "requiresLimit"),
        ({"limit": "10", "cursor": "zzz"}, "cursor", "format"),
    ],
)
def test_params_errors(args, field, kind):
    with pytest.raises(tp.PageParamError) as e:
        tp.parse_page_params(MultiDict(args))
    assert e.value.issues == [{"field": field, "kind": kind}]


def test_params_duplicate():
    with pytest.raises(tp.PageParamError) as e:
        tp.parse_page_params(MultiDict([("limit", "1"), ("limit", "2")]))
    assert e.value.issues == [{"field": "limit", "kind": "duplicate"}]
