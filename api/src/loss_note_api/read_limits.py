"""AI の 1 日の上限（Issue #44・ADR-0010、Issue #51・ADR-0014）の純関数。I/O・時刻・乱数を持たない（時刻は引数）。

- 日の区切りは日本時間の 0:00（UTC+9 の固定。日本に夏時間は無い）。日付は文書の ID（``YYYY-MM-DD``）
- 上限は 3 つ: 利用者ごとの回数（既定 30 回）・利用者ごとの費用（既定 1,000,000 µUSD = 1.00 USD。#51）・全利用者の
  合計の費用（既定 2,000,000 µUSD = 2.00 USD）。判定の順は 回数 → 利用者の費用 → 全体の費用
- 送る前に、その要求の費用の上界（予約額）を足して上限の内側のときだけ送る（等しいときは送る）
- 送った後は実額に直す（料金表の額と SDK の合計額の大きい方。どちらも無ければ予約額のまま = 多めに数える側）
- バイパスのリスト（#51）の利用者は、利用者ごとの回数・費用の上限を受けない。全体の上限（ブレーカー）は受ける。
  照らし方は使える利用者の許可リスト（``allowlist.py``）と同じ（確かめ済みのメールの完全一致）
- 金額は整数の µUSD（1 USD = 1,000,000）

上限の値とバイパスのリストは環境変数で受ける（#51・ADR-0014。ADR-0010 の決定 1 を上書き）。未設定・空なら既定値。
形の誤りは既定値に戻さず ``config_error`` に変数の名前を残し、読み取りの入口が 503 にする（閉じる側。下げるつもりの
誤記で高い既定値が効く経路を作らない）。テストは ``ReadLimits`` を差し込む。
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal

from statement_read import app_settings, pricing
from statement_read.values import Usage

from loss_note_api import allowlist

JST = timezone(timedelta(hours=9))
PER_USER_DEFAULT = 30
PER_USER_MICRO_USD_DEFAULT = 1_000_000
DAILY_MICRO_USD_DEFAULT = 2_000_000

# 環境変数の名前（#51。後の AI の振り返りも同じ財布で数える前提で AI と呼ぶ）
USER_COUNT_VAR = "LOSS_NOTE_AI_USER_DAILY_COUNT"
USER_USD_VAR = "LOSS_NOTE_AI_USER_DAILY_USD"
DAILY_USD_VAR = "LOSS_NOTE_AI_DAILY_USD"
BYPASS_EMAILS_VAR = "LOSS_NOTE_AI_BYPASS_EMAILS"

_COUNT = re.compile(r"[0-9]{1,6}")
_USD = re.compile(r"[0-9]{1,6}(\.[0-9]{1,6})?")
_MICRO = Decimal(1_000_000)

Decision = Literal["ok", "user", "user_spend", "spend"]


def _app_reserve() -> int:
    return pricing.reserve_micro_usd(app_settings.APP_MODEL, app_settings.APP_MAX_OUTPUT_TOKENS)


@dataclass(frozen=True)
class ReadLimits:
    """上限の値。reserve_micro_usd は読み取り 1 回の費用の上界（アプリのモデル・最大出力から出す）。
    bypass はバイパスのリスト（正規化したメール。repr に出さない）。
    config_error は形の誤りの環境変数の名前（None = 誤り無し）"""

    per_user: int = PER_USER_DEFAULT
    daily_micro_usd: int = DAILY_MICRO_USD_DEFAULT
    reserve_micro_usd: int = field(default_factory=_app_reserve)
    model: str = app_settings.APP_MODEL
    per_user_micro_usd: int = PER_USER_MICRO_USD_DEFAULT
    bypass: frozenset[str] = field(default=frozenset(), repr=False)
    config_error: str | None = None


def parse_count(raw: str) -> int | None:
    """回数の文字列（0〜999,999 の整数）→ 数。形が違えば None"""
    s = raw.strip()
    return int(s) if _COUNT.fullmatch(s) else None


def parse_usd(raw: str) -> int | None:
    """USD の文字列（整数部 6 桁まで・小数 6 桁まで・符号なし）→ 整数の µUSD。形が違えば None（浮動小数を通さない）"""
    s = raw.strip()
    if not _USD.fullmatch(s):
        return None
    return int(Decimal(s) * _MICRO)


def limits_from_env(env: Mapping[str, str]) -> ReadLimits:
    """環境変数 → 上限。未設定・空なら既定値。形の誤りがあれば最初の変数の名前を config_error に入れる
    （値は持たない）"""
    values: dict[str, int] = {}
    for var, key, parse in (
        (USER_COUNT_VAR, "per_user", parse_count),
        (USER_USD_VAR, "per_user_micro_usd", parse_usd),
        (DAILY_USD_VAR, "daily_micro_usd", parse_usd),
    ):
        raw = env.get(var) or ""
        if not raw:
            continue
        got = parse(raw)
        if got is None:
            return ReadLimits(config_error=var)
        values[key] = got
    return ReadLimits(**values, bypass=allowlist.parse_allowlist(env.get(BYPASS_EMAILS_VAR)))


def is_bypass(claims: Mapping[str, object] | None, limits: ReadLimits) -> bool:
    """バイパスの利用者か。照らし方は許可リストと同じ（確かめ済みのメールがリストにあるときだけ）。リストが空なら誰も当たらない"""
    if not limits.bypass or claims is None:
        return False
    return allowlist.denial_reason(claims, limits.bypass) is None


def effective_user_micro(count: int, recorded: object, reserve_micro: int) -> int:
    """利用者の日の文書の金額 → 判定に使う計上額（#51）。0 以上の整数ならそのまま。欠け・負・整数でない値は
    「数えられない」として、その日の回数 × 予約額（1 回の費用の上界）に見積もる（多めに数える側）。
    欠けるのは #51 より前の文書と、切り戻した日に前のコードが文書を ``{count}`` で置き換えたとき。負になるのは、
    新しいコードの予約と精算の間に前のコードの予約が挟まり、精算の差し引きだけが残ったとき"""
    if isinstance(recorded, int) and not isinstance(recorded, bool) and recorded >= 0:
        return recorded
    return max(count, 0) * reserve_micro


def jst_day(now_ms: int) -> str:
    """エポックのミリ秒（UTC）→ 日本時間の日付 ``YYYY-MM-DD``"""
    return datetime.fromtimestamp(now_ms / 1000, UTC).astimezone(JST).date().isoformat()


def decide(
    user_count: int,
    spent_micro: int,
    limits: ReadLimits,
    *,
    user_spent_micro: int = 0,
    bypass: bool = False,
) -> Decision:
    """その日の利用者の回数・全体の計上額（と利用者の計上額）→ 送るか。順は 回数（"user"）→ 利用者の費用
    （"user_spend"）→ 全体の費用（"spend"）。費用は 計上額 + 予約額 が上限を超えると止める（等しいときは送る）。
    bypass なら利用者の 2 つを飛ばす（全体は見る）"""
    reserve = limits.reserve_micro_usd
    if not bypass:
        if user_count >= limits.per_user:
            return "user"
        if user_spent_micro + reserve > limits.per_user_micro_usd:
            return "user_spend"
    if spent_micro + reserve > limits.daily_micro_usd:
        return "spend"
    return "ok"


def settled_micro(usage: Usage | None, sdk_cost_usd: float | None, reserve: int, model: str) -> int:
    """送った後の実額（µUSD）。料金表の額と SDK の合計額の大きい方。どちらも取れなければ予約額（多めに数える側）"""
    amounts = []
    if usage is not None:
        a = pricing.cost_micro_usd(model, usage)
        if a is not None:
            amounts.append(a)
    if sdk_cost_usd is not None:
        b = pricing.usd_to_micro(sdk_cost_usd)
        if b is not None:
            amounts.append(b)
    return max(amounts) if amounts else reserve
