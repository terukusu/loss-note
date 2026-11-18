"""決済明細の読み取りの入口 POST /api/statement-reads（Issue #11 の AC-1〜AC-13・KEEP-2・KEEP-5）。

実際の AI は呼ばない（偽の claude_agent_sdk を sys.modules に差し込む）。画像は合成のバイト列、値はすべて架空。
"""

import base64
import copy
import json
import logging
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import pytest
from helpers import fake_agent_sdk
from helpers.charts import jpeg, png
from helpers.emulator import PROJECT
from helpers.memory_store import MemoryStore
from helpers.records import t1
from helpers.tokens import unsigned_token
from statement_read import app_settings, prompt, result

from loss_note_api import logs
from loss_note_api.app import create_app
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR

A = "readUserA"
EMAIL = "fictional.reader@example.com"
PATH = "/api/statement-reads"
CRED_MARKER = "CRED-MARKER-資格情報の印-5b2e"
IMG_MARKER = b"IMGMARKER-7c41"
SYM_MARKER = "SYMMARKERQZ"  # 銘柄の名前に許した文字だけ
NUM_MARKER = 987654.321


# ---- 合成の画像（helpers/charts.py。チャートのテストと共有） ----

SMALL_PNG = png(800, 600, size=2_000)


# ---- 偽の結果 ----


def read_row(**kw) -> dict:
    row = {
        "symbol": "US30",
        "side_written": "buy",
        "side_of": "position",
        "entry_price": 39012.5,
        "entry_time": "2026-03-04T01:15",
        "exit_price": 39100.0,
        "exit_time": "2026-03-04T06:40",
        "time_zone": "GMT",
        "qty": 0.5,
        "fees": None,
        "pnl_jpy": 6500,
        "exit_order_type": "unknown",
    }
    row.update(kw)
    return row


def statement(*rows, kind="statement") -> dict:
    return {"kind": kind, "rows": list(rows)}


def epoch_ms(y, mo, d, h, mi) -> int:
    return int(datetime(y, mo, d, h, mi, tzinfo=UTC).timestamp() * 1000)


# ---- 組み立て ----


def base_env(**extra) -> dict:
    return {AUTH_EMULATOR: "127.0.0.1:9099", FIRESTORE_EMULATOR: "127.0.0.1:8080", "GOOGLE_CLOUD_PROJECT": PROJECT,
            **extra}


class ReadClient:
    def __init__(self, app, store):
        self.client = app.test_client()
        self.store = store

    def post_image(self, data: bytes, uid: str | None = A, content_type: str = "image/png", headers=None, **token_kw):
        h = dict(headers or {})
        if uid is not None:
            h["Authorization"] = f"Bearer {unsigned_token(uid, PROJECT, **token_kw)}"
        return self.client.post(PATH, data=data, headers=h, content_type=content_type)


@pytest.fixture
def emulator_env(monkeypatch):
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    monkeypatch.setenv(FIRESTORE_EMULATOR, "127.0.0.1:8080")


@pytest.fixture
def sdk(monkeypatch):
    fake = fake_agent_sdk.install(monkeypatch)
    fake.tool_input = statement(read_row())
    return fake


@pytest.fixture
def make_client(emulator_env, clock):
    def make(env=None, read_timeout=None, store=None):
        store = store or MemoryStore()
        env = base_env(ANTHROPIC_API_KEY=CRED_MARKER) if env is None else env
        return ReadClient(create_app(env, store=store, clock=clock, read_timeout=read_timeout), store)

    return make


@pytest.fixture
def reads(make_client):
    return make_client()


@pytest.fixture
def sys_tmp(monkeypatch, tmp_path):
    """システムの一時ディレクトリをテスト用の空ディレクトリに差し替える（増えたファイルを数える）"""
    d = tmp_path / "sys-tmp"
    d.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(d))
    return d


def all_files(d: Path) -> list[str]:
    return sorted(str(p.relative_to(d)) for p in d.rglob("*"))


# ---- AC-1: 認証（例 #33） ----


def bad_auth_headers():
    expired = unsigned_token(A, PROJECT, exp_offset=-120)
    return {
        "なし": {},
        "Bearer でない": {"Authorization": f"Basic {unsigned_token(A)}"},
        "壊れた JWT": {"Authorization": "Bearer not.a.jwt"},
        "期限切れ": {"Authorization": f"Bearer {expired}"},
    }


