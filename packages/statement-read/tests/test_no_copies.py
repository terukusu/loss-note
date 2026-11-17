"""AC-4: 読み取りの指示・決まった文・ツールの名前と説明・入力の形は、共有のパッケージだけに書く（二重に持たない）。

API（api/src）と評価の道具（tools/statement-eval/src）のソースに、指示の本文・ツールの名前の文字列の写しが無いこと。
"""

from pathlib import Path

import pytest

from statement_read import prompt, result

REPO = Path(__file__).resolve().parents[3]
CONSUMERS = [REPO / "api" / "src", REPO / "tools" / "statement-eval" / "src"]


def _sources():
    files = [p for d in CONSUMERS for p in d.rglob("*.py")]
    assert files, "使う側のソースが見つからない"
    return files


def _needles():
    # 指示の各行（短い行・見出しは除く）、決まった文、ツールの説明、ツールの名前の文字列
    lines = [ln.strip() for ln in prompt.READ_SYSTEM.splitlines() if len(ln.strip()) >= 20]
    assert len(lines) >= 10
    return [*lines, prompt.READ_USER_TEXT, result.TOOL_DESCRIPTION, f'"{result.TOOL_NAME}"',
            f"'{result.TOOL_NAME}'", "YYYY-MM-DDTHH:MM（明細の時間帯のまま。換算しない）"]


@pytest.mark.parametrize("needle", _needles())
def test_no_copy_outside_shared_package(needle):
    hits = [str(p.relative_to(REPO)) for p in _sources() if needle in p.read_text(encoding="utf-8")]
    assert hits == []


def test_shared_package_has_the_definitions():
    src = Path(result.__file__).read_text(encoding="utf-8")
    assert f'TOOL_NAME = "{result.TOOL_NAME}"' in src
    assert prompt.READ_USER_TEXT in Path(prompt.__file__).read_text(encoding="utf-8")
