"""Flask アプリの入口。

手元の起動: ``uv run flask --app loss_note_api.app:create_app run -p 8000``（画面の開発サーバーが /api をここへ渡す）。
"""

from flask import Flask


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/api/health")
    def health():
        # 生存確認だけ。記録（Firestore・Storage）には触れない
        return {"status": "ok"}

    return app
