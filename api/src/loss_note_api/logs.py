"""構造化ログ（1 行 1 JSON。設計書 10.1）。

出すのは出来事の名前・メソッド・ルールの型（``/api/trades/<trade_id>``。生のパスでない）・状態・時間・例外の型の名前だけ。
本文・クエリ・トークン・uid・メール・例外の文言・文書のパスは出さない。呼ぶ側も決まった鍵だけを渡す。
"""

import json
import logging
import sys

logger = logging.getLogger("loss_note_api")

_ALLOWED_KEYS = frozenset({"event", "method", "route", "status", "ms", "exc", "reason"})


class _StderrHandler(logging.StreamHandler):
    """書くたびに今の標準エラーを使う（テストが差し替えた先にも届く）"""

    def __init__(self):
        super().__init__()

    @property
    def stream(self):
        return sys.stderr

    @stream.setter
    def stream(self, _value):
        pass


def configure() -> None:
    if not any(isinstance(h, _StderrHandler) for h in logger.handlers):
        handler = _StderrHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    # gunicorn・flask の根のロガーに二重に出さない
    logger.propagate = False


def log_event(**fields: object) -> None:
    unknown = set(fields) - _ALLOWED_KEYS
    if unknown:
        # 決まった鍵の外は出さない（中身を出す経路を作らない）
        raise ValueError("ログに出せない鍵")
    logger.info(json.dumps(fields, ensure_ascii=False, separators=(",", ":")))