@pytest.mark.parametrize("name", list(bad_auth_headers()))
def test_unauthenticated_is_401_without_calling(reads, sdk, name):
    res = reads.post_image(png(1600, 900, size=300_000), uid=None, headers=bad_auth_headers()[name])
    assert res.status_code == 401
    assert res.get_json() == {"error": "unauthorized"}
    assert sdk.calls == []


def test_unauthenticated_oversized_body_is_still_401(reads, sdk):
    # 本文を見る前に断る（大きすぎる本文でも 401。400 にならない）
    res = reads.post_image(b"\x00" * 600_000, uid=None)
    assert res.status_code == 401 and sdk.calls == []


# ---- AC-2: 画像の上限（例 #29〜#32） ----


def test_image_limits_example_29_is_sent(reads, sdk):
    data = png(1600, 900, size=300_000)
    assert len(data) == 300_000
    res = reads.post_image(data)
    assert res.status_code == 200
    assert len(sdk.calls) == 1


@pytest.mark.parametrize(
    "no,data,ct,reason",
    [
        ("30", png(2001, 900, size=10_000), "image/png", "dimensions"),
        ("30 縦", png(900, 2001, size=10_000), "image/png", "dimensions"),
        ("31", jpeg(1200, 800, size=500_001), "image/jpeg", "bytes"),
        ("32 WebP", b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 64, "image/webp", "format"),
        ("32 GIF", b"GIF89a" + b"\x00" * 64, "image/gif", "format"),
        ("32 0 B", b"", "image/png", "format"),
        ("32 寸法を読めない PNG", b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, "image/png", "dimensions"),
        ("寸法 0", png(0, 900, size=1_000), "image/png", "dimensions"),
        ("Content-Type と署名の違い", png(800, 600, size=1_000), "image/jpeg", "format"),
        ("multipart", png(800, 600, size=1_000), "multipart/form-data; boundary=x", "format"),
    ],
)
def test_image_limits_rejected_without_calling(reads, sdk, no, data, ct, reason):
    res = reads.post_image(data, content_type=ct)
    assert res.status_code == 400
    assert res.get_json() == {"error": "image_rejected", "reason": reason}
    assert sdk.calls == []


def test_image_limits_boundaries_pass(reads, sdk):
    assert reads.post_image(png(2000, 2000, size=500_000)).status_code == 200
    assert reads.post_image(jpeg(2000, 10, size=500_000), content_type="image/jpeg").status_code == 200
    assert len(sdk.calls) == 2


def test_image_limits_declared_length_too_large(reads, sdk):
    # Content-Length が上限を超えると本文を読まずに断る（アプリ全体の 64 KiB の tooLarge でなく画像の符号）
    res = reads.post_image(png(1600, 900, size=2_000_000))
    assert res.status_code == 400 and res.get_json() == {"error": "image_rejected", "reason": "bytes"}
    assert sdk.calls == []


def test_image_limits_chunked_body_too_large(reads, sdk):
    # Content-Length の無い分割の本文（chunked）で上限を超える → 読む途中で止めて 400 bytes（tooLarge でない）
    import io

    data = png(1600, 900, size=500_001)  # 切り詰めて送らない（1 B 超えでも断る）
    res = reads.client.post(
        PATH,
        input_stream=io.BytesIO(data),
        headers={"Authorization": f"Bearer {unsigned_token(A, PROJECT)}", "Content-Type": "image/png",
                 "Transfer-Encoding": "chunked"},
        # gunicorn と同じく、分割の解読はサーバーが済ませ、本文の終わりが分かる入力として渡す
        environ_overrides={"wsgi.input_terminated": True},
    )
    assert res.status_code == 400
    assert res.get_json() == {"error": "image_rejected", "reason": "bytes"}
    assert sdk.calls == []


def test_image_limits_chunked_body_within_limit(reads, sdk):
    import io

    res = reads.client.post(
        PATH,
        input_stream=io.BytesIO(png(1600, 900, size=500_000)),  # 境目ちょうどは通る
        headers={"Authorization": f"Bearer {unsigned_token(A, PROJECT)}", "Content-Type": "image/png",
                 "Transfer-Encoding": "chunked"},
        # gunicorn と同じく、分割の解読はサーバーが済ませ、本文の終わりが分かる入力として渡す
        environ_overrides={"wsgi.input_terminated": True},
    )
    assert res.status_code == 200 and len(sdk.calls) == 1


