"""両建てのまとまり（Issue #266・設計書 C75・C76・C80・4.8・6.5・ADR-0027）の純関数。

保存は ``users/{uid}/positionGroups/{id}`` = ``{schemaVersion: 1, members, exit?, createdAt, updatedAt}``。
``members`` は ``[{tradeId, role, entryTime, exitTime}]``（2〜10 件。``role`` = ``main`` 本玉 / ``hedge`` 決済の代わり。
並びは結んだ順で、計算には使わない）。``entryTime``（最初のエントリーの時刻。エントリーに時刻が無ければ null）・
``exitTime``（決済の時刻）は取引の写しで、範囲の読み（6.5）だけに使う。判定・R は取引の文書の値で
画面の ``core/`` が出す。

取引の文書の最上位に逆参照 ``positionGroupId``（``record`` の外。心理のタグと同じ作り。ADR-0022）。書くのはまとまりの
入口と、取引の削除（まとまりを直す）だけ。取引の PUT・チャートの入口は文書を ``{**doc}`` で組むので保つ。
取引の ``schemaVersion`` は上げない。

API の検査は形だけ（ADR-0027 の決定 3。2〜10 件・重なりなし・役割の組・本玉は同じ向き・決済の代わりは逆の向き・
足を持たない・本人の取引・1 つのまとまりにだけ）。量・時刻・価格の意味は画面の ``core/`` が決める（C44 と同じ考え）。
"""

from collections.abc import Iterable

# 取引の文書の最上位の逆参照の鍵
KEY = "positionGroupId"
# まとまりの文書の版（知らない版の PUT・DELETE は 409。ADR-0020 の決定 7 の (a) と同じ守り）
SCHEMA_VERSION = 1
MIN_MEMBERS = 2
MAX_MEMBERS = 10
MAIN = "main"
HEDGE = "hedge"
ROLES = (MAIN, HEDGE)
# 決済の代わりを建てた注文の種類（C78。無い = 不明）
EXIT_ORDER_TYPES = ("stop", "market", "limit")
# 一覧の件数の上限（4.8）
MAX_LIST = 1_000
# 409 の理由
IN_OTHER_GROUP = "inOtherGroup"
IN_POSITION_GROUP = "inPositionGroup"


class MemberSideChanged(Exception):
    """まとまりのメンバーの向きを変える取引の PUT（409 ``inPositionGroup``。何も書かない）"""


def is_known(doc: dict) -> bool:
    """まとまりの文書の版をこの版の API が知るか（int〔bool を除く〕で SCHEMA_VERSION 以下）"""
    v = doc.get("schemaVersion")
    return type(v) is int and v <= SCHEMA_VERSION


def next_updated_at(now: int, prev: int | None) -> int:
    """直した時刻は必ず進める（``routes.next_updated_at`` と同じ）"""
    return now if prev is None else max(now, prev + 1)


def member_times(record: dict) -> dict:
    """取引の record → まとまりのメンバーの時刻の写し"""
    times = [e["time"] for e in record.get("entries") or [] if isinstance(e.get("time"), int)]
    return {"entryTime": min(times) if times else None, "exitTime": record["exit"]["time"]}


def member_ids(group: dict) -> list[str]:
    return [m["tradeId"] for m in group.get("members") or []]


def shape_issues(members: list[dict], trades: dict[str, dict]) -> list[dict]:
    """結ぶ・メンバーを変える本文のうち、取引を読んで初めて分かる形の誤り（400）。

    足を持つ取引・本玉の向きがそろわない・決済の代わりが本玉と同じ向き。issues は道筋と種類だけ
    """
    issues: list[dict] = []
    for i, m in enumerate(members):
        if "legs" in trades[m["tradeId"]]["record"]:
            issues.append({"field": f"members[{i}].tradeId", "kind": "legs"})
    main_sides = {trades[m["tradeId"]]["record"]["side"] for m in members if m["role"] == MAIN}
    if len(main_sides) > 1:
        issues.append({"field": "members", "kind": "mainSide"})
    elif main_sides:
        (side,) = main_sides
        for i, m in enumerate(members):
            if m["role"] == HEDGE and trades[m["tradeId"]]["record"]["side"] == side:
                issues.append({"field": f"members[{i}].role", "kind": "side"})
    return issues


def in_other_group(members: list[dict], trades: dict[str, dict], group_id: str | None) -> bool:
    """メンバーのどれかが別のまとまりに属しているか（逆参照が空か同じまとまりならよい）"""
    for m in members:
        ref = trades[m["tradeId"]].get(KEY)
        if ref is not None and ref != group_id:
            return True
    return False


