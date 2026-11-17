"""アプリ（API）の読み取りの設定。EPIC #10 の終了条件 8 をこの設定で測る（道具の ``eval --preset app``。AC-14）。

環境変数で変えられるようにしない（変えるなら終了条件 8 の測り直しとセットにする）。
"""

APP_MODEL = "claude-sonnet-5-5"
APP_EFFORT = "low"
# 締め切り（秒）。超えたら取り消す（後始末に最大約 5 秒かかる）
APP_TIMEOUT_SECONDS = 20
