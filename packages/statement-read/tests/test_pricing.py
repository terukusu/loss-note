"""料金表と予約額の純関数（Issue #44 の AC-6）。値はすべて架空の使用量。

予約額は独立に組み立てた式（下）と比べる。単価は USD / 100 万トークン = µUSD / トークン。
"""

import json
import math
import random
import sys

import pytest

from statement_read import agent_reader, app_settings, image, pricing, prompt, result
from statement_read.values import Usage

SONNET = "claude-sonnet-5-5"


def test_image_bound_is_above_provider_cap():
    # ceil(2000 × 2000 / 750) = 5,334（提供元の 1 枚の上限 4,784 より大きい）
    assert pricing.IMAGE_TOKENS_BOUND == 5_334 == math.ceil(image.MAX_EDGE**2 / 750)
    assert pricing.IMAGE_TOKENS_BOUND > 4_784


def test_prompt_bytes_counts_all_text_sent():
    expected = (
        len(prompt.READ_SYSTEM.encode())
        + len(prompt.READ_USER_TEXT.encode())
        + len(result.TOOL_NAME.encode())
        + len(result.TOOL_DESCRIPTION.encode())
        + len(json.dumps(result.TOOL_INPUT_SCHEMA, ensure_ascii=False).encode())
    )
    assert pricing.prompt_bytes() == expected > 3_000


def test_reserve_is_upper_bound():
    """AC-6: 予約額 ≥ (画像の上界 + 指示などのバイト数 + CLI の上乗せ) × 入力の 2 倍 + 出力の上限 × 出力の単価"""
    inp, out = 2, 10  # Sonnet 5.5: 入力 $2・出力 $10 / 100 万トークン
    bound_in = 5_334 + pricing.prompt_bytes() + 20_000
    want = bound_in * inp * 2 + app_settings.APP_MAX_OUTPUT_TOKENS * out
    got = pricing.reserve_micro_usd(SONNET, app_settings.APP_MAX_OUTPUT_TOKENS)
    assert got >= want
    assert got == want  # 整数のまま計算できる（切り上げの余りが無い）
    # 最大出力を渡さなければモデルの最大出力（128,000）で数える
    assert pricing.reserve_micro_usd(SONNET) == bound_in * inp * 2 + 128_000 * out
    # 予約額は 0.30 USD より小さい（全体の上限 2.00 USD の中で同時に 6 枚まで送れる）
    assert got < 300_000
    assert 6 * got <= 2_000_000


def test_reserve_covers_any_usage_within_bounds():
    """性質: 入力の合計が上界以内・出力が上限以内のどんな使用量でも、料金表の額 ≤ 予約額"""
    reserve = pricing.reserve_micro_usd(SONNET, app_settings.APP_MAX_OUTPUT_TOKENS)
    rng = random.Random(44)
    bound_in = pricing.input_tokens_bound()
    for _ in range(2_000):
        total_in = rng.randint(0, bound_in)
        a = rng.randint(0, total_in)
        b = rng.randint(0, total_in - a)
        u = Usage(input_tokens=a, cache_creation_input_tokens=b, cache_read_input_tokens=total_in - a - b,
                  output_tokens=rng.randint(0, app_settings.APP_MAX_OUTPUT_TOKENS))
        assert pricing.cost_micro_usd(SONNET, u) <= reserve
    worst = Usage(cache_creation_input_tokens=bound_in, output_tokens=app_settings.APP_MAX_OUTPUT_TOKENS)
    assert pricing.cost_micro_usd(SONNET, worst) <= reserve


