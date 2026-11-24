"""データの書き出し（Issue #167・設計書 9.2 の設定の行・10.1・ADR-0025）の純関数。

入口は ``routes.py`` の ``GET /api/export``（記録の API の門 = ID トークン + 許可リストの後）。本人の
``users/{uid}`` の下の記録（設定・口座・銘柄・取引）と心理のタグの選択肢の設定（#163。``emotionTagSettings`` =
``GET /api/settings/emotion-tags`` と同じ形）を、一覧の API と同じ形・同じ並びで 1 つの JSON にまとめる。

- 含めないもの: チャート画像のバイト列（取引の ``charts`` の要約 = 形式と大きさだけを含める）、明細の特徴の覚え
  （仮名化した鍵。記録でない）、AI の計上（計量）。ほかの利用者のデータは読まない（保存先のメソッドが uid で絞る）
- ログは記録の API の request の行だけ（件数・中身を出さない）
- CSV は画面が作る（判定・R・リスクの計算の正は画面の core。この形の取引から組み立てる）
"""

from loss_note_api.read_limits import jst_day

FORMAT = "loss-note-export"
# 書き出しの形の版（鍵の意味を変える・鍵を外すときに上げる。鍵を足すだけなら上げない）
VERSION = 1
PATH = "/export"


def export_body(now: int, settings: dict, accounts: list[dict], instruments: list[dict], trades: list[dict],
                emotion_tag_settings: dict) -> dict:  # fmt: skip
    """一覧の API の形にした各要素 → 書き出しの本文（入力を書き換えない）"""
    return {
        "format": FORMAT,
        "version": VERSION,
        "exportedAt": now,
        "settings": settings,
        "emotionTagSettings": dict(emotion_tag_settings),
        "accounts": list(accounts),
        "instruments": list(instruments),
        "trades": list(trades),
    }


def file_name(now: int) -> str:
    """保存の名前（日本時間の日付。例: loss-note-20261124.json）"""
    return f"loss-note-{jst_day(now).replace('-', '')}.json"
