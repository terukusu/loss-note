"""AC-4: 評価の出力（標準出力・要約 JSON）に、正解・読み取りの値の文字列が 1 つも含まれない。

偽の読み取り（正解どおり・わざと違う値・行の欠け・作り話・失敗）で評価の CLI を最後まで回し、値の文字列を
いくつもの書き方で作って探す。2 文字以下の数は件数・割合と区別できないので、型（Summary に値の欄が無い）で守る。
"""

import dataclasses
import io
import json
import re
import shutil
import tempfile
import unicodedata
from decimal import Decimal
from pathlib import Path

import pytest
from helpers import read_from_answer

from statement_eval import report
from statement_eval.cli import DATA_LOCAL, SYNTHETIC_DIR, main
from statement_eval.reader import ReadOutcome
from statement_eval.score import Usage

ENV = {"ANTHROPIC_API_KEY": "dummy-not-a-real-key"}


def _wrong(row: dict) -> dict:
    r = dict(row)
    for k in ("entry_price", "exit_price", "pnl_jpy"):
        if r[k] is not None:
            r[k] = r[k] + 7
    r["qty"] = (r["qty"] or 0) + 3
    r["symbol"] = "架空銘柄ZZ"
    r["entry_time"] = "2027-11-23T21:47"
    r["exit_time"] = "2027-11-24T22:58"
    r["fees"] = [913, 47]
    return r


class FakeReader:
    """画像ごとに決まった崩し方で返す（AI は呼ばない）"""

    def __init__(self, answers: list[dict]):
        self.answers = answers
        self.i = 0
        self.reads: list[dict] = []

    def read(self, data: bytes, media_type: str) -> ReadOutcome:
        im = self.answers[self.i % len(self.answers)]
        mode = self.i % 5
        self.i += 1
        rows = [read_from_answer(r) for r in im["rows"]]
        if mode == 1:
            rows = [_wrong(r) for r in rows]
        elif mode == 2:
            rows = rows[:-1] if len(rows) > 1 else []
        elif mode == 3:
            rows = [dict(r, exit_order_type="stop", time_zone="GMT") for r in rows]
        elif mode == 4:
            return ReadOutcome(result=None, seconds=None, error="no_tool_call")
        result = {"kind": "statement", "rows": rows}
        self.reads.append(result)
        return ReadOutcome(result=result, seconds=4.25 + mode, api_seconds=3.5 + mode,
                           usage=Usage(input_tokens=1873, output_tokens=402), sdk_cost_usd=0.0156)


def _variants_number(v) -> set[str]:
    if v is None or isinstance(v, bool):
        return set()
    d = Decimal(str(v))
    out = set()
    for x in (d, -d):
        plain = format(x, "f")
        if "." in plain:
            plain = plain.rstrip("0").rstrip(".")
        sep = format(Decimal(plain), ",f")
        full = sep.translate(str.maketrans("0123456789,.-", "０１２３４５６７８９，．－"))
        out |= {plain, sep, full, plain.lstrip("-"), sep.lstrip("-")}
    return out


def _variants_time(v) -> set[str]:
    if not v:
        return set()
    y, mo, d = v[0:4], v[5:7], v[8:10]
    hm = v[11:16]
    return {v, v.replace("T", " "), f"{y}/{mo}/{d}", f"{d}/{mo}/{y}", f"{y}-{mo}-{d}", hm}


def _value_strings(answers: list[dict], reads: list[dict]) -> set[str]:
    out: set[str] = set()
    rows = [r for im in answers for r in im["rows"]] + [r for rd in reads for r in rd["rows"]]
    for r in rows:
        for k in ("entry_price", "exit_price", "qty", "pnl_jpy"):
            out |= _variants_number(r.get(k))
        for f in r.get("fees") or []:
            out |= _variants_number(f)
        if r.get("fees"):
            out |= _variants_number(sum(Decimal(str(x)) for x in r["fees"]))
        for k in ("entry_time", "exit_time"):
            out |= _variants_time(r.get(k))
        if r.get("symbol"):
            out |= {r["symbol"], unicodedata.normalize("NFKC", r["symbol"]), "".join(r["symbol"].split())}
    return {s for s in out if len(s) >= 3}


def _run(tmp_path, extra_args=None):
    answers = json.loads((SYNTHETIC_DIR / "answers.json").read_text(encoding="utf-8"))["images"]
    fake = FakeReader(answers)
    out, err = io.StringIO(), io.StringIO()
    json_out = tmp_path / "summary.json"
    args = extra_args or ["--set", "synthetic"]
    code = main(
        ["eval", *args, "--credential", "api_key", "--usd-jpy", "150", "--json-out", str(json_out)],
        env=ENV,
        reader_factory=lambda *a: fake,
        out=out,
        err=err,
    )
    return code, out.getvalue(), err.getvalue(), json_out.read_text(encoding="utf-8"), answers, fake


@pytest.fixture
def real_dir():
    """実物の経路を通すための一時ディレクトリ（data/local/statement-eval/ の下。gitignore 済み）。合成の answers と
    画像を写し、終わったら消す。data/local/ に既にあるものには触れない"""
    parent = DATA_LOCAL / "statement-eval"
    parent.mkdir(parents=True, exist_ok=True)
    d = Path(tempfile.mkdtemp(prefix="test-real-", dir=parent))
    try:
        for f in SYNTHETIC_DIR.iterdir():
            if f.name == "answers.json" or f.suffix == ".png":
                shutil.copy(f, d / f.name)
        yield d
    finally:
        shutil.rmtree(d, ignore_errors=True)


