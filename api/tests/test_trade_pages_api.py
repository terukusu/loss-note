"""取引の一覧のページ分けの入口（Issue #87 AC-1〜AC-6・ADR-0016）。

記憶の保存先とエミュレーターの Firestore の両方で回す。値はすべて架空。利用者 A・B はテストの中だけの uid
"""

import base64
import json
import random

import pytest
from helpers.records import t1

from loss_note_api import trade_pages

A = "userAAAAAAAAAAAAAAAAAAAAAAAA"
B = "userBBBBBBBBBBBBBBBBBBBBBBBB"


def set_created(api, uid: str, tid: str, created: int) -> None:
    """作った時刻を決まった値にする（同じ作った時刻の取引を作るため。テストの中だけ）"""
    if api.kind == "memory":
        api.store.users[uid]["trades"][tid]["createdAt"] = created
    else:
        api.store._user(uid).collection("trades").document(tid).update({"createdAt": created})


def add(api, uid: str, iid: str, exit_time: int, created: int | None = None) -> str:
    body = t1(iid)
    body["exit"] = {**body["exit"], "time": exit_time}
    res = api.post("/api/trades", uid, body)
    assert res.status_code == 201
    tid = res.get_json()["id"]
    if created is not None:
        set_created(api, uid, tid, created)
    return tid


def page(api, uid: str, query: str) -> dict:
    res = api.get(f"/api/trades?{query}", uid)
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert set(body) == {"items", "next"}
    return body


def walk(api, uid: str, limit: int, order: str = "exit") -> tuple[list[str], int]:
    ids, cursor, pages = [], None, 0
    while True:
        q = f"limit={limit}" + ("" if order == "exit" else f"&order={order}") + (f"&cursor={cursor}" if cursor else "")
        body = page(api, uid, q)
        assert len(body["items"]) <= limit
        pages += 1
        ids += [t["id"] for t in body["items"]]
        cursor = body["next"]
        if cursor is None:
            return ids, pages


T0 = 1_700_000_000_000


def test_pages_example_1(api):
    """例 #1: 決済・作った時刻が同じなら ID の昇順。2 件ずつ 3 ページ、つなぐと全件の並び"""
    iid = api.instrument(A)["id"]
    a = add(api, A, iid, T0 + 50, 1_000)
    b, d = add(api, A, iid, T0 + 40, 2_000), add(api, A, iid, T0 + 40, 2_000)
    c = add(api, A, iid, T0 + 40, 3_000)
    e = add(api, A, iid, T0 + 10, 9_000)
    b, d = sorted([b, d])
    p1 = page(api, A, "limit=2")
    assert [t["id"] for t in p1["items"]] == [a, c] and p1["next"]
    p2 = page(api, A, f"limit=2&cursor={p1['next']}")
    assert [t["id"] for t in p2["items"]] == [b, d] and p2["next"]
    p3 = page(api, A, f"limit=2&cursor={p2['next']}")
    assert [t["id"] for t in p3["items"]] == [e] and p3["next"] is None
    assert [t["id"] for t in api.trades(A)] == [a, c, b, d, e]
    # 一覧の中の 1 件は 1 件の読みと同じ形（KEEP-4）
    assert p1["items"][0] == api.get(f"/api/trades/{a}", A).get_json()


def test_pages_example_2_and_3(api):
    assert page(api, A, "limit=50") == {"items": [], "next": None}
    iid = api.instrument(A)["id"]
    for i in range(3):
        add(api, A, iid, T0 + i)
    body = page(api, A, "limit=3")
    assert len(body["items"]) == 3 and body["next"] is None


