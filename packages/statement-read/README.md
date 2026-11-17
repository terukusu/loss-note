# statement-read: 決済明細の読み取りの部品

決済明細（約定明細）の画像 1 枚を AI で読み取るための部品です。API の読み取りの入口（`api/` の `POST /api/statement-reads`）と、読み取りを測る道具（[`tools/statement-eval/`](../../tools/statement-eval/README.md)）が uv の path 依存で同じものを使います（二重に持たないため。Issue #11・[ADR-0005](../../docs/adr-0005-statement-read-api.md)）。

| モジュール | 役割 |
|---|---|
| `prompt.py` | 読み取りの指示（system）と、画像に添える決まった文 |
| `result.py` | 結果を返すツール `report_statement` の名前・説明・入力の形と、結果の検査 `check_result` |
| `values.py` | 数・日時・向き（`opened_side`）・手数料の合計の純関数 |
| `image.py` | 画像の上限（PNG / JPEG・500,000 B・長辺 2,000 px）と、PNG / JPEG の寸法を読む純関数（Pillow なし） |
| `normalize.py` | 読み取りの結果 → API の応答の形（L / S・日本時間・手数料の合計・範囲の外の欄を空に） |
| `agent_reader.py` | Claude Agent SDK で 1 枚を読む送り口（締め切り・一時ディレクトリ・失敗の分類）。SDK は使う側の依存グループ `ai` |
| `app_settings.py` | アプリの読み取りのモデル・effort・締め切り |

```sh
cd packages/statement-read
mise exec -- uv sync --locked
mise exec -- uv run --locked ruff check
mise exec -- uv run --locked pytest -q   # 実際の AI は呼びません
```
