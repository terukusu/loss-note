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
# チャートの時間足の読み取りの最大出力（トークン。Issue #27・ADR-0015）。結果（report_chart_timeframe の入力）は
# 2 つの欄だけで、最も長い形（表記 16 文字の漢字）でも JSON で約 80 B。明細の実測（平均 720 トークン以下）は結果の
# JSON が数百〜数千 B のときの値で、結果の外の出力（ツールの呼び出しの枠など）を含めても数百トークンに収まる見込み。
# その数倍の余裕を取る。予約額（pricing.reserve_micro_usd）を明細の半分以下にして、明細と同時に通るようにする
APP_CHART_MAX_OUTPUT_TOKENS = 2_000
# 先立ての CLI（Issue #65・ADR-0013）: 使われない先立ては作ってから 10 分で捨てる（federation の ID トークンの
# 期限 1 時間より十分短く、Cloud Run が使われないインスタンスを止めるまでの目安より短い）
APP_WARM_TTL_SECONDS = 600
# 先立ての CLI が立ち上がるまでの上限（秒）。準備の要求が待つ上限も同じ
APP_WARM_STARTUP_SECONDS = 20