def test_output_cap_covers_longest_result():
    """最大出力は、最も長い形の結果（20 行・銘柄の名前 40 字の漢字・手数料 8 欄・桁の多い数）の JSON のバイト数
    （整形しても）より大きい（トークン数 ≤ バイト数）"""
    row = {
        "symbol": "漢" * result.MAX_SYMBOL_LEN, "side_written": "sell", "side_of": "position",
        "entry_price": -123456789.123456, "entry_time": "2026-11-18T23:59", "exit_price": -123456789.123456,
        "exit_time": "2026-11-18T23:59", "time_zone": "unknown", "qty": -123456789.123456,
        "fees": [-123456789.123456] * result.MAX_FEES, "pnl_jpy": -123456789.123456, "exit_order_type": "unknown",
    }
    longest = {"kind": "statement", "rows": [row] * result.MAX_ROWS}
    assert result.check_result(longest)["rows"]
    pretty = len(json.dumps(longest, ensure_ascii=False, indent=2).encode())
    assert pretty < app_settings.APP_MAX_OUTPUT_TOKENS


def test_cost_micro_usd_hand_examples():
    # 入力 1,500 × 2 + 出力 300 × 10 = 6,000 µUSD
    assert pricing.cost_micro_usd(SONNET, Usage(input_tokens=1500, output_tokens=300)) == 6_000
    # cache 作成 1,000 × 2 × 1.25 = 2,500、cache 読み 1,000 × 0.10 = 100
    assert pricing.cost_micro_usd(SONNET, Usage(cache_creation_input_tokens=1000,
                                                cache_read_input_tokens=1000)) == 2_600
    # 端数は切り上げ（cache 読み 1 × 0.10 = 0.1 → 1）
    assert pricing.cost_micro_usd(SONNET, Usage(cache_read_input_tokens=1)) == 1
    assert pricing.cost_micro_usd("unknown-model", Usage(input_tokens=1)) is None


def test_usd_to_micro():
    assert pricing.usd_to_micro(0.01) == 10_000
    assert pricing.usd_to_micro(0.0020001) == 2_001  # 切り上げ
    assert pricing.usd_to_micro(0.0) == 0
    assert pricing.usd_to_micro(-0.01) is None
    assert pricing.usd_to_micro(float("nan")) is None
    assert pricing.usd_to_micro(float("inf")) is None


def test_unknown_model_reserve_is_keyerror():
    with pytest.raises(KeyError):
        pricing.reserve_micro_usd("unknown-model")


def test_output_bound_is_min_of_cap_and_model():
    assert pricing.output_tokens_bound(SONNET) == 128_000
    assert pricing.output_tokens_bound(SONNET, 16_000) == 16_000
    assert pricing.output_tokens_bound(SONNET, 10**9) == 128_000


# ---- 子の CLI に最大出力を渡す（#44） ----


def test_child_env_sets_max_output_only_when_given():
    parent = {"PATH": "/bin", agent_reader.MAX_OUTPUT_ENV: "999999"}
    env = agent_reader.child_env("api_key", "S", "/b", parent_env=parent)
    # 親の値は使わせない（CLI の既定）。CLAUDE_* は資格情報・送り先の系統なので親から外し、子には名前ごと無い（#55）
    assert agent_reader.MAX_OUTPUT_ENV not in env
    scrubbed = dict(parent)
    agent_reader.scrub_process_env(scrubbed)
    assert agent_reader.MAX_OUTPUT_ENV not in agent_reader.spawn_env(scrubbed, env)
    env = agent_reader.child_env("api_key", "S", "/b", parent_env=parent, max_output_tokens=16_000)
    assert env[agent_reader.MAX_OUTPUT_ENV] == "16000"
    kw = agent_reader.option_kwargs("m", "low", "api_key", "S", "/b", max_output_tokens=16_000)
    assert kw["env"][agent_reader.MAX_OUTPUT_ENV] == "16000"


def test_reader_passes_max_output(monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", None)
    seen = {}

    async def q(*, prompt, options):
        seen["env"] = options["env"]
        async for _ in prompt:
            break
        return
        yield  # pragma: no cover

    r = agent_reader.Reader("api_key", "S", "m", "low", tmp_parent=str(tmp_path / "t"), query_fn=q,
                            max_output_tokens=16_000)
    r.read(b"\x89PNG\r\n\x1a\n", "image/png")
    assert seen["env"][agent_reader.MAX_OUTPUT_ENV] == "16000"