# ---- AC-3・AC-4: 送るもの ----


def test_request_sent_is_prompt_image_text_and_one_tool(make_client, sdk):
    client = make_client()
    # 利用者の記録・設定を作っておく（送られないことを確かめる）
    store = client.store
    trade_marker = "TRADE-MARKER-記録の印-41aa"
    store.create_instrument(A, {"name": "架空銘柄", "nameKey": "架空銘柄", "multiplier": 1, "quantityStep": 1,
                                "priceCurrency": "JPY", "underlyingKind": "index", "productForm": "cfd",
                                "createdAt": 1, "updatedAt": 1})
    store.users[A]["trades"] = {"t1": {"record": {"thesis": trade_marker}}}
    store.users[A]["settings"] = {"main": {"capitalYen": 7_777_777}}
    data = png(1600, 900, size=50_000, filler=b"\x01\x02")
    res = client.post_image(data, email=EMAIL)
    assert res.status_code == 200
    assert len(sdk.calls) == 1
    call = sdk.calls[0]
    opts = call["options"]
    # 指示・モデル・effort・ツール（共有のパッケージの定数と同じ。AC-4）
    assert opts.system_prompt is prompt.READ_SYSTEM
    assert opts.model == app_settings.APP_MODEL == "claude-sonnet-5-5"
    assert opts.effort == app_settings.APP_EFFORT == "low"
    assert opts.tools == [] and opts.setting_sources == [] and opts.max_turns == 1
    assert list(opts.mcp_servers) == ["eval"]
    tools = opts.mcp_servers["eval"]["tools"]
    assert len(tools) == 1
    assert tools[0].name == result.TOOL_NAME
    assert tools[0].description == result.TOOL_DESCRIPTION
    assert tools[0].input_schema is result.TOOL_INPUT_SCHEMA
    # message: 画像 1 枚（送ったバイトと一致）と決まった文だけ
    content = call["message"]["message"]["content"]
    assert len(content) == 2
    assert content[0]["type"] == "image" and content[0]["source"]["media_type"] == "image/png"
    assert base64.b64decode(content[0]["source"]["data"]) == data
    assert content[1] == {"type": "text", "text": prompt.READ_USER_TEXT}
    # 送った要求に uid・メール・記録・設定の値が無い
    sent = json.dumps({"message": call["message"], "options": {k: v for k, v in opts.kwargs.items()
                                                                 if k not in ("stderr", "hooks")}},
                      default=str, ensure_ascii=False)
    for needle in (A, EMAIL, trade_marker, "7777777", "架空銘柄"):
        assert needle not in sent


def test_child_env_has_only_selected_credential(make_client, sdk):
    client = make_client(env=base_env(ANTHROPIC_API_KEY=CRED_MARKER, CLAUDE_CODE_OAUTH_TOKEN="OTHER-x"))
    assert client.post_image(SMALL_PNG).status_code == 200
    env = sdk.calls[0]["options"].env
    assert env["ANTHROPIC_API_KEY"] == CRED_MARKER
    assert "CLAUDE_CODE_OAUTH_TOKEN" not in sdk.calls[0]["child_env"] and env["CLAUDE_CODE_MAX_RETRIES"] == "0"


def test_oauth_token_switch(make_client, sdk):
    client = make_client(env=base_env(STATEMENT_READ_CREDENTIAL="oauth_token", CLAUDE_CODE_OAUTH_TOKEN=CRED_MARKER))
    assert client.post_image(SMALL_PNG).status_code == 200
    env = sdk.calls[0]["options"].env
    assert env["CLAUDE_CODE_OAUTH_TOKEN"] == CRED_MARKER and "ANTHROPIC_API_KEY" not in sdk.calls[0]["child_env"]


# ---- AC-5: 形に合わない結果は全体を捨てる（例 #20〜#25） ----