def test_pages_random_walk(api):
    """種つき乱数（同じ決済・作った時刻を多く含む）× 複数の件数で、つないだ並び = 全件の並び・重なり 0"""
    rng = random.Random(87)
    iid = api.instrument(A)["id"]
    made = {}
    for _ in range(14):
        c = rng.choice([10, 20])
        made[add(api, A, iid, T0 + rng.choice([1, 2, 3]), c)] = c
    full = [t["id"] for t in api.trades(A)]
    for limit in (1, 3, 5, 14, 100):
        got, pages = walk(api, A, limit)
        assert got == full and len(set(got)) == len(full)
        assert pages == -(-len(full) // limit)
    # 作った時刻の新しい順 → ID の降順（R6）。作った時刻はテストで決めた値
    want_created = [tid for tid, _ in sorted(made.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)]
    for limit in (1, 4, 100):
        created, _ = walk(api, A, limit, "created")
        assert created == want_created


def test_page_reads_at_most_limit_plus_one(memory_api):
    """AC-2: 30 件の利用者に limit=5 → 読んだ取引の文書は 6 件以下（全件を読まない）"""
    iid = memory_api.instrument(A)["id"]
    for i in range(30):
        add(memory_api, A, iid, T0 + i)
    memory_api.store.trade_page_reads.clear()
    body = page(memory_api, A, "limit=5")
    assert len(body["items"]) == 5
    page(memory_api, A, f"limit=5&cursor={body['next']}")
    assert memory_api.store.trade_page_reads and max(memory_api.store.trade_page_reads) <= 6


@pytest.mark.parametrize(
    "query",
    [
        "limit=0",
        "limit=101",
        "limit=abc",
        "limit=5&cursor=zzz",
        "cursor=" + trade_pages.encode_cursor("exit", (1, 2, "abc")),
        "limit=5&cursor=" + trade_pages.encode_cursor("created", (2, "abc")),
        "limit=5&order=new",
        "order=created",
        "limit=5&limit=6",
    ],
)
def test_bad_params_are_400(api, query):
    """AC-3: 形の違うパラメータは 400。本文に送った値を含まない"""
    res = api.get(f"/api/trades?{query}", A)
    assert res.status_code == 400
    body = res.get_json()
    assert body["error"] == "invalid"
    text = json.dumps(body)
    for part in query.split("&"):
        value = part.split("=", 1)[1]
        assert value not in text


def test_cursor_from_other_user_stays_in_own(api):
    """AC-4: A の取引から作ったカーソルを B が使っても、B の取引だけが出る"""
    ia, ib = api.instrument(A)["id"], api.instrument(B)["id"]
    a_ids = [add(api, A, ia, T0 + i) for i in range(4)]
    b_ids = {add(api, B, ib, T0 + i) for i in range(4)}
    cursor = page(api, A, "limit=2")["next"]
    got = page(api, B, f"limit=10&cursor={cursor}")
    ids = {t["id"] for t in got["items"]}
    assert ids and ids <= b_ids and not ids & set(a_ids)
    # ID の形でない値（ほかの場所のパス・末尾の改行）を詰めたカーソルは 400（値を返さない）
    for bad_id in (f"../../{A}/trades/{a_ids[0]}", "a/b", "a\n", ""):
        bad = raw_cursor(["e", T0, 1, bad_id])
        res = api.get(f"/api/trades?limit=2&cursor={bad}", B)
        assert res.status_code == 400 and res.get_json()["issues"] == [{"field": "cursor", "kind": "format"}]


def test_no_params_is_unchanged(api):
    """AC-5: パラメータなし = 全件・決済の新しい順・next の鍵なし"""
    iid = api.instrument(A)["id"]
    for i in range(7):
        add(api, A, iid, T0 + (i * 37) % 5)
    body = api.get("/api/trades", A).get_json()
    assert set(body) == {"items"} and len(body["items"]) == 7
    times = [t["record"]["exit"]["time"] for t in body["items"]]
    assert times == sorted(times, reverse=True)


def test_created_order_latest(api):
    """AC-6: 作った時刻 100・300・200 → order=created&limit=1 は 300 の 1 件"""
    iid = api.instrument(A)["id"]
    add(api, A, iid, T0 + 3, 100)
    latest = add(api, A, iid, T0 + 1, 300)
    add(api, A, iid, T0 + 2, 200)
    body = page(api, A, "order=created&limit=1")
    assert [t["id"] for t in body["items"]] == [latest] and body["next"]


def raw_cursor(value) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()


def test_index_missing_falls_back_to_full_read(api, monkeypatch, capfd):
    """索引がまだ無い・作成中（FailedPrecondition）でも、全件を読んで切る形に戻して同じページを返す（AC-13 の安全網）。
    Firestore は問い合わせの読みを差し替えて断らせ、記憶の保存先は同じ逃げ道の旗を立てる"""
    iid = api.instrument(A)["id"]
    for i in range(7):
        add(api, A, iid, T0 + i % 3, 100 + i % 2)
    want_exit, _ = walk(api, A, 3)
    want_created, _ = walk(api, A, 3, "created")
    if api.kind == "memory":
        api.store.page_index_missing = True
    else:
        from google.api_core import exceptions as gexc
        from google.cloud.firestore_v1 import query

        class Refused:
            def stream(self, *a, **k):
                raise gexc.FailedPrecondition("The query requires an index.")

        monkeypatch.setattr(query.Query, "limit", lambda self, n: Refused())
    capfd.readouterr()
    assert walk(api, A, 3) == (want_exit, 3)
    assert walk(api, A, 3, "created")[0] == want_created
    logs = [json.loads(line) for line in capfd.readouterr().err.splitlines() if line.startswith("{")]
    falls = [x for x in logs if x.get("event") == "trades_page_fallback"]
    assert {x["reason"] for x in falls} == {"index_exit", "index_created"}
    assert all(set(x) == {"event", "reason"} for x in falls)


def test_unauthorized_page_is_401(api):
    assert api.get("/api/trades?limit=5").status_code == 401
    assert api.get("/api/trades?limit=zzz").status_code == 401


def test_store_unavailable_page_is_503(memory_api):
    memory_api.store.unavailable = True
    assert memory_api.get("/api/trades?limit=5", A).status_code == 503
