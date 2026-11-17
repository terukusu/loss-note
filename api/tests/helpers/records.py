"""テストの取引の本文（値はすべて架空）。

T1（Issue #4 の例）: L・イン 100.00・LC 99.50・数量 10,000・決済 99.50（理由 LC・注文の種類 不明）・
明細の損益 −5,200 円・手数料 200 円・3 つのタップは 決めていた / 動かしていない / 変えていない・
崩れの条件「99.50 を割ったら押し目の根拠が崩れる」
"""

import json
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "records"
BROKEN_CONDITION = "99.50 を割ったら押し目の根拠が崩れる"


def t1(instrument_id: str, **over) -> dict:
    body = {
        "status": "closed",
        "source": "manual",
        "instrumentId": instrument_id,
        "side": "L",
        "lc": 99.5,
        "brokenCondition": BROKEN_CONDITION,
        "lcDecidedBeforeEntry": True,
        "lcMove": {"kind": "none"},
        "timeframeChange": "none",
        "entries": [{"price": 100, "quantity": 10000}],
        "exit": {"time": 1_700_000_000_000, "price": 99.5, "reason": "lc"},
        "statementPnlYen": -5200,
        "fees": [{"label": "手数料", "amountYen": 200}],
    }
    body.update(over)
    return body


def load_fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def same_typed(a, b) -> bool:
    """値と型（int / float / bool / str）がともに同じか（丸め・型の変化を見逃さない）"""
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(same_typed(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(same_typed(x, y) for x, y in zip(a, b, strict=True))
    return a == b