@pytest.mark.parametrize(
    "no,script,tool_input",
    [
        ("20", "tool", statement(read_row(account_number="12345678"))),
        ("21", "tool", statement(read_row(entry_price="39,012.5"))),
        ("22", "tool", statement(read_row(side_written="long"))),
        ("23", "tool", statement(read_row(entry_time="04/03/2026 10:15"))),
        ("24", "tool", statement(*[read_row() for _ in range(21)])),
        ("25", "text", None),
        ("暦にない日時", "tool", statement(read_row(exit_time="2026-02-30T10:15"))),
    ],
)
def test_invalid_result_is_discarded(reads, sdk, no, script, tool_input):
    sdk.script, sdk.tool_input = script, tool_input
    res = reads.post_image(SMALL_PNG)
    assert res.status_code == 502
    assert res.get_json() == {"error": "read_invalid_result"}
    assert len(sdk.calls) == 1


# ---- AC-6: 結果が期待どおり（例 #17〜#19・#26〜#28） ----


def post_result(reads, sdk, tool_input) -> dict:
    sdk.tool_input = tool_input
    res = reads.post_image(SMALL_PNG)
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def test_success_example_17(reads, sdk):
    body = post_result(reads, sdk, statement(read_row()))
    assert body == {"kind": "statement", "rows": [{
        "symbol": "US30",
        "side": "L",
        "entryPrice": 39012.5,
        "exitPrice": 39100.0,
        "quantity": 0.5,
        "pnlYen": 6500,
        "entryTime": {"written": "2026-03-04T01:15", "timeZone": "GMT", "jst": "2026-03-04T10:15",
                      "epochMs": epoch_ms(2026, 3, 4, 1, 15)},
        "exitTime": {"written": "2026-03-04T06:40", "timeZone": "GMT", "jst": "2026-03-04T15:40",
                     "epochMs": epoch_ms(2026, 3, 4, 6, 40)},
        "timeZoneNeedsCheck": False,
        "fees": None,
        "feesTotalYen": None,
        "exitOrderType": "unknown",
    }]}


def test_success_example_18(reads, sdk):
    body = post_result(reads, sdk, statement(read_row(pnl_jpy=0), read_row(pnl_jpy=-12340)))
    assert [r["pnlYen"] for r in body["rows"]] == [0, -12340]


def test_success_example_19(reads, sdk):
    assert post_result(reads, sdk, statement(kind="not_statement")) == {"kind": "notStatement", "rows": []}


@pytest.mark.parametrize("symbol", ["X" * 41, "US30;x", "US30@x"])
def test_success_examples_26_27(reads, sdk, symbol):
    row = post_result(reads, sdk, statement(read_row(symbol=symbol)))["rows"][0]
    assert row["symbol"] is None
    assert row["side"] == "L" and row["entryPrice"] == 39012.5 and row["pnlYen"] == 6500


@pytest.mark.parametrize("qty", [0, -1])
def test_success_example_28(reads, sdk, qty):
    row = post_result(reads, sdk, statement(read_row(qty=qty)))["rows"][0]
    assert row["quantity"] is None and row["entryPrice"] == 39012.5 and row["exitPrice"] == 39100.0


def test_success_fees_and_time_zone_mark(reads, sdk):
    row = post_result(reads, sdk, statement(read_row(fees=[38, 3, 38, 3], time_zone="unknown")))["rows"][0]
    assert row["fees"] == [38, 3, 38, 3] and row["feesTotalYen"] == 82
    assert row["timeZoneNeedsCheck"] is True and row["entryTime"]["jst"] is None


# ---- AC-10: 画像と結果が残らない（終了条件 6(a)） ----


@pytest.mark.parametrize(
    "case,script,tool_input,status",
    [
        ("17 成功", "tool", statement(read_row()), 200),
        ("20 形の誤り", "tool", statement(read_row(account_number="x")), 502),
        ("35 送り先の失敗", "raise", None, 502),
        ("36 締め切り超え", "hang", None, 504),
    ],
)
def test_nothing_left_after_read(make_client, sdk, sys_tmp, case, script, tool_input, status):
    client = make_client(read_timeout=0.05)
    before = copy.deepcopy(client.store.users)
    sdk.script, sdk.tool_input, sdk.write_tmp = script, tool_input, True
    res = client.post_image(png(1600, 900, size=300_000, filler=IMG_MARKER))
    assert res.status_code == status
    assert len(sdk.calls) == 1
    # CLI の一時ディレクトリ・HOME・TMPDIR（画像を書いた場所）は要求ごとの一時ディレクトリの中で、消えている。
    # システムの一時ディレクトリに増えたファイルは 0
    env = sdk.calls[0]["options"].env
    for key in ("CLAUDE_CODE_TMPDIR", "CLAUDE_CONFIG_DIR", "HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"):
        assert env[key].startswith(str(sys_tmp)), key
        assert not Path(env[key]).exists(), key
    assert all_files(sys_tmp) == []
    # 記録の保存先は要求の前と同じ（書き込み 0 件）
    assert client.store.users == before
    if script == "hang":
        assert sdk.cleaned == 1  # 取り消しで SDK の後始末が走った


