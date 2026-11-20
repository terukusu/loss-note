"""入口: python -m statement_eval generate [--check] / eval --set synthetic|real ...

- generate: 合成の明細（manifest.json・answers.json・sNN.png）を作る。--check は manifest と answers を作り直して
  コミット済みと比べるだけ（画像は描かない）
- eval: 明細の画像を AI で読み、正解と欄ごとに比べ、件数・割合・秒数・費用だけを出す（R5）。資格情報が無ければ
  SDK を import せずに exit 2。--preset app はアプリ（API）の読み取りの設定（statement_read.app_settings のモデル・
  effort・締め切り）で読み、画像は縮めずに API と同じ上限（statement_read.image.check_limits）で検査する（#11 の AC-14）
- generate-charts: 合成のチャート（synthetic-charts/ の manifest.json・answers.json・cNN.png。#27）を作る。
  --check は generate と同じ
- eval-charts: チャートの時間足の表示を AI で読み（共有の送り口に chart_timeframe.CHART_TASK を差し込む。API と同じ
  指示）、読み違い・作り話の件数と秒数だけを出す（#27 の AC-7）。--preset app はアプリの設定。--set real は
  data/local/ の下だけ
"""

import argparse
import json
import os
import re
import sys
import tempfile
from collections import Counter
from collections.abc import Callable
from decimal import Decimal
from pathlib import Path

from statement_read import app_settings
from statement_read import image as shared_image

from . import chart_score, chart_synthetic, images, report, schema, score, synthetic

TOOL_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = TOOL_DIR.parents[1]
SYNTHETIC_DIR = TOOL_DIR / "synthetic"
SYNTHETIC_CHARTS_DIR = TOOL_DIR / "synthetic-charts"
DATA_LOCAL = REPO_ROOT / "data" / "local"
REAL_TMP = DATA_LOCAL / "statement-eval" / "tmp"
DEFAULT_MODEL = "claude-opus-5-5"
DEFAULT_EFFORT = "low"
EFFORTS = ("low", "medium", "high", "xhigh", "max")
_MODEL_RE = re.compile(r"^[a-z0-9][a-z0-9.\-]{0,63}$")


