"""先立ての CLI（warm.WarmPool。Issue #65）: 使い捨て・期限・同時の取り合い・送る前の失敗・締め切り・閉じる。

実際の AI・SDK は使わない（偽の query_fn。SDK と同じく、prompt を読む前に「起動」の時間を眠る）。値は架空。
"""

import contextlib
import os
import sys
import threading
import time
from pathlib import Path

import anyio
import pytest

from statement_read import agent_reader, warm

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
TOKEN_A = "aaa.bbb.ccc"
TOKEN_B = "ddd.eee.fff"


@pytest.fixture(autouse=True)
def no_sdk(monkeypatch):
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", None)


class ToolUseBlock:
    def __init__(self, name, input):
        self.name, self.input = name, input


class AssistantMessage:
    def __init__(self, content):
        self.content = content


class ResultMessage:
    def __init__(self):
        self.usage, self.duration_api_ms, self.total_cost_usd, self.is_error = {}, 1000, 0.01, False


def good_input(symbol="US30"):
    return {"kind": "statement", "rows": [{
        "symbol": symbol, "side_written": "buy", "side_of": "position", "entry_price": 39012.5,
        "entry_time": "2026-03-04T01:15", "exit_price": 39100.0, "exit_time": "2026-03-04T06:40", "time_zone": "GMT",
        "qty": 0.5, "fees": None, "pnl_jpy": 6500, "exit_order_type": "unknown"}]}


class FakeCli:
    """偽の SDK の query。起動（startup 秒）→ prompt の最初の message → 筋書き"""

    def __init__(self, startup=0.0, script="tool"):
        self.startup = startup
        self.script = script
        self.spawned: list[dict] = []
        self.cleaned = 0
        self.prompt_errors: list[str] = []
        self.lock = threading.Lock()

    async def __call__(self, *, prompt, options):
        rec = {"options": options, "message": None, "token_at_send": None}
        with self.lock:
            self.spawned.append(rec)
        try:
            await anyio.sleep(self.startup)
            if self.script == "fail_startup":
                raise ConnectionError("startup failed SECRET")
            try:
                async with contextlib.aclosing(prompt) as stream:
                    async for m in stream:
                        rec["message"] = m
                        f = options["env"].get(agent_reader.IDENTITY_TOKEN_FILE_ENV)
                        if f:
                            rec["token_at_send"] = Path(f).read_text()
                        break
            except Exception as e:  # noqa: BLE001 - 本物の SDK と同じく prompt の例外を握る
                self.prompt_errors.append(type(e).__name__)
            if rec["message"] is None:
                return
            if self.script == "hang":
                await anyio.sleep(60)
            # 画像の印（data の先頭）を銘柄にして返す（取り違えを見分ける）
            data = rec["message"]["message"]["content"][0]["source"]["data"]
            yield AssistantMessage([ToolUseBlock(agent_reader.CLI_TOOL_NAME, good_input(symbol=f"S{len(data)}"))])
            yield ResultMessage()
        finally:
            with anyio.CancelScope(shield=True):
                await anyio.sleep(0.01)
                with self.lock:
                    self.cleaned += 1


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture
def make_pool(tmp_path):
    pools = []

    def make(cli, credential="api_key", secret="SECRET-X", timeout=5.0, **kw):
        p = warm.WarmPool(credential, secret, "claude-sonnet-5-5", "low", timeout=timeout,
                          tmp_parent=str(tmp_path / "t"), query_fn=cli, **kw)
        pools.append(p)
        return p

    yield make
    for p in pools:
        p.close()


def tmp_dirs(tmp_path) -> list[str]:
    d = tmp_path / "t"
    return sorted(os.listdir(d)) if d.exists() else []


def test_prepare_then_read_skips_startup(make_pool, tmp_path):
    cli = FakeCli(startup=0.5)
    pool = make_pool(cli)
    assert pool.prepare(5) is True
    t = time.monotonic()
    o = pool.read(PNG, "image/png")
    took = time.monotonic() - t
    sent = agent_reader.user_message(PNG, "image/png")["message"]["content"][0]["source"]["data"]
    assert o is not None and o.error is None and o.result["rows"][0]["symbol"] == f"S{len(sent)}"
    assert took < 0.5  # 起動（0.5 秒）を待たない
    assert len(cli.spawned) == 1 and cli.cleaned == 1
    # 結果を返す前に一時ディレクトリを消している
    assert tmp_dirs(tmp_path) == []


