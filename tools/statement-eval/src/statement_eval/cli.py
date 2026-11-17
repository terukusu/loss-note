"""入口: python -m statement_eval generate [--check] / eval --set synthetic|real ...

- generate: 合成の明細（manifest.json・answers.json・sNN.png）を作る。--check は manifest と answers を作り直して
  コミット済みと比べるだけ（画像は描かない）
- eval: 明細の画像を AI で読み、正解と欄ごとに比べ、件数・割合・秒数・費用だけを出す（R5）。資格情報が無ければ
  SDK を import せずに exit 2
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

from . import images, report, schema, score, synthetic

TOOL_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = TOOL_DIR.parents[1]
SYNTHETIC_DIR = TOOL_DIR / "synthetic"
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


# ---- eval ----


def _default_reader_factory(credential, secret, model, effort, tmp_parent):
    from .reader import Reader

    return Reader(credential, secret, model, effort, tmp_parent=tmp_parent)


def _median_max(xs):
    mm = score.median_max(xs)
    return (None, None) if mm is None else mm


def run_eval(args, env: dict[str, str], reader_factory: Callable, out, err) -> int:
    from .reader import NoCredential, credential_secret

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
            data, media_type, was_shrunk = images.prepare(p.read_bytes())
        except (OSError, ValueError):
            print(f"画像 {i} を読めません", file=out)
            return 2
        shrunk += int(was_shrunk)
        prepared.append((data, media_type))

    reader = reader_factory(args.credential, secret, args.model, args.effort, tmp_parent)
    scores: list[score.ImageScore] = []
    seconds: list[float] = []
    api_seconds: list[float] = []
    usages: list[score.Usage] = []
    sdk_costs: list[float] = []
    tz = Counter()
    failures = Counter()
    per_image: list[list[score.ImageScore]] = []
    total = len(prepared) * repeat
    n = 0
    for im, (data, media_type) in zip(answers["images"], prepared, strict=True):
        runs = []
        for _ in range(repeat):
            n += 1
            print(f"読み取り {n} / {total}", file=err)
            o = reader.read(data, media_type)
            s = score.score_image(im, o.result)
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
                     for f in score.FIELDS),
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
    e.add_argument("--model", default=DEFAULT_MODEL)
    e.add_argument("--effort", choices=EFFORTS, default=DEFAULT_EFFORT)
    e.add_argument("--repeat", type=int, choices=range(1, 11), metavar="1-10")
    e.add_argument("--usd-jpy", type=float, help="円の換算に使うレート（渡したときだけ円も出す）")
    e.add_argument("--json-out", help="要約の JSON の書き出し先（data/local/ の下か一時ディレクトリだけ）")
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
    return run_eval(args, dict(os.environ) if env is None else env, reader_factory or _default_reader_factory, out,
                    err)
