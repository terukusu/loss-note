"""合成のチャート（Issue #27 の AC-7）: 場面の表 → 描く中身と正解。純関数（乱数・I/O なし）。

値・銘柄名はすべて架空（「架空指数A」など）。チャートの道具の会社名・ロゴ・配色は入れず、時間足の表示の
**書き方の形**（凡例の「銘柄 · 4h」、MT 型の「銘柄,H4」、日本語の「日足」、数だけの「240」、選ばれた時間足の
ボタン）だけを真似る。
場面には、表示が無い・列挙に無い足・時間足の違う 2 つのチャート・チャートでない画像を含める（読み違えるより空が正）。

正解は ``timeframe``（記録の時間足の列挙か null）と ``label_shown``（時間足の表示が写っているか。作り話と読み違いを
分けて数える）。
"""

from dataclasses import dataclass

TITLE_NOTE = "合成・架空の値"
STYLES = ("legend", "mt", "ja", "numeric", "toolbar", "none", "two_panes", "not_chart")


@dataclass(frozen=True)
class ChartCase:
    file: str
    style: str
    symbol: str
    label: str | None  # 描く時間足の表示（two_panes は「左|右」）
    timeframe: str | None  # 正解（列挙か null）
    label_shown: bool
    dark: bool = False
    seed: int = 1


CASES: tuple[ChartCase, ...] = (
    ChartCase("c01.png", "legend", "架空指数A", "4h", "4h", True, seed=1),
    ChartCase("c02.png", "legend", "架空指数A", "1D", "1d", True, dark=True, seed=2),
    ChartCase("c03.png", "mt", "KAKUUB", "H4", "4h", True, seed=3),
    ChartCase("c04.png", "mt", "KAKUUB", "M15", "15m", True, dark=True, seed=4),
    ChartCase("c05.png", "ja", "架空指数A", "日足", "1d", True, seed=5),
    ChartCase("c06.png", "ja", "架空指数C", "4時間足", "4h", True, dark=True, seed=6),
    ChartCase("c07.png", "numeric", "架空指数A", "240", "4h", True, seed=7),
    ChartCase("c08.png", "toolbar", "架空指数C", "1h", "1h", True, seed=8),
    ChartCase("c09.png", "none", "架空指数A", None, None, False, seed=9),
    ChartCase("c10.png", "legend", "架空指数A", "2h", None, True, seed=10),
    ChartCase("c11.png", "mt", "KAKUUB", "W1", "1w", True, seed=11),
    ChartCase("c12.png", "legend", "架空指数C", "5m", "5m", True, dark=True, seed=12),
    ChartCase("c13.png", "not_chart", "架空指数A", None, None, False, seed=13),
    ChartCase("c14.png", "two_panes", "架空指数A", "4h|1D", None, True, seed=14),
)

TOOLBAR = ("1m", "5m", "15m", "1h", "4h", "D", "W")


@dataclass(frozen=True)
class Candle:
    open: float
    high: float
    low: float
    close: float


def candles(seed: int, n: int = 60) -> tuple[Candle, ...]:
    """決まった数列のろうそく足（線形合同法。乱数のモジュールを使わない。価格は架空で、画像に数は描かない）"""
    x = (seed * 2654435761) % 4294967296
    price = 100.0
    out = []
    for _ in range(n):
        x = (1103515245 * x + 12345) % 2147483648
        step = ((x % 2001) - 1000) / 400
        x = (1103515245 * x + 12345) % 2147483648
        wick = (x % 1000) / 800
        o, c = price, price + step
        out.append(Candle(o, max(o, c) + wick, min(o, c) - wick, c))
        price = c
    return tuple(out)


def header(case: ChartCase) -> str | None:
    """チャートの上に描く凡例の文字（時間足の表示を含む）"""
    if case.style == "legend":
        return f"{case.symbol} · {case.label} · {TITLE_NOTE}"
    if case.style == "mt":
        return f"{case.symbol},{case.label}  {TITLE_NOTE}"
    if case.style == "ja":
        return f"{case.symbol}  {case.label}  （{TITLE_NOTE}）"
    if case.style == "numeric":
        return f"{case.symbol}, {case.label}  {TITLE_NOTE}"
    if case.style in ("toolbar", "none"):
        return f"{case.symbol}  {TITLE_NOTE}"
    return None


def answers() -> dict:
    return {
        "images": [
            {"file": c.file, "kind": "not_chart" if c.style == "not_chart" else "chart", "timeframe": c.timeframe,
             "label_shown": c.label_shown}
            for c in CASES
        ]
    }


def manifest() -> dict:
    return {"note": "合成のチャート（架空の値）。python -m statement_eval generate-charts で作り直す",
            "images": [{"file": c.file, "style": c.style, "dark": c.dark} for c in CASES]}
