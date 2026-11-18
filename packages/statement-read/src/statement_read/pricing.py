"""読み取りの料金表と、1 回の読み取りの費用の上界（予約額）の純関数（Issue #44）。

API の 1 日の費用の上限（``loss_note_api.read_limits``）と評価の道具の費用の集計（``statement_eval.score``）が
同じ表を使う（二重に持たない）。

- 単価は USD / 100 万トークン。これは µUSD（1 USD = 1,000,000 µUSD）/ トークンと同じ数なので、トークン数 × 単価が
  整数の µUSD のまま計算できる（浮動小数の誤差を出さない）
- 予約額 = 入力の上界 × 入力の最高単価 + 出力の上限 × 出力の単価。入力の上界は「画像 1 枚の上界 + 指示・決まった文・
  ツールの定義の UTF-8 のバイト数（トークン数 ≤ バイト数）+ CLI が足す分（上乗せ）」、入力の最高単価は 1 時間の
  cache 作成（入力の 2 倍）。出力の上限はアプリが CLI に渡す最大出力（``app_settings.APP_MAX_OUTPUT_TOKENS``）と
  モデルの最大出力の小さい方
- I/O・時刻・乱数を持たない
"""

import json
import math
from decimal import ROUND_CEILING, Decimal

from . import image, prompt, result
from .values import Usage

# 2026-11-03 時点の公開価格（USD / 100 万トークン）: 入力・出力・cache 読み。cache 作成（5 分）は入力の 1.25 倍。
# Haiku 5.5 は 10 万トークン以下の要求の価格（明細 1 枚の読み取りはこれに収まる）
PRICES_PER_MTOK: dict[str, tuple[Decimal, Decimal, Decimal]] = {
    "claude-opus-5-5": (Decimal("4"), Decimal("20"), Decimal("0.20")),
    "claude-sonnet-5-5": (Decimal("2"), Decimal("10"), Decimal("0.10")),
    "claude-haiku-5-5": (Decimal("0.10"), Decimal("0.50"), Decimal("0.01")),
}
CACHE_WRITE_FACTOR = Decimal("1.25")
# 1 時間の cache 作成は入力の 2 倍（入力の単価のうち最も高いもの。予約額の上界に使う）
CACHE_WRITE_1H_FACTOR = Decimal("2")
# モデルが 1 回に返せる最大出力（トークン。2026-11-03 の公開の表）
MAX_OUTPUT_TOKENS: dict[str, int] = {
    "claude-opus-5-5": 128_000,
    "claude-sonnet-5-5": 128_000,
    "claude-haiku-5-5": 128_000,
}
# 画像 1 枚の入力の上界（長辺 2,000 px の正方形で ceil(幅 × 高さ / 750)。提供元の上限 4,784 より大きい）
IMAGE_TOKENS_BOUND = math.ceil(image.MAX_EDGE * image.MAX_EDGE / 750)
# CLI が要求ごとに足す入力（システムの指示の前置き・ツールの枠など）の上乗せ。手元の実測（合成 14 枚の料金表の平均から
# 逆算した入力は数千トークン）の数倍を取る
CLI_OVERHEAD_TOKENS = 20_000
MICRO = Decimal(1_000_000)


def prompt_bytes() -> int:
    """指示（system）・画像に添える文・ツールの名前・説明・入力の形（JSON）の UTF-8 のバイト数（トークン数の上界）"""
    parts = (
        prompt.READ_SYSTEM,
        prompt.READ_USER_TEXT,
        result.TOOL_NAME,
        result.TOOL_DESCRIPTION,
        json.dumps(result.TOOL_INPUT_SCHEMA, ensure_ascii=False),
    )
    return sum(len(p.encode("utf-8")) for p in parts)


def input_tokens_bound() -> int:
    """読み取り 1 回の入力のトークン数の上界"""
    return IMAGE_TOKENS_BOUND + prompt_bytes() + CLI_OVERHEAD_TOKENS


def _ceil_int(d: Decimal) -> int:
    return int(d.to_integral_value(rounding=ROUND_CEILING))


def output_tokens_bound(model: str, max_output_tokens: int | None = None) -> int:
    """出力のトークン数の上限（CLI に渡す最大出力とモデルの最大出力の小さい方）。表に無いモデルは KeyError"""
    cap = MAX_OUTPUT_TOKENS[model]
    return cap if max_output_tokens is None else min(cap, max_output_tokens)


def reserve_micro_usd(model: str, max_output_tokens: int | None = None) -> int:
    """読み取り 1 回の費用の上界（整数の µUSD。切り上げ）。表に無いモデルは KeyError（起動時に分かる）"""
    inp, out, _cache_read = PRICES_PER_MTOK[model]
    total = Decimal(input_tokens_bound()) * inp * CACHE_WRITE_1H_FACTOR + Decimal(
        output_tokens_bound(model, max_output_tokens)
    ) * out
    return _ceil_int(total)


def cost_micro_usd(model: str, usage: Usage) -> int | None:
    """使用量 → 整数の µUSD（切り上げ）。価格表に無いモデルは None"""
    p = PRICES_PER_MTOK.get(model)
    if p is None:
        return None
    inp, out, cache_read = p
    total = (
        Decimal(usage.input_tokens) * inp
        + Decimal(usage.output_tokens) * out
        + Decimal(usage.cache_read_input_tokens) * cache_read
        + Decimal(usage.cache_creation_input_tokens) * inp * CACHE_WRITE_FACTOR
    )
    return _ceil_int(total)


def usd_to_micro(usd: float) -> int | None:
    """SDK が返す合計額（USD の float）→ 整数の µUSD（切り上げ）。負・有限でない値は None"""
    d = Decimal(str(usd))
    if not d.is_finite() or d < 0:
        return None
    return _ceil_int(d * MICRO)
