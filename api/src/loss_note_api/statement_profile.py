"""明細の特徴の鍵と覚えの純関数（Issue #66・ADR-0017）。I/O・時刻・乱数を持たない。

明細の読み取りが返す会社・サービスの名前（``issuer``）は API の中でだけ使い、ここで利用者ごとの一方向の鍵に変えて
捨てる（応答・ログ・保存先に名前を出さない。設計書 C14・C45）。保存するのは ``users/{uid}/statement_profiles/{鍵}``
= ``{accountId, updatedAt}`` だけ（画像・読み取りの値・会社の名前・口座番号を持たない。ADR-0005）。

鍵の材料（R2）:
- 利用者（uid。利用者をまたいで同じ鍵にしない）
- 会社の名前の同一視（共有の ``statement_read.values.issuer_key`` = ``schema.name_key`` の NFKC・大文字小文字・前後の
  空白に加えて、間の空白も除く。「架空証券 X」「架空証券Ｘ」「 架空証券 x 」を同じにする。S15。評価の道具の採点と同じ）
- 行の向きの書き方（``side_of`` = position / close）の集合。読めなかった行（None）は数えない
- 行の通貨（``pnl_currency``。英字 3 文字）の集合。unknown は数えない
会社の名前が読めなければ鍵は作らない（向きと通貨だけの鍵は会社をまたいで同じになりやすく、誤って選ぶと
リスク（%）の分母が誤る）。
"""

import hashlib
import re
from collections.abc import Iterable

from statement_read.values import issuer_key

KEY_PATTERN = re.compile(r"^[0-9a-f]{32}$")
_VERSION = "loss-note/statement-profile/v1"
_UNKNOWN = "unknown"


__all__ = ["KEY_PATTERN", "issuer_key", "profile_doc", "profile_key", "profile_response", "valid_key"]


def profile_key(uid: str, issuer: str | None, rows: Iterable[dict]) -> str | None:
    """明細の特徴の鍵（16 進 32 文字）。会社の名前が読めなければ None。決定的（同じ材料なら同じ値）"""
    name = issuer_key(issuer)
    if name is None:
        return None
    rows = list(rows)
    sides = sorted({r.get("side_of") for r in rows if isinstance(r.get("side_of"), str)})
    currencies = sorted({
        r.get("pnl_currency") for r in rows
        if isinstance(r.get("pnl_currency"), str) and r.get("pnl_currency") != _UNKNOWN
    })  # fmt: skip
    material = "\0".join([_VERSION, uid, name, ",".join(sides), ",".join(currencies)])
    del name
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:32]


def valid_key(key: str) -> bool:
    return isinstance(key, str) and KEY_PATTERN.fullmatch(key) is not None


def profile_doc(account_id: str, now: int) -> dict:
    """覚えの文書（口座の ID と時刻だけ）"""
    return {"accountId": account_id, "updatedAt": now}


def profile_response(key: str | None, doc: dict | None) -> dict | None:
    """読み取りの応答の ``profile``。鍵が無ければ None、覚えが無ければ accountId は None"""
    if key is None:
        return None
    account_id = doc.get("accountId") if isinstance(doc, dict) else None
    return {"key": key, "accountId": account_id if isinstance(account_id, str) else None}
