"""チャートの時間足の読み取りの採点（Issue #27 の AC-7）。純関数（I/O なし）。

1 回の読み取りを次のどれか 1 つに数える:

- ``match``: 時間足が正解と同じ（どちらも null を含む）で、チャートか / でないかも正解と同じ
- ``empty``: 正解は列挙の値なのに null（空。許す。判定は壊れない）
- ``wrong``: 時間足の表示が写っているのに、列挙の別の値を返した（**読み違い**。偽の B になりうる）
- ``invented``: 時間足の表示が写っていないのに、列挙の値を返した（**作り話**）
- ``kind_mismatch``: 時間足は合っているが、チャートか / でないかが違う
- ``failed``: 読み取りの失敗（締め切り・形の外など）

AC-7 の合否は ``wrong == 0`` かつ ``invented == 0``。出力は件数・割合・秒数だけ（画像の中身を出さない）。
"""

import json
from dataclasses import asdict, dataclass

from statement_read.chart_timeframe import normalize_chart

CATEGORIES = ("match", "empty", "wrong", "invented", "kind_mismatch", "failed")


def classify(answer: dict, result: dict | None) -> str:
    """正解（kind・timeframe・label_shown）と、送り口の検査済みの結果（kind・timeframe_written。失敗は None）→ 分類"""
    if result is None:
        return "failed"
    got = normalize_chart(result)
    want_tf = answer["timeframe"]
    got_tf = got["timeframe"]
    # 値を作った（読み違い・作り話）を先に見る。次にチャートか / でないかの違い（正解が列挙の値のチャートを
    # 「チャートでない」と読んだときも、空でなくこちらに数える）
    if got_tf is not None and got_tf != want_tf:
        return "wrong" if answer["label_shown"] else "invented"
    if got["kind"] != answer["kind"]:
        return "kind_mismatch"
    if got_tf != want_tf:
        return "empty"
    return "match"


@dataclass(frozen=True)
class ChartSummary:
    model: str
    effort: str
    n_images: int
    repeat: int
    n_reads: int
    counts: dict
    seconds_median: float | None
    seconds_max: float | None
    failures: dict

    @property
    def passed(self) -> bool:
        return self.counts.get("wrong", 0) == 0 and self.counts.get("invented", 0) == 0


def to_markdown(s: ChartSummary) -> str:
    def sec(v):
        return "—" if v is None else f"{v:.1f} 秒"

    lines = [
        "## チャートの時間足の読み取り（合成のチャート）",
        "",
        f"- モデル: {s.model}（effort {s.effort}）・画像 {s.n_images} 枚 × {s.repeat} 回 = {s.n_reads} 回",
        f"- 合否（読み違い 0・作り話 0）: {'pass' if s.passed else 'fail'}",
        "",
        "| 分類 | 件数 |",
        "|---|---|",
    ]
    names = {"match": "一致", "empty": "空（許す）", "wrong": "読み違い", "invented": "作り話",
             "kind_mismatch": "チャートか / でないかの違い", "failed": "失敗"}
    for k in CATEGORIES:
        lines.append(f"| {names[k]} | {s.counts.get(k, 0)} |")
    lines += ["", f"- 1 枚の秒数: 中央値 {sec(s.seconds_median)}・最大 {sec(s.seconds_max)}"]
    if s.failures:
        lines.append("- 失敗の種類: " + "・".join(f"{k} {v}" for k, v in sorted(s.failures.items())))
    return "\n".join(lines) + "\n"


def to_json(s: ChartSummary) -> str:
    return json.dumps({**asdict(s), "passed": s.passed}, ensure_ascii=False, indent=2) + "\n"


def check_answers(obj) -> list[dict]:
    """answers.json の検査（images の各行に file・kind・timeframe・label_shown）。外れたら ValueError"""
    from statement_read.chart_timeframe import KINDS, TIMEFRAMES

    if not isinstance(obj, dict) or not isinstance(obj.get("images"), list) or not obj["images"]:
        raise ValueError("images")
    out = []
    for i, im in enumerate(obj["images"]):
        if not isinstance(im, dict) or set(im) != {"file", "kind", "timeframe", "label_shown"}:
            raise ValueError(f"images[{i}]")
        f = im["file"]
        if not isinstance(f, str) or "/" in f or "\\" in f or f.startswith(".") or not f:
            raise ValueError(f"images[{i}].file")
        if im["kind"] not in KINDS or (im["timeframe"] is not None and im["timeframe"] not in TIMEFRAMES):
            raise ValueError(f"images[{i}]")
        if not isinstance(im["label_shown"], bool):
            raise ValueError(f"images[{i}].label_shown")
        out.append(im)
    return out
