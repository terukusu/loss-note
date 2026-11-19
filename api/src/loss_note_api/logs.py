"""構造化ログ（1 行 1 JSON。設計書 10.1）。

出すのは出来事の名前・メソッド・ルールの型（``/api/trades/<trade_id>``。生のパスでない）・状態・時間・例外の型の名前だけ。
本文・クエリ・トークン・uid・メール・例外の文言・文書のパスは出さない。呼ぶ側も決まった鍵だけを渡す。
"""

import json
import logging
import sys

logger = logging.getLogger("loss_note_api")

# rows = 明細の読み取りで返した行の数（件数だけ。#11）。
# *_ms = 時間の内訳（ミリ秒の数だけ。#60）: 起動の準備（warmup）の段ごと（store_ms・auth_ms・sdk_ms）と、
# 明細の読み取りの段ごと（limit_ms = 上限の予約・token_ms = federation の ID トークン・read_ms = 送り口の全体・
# api_ms = CLI が報告する AI の API の時間。#99 で送り口の段: wait_ms・first_ms・result_ms・turn_ms・close_ms と、準備の
# 要求の settle_ms = CLI の CPU が静まるまで待った時間）。
# cli = 明細の読み取りが先立ての CLI を使ったか（warm / cold の 2 値だけ。#65）、cli_ms = 起動の準備の先立ての段
# fromSettings・history = 既定の口座を設定から作ったか（真偽）と、写した資金の履歴の件数（#47。値・名前を出さない）
# profile = 明細の特徴の覚えを読んだ結果（hit / miss / none / unavailable の決まった語だけ。鍵・会社の名前・口座を
# 出さない。#66）
# warm = 明細の読み取りが先立てを使えなかった理由と、取られずに終わった先立ての終わり方（statement_read.warm の決まった
# 語だけ）、warm_from = 先立ての出どころ（startup / prepare）、warm_age_ms・warm_ready_ms・warm_end_ms = 先立てを作って
# から今・立ち上がるまで・終わるまで（ミリ秒の数だけ。#99 の続き）
_ALLOWED_KEYS = frozenset(
    {"event", "method", "route", "status", "ms", "exc", "reason", "rows",
     "store_ms", "auth_ms", "sdk_ms", "cli_ms", "limit_ms", "token_ms", "read_ms", "api_ms", "cli",
     "wait_ms", "first_ms", "result_ms", "turn_ms", "close_ms", "settle_ms",
     "var", "fromSettings", "history", "profile",
     "warm", "warm_from", "warm_age_ms", "warm_ready_ms", "warm_end_ms"}
)


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
