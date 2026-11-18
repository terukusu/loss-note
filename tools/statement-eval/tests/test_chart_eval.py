"""チャートの時間足の読み取りの精度の道具（Issue #27 の AC-7）: 採点・合成のチャート・CLI。実際の AI は呼ばない"""

import io
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image
from statement_read import image as shared_image
from statement_read.agent_reader import ReadOutcome
from statement_read.chart_timeframe import CHART_TASK, TIMEFRAMES

from statement_eval import chart_score, chart_synthetic
from statement_eval.cli import SYNTHETIC_CHARTS_DIR, _default_chart_reader_factory, main

REPO = Path(__file__).resolve().parents[3]


def ans(timeframe, label_shown=True, kind="chart"):
    return {"file": "x.png", "kind": kind, "timeframe": timeframe, "label_shown": label_shown}


def got(written, kind="chart"):
    return {"kind": kind, "timeframe_written": written}


# ---- 採点 ----


@pytest.mark.parametrize(
    "answer,result,want",
    [
        (ans("4h"), got("4H"), "match"),
        (ans("4h"), got("240"), "match"),
        (ans("4h"), got(None), "empty"),
        (ans("4h"), got("1M"), "empty"),  # 2 通りに読める表記は空に直る（読み違いにしない）
        (ans("4h"), got("1D"), "wrong"),
        (ans(None, label_shown=True), got("2h"), "match"),  # 列挙に無い足を書かれたとおり読めば空
        (ans(None, label_shown=True), got("4h"), "wrong"),
        (ans(None, label_shown=False), got("4h"), "invented"),
        (ans(None, label_shown=False), got(None), "match"),
        (ans(None, label_shown=False, kind="not_chart"), got(None, kind="not_chart"), "match"),
        (ans(None, label_shown=False, kind="not_chart"), got(None), "kind_mismatch"),
        (ans("4h"), got(None, kind="not_chart"), "kind_mismatch"),  # N8: 空でなく種類の違いに数える
        (ans(None, label_shown=False, kind="not_chart"), got("D"), "invented"),
        (ans("1d"), None, "failed"),
    ],
)
def test_classify(answer, result, want):
    assert chart_score.classify(answer, result) == want


def test_passed_only_when_no_wrong_and_no_invented():
    base = dict(model="m", effort="low", n_images=1, repeat=1, n_reads=1, seconds_median=None, seconds_max=None,
                failures={})
    assert chart_score.ChartSummary(counts={"match": 1, "empty": 3}, **base).passed
    assert not chart_score.ChartSummary(counts={"wrong": 1}, **base).passed
    assert not chart_score.ChartSummary(counts={"invented": 1}, **base).passed


# ---- 合成のチャート ----


def test_committed_answers_and_manifest_match_generator():
    assert main(["generate-charts", "--check"], out=io.StringIO()) == 0
    committed = json.loads((SYNTHETIC_CHARTS_DIR / "answers.json").read_text(encoding="utf-8"))
    assert committed == chart_synthetic.answers()
    assert chart_score.check_answers(committed)


def test_cases_cover_the_scenes():
    styles = {c.style for c in chart_synthetic.CASES}
    assert styles == set(chart_synthetic.STYLES)
    # 表示なし・列挙に無い足・時間足の違う 2 つ・チャートでない、の正解は空
    for c in chart_synthetic.CASES:
        if c.style in ("none", "two_panes", "not_chart") or c.label == "2h":
            assert c.timeframe is None
        else:
            assert c.timeframe in TIMEFRAMES
    assert any(c.dark for c in chart_synthetic.CASES) and any(not c.dark for c in chart_synthetic.CASES)
    # 正解の時間足は表示の表記を表記の直しに通した値と同じ（作り話でない正解）
    from statement_read.chart_timeframe import timeframe_of

    for c in chart_synthetic.CASES:
        if c.style in ("legend", "mt", "ja", "numeric", "toolbar"):
            assert timeframe_of(c.label) == c.timeframe, c.file


