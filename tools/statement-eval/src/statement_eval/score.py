"""採点の純関数（Issue #14 の R1〜R4。#11 の閾値の検査も同じ規則を使う）。I/O・時刻・乱数を持たない。

- 正解（answers.json の行）は schema.check_answers を、読み取りは schema.check_result を通ったものだけを受ける
- 数は Decimal で比べる（桁区切り・全角・通貨の記号は無視、符号は区別）
- 向きは建てた向き（L / S）で比べる。読み取りは明細に書かれた売買の向き（side_written）と、その向きが建玉そのもの
  の向きか決済の向きか（side_of）を返し、L / S への変換は opened_side() が行う（AI に反転させない）
  - 形 1（1 行 1 取引で「方向」の欄に「売約定」「買約定」）: 建玉そのものの向き → 売約定 = S、買約定 = L
  - 形 2（「決済売」「決済買」）: 決済の向き → 決済売 = L、決済買 = S
- 手数料は欄ごとの配列の合計で比べる（合計は AI でなくここで出す）
"""

import itertools
import re
import statistics
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal

# 数・日時・向き・手数料の純関数は API の直しと共有する（statement_read.values。#11）。ここからも同じ名前で使える
from statement_read.values import ORDER_TYPES, Usage, normalize_number, opened_side, sum_fees, time_key

# R1 の 10 欄（出力の順番）
FIELDS = (
    "symbol",
    "side",
    "entry_price",
    "entry_time",
    "exit_price",
    "exit_time",
    "qty",
    "fees",
    "pnl_jpy",
    "exit_order_type",
)
# 判定と R に効く 4 欄（R7）
DECISIVE_FIELDS = ("side", "entry_price", "exit_price", "pnl_jpy")
NUMBER_FIELDS = ("entry_price", "exit_price", "qty", "pnl_jpy")
TIME_FIELDS = ("entry_time", "exit_time")
# 全順列で行を対応づける上限（8! = 40,320 通り）
MAX_PERMUTE_ROWS = 8

_STATEMENT_DT_RE = re.compile(r"^\s*(\d{1,4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,4})\s+(\d{1,2}):(\d{2})(?::\d{2})?")

AnswerRow = dict  # キーは FIELDS。数は文字列、fees は文字列の配列、無い欄は None
ReadRow = dict  # schema.READ_ROW_KEYS。検査済み


@dataclass(frozen=True)
class RowScore:
    """正解の 1 行の採点。matches は FIELDS の順の一致（True / False）"""

    matches: tuple[bool, ...]
    hallucinated_order_type: bool = False

    @property
    def n_matched(self) -> int:
        return sum(self.matches)


@dataclass(frozen=True)
class ImageScore:
    """1 枚 1 回の読み取りの採点"""

    rows: tuple[RowScore, ...]
    n_answer_rows: int
    n_read_rows: int
    failed: bool  # 読み取りが失敗した（結果が無い・検査で捨てた）

    @property
    def row_count_match(self) -> bool:
        return not self.failed and self.n_answer_rows == self.n_read_rows

    @property
    def hallucinations(self) -> int:
        return sum(r.hallucinated_order_type for r in self.rows)


@dataclass(frozen=True)
class Tally:
    """集計（件数・割合・秒数・費用。値は持たない）"""

    model: str
    n_reads: int
    n_failed: int
    n_answer_rows: int  # 分母（正解の行の数 × 回数）
    field_matches: dict[str, int] = field(default_factory=dict)
    row_count_matches: int = 0
    hallucinations: int = 0
    seconds: tuple[float, float] | None = None  # (中央値, 最大)
    cost_total_usd: Decimal | None = None

    def rate(self, name: str) -> float | None:
        if self.n_answer_rows == 0:
            return None
        return self.field_matches.get(name, 0) / self.n_answer_rows


# ---- 正規化 ----


def parse_statement_datetime(text: str, order: Literal["DMY", "YMD"]) -> str:
    """明細の書き方の日時（「04/03/2026 10:15」「2026/03/04 10:15」）→ ISO の「YYYY-MM-DDTHH:MM」。時間帯は換算しない"""
    m = _STATEMENT_DT_RE.match(unicodedata.normalize("NFKC", text))
    if not m:
        raise ValueError("datetime")
    a, b, c, hh, mm = (int(x) for x in m.groups())
    if order == "DMY":
        d, mo, y = a, b, c
    elif order == "YMD":
        y, mo, d = a, b, c
    else:
        raise ValueError("order")
    if not (1 <= mo <= 12 and 1 <= d <= 31 and 0 <= hh <= 23 and 0 <= mm <= 59 and y >= 1000):
        raise ValueError("datetime")
    return f"{y:04d}-{mo:02d}-{d:02d}T{hh:02d}:{mm:02d}"


def normalize_symbol(v: str | None) -> str | None:
    if not isinstance(v, str):
        return None
    s = "".join(unicodedata.normalize("NFKC", v).split())
    return s or None


# ---- 比べる ----


def _read_value(name: str, read: ReadRow):
    if name == "side":
        return opened_side(read.get("side_written"), read.get("side_of"))
    return read.get(name)


