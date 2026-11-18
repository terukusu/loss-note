"""決済明細の読み取りの 1 日の上限（Issue #44・ADR-0010）の純関数。I/O・時刻・乱数を持たない（時刻は引数）。

- 日の区切りは日本時間の 0:00（UTC+9 の固定。日本に夏時間は無い）。日付は文書の ID（``YYYY-MM-DD``）
- 利用者ごとの回数の上限（既定 30 回）と、全利用者の合計の費用の上限（既定 2,000,000 µUSD = 2.00 USD）
- 送る前に、その要求の費用の上界（予約額）を足して上限の内側のときだけ送る（等しいときは送る）。回数を先に見る
- 送った後は実額に直す（料金表の額と SDK の合計額の大きい方。どちらも無ければ予約額のまま = 多めに数える側）
- 金額は整数の µUSD（1 USD = 1,000,000）

上限の値はコードの定数（環境変数で変えない。設定の誤りで上限が外れる経路を作らない）。
テストは ``ReadLimits`` を差し込む。
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone
from typing import Literal

from statement_read import app_settings, pricing
from statement_read.values import Usage

JST = timezone(timedelta(hours=9))
PER_USER_DEFAULT = 30
DAILY_MICRO_USD_DEFAULT = 2_000_000

Decision = Literal["ok", "user", "spend"]


def _app_reserve() -> int:
    return pricing.reserve_micro_usd(app_settings.APP_MODEL, app_settings.APP_MAX_OUTPUT_TOKENS)


@dataclass(frozen=True)
class ReadLimits:
    """上限の値。reserve_micro_usd は読み取り 1 回の費用の上界（アプリのモデル・最大出力から出す）"""

    per_user: int = PER_USER_DEFAULT
    daily_micro_usd: int = DAILY_MICRO_USD_DEFAULT
    reserve_micro_usd: int = field(default_factory=_app_reserve)
    model: str = app_settings.APP_MODEL


def jst_day(now_ms: int) -> str:
    """エポックのミリ秒（UTC）→ 日本時間の日付 ``YYYY-MM-DD``"""
    return datetime.fromtimestamp(now_ms / 1000, UTC).astimezone(JST).date().isoformat()


def decide(user_count: int, spent_micro: int, limits: ReadLimits) -> Decision:
    """その日の利用者の回数・全体の計上額 → 送るか。回数を先に見る（回数が上限なら "user"）。
    計上額 + 予約額が上限を超えるなら "spend"（等しいときは送る）"""
    if user_count >= limits.per_user:
        return "user"
    if spent_micro + limits.reserve_micro_usd > limits.daily_micro_usd:
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
