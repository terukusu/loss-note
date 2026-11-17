"""評価の要約（R5: 件数・割合・秒数・費用・使ったモデルの名前だけ）→ Markdown / JSON。

要約は Summary（下の dataclass）からしか作らない。Summary は値（価格・数量・損益・日時・銘柄の名前・ファイル名）を
入れる欄を持たない（tests/test_report_no_values.py の test_summary_type_has_no_value_fields が欄の名前と型を固定する）。
"""

import json
from dataclasses import asdict, dataclass

from .score import DECISIVE_FIELDS

FIELD_LABELS = {
    "symbol": "銘柄の名前",
    "side": "L / S（建てた向き）",
    "entry_price": "建てた価格",
    "entry_time": "建てた日時",
    "exit_price": "決済の価格",
    "exit_time": "決済の日時",
    "qty": "数量",
    "fees": "手数料",
    "pnl_jpy": "損益（円）",
    "exit_order_type": "決済の注文の種類",
}
SET_LABELS = {"synthetic": "合成の明細", "real": "実物の明細"}


@dataclass(frozen=True)
class FieldRate:
    name: str  # 欄の名前（score.FIELDS）
    matched: int
    denominator: int


@dataclass(frozen=True)
class GroupMismatch:
    group: str  # 合成は場面 ID、実物は画像の番号（"1"・"2"・"3"）
    reads: int
    mismatched_fields: int
    all_runs_matched_fields: int | None = None  # 実物: 3 回とも一致した欄の数（正解の行 × 10 欄のうち）
    fields_total: int | None = None


@dataclass(frozen=True)
class Count:
    name: str  # 時間帯の列挙の名前・失敗の種類の名前
    count: int


@dataclass(frozen=True)
class Summary:
    set_name: str  # synthetic / real
    model: str
    effort: str
    credential_kind: str  # oauth_token / api_key（名前だけ）
    n_images: int
    repeat: int
    n_reads: int
    n_failed: int
    n_answer_rows: int  # 分母（正解の行の数 × 回数）
    fields: tuple[FieldRate, ...]
    row_count_matched: int
    row_count_denominator: int
    hallucinations: int
    order_type_visible_rows: int | None  # 実物: 正解で注文の種類が写っていた行の数（正解の側から数える）
    order_type_rows: int | None
    time_zones: tuple[Count, ...]
    failures: tuple[Count, ...]
    images_within_limits: int
    images_shrunk: int
    seconds_median: float | None
    seconds_max: float | None
    api_seconds_median: float | None
    api_seconds_max: float | None
    cost_per_read_usd: float | None
    cost_total_usd: float | None
    sdk_cost_total_usd: float | None
    usd_jpy: float | None
    groups: tuple[GroupMismatch, ...]
    rows_per_round: int  # 1 回分の正解の行の数（1 件の誤りが動かす割合の分母）


def _pct(n: int, d: int) -> str:
    return "—" if d == 0 else f"{n / d * 100:.1f}%"


def _sec(x: float | None) -> str:
    return "—" if x is None else f"{x:.1f} 秒"


def _usd(x: float | None) -> str:
    return "不明" if x is None else f"${x:.4f}"


def limits(s: Summary) -> list[str]:
    """数字から言えることの限界（AC-7 の 3 点）"""
    if s.set_name == "real" and s.rows_per_round > 0:
        one = f"実物は {s.n_images} 枚・2 社だけで、1 回分の分母は {s.rows_per_round} 行です。1 件の誤りで割合が " \
              f"{100 / s.rows_per_round:.0f} ポイント動きます（{s.repeat} 回を足した分母 {s.n_answer_rows} では " \
              f"{100 / max(s.n_answer_rows, 1):.0f} ポイントに見えますが、同じ明細の繰り返しなので独立した件数では" \
              "ありません）"
    else:
        one = "実物は 3 枚・2 社だけで、1 件の誤りで割合が 33 ポイント動きます（実物の要約で行の数から実数を出します）"
    return [
        one,
        "合成の明細は形（欄の並び・日時の書き方・向きの言葉）への対応を測るもので、実物の画質や撮り方での精度は"
        "測りません（option-simulator の ADR-0009 と同じ限界）",
        "秒数はその日の提供元の混み具合に左右されます。秒数は送ってから結果を受け取るまでの壁時計で、CLI の起動"
        "（約 1 秒）を含みます",
    ]


