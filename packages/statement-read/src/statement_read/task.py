"""読み取りの種類（Issue #27）: 送り口（``agent_reader.Reader``）に差し込む、指示・画像に添える決まった文・
結果を返すツールの名前・説明・入力の形と、結果の検査の組。

送り口の守り（子の環境・一時ディレクトリ・締め切り・フック・失敗の分類）は種類によらず同じものを使い、
種類ごとに変わるのはこの組だけ。決済明細（``STATEMENT_TASK``）と、チャートの時間足（``chart_timeframe.CHART_TASK``）。
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from . import prompt, result


@dataclass(frozen=True)
class ReadTask:
    """読み取りの種類。check はツールの入力 → 検査済みの dict（外れたら result.Bad を投げる。値を持たない）"""

    system: str
    user_text: str
    tool_name: str
    tool_description: str
    input_schema: dict[str, Any]
    check: Callable[[Any], dict]

    def prompt_bytes(self) -> int:
        """指示・決まった文・ツールの名前・説明・入力の形（JSON）の UTF-8 のバイト数
        （トークン数の上界。pricing と同じ数え方）"""
        parts = (
            self.system,
            self.user_text,
            self.tool_name,
            self.tool_description,
            json.dumps(self.input_schema, ensure_ascii=False),
        )
        return sum(len(p.encode("utf-8")) for p in parts)


STATEMENT_TASK = ReadTask(
    system=prompt.READ_SYSTEM,
    user_text=prompt.READ_USER_TEXT,
    tool_name=result.TOOL_NAME,
    tool_description=result.TOOL_DESCRIPTION,
    input_schema=result.TOOL_INPUT_SCHEMA,
    check=result.check_result,
)
