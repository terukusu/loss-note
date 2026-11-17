"""KEEP-2: 実物の明細の画像・正解・読み取りの結果の置き場所（data/local/）が git で無視される"""

import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]


def test_data_local_is_ignored():
    # git が無い環境ではスキップせずに失敗させる（CI は checkout 済み）
    git = shutil.which("git")
    assert git is not None
    for p in (
        "data/local/statement-eval/real/x.png",
        "data/local/statement-eval/real/answers.json",
        "data/local/statement-eval/tmp/y",
        "data/local/statement-eval/summary.json",
    ):
        r = subprocess.run([git, "check-ignore", "-q", p], cwd=REPO, check=False)
        assert r.returncode == 0, p


def test_synthetic_files_are_not_ignored():
    git = shutil.which("git")
    assert git is not None
    r = subprocess.run([git, "check-ignore", "-q", "tools/statement-eval/synthetic/s01.png"], cwd=REPO, check=False)
    assert r.returncode == 1