def to_markdown(s: Summary) -> str:
    unit = "画像ごと"
    lines = [
        f"## 決済明細の読み取りの評価（{SET_LABELS.get(s.set_name, s.set_name)}）",
        "",
        f"- モデル: `{s.model}`（effort `{s.effort}`）・資格情報の種類: {s.credential_kind}",
        f"- 画像 {s.n_images} 枚 × {s.repeat} 回 = 読み取り {s.n_reads} 回（失敗 {s.n_failed} 回）・"
        f"正解の行 {s.n_answer_rows}（分母）",
        f"- 画像の大きさ: 上限内 {s.images_within_limits} 枚・縮めて送った {s.images_shrunk} 枚",
        "",
        "| 欄 | 一致 / 分母 | 割合 |",
        "|---|---|---|",
    ]
    for f in s.fields:
        lines.append(f"| {FIELD_LABELS.get(f.name, f.name)} | {f.matched} / {f.denominator} | "
                     f"{_pct(f.matched, f.denominator)} |")
    lines.append(f"| 行数（{unit}） | {s.row_count_matched} / {s.row_count_denominator} | "
                 f"{_pct(s.row_count_matched, s.row_count_denominator)} |")
    lines.append("")
    decisive = [f for f in s.fields if f.name in DECISIVE_FIELDS]
    if decisive:
        ok = all(f.matched == f.denominator for f in decisive)
        lines.append("- 判定と R に効く 4 欄（L / S・建てた価格・決済の価格・損益（円））: "
                     + ("全件一致" if ok else "不一致あり（R7: 30 秒の予算の見直しを提案に含める）"))
    lines.append(f"- 決済の注文の種類の作り話（写っていないのに種類を返した）: {s.hallucinations} 件")
    if s.order_type_rows is not None and s.order_type_visible_rows is not None:
        lines.append(f"- 決済の注文の種類が写っていた行: {s.order_type_visible_rows} / {s.order_type_rows}"
                     f"（{_pct(s.order_type_visible_rows, s.order_type_rows)}。正解の側から数える）")
    if s.time_zones:
        tz = "・".join(f"{c.name} {c.count}" for c in s.time_zones)
        lines.append(f"- 読み取りが返した時間帯（行の数。採点しない）: {tz}")
    if s.failures:
        lines.append("- 失敗の種類: " + "・".join(f"{c.name} {c.count}" for c in s.failures))
    lines.append(f"- 所要秒数（壁時計・1 枚）: 中央値 {_sec(s.seconds_median)}・最大 {_sec(s.seconds_max)}"
                 f"（API の時間: 中央値 {_sec(s.api_seconds_median)}・最大 {_sec(s.api_seconds_max)}。"
                 "失敗した回は除く）")
    cost = f"- 費用（使用量 × 公開価格）: 1 回あたり {_usd(s.cost_per_read_usd)}・合計 {_usd(s.cost_total_usd)}"
    if s.usd_jpy is not None and s.cost_per_read_usd is not None and s.cost_total_usd is not None:
        per, tot = s.cost_per_read_usd * s.usd_jpy, s.cost_total_usd * s.usd_jpy
        cost += f"（1 回あたり 約 {per:.2f} 円・合計 約 {tot:.1f} 円）"
    if s.sdk_cost_total_usd is not None:
        cost += f"。参考: SDK の total_cost_usd の合計 {_usd(s.sdk_cost_total_usd)}"
    if s.credential_kind == "oauth_token":
        cost += "。サブスクの枠で回したので、従量課金なら、の換算額です"
    lines.append(cost)
    lines.append("")
    if s.groups:
        head = "場面" if s.set_name == "synthetic" else "画像の番号"
        lines.append(f"### {head}ごとの不一致の欄の数")
        lines.append("")
        if s.set_name == "real":
            lines.append(f"| {head} | 読み取り | 不一致の欄 | {s.repeat} 回とも一致した欄 |")
            lines.append("|---|---|---|---|")
            for g in s.groups:
                lines.append(f"| {g.group} | {g.reads} | {g.mismatched_fields} | "
                             f"{g.all_runs_matched_fields} / {g.fields_total} |")
        else:
            lines.append(f"| {head} | 読み取り | 不一致の欄 |")
            lines.append("|---|---|---|")
            for g in s.groups:
                lines.append(f"| {g.group} | {g.reads} | {g.mismatched_fields} |")
        lines.append("")
    lines.append("### 限界")
    lines.append("")
    lines.extend(f"- {x}" for x in limits(s))
    return "\n".join(lines) + "\n"


def to_json(s: Summary) -> str:
    d = asdict(s)
    d["limits"] = limits(s)
    return json.dumps(d, ensure_ascii=False, indent=2) + "\n"