def test_slot_used_once_and_removed(make_pool, tmp_path):
    cli = FakeCli()
    pool = make_pool(cli)
    assert pool.prepare(5)
    assert pool.read(PNG, "image/png") is not None
    # 使った slot は捨てた: 次の読み取りの slot は無い（呼ぶ側がその場で立てる）
    assert pool.read(PNG, "image/png") is None
    assert len(cli.spawned) == 1 and tmp_dirs(tmp_path) == []
    # 次の準備で新しい slot（別の一時ディレクトリ）
    assert pool.prepare(5)
    assert pool.read(PNG, "image/png") is not None
    cwd = [r["options"]["cwd"] for r in cli.spawned]
    assert len(cwd) == 2 and cwd[0] != cwd[1]


def test_prepare_twice_starts_one(make_pool):
    cli = FakeCli(startup=0.1)
    pool = make_pool(cli)
    assert pool.prepare(5) and pool.prepare(5)
    assert len(cli.spawned) == 1
    assert all(r["message"] is None for r in cli.spawned)  # message は送っていない


def test_read_without_slot_is_none(make_pool):
    cli = FakeCli()
    pool = make_pool(cli)
    assert pool.read(PNG, "image/png") is None and cli.spawned == []


def test_read_takes_starting_slot_and_waits(make_pool):
    cli = FakeCli(startup=0.3)
    pool = make_pool(cli)
    assert pool.start() is True
    o = pool.read(PNG, "image/png")
    assert o is not None and o.error is None and len(cli.spawned) == 1


