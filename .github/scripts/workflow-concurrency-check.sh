#!/usr/bin/env bash
# deploy.yml・rollback.yml の concurrency の検査（Issue #42 のレビューの指摘 1）。
# GitHub の concurrency は「同じグループの pending は 1 つだけで、新しく入った run が前の pending を取り消す」ので、
# job の if で弾かれる run を terraform-prod に入れると、正当な pending の deploy・rollback が取り消される。
# そこで concurrency.group を `${{ (<job の if>) && 'terraform-prod' || format('<名前>-skip-{0}', github.run_id) }}` の形にし、
# 条件を job の if と同じ文字列（空白の違いは無視）に保つ。この検査はその一致と cancel-in-progress: false と、
# pull_request_target を使っていないことを確かめる（YAML の行を読むだけ。外部の依存なし）。
#
#   workflow-concurrency-check.sh [<ワークフローのディレクトリ>]   既定は .github/workflows（自己テストは一時ディレクトリを渡す）
set -euo pipefail

cd "$(dirname "$0")/../.."
dir="${1:-.github/workflows}"

python3 -I - "$dir" <<'PY'
import re
import sys
from pathlib import Path

d = Path(sys.argv[1])
# ワークフロー → 条件を持つ job の名前・skip のグループ名の頭
TARGETS = {"deploy.yml": ("plan", "deploy"), "rollback.yml": ("rollback", "rollback")}


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def block_value(lines: list[str], i: int, indent: int) -> str:
    """lines[i] が `<key>: <値>` か `<key>: >-` のとき、値（続く深い行を含む）を返す"""
    head = lines[i].split(":", 1)[1].strip()
    if head not in (">-", ">", "|", "|-"):
        return head
    out = []
    for line in lines[i + 1:]:
        if line.strip() and (len(line) - len(line.lstrip(" "))) <= indent:
            break
        out.append(line.strip())
    return " ".join(out)


errors = []
for name, (job, prefix) in TARGETS.items():
    p = d / name
    if not p.is_file():
        errors.append(f"{name} が無い")
        continue
    lines = p.read_text(encoding="utf-8").splitlines()
    group = cancel = cond = None
    in_conc = in_jobs = in_job = False
    for i, line in enumerate(lines):
        if re.match(r"^\S", line):
            in_conc = line.startswith("concurrency:")
            in_jobs = line.startswith("jobs:")
            in_job = False
            continue
        if in_conc:
            m = re.match(r"^  (group|cancel-in-progress):", line)
            if m and m.group(1) == "group":
                group = block_value(lines, i, 2)
            elif m:
                cancel = block_value(lines, i, 2)
        if in_jobs:
            if re.match(r"^  \S", line):
                in_job = line.strip() == f"{job}:"
            elif in_job and re.match(r"^    if:", line):
                cond = block_value(lines, i, 4)
    if group is None or cond is None:
        errors.append(f"{name}: concurrency.group か jobs.{job}.if が無い")
        continue
    want = "${{ (" + norm(cond) + ") && 'terraform-prod' || format('" + prefix + "-skip-{0}', github.run_id) }}"
    if norm(group) != want:
        errors.append(f"{name}: concurrency.group が jobs.{job}.if と対になっていない\n  期待: {want}\n  実際: {norm(group)}")
    if cancel != "false":
        errors.append(f"{name}: concurrency.cancel-in-progress が false でない")

for p in sorted(d.glob("*.y*ml")):
    # コメント（行頭の # と、空白の後の # 以降）を除いて探す
    code = [re.sub(r"\s#.*$", "", ln) for ln in p.read_text(encoding="utf-8").splitlines() if not ln.lstrip().startswith("#")]
    if any("pull_request_target" in ln for ln in code):
        errors.append(f"{p.name}: pull_request_target を使っている")

if errors:
    print("失敗:\n" + "\n".join(errors), file=sys.stderr)
    sys.exit(1)
print(f"ok: {', '.join(TARGETS)} の concurrency は job の if と対・cancel-in-progress: false・pull_request_target なし")
PY
