"""口座（Issue #47 PR-1・ADR-0012・設計書 4.5・C41）の純関数。

口座 = ``users/{uid}/accounts/{id}`` の文書 ``{name, nameKey, capitalYen, riskTolerancePct, capitalHistory,
createdAt, updatedAt}``。PR-1 の口座はすべて円（通貨の欄を持たない。無い = JPY）。
既定の口座は決まった ID ``default``（名前「口座 1」）。口座を読む・使う入口で無ければ、決まった ID の create で
設定 ``users/{uid}/settings/current`` の資金・許容リスク・資金の履歴から 1 回だけ作る
（移し替え。取引・設定は書かない）。
取引の ``record.accountId`` が無い = 既定の口座（移す前の取引・口座 1 つの利用者の取引）。
``build_default_now``（今の時刻）と ``log_default_created``（ログ）のほかは I/O・時刻・乱数を持たない
（``now`` は引数）。
"""

import copy
import time
from collections.abc import Callable

from loss_note_api import schema
from loss_note_api.logs import log_event

DEFAULT_ACCOUNT_ID = "default"
DEFAULT_ACCOUNT_NAME = "口座 1"
DEFAULT_RISK_TOLERANCE_PCT = 1

Doc = dict
# 既定の口座を作る: 設定の文書（無ければ None）-> 口座の文書
BuildDefault = Callable[[Doc | None], Doc]


def account_id_of(record: dict) -> str:
    """取引の記録の口座の ID（無ければ既定の口座。core/record.ts の accountIdOf と同じ）"""
    return record.get("accountId") or DEFAULT_ACCOUNT_ID


def default_account(settings: Doc | None, now: int) -> Doc:
    """既定の口座「口座 1」の文書。設定の資金・許容リスク・資金の履歴を写す（無ければ資金 null・1%・[]）。
    入力を書き換えない"""
    s = settings or {}
    capital = s.get("capitalYen")
    risk = s.get("riskTolerancePct")
    return {
        "name": DEFAULT_ACCOUNT_NAME,
        "nameKey": schema.name_key(DEFAULT_ACCOUNT_NAME),
        "capitalYen": capital,
        "riskTolerancePct": DEFAULT_RISK_TOLERANCE_PCT if risk is None else risk,
        "capitalHistory": copy.deepcopy(list(s.get("capitalHistory") or [])),
        "createdAt": now,
        "updatedAt": now,
    }


def build_default_now(settings: Doc | None) -> Doc:
    """時刻を今にした ``default_account``（保存先を直接呼ぶテスト・道具の既定。API は時計を渡す）"""
    return default_account(settings, int(time.time() * 1000))


def log_default_created(settings: Doc | None, doc: Doc) -> None:
    """移し替えで既定の口座を作ったときに 1 回だけ。真偽と件数だけ（名前・金額・uid を出さない）"""
    log_event(event="default_account_created", fromSettings=settings is not None,
              history=len(doc.get("capitalHistory") or []))  # fmt: skip


def account_response(account_id: str, doc: Doc) -> dict:
    """応答の形（nameKey は返さない）"""
    return {
        "id": account_id,
        "name": doc["name"],
        "capitalYen": doc.get("capitalYen"),
        "riskTolerancePct": doc.get("riskTolerancePct", DEFAULT_RISK_TOLERANCE_PCT),
        "capitalHistory": doc.get("capitalHistory", []),
        "createdAt": doc["createdAt"],
        "updatedAt": doc["updatedAt"],
    }


def account_sort_key(item: tuple[str, Doc]):
    """名前の順（銘柄と同じ。nameKey → name → ID）"""
    aid, doc = item
    return (doc["nameKey"], doc["name"], aid)


def account_snapshot(account: Doc) -> dict:
    """取引の snapshot に写す口座の値（鍵は今の snapshot と同じ。資金は円）"""
    return {
        "capitalYen": account.get("capitalYen"),
        "riskTolerancePct": account.get("riskTolerancePct", DEFAULT_RISK_TOLERANCE_PCT),
    }


def next_capital_history(history: list, prev_capital: float | None, new_capital: float | None, now: int) -> list:
    """資金が変わったときだけ ``{valueYen, at}`` を末尾に足し、末尾の MAX_CAPITAL_HISTORY 件に切る（設定と口座で共有）。
    入力を書き換えない"""
    out = list(history or [])
    if new_capital != prev_capital:
        out.append({"valueYen": new_capital, "at": now})
        out = out[-schema.MAX_CAPITAL_HISTORY :]
    return out