def build_group(members: list[dict], exit_: dict | None, trades: dict[str, dict], now: int,
                prev: dict | None = None) -> dict:  # fmt: skip
    """まとまりの文書（作る / 置き換える）。時刻の写しは今の取引の文書から"""
    doc = {
        "schemaVersion": SCHEMA_VERSION,
        "members": [{"tradeId": m["tradeId"], "role": m["role"], **member_times(trades[m["tradeId"]]["record"])}
                    for m in members],  # fmt: skip
        "createdAt": now if prev is None else prev["createdAt"],
        "updatedAt": now if prev is None else next_updated_at(now, prev.get("updatedAt")),
    }
    if exit_:
        doc["exit"] = dict(exit_)
    return doc


def link(doc: dict, group_id: str, now: int) -> dict:
    """取引の文書に逆参照を付ける（record・snapshot・版・心理のタグなどは変えない）"""
    return {**doc, KEY: group_id, "updatedAt": next_updated_at(now, doc.get("updatedAt"))}


def unlink(doc: dict, now: int) -> dict:
    """取引の文書から逆参照を外す"""
    new = {k: v for k, v in doc.items() if k != KEY}
    new["updatedAt"] = next_updated_at(now, doc.get("updatedAt"))
    return new


def relink_writes(group_id: str, before: Iterable[str], after: Iterable[str], trades: dict[str, dict],
                  now: int) -> dict[str, dict]:  # fmt: skip
    """メンバーの入れ替えで書く取引の文書（外れた = 逆参照を外す、加わった = 付ける）。

    外れた取引は、逆参照がこのまとまりを指しているときだけ外す（無い取引・ほかを指す取引は書かない）
    """
    after_set = set(after)
    writes: dict[str, dict] = {}
    for tid in before:
        doc = trades.get(tid)
        if tid not in after_set and doc is not None and doc.get(KEY) == group_id:
            writes[tid] = unlink(doc, now)
    for tid in after_set:
        doc = trades[tid]
        if doc.get(KEY) != group_id:
            writes[tid] = link(doc, group_id, now)
    return writes


def has_roles(members: list[dict]) -> bool:
    """本玉 1 件以上・決済の代わり 1 件以上か"""
    roles = {m["role"] for m in members}
    return MAIN in roles and HEDGE in roles


def after_trade_removed(group: dict, trade_id: str, now: int) -> tuple[str, dict | None]:
    """メンバーの取引を消した後のまとまり: ``("skip", None)`` = 書かない（知らない版・メンバーでない）/
    ``("write", 新しい文書)`` = メンバーから外す / ``("delete", None)`` = 役割の組が崩れたのでまとまりを消す"""
    if not is_known(group) or trade_id not in member_ids(group):
        return "skip", None
    rest = [m for m in group["members"] if m["tradeId"] != trade_id]
    if not has_roles(rest):
        return "delete", None
    return "write", {**group, "members": rest, "updatedAt": next_updated_at(now, group.get("updatedAt"))}


def after_trade_updated(group: dict, trade_id: str, old: dict, new: dict, now: int) -> dict | None:
    """メンバーの取引を直した後のまとまり（None = 書かない）。向きを変えたら ``MemberSideChanged``。

    知らない版のまとまり・この取引をメンバーに持たないまとまり（崩れた逆参照）は見ない
    """
    if not is_known(group) or trade_id not in member_ids(group):
        return None
    if new["record"]["side"] != old["record"]["side"]:
        raise MemberSideChanged()
    times = member_times(new["record"])
    members = [{**m, **times} if m["tradeId"] == trade_id else m for m in group["members"]]
    if members == group["members"]:
        return None
    return {**group, "members": members, "updatedAt": next_updated_at(now, group.get("updatedAt"))}


def span(group: dict) -> tuple[int, int] | None:
    """時刻の写しの幅〔最初のエントリー〜最後の決済〕。エントリーの時刻の無いメンバーは決済の時刻で数える"""
    starts: list[int] = []
    ends: list[int] = []
    for m in group.get("members") or []:
        exit_time = m.get("exitTime")
        if not isinstance(exit_time, int):
            continue
        entry_time = m.get("entryTime")
        starts.append(entry_time if isinstance(entry_time, int) else exit_time)
        ends.append(exit_time)
    if not starts:
        return None
    return min(starts), max(ends)


def overlaps(group: dict, start: int, end: int) -> bool:
    """時刻の写しの幅が範囲 [start, end) と重なるか"""
    s = span(group)
    return s is not None and s[0] < end and s[1] >= start


def group_response(group_id: str, doc: dict) -> dict:
    res = {
        "id": group_id,
        "schemaVersion": doc["schemaVersion"],
        "members": [dict(m) for m in doc.get("members") or []],
        "createdAt": doc["createdAt"],
        "updatedAt": doc["updatedAt"],
    }
    if doc.get("exit"):
        res["exit"] = dict(doc["exit"])
    return res


def sort_key(item: tuple[str, dict]):
    """一覧の並び: 作った時刻の新しい順 → ID の昇順"""
    gid, doc = item
    return (-int(doc.get("createdAt") or 0), gid)