def test_nothing_left_storage_not_used():
    # API のソースは Storage を使わない（画像を置く経路が無い）
    src = Path(__file__).resolve().parents[1] / "src"
    for p in src.rglob("*.py"):
        text = p.read_text(encoding="utf-8")
        assert "firebase_admin import storage" not in text and "google.cloud import storage" not in text
        assert "google.cloud.storage" not in text and "firebase_admin.storage" not in text


# ---- AC-11: ログとエラーの応答に目印が出ない ----


@pytest.fixture
def capture(caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)
    monkeypatch.setattr(logs.logger, "propagate", True)
    return caplog


def test_markers_not_in_logs_or_errors(make_client, sdk, capture, capfd):
    client = make_client(read_timeout=0.05)
    image = png(1600, 900, size=100_000, filler=IMG_MARKER)
    marked = statement(read_row(symbol=SYM_MARKER, entry_price=NUM_MARKER, pnl_jpy=NUM_MARKER, fees=[NUM_MARKER]))
    error_bodies = []
    # 成功
    sdk.script, sdk.tool_input = "tool", marked
    ok = client.post_image(image, email=EMAIL)
    assert ok.status_code == 200 and ok.get_json()["rows"][0]["symbol"] == SYM_MARKER
    # 形の誤り（知らない鍵に目印）
    bad = copy.deepcopy(marked)
    bad["rows"][0]["account_number"] = SYM_MARKER
    sdk.tool_input = bad
    error_bodies.append(client.post_image(image, email=EMAIL))
    # 送り先の失敗（例外の文言に目印・資格情報）
    sdk.script, sdk.raise_text = "raise", f"{SYM_MARKER} {CRED_MARKER} {NUM_MARKER}"
    error_bodies.append(client.post_image(image, email=EMAIL))
    # 締め切り超え
    sdk.script = "hang"
    error_bodies.append(client.post_image(image, email=EMAIL))
    # 送り先のエラーの結果
    sdk.script = "is_error"
    error_bodies.append(client.post_image(image, email=EMAIL))
    assert [r.status_code for r in error_bodies] == [502, 502, 504, 502]

    out, err = capfd.readouterr()
    log_text = "\n".join([out, err, *(r.getMessage() for r in capture.records)])
    texts = [log_text, *(r.get_data(as_text=True) for r in error_bodies)]
    assert any("statement_read" in t for t in texts)  # ログは出ている
    for t in texts:
        for needle in (SYM_MARKER, CRED_MARKER, str(NUM_MARKER), "987654", IMG_MARKER.decode(), EMAIL, A):
            assert needle not in t
    raw_logs = out.encode() + err.encode()
    assert IMG_MARKER not in raw_logs


def test_read_log_shape(make_client, sdk, capture, capfd):
    client = make_client()
    client.post_image(SMALL_PNG)
    client.post_image(b"GIF89a" + b"\x00" * 10, content_type="image/gif")
    _out, err = capfd.readouterr()
    lines = [json.loads(ln) for ln in err.splitlines() if ln.startswith("{")]
    reads_ = [ln for ln in lines if ln.get("event") == "statement_read"]
    assert [ln["reason"] for ln in reads_] == ["ok", "image_format"]
    assert reads_[0]["rows"] == 1 and reads_[1]["rows"] == 0
    # 時間の内訳（#60）: AI へ送った回は上限の予約・送り口の全体・CLI が報告した API の時間（偽の SDK は 1,200 ms）。
    # 送る前に返した回は内訳なし。送った回は先立てを使ったか（#65。準備をしていないので cold）
    assert set(reads_[0]) == {"event", "reason", "rows", "ms", "limit_ms", "read_ms", "api_ms", "cli"}
    assert reads_[0]["api_ms"] == 1200.0 and reads_[0]["cli"] == "cold"
    assert set(reads_[1]) == {"event", "reason", "rows", "ms"}
    for ln in reads_:
        for k in set(ln) - {"event", "reason", "rows", "cli"}:
            assert isinstance(ln[k], (int, float)) and not isinstance(ln[k], bool)
    # 既存の request の行もそのまま
    assert any(ln.get("event") == "request" and ln.get("route") == PATH for ln in lines)