def _dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def _within(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


# ---- generate ----


def cmd_generate(args, out) -> int:
    from . import render

    target = Path(args.out) if args.out else SYNTHETIC_DIR
    manifest_text = _dump(synthetic.manifest())
    answers_text = _dump(synthetic.answers())
    if args.check:
        ok = True
        for name, text in (("manifest.json", manifest_text), ("answers.json", answers_text)):
            p = target / name
            if not p.is_file() or p.read_text(encoding="utf-8") != text:
                print(f"{name} がコミット済みと違います（python -m statement_eval generate で作り直してください）",
                      file=out)
                ok = False
        if ok:
            print("manifest.json・answers.json はコミット済みと同じです", file=out)
        return 0 if ok else 1
    try:
        font = render.find_font(args.font)
    except render.FontNotFound as e:
        print(str(e), file=out)
        return 2
    target.mkdir(parents=True, exist_ok=True)
    (target / "manifest.json").write_text(manifest_text, encoding="utf-8")
    (target / "answers.json").write_text(answers_text, encoding="utf-8")
    for s in synthetic.STATEMENTS:
        (target / s.file).write_bytes(render.render_png(synthetic.layout(s), font))
    print(f"合成の明細 {len(synthetic.STATEMENTS)} 枚と正解を書きました", file=out)
    return 0


# ---- generate-charts（#27） ----


def cmd_generate_charts(args, out) -> int:
    from . import chart_render, render

    target = Path(args.out) if args.out else SYNTHETIC_CHARTS_DIR
    manifest_text = _dump(chart_synthetic.manifest())
    answers_text = _dump(chart_synthetic.answers())
    if args.check:
        ok = True
        for name, text in (("manifest.json", manifest_text), ("answers.json", answers_text)):
            p = target / name
            if not p.is_file() or p.read_text(encoding="utf-8") != text:
                print(f"{name} がコミット済みと違います"
                      "（python -m statement_eval generate-charts で作り直してください）", file=out)
                ok = False
        if ok:
            print("manifest.json・answers.json はコミット済みと同じです", file=out)
        return 0 if ok else 1
    try:
        font = render.find_font(args.font)
    except render.FontNotFound as e:
        print(str(e), file=out)
        return 2
    target.mkdir(parents=True, exist_ok=True)
    (target / "manifest.json").write_text(manifest_text, encoding="utf-8")
    (target / "answers.json").write_text(answers_text, encoding="utf-8")
    for c in chart_synthetic.CASES:
        (target / c.file).write_bytes(chart_render.render_chart_png(c, font))
    print(f"合成のチャート {len(chart_synthetic.CASES)} 枚と正解を書きました", file=out)
    return 0


# ---- eval-charts（#27） ----


def _default_chart_reader_factory(credential, secret, model, effort, tmp_parent, timeout=None,
                                  max_output_tokens=None):
    from statement_read.chart_timeframe import CHART_TASK

    from .reader import Reader

    return Reader(credential, secret, model, effort, tmp_parent=tmp_parent, timeout=timeout, task=CHART_TASK,
                  max_output_tokens=max_output_tokens)


def run_eval_charts(args, env: dict[str, str], reader_factory: Callable, out, err) -> int:
    from .reader import NoCredential, credential_secret

    timeout = max_output = None
    if args.preset == "app":
        if args.model is not None or args.effort is not None:
            print("--preset app は --model・--effort と一緒に指定できません", file=out)
            return 2
        args.model, args.effort = app_settings.APP_MODEL, app_settings.APP_EFFORT
        # アプリと同じ締め切り・最大出力（チャートの最大出力。#27・ADR-0015）
        timeout, max_output = app_settings.APP_TIMEOUT_SECONDS, app_settings.APP_CHART_MAX_OUTPUT_TOKENS
    else:
        args.model = DEFAULT_MODEL if args.model is None else args.model
        args.effort = DEFAULT_EFFORT if args.effort is None else args.effort
    try:
        secret = credential_secret(args.credential, env)
    except NoCredential:
        print("資格情報がありません（--credential oauth_token なら CLAUDE_CODE_OAUTH_TOKEN、api_key なら "
              "ANTHROPIC_API_KEY）。AI は呼んでいません", file=out)
        return 2
    if not _MODEL_RE.match(args.model or ""):
        print("--model の形が不正です", file=out)
        return 2
    if args.set == "real":
        if not args.dir or not _within(Path(args.dir), DATA_LOCAL):
            print("--set real には data/local/ の下の --dir が要ります", file=out)
            return 2
        base, tmp_parent, repeat = Path(args.dir), str(REAL_TMP), args.repeat or 3
    else:
        base, tmp_parent, repeat = SYNTHETIC_CHARTS_DIR, None, args.repeat or 1
    if args.json_out and not (_within(Path(args.json_out).parent, DATA_LOCAL)
                              or _within(Path(args.json_out).parent, Path(tempfile.gettempdir()))):
        print("--json-out は data/local/ の下か一時ディレクトリだけを受け付けます", file=out)
        return 2
    try:
        answers = chart_score.check_answers(json.loads((base / "answers.json").read_text(encoding="utf-8")))
    except FileNotFoundError:
        print("answers.json がありません", file=out)
        return 2
    except ValueError:  # JSONDecodeError を含む
        print("answers.json が不正です", file=out)
        return 2
    prepared = []
    for i, im in enumerate(answers, start=1):
        try:
            raw = (base / im["file"]).read_bytes()
        except OSError:
            print(f"画像 {i} を読めません", file=out)
            return 2
        media_type = shared_image.media_type_of(raw)
        # API と同じ上限（縮めない）。外なら API も断るので読まずに止める
        if shared_image.check_limits(raw, media_type) is not None:
            print(f"画像 {i} がアプリの上限の外です（PNG / JPEG・500,000 B 以下・長辺 2,000 px 以下）", file=out)
            return 2
        prepared.append((raw, media_type))

    reader = reader_factory(args.credential, secret, args.model, args.effort, tmp_parent, timeout, max_output)
    counts: Counter = Counter()
    failures: Counter = Counter()
    seconds: list[float] = []
    total = len(prepared) * repeat
    n = 0
    for im, (data, media_type) in zip(answers, prepared, strict=True):
        for _ in range(repeat):
            n += 1
            print(f"読み取り {n} / {total}", file=err)
            o = reader.read(data, media_type)
            counts[chart_score.classify(im, o.result)] += 1
            if o.result is None:
                failures[o.error or "unknown"] += 1
            elif o.seconds is not None:
                seconds.append(o.seconds)
    smed, smax = _median_max(seconds)
    summary = chart_score.ChartSummary(
        model=args.model, effort=args.effort, n_images=len(prepared), repeat=repeat, n_reads=total,
        counts={k: counts.get(k, 0) for k in chart_score.CATEGORIES}, seconds_median=smed, seconds_max=smax,
        failures=dict(failures),
    )
    out.write(chart_score.to_markdown(summary))
    if args.json_out:
        Path(args.json_out).write_text(chart_score.to_json(summary), encoding="utf-8")
    return 0


# ---- eval ----


def _default_reader_factory(credential, secret, model, effort, tmp_parent, timeout=None):
    from .reader import Reader

    return Reader(credential, secret, model, effort, tmp_parent=tmp_parent, timeout=timeout)


def _median_max(xs):
    mm = score.median_max(xs)
    return (None, None) if mm is None else mm


def run_eval(args, env: dict[str, str], reader_factory: Callable, out, err) -> int:
    from .reader import NoCredential, credential_secret

    # --preset app: アプリの読み取りの設定（モデル・effort・締め切り）。--model・--effort とは一緒に使えない
    timeout = None
    if args.preset == "app":
        if args.model is not None or args.effort is not None:
            print("--preset app は --model・--effort と一緒に指定できません", file=out)
            return 2
        args.model, args.effort = app_settings.APP_MODEL, app_settings.APP_EFFORT
        timeout = app_settings.APP_TIMEOUT_SECONDS
    else:
        args.model = DEFAULT_MODEL if args.model is None else args.model
        args.effort = DEFAULT_EFFORT if args.effort is None else args.effort

    # 資格情報（値は表示しない。SDK を import する前に確かめる）
    try:
        secret = credential_secret(args.credential, env)
    except NoCredential:
        print("資格情報がありません（--credential oauth_token なら CLAUDE_CODE_OAUTH_TOKEN、api_key なら "
              "ANTHROPIC_API_KEY）。AI は呼んでいません", file=out)
        return 2
    if not _MODEL_RE.match(args.model or ""):
        print("--model の形が不正です", file=out)
        return 2
    if args.usd_jpy is not None and not (0 < args.usd_jpy < 10_000):
        print("--usd-jpy は正の数で渡してください", file=out)
        return 2

    if args.set == "real":
        if not args.dir:
            print("--set real には --dir（data/local/ の下）が要ります", file=out)
            return 2
        base = Path(args.dir)
        if not _within(base, DATA_LOCAL):
            print("--dir は data/local/ の下だけを受け付けます", file=out)
            return 2
        tmp_parent = str(REAL_TMP)
        repeat = args.repeat or 3
    else:
        base = SYNTHETIC_DIR
        tmp_parent = None
        repeat = args.repeat or 1
    if args.json_out and not (_within(Path(args.json_out).parent, DATA_LOCAL)
                              or _within(Path(args.json_out).parent, Path(tempfile.gettempdir()))):
        print("--json-out は data/local/ の下か一時ディレクトリだけを受け付けます", file=out)
        return 2

    try:
        answers = schema.check_answers(json.loads((base / "answers.json").read_text(encoding="utf-8")))
    except FileNotFoundError:
        print("answers.json がありません", file=out)
        return 2
    except json.JSONDecodeError:
        print("answers.json が JSON として読めません", file=out)
        return 2
    except schema.Bad as e:
        print(f"answers.json が不正です: {e.path}: {e.reason}", file=out)
        return 2
    scenes_by_file: dict[str, list[str]] = {}
    if args.set == "synthetic":
        try:
            man = json.loads((base / "manifest.json").read_text(encoding="utf-8"))
            scenes_by_file = {str(im["file"]): [str(x) for x in im["scenes"]] for im in man["images"]}
        except (OSError, ValueError, KeyError, TypeError):  # JSONDecodeError は ValueError
            print("manifest.json が不正です", file=out)
            return 2

    # 画像を先にそろえる（読めない画像があれば AI を呼ぶ前に止まる）
    prepared = []
    shrunk = 0
    for i, im in enumerate(answers["images"], start=1):
        p = base / im["file"]
        try:
            raw = p.read_bytes()
            if args.preset == "app":
                # API と同じ: 縮めない。上限の外なら API も断るので、ここでも読まずに止める
                media_type = shared_image.media_type_of(raw)
                if shared_image.check_limits(raw, media_type) is not None:
                    print(f"画像 {i} がアプリの上限の外です（PNG / JPEG・500,000 B 以下・長辺 2,000 px 以下）",
                          file=out)
                    return 2
                data, was_shrunk = raw, False
            else:
                data, media_type, was_shrunk = images.prepare(raw)
        except (OSError, ValueError):
            print(f"画像 {i} を読めません", file=out)
            return 2
        shrunk += int(was_shrunk)
        prepared.append((data, media_type))

    reader = reader_factory(args.credential, secret, args.model, args.effort, tmp_parent, timeout)
    scores: list[score.ImageScore] = []
    seconds: list[float] = []
    api_seconds: list[float] = []
    usages: list[score.Usage] = []
    sdk_costs: list[float] = []
    tz = Counter()
    failures = Counter()
    per_image: list[list[score.ImageScore]] = []
    # 回ごとの会社の名前の読み（#66。鍵の安定を数えるだけ。記憶の中だけで、要約には件数しか出さない）
    issuer_reads: list[list[dict | None]] = [[] for _ in range(repeat)]
    # 画像ごと・回ごとの鍵の材料（会社の名前の比べる形・向きの集合・通貨の集合。記憶の中だけ）
    materials: list[list[tuple | None]] = []
    total = len(prepared) * repeat
    n = 0
    for im, (data, media_type) in zip(answers["images"], prepared, strict=True):
        runs = []
        materials.append([])
        for rnd in range(repeat):
            n += 1
            print(f"読み取り {n} / {total}", file=err)
            o = reader.read(data, media_type)
            s = score.score_image(im, o.result)
            issuer_reads[rnd].append(None if o.result is None else {"issuer": o.result.get("issuer")})
            materials[-1].append(score.profile_material(o.result))
            runs.append(s)
            scores.append(s)
            if o.result is None:
                failures[o.error or "unknown"] += 1
            elif o.seconds is not None:
                seconds.append(o.seconds)
                if o.api_seconds is not None:
                    api_seconds.append(o.api_seconds)
            if o.usage is not None:
                usages.append(o.usage)
            if o.sdk_cost_usd is not None:
                sdk_costs.append(o.sdk_cost_usd)
            for r in (o.result or {}).get("rows", []):
                tz[r.get("time_zone") or "null"] += 1
        per_image.append(runs)

    tally = score.aggregate(scores, seconds, usages, args.model)
    issuer_scored = [s for s in scores if s.issuer_matched is not None]
    pairs_ok = pairs_total = 0
    for reads_ in issuer_reads:
        ok_, tot_ = score.issuer_keys_stable(answers["images"], reads_)
        pairs_ok += ok_
        pairs_total += tot_
    groups: list[report.GroupMismatch] = []
    if args.set == "synthetic":
        by_scene: dict[str, list[int]] = {sc: [0, 0] for sc in synthetic.SCENES}
        for im, runs in zip(answers["images"], per_image, strict=True):
            for sc in scenes_by_file.get(im["file"], []):
                if sc in by_scene:
                    by_scene[sc][0] += len(runs)
                    by_scene[sc][1] += sum(len(score.FIELDS) - r.n_matched for s in runs for r in s.rows)
        groups = [report.GroupMismatch(group=sc, reads=v[0], mismatched_fields=v[1]) for sc, v in by_scene.items()]
    else:
        for i, runs in enumerate(per_image, start=1):
            mism = sum(len(score.FIELDS) - r.n_matched for s in runs for r in s.rows)
            n_rows = runs[0].n_answer_rows if runs else 0
            all_ok = sum(
                1
                for ri in range(n_rows)
                for fi in range(len(score.FIELDS))
                if all(s.rows[ri].matches[fi] for s in runs)
            )
            groups.append(report.GroupMismatch(group=str(i), reads=len(runs), mismatched_fields=mism,
                                               all_runs_matched_fields=all_ok,
                                               fields_total=n_rows * len(score.FIELDS)))

    rows_per_round = sum(len(im["rows"]) for im in answers["images"])
    ot_rows = ot_visible = None
    if args.set == "real":
        ot_rows = rows_per_round
        ot_visible = sum(1 for im in answers["images"] for r in im["rows"] if r["exit_order_type"] != "unknown")
    smed, smax = _median_max(seconds)
    amed, amax = _median_max(api_seconds)
    cost_total = float(tally.cost_total_usd) if tally.cost_total_usd is not None else None
    summary = report.Summary(
        set_name=args.set,
        model=args.model,
        effort=args.effort,
        credential_kind=args.credential,
        n_images=len(prepared),
        repeat=repeat,
        n_reads=tally.n_reads,
        n_failed=tally.n_failed,
        n_answer_rows=tally.n_answer_rows,
        fields=tuple(report.FieldRate(name=f, matched=tally.field_matches[f], denominator=tally.n_answer_rows)
                     for f in score.FIELDS)
        + tuple(report.FieldRate(name=f, matched=tally.field_matches.get(f, 0), denominator=tally.n_option_rows)
                for f in score.OPTION_FIELDS if tally.n_option_rows),
        row_count_matched=tally.row_count_matches,
        row_count_denominator=tally.n_reads,
        hallucinations=tally.hallucinations,
        order_type_visible_rows=ot_visible,
        order_type_rows=ot_rows,
        time_zones=tuple(report.Count(name=k, count=v) for k, v in sorted(tz.items())),
        failures=tuple(report.Count(name=k, count=v) for k, v in sorted(failures.items())),
        images_within_limits=len(prepared) - shrunk,
        images_shrunk=shrunk,
        seconds_median=smed,
        seconds_max=smax,
        api_seconds_median=amed,
        api_seconds_max=amax,
        cost_per_read_usd=(cost_total / tally.n_reads) if cost_total is not None and tally.n_reads else None,
        cost_total_usd=cost_total,
        sdk_cost_total_usd=float(sum(Decimal(str(c)) for c in sdk_costs)) if sdk_costs else None,
        usd_jpy=args.usd_jpy,
        groups=tuple(groups),
        issuer_matched=sum(bool(s.issuer_matched) for s in issuer_scored),
        issuer_denominator=len(issuer_scored),
        issuer_pairs_stable=pairs_ok,
        issuer_pairs=pairs_total,
        profile_stable_images=sum(score.profile_runs_stable(m) for m in materials),
        profile_images=len(materials),
        rows_per_round=rows_per_round,
    )
    out.write(report.to_markdown(summary))
    if args.json_out:
        Path(args.json_out).write_text(report.to_json(summary), encoding="utf-8")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="statement_eval", description="決済明細の読み取りの評価")
    sub = p.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate", help="合成の明細と正解を作る")
    g.add_argument("--check", action="store_true", help="manifest と answers をコミット済みと比べるだけ")
    g.add_argument("--font", help="日本語のフォントのパス（無ければ代表的な置き場所を探す）")
    g.add_argument("--out", help="書き出す先（既定は tools/statement-eval/synthetic）")
    e = sub.add_parser("eval", help="明細を AI で読んで採点する（件数・割合・秒数・費用だけを出す）")
    e.add_argument("--set", choices=("synthetic", "real"), required=True)
    e.add_argument("--dir", help="実物の画像と answers.json の置き場所（data/local/ の下だけ）")
    e.add_argument("--credential", choices=("oauth_token", "api_key"))
    e.add_argument("--preset", choices=("app",),
                   help="アプリ（API）の読み取りの設定で読む（モデル・effort・締め切り。画像は縮めずに検査）")
    e.add_argument("--model", help=f"モデル（既定は {DEFAULT_MODEL}）")
    e.add_argument("--effort", choices=EFFORTS, help=f"effort（既定は {DEFAULT_EFFORT}）")
    e.add_argument("--repeat", type=int, choices=range(1, 11), metavar="1-10")
    e.add_argument("--usd-jpy", type=float, help="円の換算に使うレート（渡したときだけ円も出す）")
    e.add_argument("--json-out", help="要約の JSON の書き出し先（data/local/ の下か一時ディレクトリだけ）")
    gc = sub.add_parser("generate-charts", help="合成のチャートと正解を作る（#27）")
    gc.add_argument("--check", action="store_true", help="manifest と answers をコミット済みと比べるだけ")
    gc.add_argument("--font", help="日本語のフォントのパス（無ければ代表的な置き場所を探す）")
    gc.add_argument("--out", help="書き出す先（既定は tools/statement-eval/synthetic-charts）")
    ec = sub.add_parser("eval-charts",
                        help="チャートの時間足を AI で読んで採点する（読み違い・作り話の件数と秒数だけ）")
    ec.add_argument("--set", choices=("synthetic", "real"), default="synthetic")
    ec.add_argument("--dir", help="実物のチャートと answers.json の置き場所（data/local/ の下だけ）")
    ec.add_argument("--credential", choices=("oauth_token", "api_key"))
    ec.add_argument("--preset", choices=("app",),
                    help="アプリ（API）の読み取りの設定で読む（モデル・effort・締め切り）")
    ec.add_argument("--model", help=f"モデル（既定は {DEFAULT_MODEL}）")
    ec.add_argument("--effort", choices=EFFORTS, help=f"effort（既定は {DEFAULT_EFFORT}）")
    ec.add_argument("--repeat", type=int, choices=range(1, 11), metavar="1-10")
    ec.add_argument("--json-out", help="要約の JSON の書き出し先（data/local/ の下か一時ディレクトリだけ）")
    return p


def main(argv: list[str] | None = None, *, env: dict[str, str] | None = None,
         reader_factory: Callable | None = None, out=None, err=None) -> int:
    out = out or sys.stdout
    err = err or sys.stderr
    try:
        args = build_parser().parse_args(argv)
    except SystemExit as e:
        return int(e.code or 0) if isinstance(e.code, int) else 2
    if args.cmd == "generate":
        return cmd_generate(args, out)
    if args.cmd == "generate-charts":
        return cmd_generate_charts(args, out)
    if env is None:
        # 資格情報を写したら、この process の環境から資格情報・送り先の系統の名前を外す（入口の 1 回だけ。送り口は
        # 名前が残っていると送らない。#55・ADR-0011）
        env = dict(os.environ)
        from .reader import scrub_process_env

        scrub_process_env()
    if args.cmd == "eval-charts":
        return run_eval_charts(args, env, reader_factory or _default_chart_reader_factory, out, err)
    return run_eval(args, env, reader_factory or _default_reader_factory, out, err)