def test_images_are_within_app_limits():
    for c in chart_synthetic.CASES:
        raw = (SYNTHETIC_CHARTS_DIR / c.file).read_bytes()
        assert shared_image.check_limits(raw, shared_image.media_type_of(raw)) is None, c.file
        with Image.open(io.BytesIO(raw)) as im:
            assert im.format == "PNG"


def test_candles_are_deterministic():
    assert chart_synthetic.candles(3) == chart_synthetic.candles(3)
    assert chart_synthetic.candles(3) != chart_synthetic.candles(4)


def test_synthetic_charts_are_not_ignored():
    git = shutil.which("git")
    assert git is not None
    r = subprocess.run([git, "check-ignore", "-q", "tools/statement-eval/synthetic-charts/c01.png"], cwd=REPO,
                       check=False)
    assert r.returncode == 1


# ---- CLI（偽の送り口） ----


class FakeReader:
    def __init__(self, results):
        self.results = list(results)
        self.calls = 0

    def read(self, data, media_type):
        self.calls += 1
        r = self.results.pop(0)
        if r is None:
            return ReadOutcome(result=None, seconds=None, error="timeout")
        return ReadOutcome(result=r, seconds=1.5)


def run(argv, results, env=None):
    reader = FakeReader(results)
    out, err = io.StringIO(), io.StringIO()
    code = main(argv, env={"ANTHROPIC_API_KEY": "SECRET-KEY-X"} if env is None else env,
                reader_factory=lambda *a, **k: reader, out=out, err=err)
    return code, out.getvalue(), reader


def correct_results():
    out = []
    for c in chart_synthetic.CASES:
        if c.style == "not_chart":
            out.append(got(None, kind="not_chart"))
        elif c.style in ("none", "two_panes"):
            out.append(got(None))
        else:
            out.append(got(c.label))
    return out


def test_eval_charts_all_correct_passes():
    code, text, reader = run(["eval-charts", "--credential", "api_key", "--preset", "app"], correct_results())
    assert code == 0 and reader.calls == len(chart_synthetic.CASES)
    assert "合否（読み違い 0・作り話 0）: pass" in text
    assert f"| 一致 | {len(chart_synthetic.CASES)} |" in text
    assert "SECRET-KEY-X" not in text


def test_eval_charts_counts_wrong_and_invented():
    results = correct_results()
    results[0] = got("1D")  # c01: 4h → 日足（読み違い）
    results[8] = got("4h")  # c09: 表示なし → 4h（作り話）
    results[1] = None  # c02: 失敗
    code, text, _ = run(["eval-charts", "--credential", "api_key", "--preset", "app"], results)
    assert code == 0
    assert "| 読み違い | 1 |" in text and "| 作り話 | 1 |" in text and "| 失敗 | 1 |" in text
    assert "fail" in text and "timeout 1" in text


def test_eval_charts_without_credential_does_not_read():
    code, text, reader = run(["eval-charts", "--credential", "api_key"], [], env={})
    assert code == 2 and reader.calls == 0 and "AI は呼んでいません" in text


def test_eval_charts_real_set_only_under_data_local(tmp_path):
    code, text, reader = run(["eval-charts", "--credential", "api_key", "--set", "real", "--dir", str(tmp_path)], [])
    assert code == 2 and reader.calls == 0


def test_eval_charts_preset_app_excludes_model():
    code, _text, reader = run(["eval-charts", "--credential", "api_key", "--preset", "app", "--model", "x"], [])
    assert code == 2 and reader.calls == 0


def test_default_factory_uses_chart_task():
    r = _default_chart_reader_factory("api_key", "S", "claude-sonnet-5-5", "low", None, 20, 2_000)
    assert r.task is CHART_TASK and r.timeout == 20 and r.max_output_tokens == 2_000


def test_preset_app_uses_chart_max_output():
    seen = {}

    def factory(*a):
        seen["args"] = a
        return FakeReader(correct_results())

    main(["eval-charts", "--credential", "api_key", "--preset", "app"], env={"ANTHROPIC_API_KEY": "S"},
         reader_factory=factory, out=io.StringIO(), err=io.StringIO())
    from statement_read import app_settings

    assert seen["args"][-2:] == (app_settings.APP_TIMEOUT_SECONDS, app_settings.APP_CHART_MAX_OUTPUT_TOKENS)