# ---- AC-12: 資格情報が無い（例 #34） ----


@pytest.mark.parametrize(
    "env",
    [
        base_env(),
        base_env(ANTHROPIC_API_KEY=""),
        base_env(STATEMENT_READ_CREDENTIAL="api_key", CLAUDE_CODE_OAUTH_TOKEN="x"),
        base_env(STATEMENT_READ_CREDENTIAL="oauth_token", ANTHROPIC_API_KEY="x"),
        base_env(STATEMENT_READ_CREDENTIAL="oauth_token", CLAUDE_CODE_OAUTH_TOKEN=""),
        base_env(STATEMENT_READ_CREDENTIAL="password", ANTHROPIC_API_KEY="x"),
    ],
    ids=["空", "空文字", "api_key でほかだけ", "oauth_token でほかだけ", "oauth_token が空文字", "知らない切り替え"],
)
def test_unavailable_without_credential(make_client, sdk, env):
    client = make_client(env=env)
    res = client.post_image(SMALL_PNG)
    assert res.status_code == 503
    assert res.get_json() == {"error": "read_unavailable"}
    assert sdk.calls == []


def test_unavailable_without_sdk(make_client, monkeypatch):
    import sys

    monkeypatch.setitem(sys.modules, "claude_agent_sdk", None)
    res = make_client().post_image(SMALL_PNG)
    assert res.status_code == 503 and res.get_json() == {"error": "read_unavailable"}


def test_unavailable_when_unconfigured(sdk):
    # プロジェクト ID が無い設定（記録の API と同じく 503 unavailable）
    res = create_app({}).test_client().post(PATH, data=SMALL_PNG, content_type="image/png")
    assert res.status_code == 503 and res.get_json() == {"error": "unavailable"}
    assert sdk.calls == []


def test_only_post(reads, sdk):
    res = reads.client.get(PATH, headers={"Authorization": f"Bearer {unsigned_token(A, PROJECT)}"})
    assert res.status_code == 405


# ---- AC-13: 送り先の失敗（例 #35・#36） ----


@pytest.mark.parametrize("script", ["raise", "is_error", "no_result"])
def test_upstream_failure_is_fixed_code(reads, sdk, script):
    sdk.script, sdk.raise_text = script, "upstream body with details 500"
    res = reads.post_image(SMALL_PNG)
    assert res.status_code == 502
    assert res.get_json() == {"error": "read_failed"}
    assert "upstream" not in res.get_data(as_text=True)


def test_timeout_is_504(make_client, sdk):
    sdk.script = "hang"
    res = make_client(read_timeout=0.05).post_image(SMALL_PNG)
    assert res.status_code == 504
    assert res.get_json() == {"error": "read_timeout"}
    assert sdk.cleaned == 1


def test_default_timeout_is_app_setting():
    from loss_note_api.statement_read import read_config

    config = read_config(base_env(ANTHROPIC_API_KEY="x"), mode="emulator")
    assert config.timeout == app_settings.APP_TIMEOUT_SECONDS == 20
    secret = read_config(base_env(ANTHROPIC_API_KEY="SECRET-REPR"), mode="emulator")
    assert "SECRET-REPR" not in repr(secret)


# ---- KEEP-2: 読み取り以外の本文の上限は 64 KiB のまま ----


def test_body_limit_only_for_read(make_client, sdk, clock):
    client = make_client()
    assert client.post_image(png(1600, 900, size=300_000)).status_code == 200
    raw = json.dumps(t1("abc123", thesis="y" * (70 * 1024)))
    assert len(raw.encode()) > 64 * 1024
    res = client.client.post("/api/trades", data=raw, content_type="application/json",
                             headers={"Authorization": f"Bearer {unsigned_token(A, PROJECT)}"})
    assert res.status_code == 400
    assert res.get_json() == {"error": "invalid", "issues": [{"field": "", "kind": "tooLarge"}]}
