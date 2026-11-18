"""使える利用者の許可リスト（Issue #43・設計書 10.1・ADR-0003「縦切り 2 で決めたこと」）。純関数だけ。

本番（署名を検証する起動）は、署名を検証できた ID トークンのうち、確かめ済みのメールが許可リストにある利用者だけを
``/api/*``（``/api/health`` を除く）へ通す。ほかは 403（``routes.py`` の ``authenticate``）。

- 値は環境変数 ``LOSS_NOTE_ALLOWED_EMAILS``（カンマ区切り。本番は Secret Manager の参照。リポジトリ・ログに出さない）
- 一致は前後の空白を除いた完全一致で、ASCII の A〜Z だけを小文字に寄せる
  （Unicode の大文字小文字の同一視はしない。Gmail の点の有無なども同一視しない）
- 閉じる側に倒す: 本番で変数が無い・空ならすべて 403。
  エミュレーターの起動で変数の鍵が無いときだけ制限しない（手元の開発）
"""

from collections.abc import Mapping

from loss_note_api.runtime import Mode

ALLOWED_EMAILS_VAR = "LOSS_NOTE_ALLOWED_EMAILS"

_ASCII_LOWER = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")


def _ascii_lower(value: str) -> str:
    return value.translate(_ASCII_LOWER)


def parse_allowlist(raw: str | None) -> frozenset[str]:
    """カンマで分け、前後の空白を除き、空の要素を捨て、ASCII の大文字だけを小文字にする"""
    if not raw:
        return frozenset()
    return frozenset(_ascii_lower(item.strip()) for item in raw.split(",") if item.strip())


def policy_for(mode: Mode, env: Mapping[str, str]) -> frozenset[str] | None:
    """None = 制限しない（エミュレーターの起動で変数の鍵が無いときだけ）。鍵があれば空でもその集合で効かせる"""
    if mode == "emulator" and ALLOWED_EMAILS_VAR not in env:
        return None
    return parse_allowlist(env.get(ALLOWED_EMAILS_VAR))


def denial_reason(claims: Mapping[str, object], policy: frozenset[str] | None) -> str | None:
    """通さない理由の決まった語（ログ用。メール・uid を含まない）。通すなら None"""
    if policy is None:
        return None
    if not policy:
        return "empty_list"
    email = claims.get("email")
    if not isinstance(email, str) or not email:
        return "no_email"
    # 真偽値の真だけ（文字列 "true" などは受けない）
    if claims.get("email_verified") is not True:
        return "unverified"
    if _ascii_lower(email) not in policy:
        return "not_listed"
    return None


def is_allowed(claims: Mapping[str, object], policy: frozenset[str] | None) -> bool:
    return denial_reason(claims, policy) is None
