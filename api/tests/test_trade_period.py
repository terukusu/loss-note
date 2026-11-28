"""取引の一覧の決済の時刻の範囲（Issue #88 AC-2〜AC-4・設計書 C44）。

記憶の保存先とエミュレーターの Firestore の両方で回す。値はすべて架空。利用者 A・B はテストの中だけの uid
"""

import pytest
from test_trade_pages_api import A, B, add

from loss_note_api import trade_range

DAY = 86_400_000
T = 1_763_478_000_000  # 範囲の開始（架空）


def ranged(api, uid: str, start: int, end: int) -> list[dict]:
    res = api.get(f"/api/trades?exitFrom={start}&exitTo={end}", uid)
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    # 両建てのまとまり（#266）の 2 つの鍵は常に出す。まとまりの無い利用者では空
    assert set(body) == {"items", "truncated", "positionGroups", "groupMembers"}
    assert body["truncated"] is False
    assert body["positionGroups"] == [] and body["groupMembers"] == []
    return body["items"]


def test_range_boundaries(api):
    """AC-2: 開始ちょうど・終了の 1 ミリ秒前は入り、終了ちょうど・範囲の外は入らない"""
    iid = api.instrument(A)["id"]
    at_start = add(api, A, iid, T)
    before_end = add(api, A, iid, T + DAY - 1)
    add(api, A, iid, T + DAY)
    add(api, A, iid, T - 1)
    add(api, A, iid, T + 5 * DAY)
    got = [t["id"] for t in ranged(api, A, T, T + DAY)]
    assert got == [before_end, at_start]


def test_range_order_matches_list(api):
    """AC-2: 並びは範囲を付けない一覧と同じ（決済の新しい順 → 作った時刻の新しい順 → ID の昇順）"""
    iid = api.instrument(A)["id"]
    for t, c in [(T + 10, 1), (T + 10, 1), (T + 10, 3), (T + 3, 9), (T + 50, 2), (T - 5, 1)]:
        add(api, A, iid, t, 1_000 + c)
    full = [t["id"] for t in api.trades(A)]
    items = ranged(api, A, T, T + DAY)
    got = [t["id"] for t in items]
    assert len(got) == 5
    assert got == [tid for tid in full if tid in set(got)]
    # 1 件の形は 1 件の読みと同じ
    assert items[0] == api.get(f"/api/trades/{items[0]['id']}", A).get_json()


@pytest.mark.parametrize(
    "query",
    [
        f"exitFrom={T}",
        f"exitFrom=abc&exitTo={T}",
        f"exitFrom=-1&exitTo={T}",
        f"exitFrom={T}&exitTo={T}",
        f"exitFrom={T}&exitTo={T + 367 * DAY + 1}",
    ],
)
def test_range_invalid(api, query):
    """AC-3: 片方だけ・整数でない・負・開始 ≧ 終了・367 日を超える は 400。取引を返さず、入力の値を本文に出さない"""
    iid = api.instrument(A)["id"]
    add(api, A, iid, T)
    res = api.get(f"/api/trades?{query}", A)
    assert res.status_code == 400
    body = res.get_json()
    assert body["error"] == "invalid" and "items" not in body
    text = res.get_data(as_text=True)
    assert str(T) not in text and "abc" not in text and "-1" not in text


def test_range_with_page_args_is_invalid(api):
    res = api.get(f"/api/trades?exitFrom={T}&exitTo={T + DAY}&limit=10", A)
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "limit", "kind": "withRange"}]


def test_range_other_user(api):
    """AC-4: 同じ範囲にほかの利用者の取引を置いても、自分の取引だけ"""
    mine = add(api, A, api.instrument(A)["id"], T + 1)
    add(api, B, api.instrument(B)["id"], T + 2)
    assert [t["id"] for t in ranged(api, A, T, T + DAY)] == [mine]
    assert len(ranged(api, B, T, T + DAY)) == 1


def test_range_empty_and_unauthenticated(api):
    assert ranged(api, A, T, T + DAY) == []
    assert api.get(f"/api/trades?exitFrom={T}&exitTo={T + DAY}").status_code == 401


def test_range_cap(api, monkeypatch):
    """C44: 件数の上限を超えたら、決済の新しい順の先頭の上限の件数と truncated: true。ちょうどなら false"""
    monkeypatch.setattr(trade_range, "MAX_RANGE_ITEMS", 3)
    iid = api.instrument(A)["id"]
    made = [add(api, A, iid, T + i) for i in range(3)]
    res = api.get(f"/api/trades?exitFrom={T}&exitTo={T + DAY}", A).get_json()
    assert res["truncated"] is False and len(res["items"]) == 3
    newest = add(api, A, iid, T + 10)
    add(api, A, iid, T + DAY)  # 範囲の外は数えない
    res = api.get(f"/api/trades?exitFrom={T}&exitTo={T + DAY}", A).get_json()
    assert res["truncated"] is True
    assert [t["id"] for t in res["items"]] == [newest, made[2], made[1]]
