"""アプリ（API）の読み取りの設定。EPIC #10 の終了条件 8 をこの設定で測る（道具の ``eval --preset app``。AC-14）。

環境変数で変えられるようにしない（変えるなら終了条件 8 の測り直しとセットにする）。
"""

APP_MODEL = "claude-sonnet-5-5"
APP_EFFORT = "low"
# 締め切り（秒）。超えたら取り消す（後始末に最大約 5 秒かかる）
APP_TIMEOUT_SECONDS = 20
# 最大出力（トークン。Issue #44）。子の CLI に CLAUDE_CODE_MAX_OUTPUT_TOKENS で渡し、
# 1 回の費用の上界（予約額。pricing）を小さくする。結果（report_statement の入力）は最も長い形
# （20 行・銘柄の名前 40 字の漢字・手数料 8 欄・桁の多い数）でも JSON で約 12,000 B
# （整形しても約 15,000 B。トークン数 ≤ バイト数）。合成 14 枚の実測の出力は平均 720 トークン以下
APP_MAX_OUTPUT_TOKENS = 16_000
