# 本番のイメージ（Issue #42・ADR-0009）: API（api/、Flask / gunicorn）と画面（ui/ を Vite でビルドした dist/）を 1 つのイメージに。
# 1 つの Cloud Run のサービスで配る（同じオリジン。画面 → /api）。ビルド context はリポジトリ直下:
#   docker build -t loss-note:local .
#   （本番のビルドは Firebase の Web の設定を --build-arg VITE_FIREBASE_PROJECT_ID・VITE_FIREBASE_API_KEY・VITE_FIREBASE_AUTH_DOMAIN で渡す。
#    渡さなければログインの画面は「設定が無い」の案内になる）
# context に入るものは .dockerignore（許可リスト）で限定する。入力パスを変えたら .github/scripts/image.sh も直す（ci.yml が突き合わせる）。
# ベースイメージは digest で固定する（公開から 2 週間以上たった版。uv の exclude-newer と同じ考え方）。
# node は .node-version（24.22.3）の digest が 14 日に満たなかったので、同じ 24 系（package.json の engines の範囲）の 24.22.1
ARG NODE_IMAGE=node:24.22.1-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c
ARG PYTHON_IMAGE=python:3.13.17-slim@sha256:d98cc29d3266e535dd9da1099688d9cb3ca4753813571e071763d17725460962

# 画面: package-lock.json の integrity で検証して入れ、vite build で dist/ を作る（開発の時だけの部品の見本・既定値は入らない）
FROM ${NODE_IMAGE} AS web
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY vite.config.ts tsconfig.json ./
COPY core ./core
COPY ui ./ui
# Firebase の Web の設定（公開の JS に入る値。秘密ではない）。この段の RUN の環境にだけ置き、最終段の履歴には残らない
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
RUN npm run build

# API: uv.lock のハッシュで検証して /opt/venv に入れる（開発用の依存は入れない）。読み取りの部品（packages/statement-read）は
# api/ からの相対パスの依存なので、元の相対位置に置いて編集可能でない形で入れる。
# 明細の読み取りの AI の SDK（依存グループ ai。同梱の CLI を含む）は最初から入れる（#44 が資格情報を足すだけで動くように。
# 資格情報が無い間は読み取りの入口が 503 read_unavailable を返す）
FROM ${PYTHON_IMAGE} AS build
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PYTHON=/usr/local/bin/python3 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PIP_DISABLE_PIP_VERSION_CHECK=1
COPY .github/uv-requirements.txt /tmp/uv-requirements.txt
RUN pip install --no-cache-dir --require-hashes -r /tmp/uv-requirements.txt
WORKDIR /src/api
# 依存だけ先に入れて層をキャッシュする
COPY api/pyproject.toml api/uv.lock ./
COPY packages/statement-read/pyproject.toml /src/packages/statement-read/pyproject.toml
RUN uv sync --locked --no-dev --group ai --no-install-project --no-install-package statement-read
COPY packages/statement-read/src /src/packages/statement-read/src
COPY api/src ./src
RUN uv sync --locked --no-dev --group ai --no-editable

FROM ${PYTHON_IMAGE}
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
COPY --from=build /opt/venv /opt/venv
COPY --from=web /src/dist /app/static
# STATIC_DIR があるときだけ API が画面の静的ファイルも配る（api/src/loss_note_api/web.py）。
# GOOGLE_CLOUD_PROJECT（必須）は実行時の環境変数（infra/prod）。エミュレーターの接続先は持たない（ADR-0004 の verify）
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    STATIC_DIR=/app/static \
    PORT=8080
WORKDIR /app
USER 10001
# 1 ワーカー・8 スレッド（Cloud Run の同時実行 8 と同じ）。--timeout 60 は Cloud Run のタイムアウトと同じ（画面の待ち 30 秒 = 読み取りの締め切り 20 秒 + 後始末 約 5 秒 より長い）。
# アクセスログは出さない（gunicorn の既定。パス・クエリをログに出さない。API の request の出来事だけ）
CMD ["sh", "-c", "exec gunicorn --bind :${PORT} --workers 1 --threads 8 --timeout 60 --no-control-socket 'loss_note_api.app:create_app()'"]
