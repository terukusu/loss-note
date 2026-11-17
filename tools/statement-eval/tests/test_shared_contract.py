"""#11 の AC-4・AC-14 の下ごしらえ: 道具の読み取りの部品は共有のパッケージ（statement_read）と同じもの。

- 指示・決まった文・ツールの名前と説明・入力の形・結果の検査・送り口・向きの直しが、API と同じオブジェクト（写しでない）
- eval --preset app がアプリの設定（モデル・effort・締め切り）で読み、画像を縮めずに API と同じ上限で検査する
"""

import io
import json

import pytest
import statement_read.agent_reader as shared_reader
import statement_read.image as shared_image
import statement_read.prompt as shared_prompt
import statement_read.result as shared_result
import statement_read.values as shared_values
from statement_read import app_settings

from statement_eval import cli, images, prompt, reader, schema, score
from statement_eval.cli import SYNTHETIC_DIR, main
from statement_eval.reader import ReadOutcome


def test_prompt_is_the_shared_object():
    assert prompt.READ_SYSTEM is shared_prompt.READ_SYSTEM
    assert prompt.READ_USER_TEXT is shared_prompt.READ_USER_TEXT


def test_tool_shape_is_the_shared_object():
    assert schema.TOOL_NAME is shared_result.TOOL_NAME
    assert schema.TOOL_DESCRIPTION is shared_result.TOOL_DESCRIPTION
    assert schema.TOOL_INPUT_SCHEMA is shared_result.TOOL_INPUT_SCHEMA
    assert schema.check_result is shared_result.check_result
    assert schema.Bad is shared_result.Bad


def test_reader_and_values_are_shared():
    assert reader.Reader is shared_reader.Reader
    assert reader.option_kwargs is shared_reader.option_kwargs
    assert score.opened_side is shared_values.opened_side
    assert score.sum_fees is shared_values.sum_fees
    assert score.normalize_number is shared_values.normalize_number
    assert images.MAX_BYTES == shared_image.MAX_BYTES and images.MAX_EDGE == shared_image.MAX_EDGE


class _Recorder:
    def __init__(self):
        self.factory_args = None
        self.sent: list[tuple[bytes, str]] = []

    def factory(self, *a):
        self.factory_args = a
        return self

    def read(self, data: bytes, media_type: str) -> ReadOutcome:
        self.sent.append((data, media_type))
        return ReadOutcome(result=None, seconds=None, error="no_tool_call")


def test_preset_app_uses_app_settings_and_raw_images():
    rec = _Recorder()
    out = io.StringIO()
    code = main(["eval", "--set", "synthetic", "--preset", "app", "--credential", "api_key"],
                env={"ANTHROPIC_API_KEY": "k"}, reader_factory=rec.factory, out=out, err=io.StringIO())
    assert code == 0
    _cred, _secret, model, effort, _tmp, timeout = rec.factory_args
    assert (model, effort, timeout) == (app_settings.APP_MODEL, app_settings.APP_EFFORT,
                                        app_settings.APP_TIMEOUT_SECONDS)
    files = [im["file"] for im in json.loads((SYNTHETIC_DIR / "answers.json").read_text(encoding="utf-8"))["images"]]
    assert len(rec.sent) == len(files)
    for (data, mt), f in zip(rec.sent, files, strict=True):
        # 縮めずにそのまま送る（API と同じ。合成の明細は上限の内）
        assert data == (SYNTHETIC_DIR / f).read_bytes() and mt == "image/png"
        assert shared_image.check_limits(data, mt) is None
    assert app_settings.APP_MODEL in out.getvalue()


def test_default_timeout_is_none_without_preset():
    rec = _Recorder()
    code = main(["eval", "--set", "synthetic", "--credential", "api_key"], env={"ANTHROPIC_API_KEY": "k"},
                reader_factory=rec.factory, out=io.StringIO(), err=io.StringIO())
    assert code == 0
    assert rec.factory_args[2:4] == (cli.DEFAULT_MODEL, cli.DEFAULT_EFFORT) and rec.factory_args[5] is None


@pytest.mark.parametrize("extra", [["--model", "claude-opus-5-5"], ["--effort", "high"]])
def test_preset_app_excludes_model_and_effort(extra):
    out = io.StringIO()
    code = main(["eval", "--set", "synthetic", "--preset", "app", "--credential", "api_key", *extra],
                env={"ANTHROPIC_API_KEY": "k"}, reader_factory=lambda *a: pytest.fail("called"), out=out,
                err=io.StringIO())
    assert code == 2 and "--preset app" in out.getvalue()


def test_preset_app_rejects_image_over_limits(tmp_path, monkeypatch):
    import shutil

    for name in ("answers.json", "manifest.json"):
        shutil.copy(SYNTHETIC_DIR / name, tmp_path / name)
    files = [im["file"] for im in json.loads((tmp_path / "answers.json").read_text(encoding="utf-8"))["images"]]
    for f in files:
        shutil.copy(SYNTHETIC_DIR / f, tmp_path / f)
    (tmp_path / files[0]).write_bytes(b"GIF89a" + b"\x00" * 40)
    monkeypatch.setattr(cli, "SYNTHETIC_DIR", tmp_path)
    out = io.StringIO()
    code = main(["eval", "--set", "synthetic", "--preset", "app", "--credential", "api_key"],
                env={"ANTHROPIC_API_KEY": "k"}, reader_factory=lambda *a: pytest.fail("called"), out=out,
                err=io.StringIO())
    assert code == 2 and "上限の外" in out.getvalue()