# 費用・秒数・レート（引数）は型で値でないと決まっている欄。浮動小数の桁がたまたま値の文字列と
# 重なるので、探す前に伏せる
_FLOAT_KEYS = ("seconds_median", "seconds_max", "api_seconds_median", "api_seconds_max", "cost_per_read_usd",
               "cost_total_usd", "sdk_cost_total_usd", "usd_jpy")
_MD_FLOATS = re.compile(r"\$\d+\.\d+|約 [\d.]+ 円|[\d.]+ 秒")


def _mask(stdout: str, js: str) -> tuple[str, str]:
    d = json.loads(js)
    for k in _FLOAT_KEYS:
        assert d[k] is None or isinstance(d[k], float)
        d[k] = None
    return _MD_FLOATS.sub("#", stdout), json.dumps(d, ensure_ascii=False)


def _assert_no_values(code, stdout, stderr, js, answers, fake):
    assert code == 0
    values = _value_strings(answers, fake.reads)
    assert len(values) > 100  # 探す文字列が十分にある
    stdout, js = _mask(stdout, js)
    for text in (stdout, stderr, js):
        found = sorted(v for v in values if v in text)
        assert found == [], found[:5]
    # ファイル名も出さない
    for im in answers:
        assert im["file"] not in stdout and im["file"] not in js
    assert "dummy-not-a-real-key" not in stdout + stderr + js


def test_eval_output_contains_no_values(tmp_path):
    _assert_no_values(*_run(tmp_path))


def test_eval_output_contains_no_values_real(tmp_path, real_dir):
    # 実物の経路（画像の番号ごとの表・3 回とも一致した欄・注文の種類が写っていた行）も最後まで回す
    res = _run(tmp_path, ["--set", "real", "--dir", str(real_dir)])
    _assert_no_values(*res)
    code, stdout, _, js, answers, fake = res
    assert "画像の番号ごと" in stdout and "3 回とも一致した欄" in stdout and "写っていた行" in stdout
    d = json.loads(js)
    assert d["set_name"] == "real" and d["repeat"] == 3 and d["n_reads"] == len(answers) * 3
    assert [g["group"] for g in d["groups"]] == [str(i) for i in range(1, len(answers) + 1)]
    assert real_dir.name not in stdout + js


def test_eval_output_has_all_fields_and_counts(tmp_path):
    code, stdout, _, js, answers, _ = _run(tmp_path)
    d = json.loads(js)
    assert [f["name"] for f in d["fields"]] == list(report.FIELD_LABELS)
    n_rows = sum(len(im["rows"]) for im in answers)
    assert all(f["denominator"] == n_rows for f in d["fields"])
    assert d["n_reads"] == len(answers) and d["n_failed"] == len(answers) // 5 + (1 if len(answers) % 5 > 4 else 0)
    assert d["hallucinations"] > 0
    assert d["seconds_median"] is not None and d["cost_total_usd"] is not None
    for label in report.FIELD_LABELS.values():
        assert label in stdout
    assert "行数" in stdout and "claude-opus-5-5" in stdout


def test_report_includes_limits(tmp_path):
    _, stdout, _, js, _, _ = _run(tmp_path)
    assert "33 ポイント" in stdout
    assert "画質や撮り方" in stdout and "ADR-0009" in stdout
    assert "混み具合" in stdout
    assert len(json.loads(js)["limits"]) == 3


def test_real_limits_use_the_denominator():
    s = report.Summary(
        set_name="real", model="m", effort="low", credential_kind="api_key", n_images=3, repeat=3, n_reads=9,
        n_failed=0, n_answer_rows=9, fields=(), row_count_matched=9, row_count_denominator=9, hallucinations=0,
        order_type_visible_rows=0, order_type_rows=3, time_zones=(), failures=(), images_within_limits=3,
        images_shrunk=0, seconds_median=None, seconds_max=None, api_seconds_median=None, api_seconds_max=None,
        cost_per_read_usd=None, cost_total_usd=None, sdk_cost_total_usd=None, usd_jpy=None, groups=(),
        rows_per_round=3,
    )
    text = report.to_markdown(s)
    assert "33 ポイント" in text and "11 ポイント" in text


_ALLOWED_FIELDS = {
    "set_name", "model", "effort", "credential_kind", "n_images", "repeat", "n_reads", "n_failed", "n_answer_rows",
    "fields", "row_count_matched", "row_count_denominator", "hallucinations", "order_type_visible_rows",
    "order_type_rows", "time_zones", "failures", "images_within_limits", "images_shrunk", "seconds_median",
    "seconds_max", "api_seconds_median", "api_seconds_max", "cost_per_read_usd", "cost_total_usd",
    "sdk_cost_total_usd", "usd_jpy", "groups", "rows_per_round",
}


def test_summary_type_has_no_value_fields():
    # 要約の型に値（価格・数量・損益・日時・銘柄の名前・ファイル名）を入れる欄が無い。欄を足すときはここを見直す
    assert {f.name for f in dataclasses.fields(report.Summary)} == _ALLOWED_FIELDS
    assert {f.name for f in dataclasses.fields(report.FieldRate)} == {"name", "matched", "denominator"}
    assert {f.name for f in dataclasses.fields(report.GroupMismatch)} == {
        "group", "reads", "mismatched_fields", "all_runs_matched_fields", "fields_total"}
    assert {f.name for f in dataclasses.fields(report.Count)} == {"name", "count"}
    str_fields = {f.name for f in dataclasses.fields(report.Summary) if f.type is str}
    assert str_fields == {"set_name", "model", "effort", "credential_kind"}