def test_concurrent_reads_take_only_one(make_pool):
    cli = FakeCli(startup=0.0)
    pool = make_pool(cli)
    assert pool.prepare(5)
    out: list = [None, None]

    def go(i):
        out[i] = pool.read(PNG + bytes([i]) * (i + 1), "image/png")

    ts = [threading.Thread(target=go, args=(i,)) for i in range(2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert sum(o is None for o in out) == 1
    got = next(o for o in out if o is not None)
    assert got.error is None


def test_expired_by_clock_is_discarded(make_pool, tmp_path):
    clock = Clock()
    cli = FakeCli()
    pool = make_pool(cli, clock=clock, ttl=600)
    assert pool.prepare(5)
    clock.t += 600
    assert pool.read(PNG, "image/png") is None
    deadline = time.monotonic() + 5
    # 一時ディレクトリは偽の CLI の後始末の後（WarmPool._run の finally）で消えるので、両方を待つ
    while (cli.cleaned < 1 or tmp_dirs(tmp_path)) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert cli.cleaned == 1 and tmp_dirs(tmp_path) == []


def test_ttl_expires_in_loop(make_pool, tmp_path):
    cli = FakeCli()
    pool = make_pool(cli, ttl=0.2)
    assert pool.prepare(5)
    deadline = time.monotonic() + 5
    # 一時ディレクトリは偽の CLI の後始末の後（WarmPool._run の finally）で消えるので、両方を待つ
    while (cli.cleaned < 1 or tmp_dirs(tmp_path)) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert cli.cleaned == 1 and tmp_dirs(tmp_path) == []
    assert pool.read(PNG, "image/png") is None


def test_failure_before_send_is_none(make_pool, tmp_path):
    cli = FakeCli(script="fail_startup")
    pool = make_pool(cli)
    assert pool.prepare(5) is False
    assert pool.read(PNG, "image/png") is None
    assert tmp_dirs(tmp_path) == []


def test_taken_slot_failing_before_send_is_none(make_pool, tmp_path):
    cli = FakeCli(startup=0.2, script="fail_startup")
    pool = make_pool(cli)
    pool.start()
    assert pool.read(PNG, "image/png") is None  # 送る前の失敗 → 呼ぶ側がその場で立てる
    assert tmp_dirs(tmp_path) == []


def test_timeout_counts_from_take(make_pool, tmp_path):
    cli = FakeCli(script="hang")
    pool = make_pool(cli, timeout=0.3)
    assert pool.prepare(5)
    t = time.monotonic()
    o = pool.read(PNG, "image/png")
    assert o is not None and o.error == "timeout"
    assert time.monotonic() - t < 3
    assert cli.cleaned == 1 and tmp_dirs(tmp_path) == []


def test_exception_after_send_is_type_name(make_pool):
    class Boom(FakeCli):
        async def __call__(self, *, prompt, options):
            async with contextlib.aclosing(prompt) as stream:
                async for _ in stream:
                    break
            raise ConnectionError("upstream said SECRET-BODY")
            yield  # pragma: no cover

    pool = make_pool(Boom())
    assert pool.prepare(5)
    o = pool.read(PNG, "image/png")
    assert o is not None and o.error == "ConnectionError" and "SECRET" not in repr(o)


def test_federation_writes_token_and_replaces_per_request(make_pool, tmp_path):
    tokens = iter([TOKEN_A])
    cli = FakeCli()
    fed = {"ANTHROPIC_FEDERATION_RULE_ID": "fdrl_example", "ANTHROPIC_ORGANIZATION_ID": "org-example"}
    pool = make_pool(cli, credential="federation", secret=fed, identity_token=lambda: next(tokens))
    assert pool.prepare(5)
    path = cli.spawned[0]["options"]["env"][agent_reader.IDENTITY_TOKEN_FILE_ENV]
    assert Path(path).read_text() == TOKEN_A
    assert oct(os.stat(path).st_mode & 0o777) == "0o600"
    o = pool.read(PNG, "image/png", identity_token=TOKEN_B)
    assert o is not None and o.error is None
    assert cli.spawned[0]["token_at_send"] == TOKEN_B
    assert not Path(path).exists() and tmp_dirs(tmp_path) == []


def test_federation_without_token_does_not_start(make_pool, tmp_path):
    def fail():
        raise RuntimeError("metadata")

    fed = {"ANTHROPIC_FEDERATION_RULE_ID": "fdrl_example", "ANTHROPIC_ORGANIZATION_ID": "org-example"}
    cli = FakeCli()
    pool = make_pool(cli, credential="federation", secret=fed, identity_token=fail)
    assert pool.prepare(5) is False
    assert cli.spawned == [] and tmp_dirs(tmp_path) == []


def test_child_env_same_as_reader(make_pool):
    cli = FakeCli()
    pool = make_pool(cli)
    assert pool.prepare(5)
    env = cli.spawned[0]["options"]["env"]
    base = str(Path(cli.spawned[0]["options"]["cwd"]).parent)
    want = agent_reader.option_kwargs("claude-sonnet-5-5", "low", "api_key", "SECRET-X", base)["env"]
    assert env == want


def test_close_cancels_slot(make_pool, tmp_path):
    cli = FakeCli()
    pool = make_pool(cli)
    assert pool.prepare(5)
    pool.close()
    assert cli.cleaned == 1 and tmp_dirs(tmp_path) == []
    assert pool.start() is False and pool.read(PNG, "image/png") is None


def test_repr_has_no_secret(make_pool):
    pool = make_pool(FakeCli())
    assert "SECRET" not in repr(pool)


# ── レビューの指摘 1: 送る前の段の失敗は例外にしない（SDK が prompt の例外の文言をログに出すため）──
def test_federation_missing_request_token_ends_without_exception(make_pool, tmp_path, capfd):
    fed = {"ANTHROPIC_FEDERATION_RULE_ID": "fdrl_example", "ANTHROPIC_ORGANIZATION_ID": "org-example"}
    cli = FakeCli()
    pool = make_pool(cli, credential="federation", secret=fed, identity_token=lambda: TOKEN_A)
    assert pool.prepare(5)
    assert pool.read(PNG, "image/png", identity_token=None) is None  # 呼ぶ側がその場で立てる
    assert cli.prompt_errors == []  # prompt の generator は例外を投げずに終えた
    assert cli.spawned[0]["message"] is None  # 何も送っていない
    assert tmp_dirs(tmp_path) == []
    _out, err = capfd.readouterr()
    assert "identity_token" not in err and "NoCredential" not in err


# ── レビューの指摘 2: close は取られて処理中の先立ても後始末し、asyncgen の警告を残さない ──
def test_close_cleans_in_flight_slot(make_pool, tmp_path):
    cli = FakeCli(script="hang")
    pool = make_pool(cli, timeout=30)
    assert pool.prepare(5)
    out: list = []
    t = threading.Thread(target=lambda: out.append(pool.read(PNG, "image/png")))
    t.start()
    deadline = time.monotonic() + 5
    while (not cli.spawned or cli.spawned[0]["message"] is None) and time.monotonic() < deadline:
        time.sleep(0.01)
    pool.close(wait=0.3)
    t.join(5)
    assert out and out[0] is not None and out[0].error == "timeout"
    assert cli.cleaned == 1 and tmp_dirs(tmp_path) == []


def test_no_unawaited_generator_warnings(tmp_path):
    # 先立てを使う・捨てる・閉じるを別の process で流し、終わりの警告（asyncgen の後始末の漏れ）が出ないこと
    import subprocess
    import textwrap

    code = textwrap.dedent(f'''
        import sys, warnings
        sys.path.insert(0, {str(Path(__file__).parent)!r})
        sys.modules["claude_agent_sdk"] = None
        warnings.simplefilter("always")
        import test_warm as t
        from statement_read import warm
        for script in ("tool", "hang"):
            cli = t.FakeCli(script=script)
            p = warm.WarmPool("api_key", "S", "m", "low", timeout=0.2, tmp_parent={str(tmp_path / "t")!r},
                              query_fn=cli)
            assert p.prepare(5)
            p.read(t.PNG, "image/png")
            assert p.prepare(5)
            p.close()
        import gc; gc.collect()
        print("done")
    ''')
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0 and "done" in r.stdout
    assert "never awaited" not in r.stderr and "was destroyed" not in r.stderr, r.stderr
