"""起動の段の準備（Issue #60）。

本番は最小 0 台（設計書 10 章）なので、インスタンスの起動のたびに、最初の要求が保存先（Firestore のクライアント・
gRPC の接続・アクセス トークン）と ID トークンの検証（firebase-admin の初期化・公開鍵の取得）の初期化を払っていた
（同時に来た最初の 3 件がそろって約 1.5 秒）。gunicorn の worker は ``create_app()`` が返るまで要求を受けないので、
ここで準備を済ませれば、その時間は起動の段（Cloud Run の起動時の CPU ブーストの中）に移る。

- 段は順に 1 回ずつ呼ぶ。どれかが例外を投げても続け、起動は止めない（失敗した段は最初の要求で作り直す = 今までの
  遅延の初期化のまま）
- 段 ``cli``（#65）は明細の読み取りの CLI の先立てを立て始めるだけ（立ち上がりを待たない）。起動の直後に要求が
  来て CPU が割り当てられれば立ち上がって使われる。要求が来ないまま起動の上限を過ぎた先立ては、印 ``startup_idle``
  で捨てる（CPU があって間に合わなかった ``startup_timeout`` と分ける。ADR-0013 の追記）
- ログは 1 行（``event=warmup``）: 理由（``ok`` か、失敗した段の名前を ``+`` でつないだもの）・合計の時間・段ごとの
  時間（``<段>_ms``）。例外の型も文言も出さない（文言に接続先・文書のパスが入りうる）
"""

import time
from collections.abc import Callable, Sequence

from loss_note_api import logs

# 段の名前 → ログの時間の鍵（logs._ALLOWED_KEYS にあるものだけ）
STEP_KEYS = {"store": "store_ms", "auth": "auth_ms", "sdk": "sdk_ms", "cli": "cli_ms"}

Step = tuple[str, Callable[[], object]]


def _ms(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 1)


def run(steps: Sequence[Step]) -> list[str]:
    """steps を順に呼び、失敗した段の名前を返す（呼んだ順）。ログを 1 行出す"""
    started = time.perf_counter()
    failed: list[str] = []
    timings: dict[str, float] = {}
    for name, step in steps:
        key = STEP_KEYS[name]  # 知らない段の名前はログの鍵が無いので、呼ぶ前に落とす（作る側の誤り）
        t = time.perf_counter()
        try:
            step()
        except Exception:  # noqa: BLE001 - 起動は止めない。型の名前・文言は出さない
            failed.append(name)
        timings[key] = _ms(t)
    logs.log_event(event="warmup", reason="+".join(failed) or "ok", ms=_ms(started), **timings)
    return failed