def compare_field(name: str, answer, read: ReadRow) -> bool:
    """1 欄の一致（R1・R2）"""
    got = _read_value(name, read)
    if name in NUMBER_FIELDS:
        a, r = normalize_number(answer), normalize_number(got)
        return a == r
    if name in TIME_FIELDS:
        return time_key(answer) == time_key(got)
    if name == "symbol":
        return normalize_symbol(answer) == normalize_symbol(got)
    if name == "side":
        return (answer in ("L", "S") and answer == got) or (answer is None and got is None)
    if name == "fees":
        a_none = answer is None or answer == []
        r_none = got is None or got == []
        if a_none or r_none:
            return a_none and r_none
        a, r = sum_fees(answer), sum_fees(got)
        return a is not None and a == r
    if name == "exit_order_type":
        a = answer if answer in ORDER_TYPES else "unknown"
        r = got if got in ORDER_TYPES else "unknown"
        return a == r
    raise ValueError("field")


def compare_row(answer: AnswerRow, read: ReadRow | None) -> RowScore:
    """正解の 1 行と読み取りの 1 行（None = 返らなかった行）"""
    if read is None:
        return RowScore(matches=(False,) * len(FIELDS))
    matches = tuple(compare_field(n, answer.get(n), read) for n in FIELDS)
    a_type = answer.get("exit_order_type") or "unknown"
    r_type = read.get("exit_order_type") or "unknown"
    hallucinated = a_type == "unknown" and r_type in ORDER_TYPES and r_type != "unknown"
    return RowScore(matches=matches, hallucinated_order_type=hallucinated)


def match_rows(answers: list[AnswerRow], reads: list[ReadRow]) -> list[tuple[int, int | None]]:
    """正解の行と読み取りの行の対応（正解の添字, 読み取りの添字 | None）。一致する欄の数の合計が最大の組み合わせ。
    どちらかが MAX_PERMUTE_ROWS 行を超えたら上から順。同点は先に見つかった（添字の小さい）組み合わせ"""
    na, nr = len(answers), len(reads)
    if na == 0:
        return []
    if na > MAX_PERMUTE_ROWS or nr > MAX_PERMUTE_ROWS:
        return [(i, i if i < nr else None) for i in range(na)]
    gain = [[compare_row(a, r).n_matched for r in reads] for a in answers]
    best: list[tuple[int, int | None]] | None = None
    best_score = -1
    if nr >= na:
        for perm in itertools.permutations(range(nr), na):
            s = sum(gain[i][j] for i, j in enumerate(perm))
            if s > best_score:
                best_score, best = s, [(i, j) for i, j in enumerate(perm)]
    else:
        for perm in itertools.permutations(range(na), nr):  # 読み取りの j 行目 → 正解の perm[j] 行目
            s = sum(gain[i][j] for j, i in enumerate(perm))
            if s > best_score:
                owner = {i: j for j, i in enumerate(perm)}
                best_score, best = s, [(i, owner.get(i)) for i in range(na)]
    assert best is not None
    return best


def score_image(answer: dict, read: dict | None) -> ImageScore:
    """正解の 1 枚（{"rows": [...]}）と読み取りの結果（{"kind", "rows"} | None = 失敗）"""
    a_rows = list(answer.get("rows") or [])
    if read is None:
        return ImageScore(
            rows=tuple(compare_row(a, None) for a in a_rows), n_answer_rows=len(a_rows), n_read_rows=0, failed=True
        )
    r_rows = list(read.get("rows") or []) if read.get("kind") == "statement" else []
    pairs = match_rows(a_rows, r_rows)
    rows = tuple(compare_row(a_rows[i], r_rows[j] if j is not None else None) for i, j in pairs)
    return ImageScore(rows=rows, n_answer_rows=len(a_rows), n_read_rows=len(r_rows), failed=False)


def median_max(xs: list[float]) -> tuple[float, float] | None:
    """中央値（偶数個は中の 2 つの平均）と最大。空なら None"""
    vals = [float(x) for x in xs]
    if not vals:
        return None
    return float(statistics.median(vals)), max(vals)


# ---- 費用 ----

# 2026-11-03 時点の公開価格（USD / 100 万トークン）: 入力・出力・cache 読み。cache 作成は入力の 1.25 倍。
# Haiku 5.5 は 10 万トークン以下の要求の価格（明細 1 枚の読み取りはこれに収まる）
PRICES_PER_MTOK: dict[str, tuple[Decimal, Decimal, Decimal]] = {
    "claude-opus-5-5": (Decimal("4"), Decimal("20"), Decimal("0.20")),
    "claude-sonnet-5-5": (Decimal("2"), Decimal("10"), Decimal("0.10")),
    "claude-haiku-5-5": (Decimal("0.10"), Decimal("0.50"), Decimal("0.01")),
}
CACHE_WRITE_FACTOR = Decimal("1.25")


def cost_usd(model: str, usage: Usage) -> Decimal | None:
    """使用量 → USD。価格表に無いモデルは None（不明）"""
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
    return total / Decimal(1_000_000)


def aggregate(scores: list[ImageScore], seconds: list[float], usages: list[Usage], model: str) -> Tally:
    """読み取りごとの採点・秒数（失敗した回を除いて呼び出し側が渡す）・使用量 → 集計"""
    field_matches = dict.fromkeys(FIELDS, 0)
    for s in scores:
        for r in s.rows:
            for name, ok in zip(FIELDS, r.matches, strict=True):
                field_matches[name] += int(ok)
    costs = [cost_usd(model, u) for u in usages]
    cost_total = None if not costs or any(c is None for c in costs) else sum(costs, Decimal(0))
    return Tally(
        model=model,
        n_reads=len(scores),
        n_failed=sum(s.failed for s in scores),
        n_answer_rows=sum(s.n_answer_rows for s in scores),
        field_matches=field_matches,
        row_count_matches=sum(s.row_count_match for s in scores),
        hallucinations=sum(s.hallucinations for s in scores),
        seconds=median_max(seconds),
        cost_total_usd=cost_total,
    )
