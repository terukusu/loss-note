"""合成の明細（R6・AC-2・AC-3）。場面はタグを信じず、正解の中身と形から性質で確かめる"""

import io
import json
from decimal import Decimal
from pathlib import Path

import pytest
from PIL import Image

from statement_eval import images, schema, synthetic
from statement_eval.cli import SYNTHETIC_DIR, main

COMMITTED_ANSWERS = SYNTHETIC_DIR / "answers.json"
COMMITTED_MANIFEST = SYNTHETIC_DIR / "manifest.json"


def _dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def _committed():
    ans = json.loads(COMMITTED_ANSWERS.read_text(encoding="utf-8"))
    man = json.loads(COMMITTED_MANIFEST.read_text(encoding="utf-8"))
    forms = {im["file"]: im for im in man["images"]}
    return ans, forms


def test_at_least_12_images():
    ans, forms = _committed()
    assert len(ans["images"]) >= 12
    assert {im["file"] for im in ans["images"]} == set(forms)


def test_scenes_cover_all_nine():
    ans, forms = _committed()
    found: dict[str, set[str]] = {}

    def hit(scene, f):
        found.setdefault(scene, set()).add(f)

    for im in ans["images"]:
        f, rows = im["file"], im["rows"]
        form = forms[f]["form"]
        sides = {r["side"] for r in rows}
        if form == "form1" and "L" in sides:
            hit("form1_long", f)
        if form == "form1" and "S" in sides:
            hit("form1_short", f)
        if form == "form2_future" and "L" in sides:
            hit("form2_future_close_sell", f)
        if form == "form2_option" and "S" in sides:
            hit("form2_option_close_buy", f)
            assert all(any(k in r["symbol"] for k in (" P ", " C ")) and "/" in r["symbol"] for r in rows)
        days = [
            (int(r[k][8:10]), int(r[k][5:7]))
            for r in rows
            for k in ("entry_time", "exit_time")
        ]
        if any(d <= 12 and d != m for d, m in days):
            hit(f"day_le_12:{forms[f]['date_order']}", f)
        hit(f"rows:{len(rows)}", f)
        for r in rows:
            p = Decimal(r["pnl_jpy"])
            if p == 0:
                hit("pnl_zero", f)
            if p < 0:
                hit("pnl_loss", f)
            if r["exit_order_type"] in ("stop", "market"):
                hit(f"order_type:{r['exit_order_type']}", f)
            if "." in r["entry_price"] or "." in r["exit_price"]:
                hit("decimal", f)
            if abs(Decimal(r["pnl_jpy"])) >= 1_000_000 or abs(Decimal(r["qty"])) >= 1000:
                hit("big_number", f)
    for scene in (
        "form1_long", "form1_short", "form2_future_close_sell", "form2_option_close_buy",
        "day_le_12:DMY", "day_le_12:YMD", "rows:2", "rows:3", "pnl_zero", "pnl_loss",
        "order_type:stop", "order_type:market", "decimal", "big_number",
    ):
        assert found.get(scene), scene
    # manifest の場面 ID も 9 場面をすべて含む
    tagged = {sc for im in forms.values() for sc in im["scenes"]}
    assert tagged == set(synthetic.SCENES)


def test_answers_regenerate_identically():
    a1, a2 = _dump(synthetic.answers()), _dump(synthetic.answers())
    assert a1 == a2
    assert a1 == COMMITTED_ANSWERS.read_text(encoding="utf-8")
    assert _dump(synthetic.manifest()) == COMMITTED_MANIFEST.read_text(encoding="utf-8")


def test_generate_check_passes(capsys):
    assert main(["generate", "--check"]) == 0


def test_generate_check_detects_drift(tmp_path):
    (tmp_path / "manifest.json").write_text(COMMITTED_MANIFEST.read_text(encoding="utf-8"), encoding="utf-8")
    (tmp_path / "answers.json").write_text("{}\n", encoding="utf-8")
    assert main(["generate", "--check", "--out", str(tmp_path)], out=io.StringIO()) == 1


def test_answers_pass_check_answers():
    # 実物の正解（data/local/statement-eval/real/answers.json）と同じ形
    ans = json.loads(COMMITTED_ANSWERS.read_text(encoding="utf-8"))
    assert schema.check_answers(ans)["images"][0]["file"] == "s01.png"


def test_png_files_exist_and_fit_limits():
    ans, _ = _committed()
    total = 0
    for im in ans["images"]:
        p = Path(SYNTHETIC_DIR / im["file"])
        data = p.read_bytes()
        total += len(data)
        assert images.media_type_of(data) == "image/png"
        assert len(data) <= images.MAX_BYTES
        with Image.open(io.BytesIO(data)) as img:
            img.verify()
        with Image.open(io.BytesIO(data)) as img:
            assert max(img.size) <= images.MAX_EDGE
        assert images.fits(data)
    assert total <= 1_500_000


def test_side_words_follow_the_form():
    # 形 1 の「方向」は建玉そのものの向き、形 2 の「取引」は決済の向き
    for s in synthetic.STATEMENTS:
        lay = synthetic.layout(s)
        col = lay.columns.index("方向" if s.form == "form1" else "取引")
        for t, cells in zip(s.trades, lay.cells, strict=True):
            word = cells[col]
            if s.form == "form1":
                assert word == ("買約定" if t.side == "L" else "売約定")
            else:
                assert word == ("決済売" if t.side == "L" else "決済買")


def test_layout_shows_values_matching_answers():
    # 描く文字列から正解の数・日時が復元できる（桁区切りを外すと正解の数になる）
    from statement_eval.score import normalize_number, parse_statement_datetime

    for s in synthetic.STATEMENTS:
        lay = synthetic.layout(s)
        ans = synthetic.answers((s,))["images"][0]["rows"]
        for cells, a in zip(lay.cells, ans, strict=True):
            joined = [c.replace("\n", " ") for c in cells]
            nums = {normalize_number(c) for c in joined} - {None}
            for k in ("entry_price", "exit_price", "qty", "pnl_jpy"):
                assert normalize_number(a[k]) in nums
            order = "DMY" if s.form == "form1" else "YMD"
            times = {parse_statement_datetime(c, order) for c in joined if c.count(":") == 1 and "/" in c}
            assert {a["entry_time"], a["exit_time"]} <= times
            assert a["symbol"] in joined
            assert "合成・架空の値" in lay.title


# ---- 損益の計算（手計算の例） ----


def _t(**kw):
    base = dict(symbol="X", side="L", entry="100", exit="110", qty="2", entry_time="2026/01/05 09:00",
                exit_time="2026/01/05 10:00", multiplier="1")
    base.update(kw)
    return synthetic.Trade(**base)


def test_net_pnl_hand_examples():
    # L・倍率 1・利益: (110 − 100) × 2 × 1 = 20
    assert synthetic.net_pnl(_t()) == Decimal(20)
    # S・倍率 1・損失: (110 − 100) × 2 × 1 × (−1) = −20
    assert synthetic.net_pnl(_t(side="S")) == Decimal(-20)
    # L・倍率 150（外貨建ての円換算の代わり）・小数の価格: (151.534 − 151.234) × 1,000 × 150 = 45,000
    assert synthetic.net_pnl(_t(entry="151.234", exit="151.534", qty="1000", multiplier="150")) == Decimal(45000)
    # S・倍率 100・手数料つき利益: (38,900 − 38,610) × 1 × 100 − (38 + 3 + 38 + 3) = 29,000 − 82 = 28,918
    t = _t(side="S", entry="38900", exit="38610", qty="1", multiplier="100", fees=("38", "3", "38", "3"))
    assert synthetic.net_pnl(t) == Decimal(28918)
    # 建値 = 決済値: 0
    assert synthetic.net_pnl(_t(exit="100")) == Decimal(0)


def test_net_pnl_symmetry_and_linearity():
    for q in ("1", "2", "7"):
        lt, st = _t(qty=q, exit="137.5"), _t(qty=q, exit="137.5", side="S")
        assert synthetic.gross_pnl(lt) == -synthetic.gross_pnl(st)
        assert synthetic.gross_pnl(lt) == synthetic.gross_pnl(_t(qty="1", exit="137.5")) * Decimal(q)


# ---- 画像の縮小・manifest の検査 ----


def test_prepare_shrinks_large_image():
    img = Image.new("RGB", (3000, 1200), "white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    out, mt, shrunk = images.prepare(buf.getvalue())
    assert shrunk and mt == "image/png" and images.fits(out)


def test_prepare_rejects_when_still_too_big(monkeypatch):
    # 縮めても上限に収まらないときは、上限を超えたまま返さずに止まる
    monkeypatch.setattr(images, "MAX_BYTES", 10)
    data = (SYNTHETIC_DIR / "s01.png").read_bytes()
    with pytest.raises(ValueError, match="image_size"):
        images.prepare(data)


def test_prepare_rejects_non_image():
    with pytest.raises(ValueError, match="image_format"):
        images.prepare(b"GIF89a....")


def _broken_manifest_dir(tmp_path, text):
    import shutil

    shutil.copy(COMMITTED_ANSWERS, tmp_path / "answers.json")
    (tmp_path / "manifest.json").write_text(text, encoding="utf-8")
    return tmp_path


def test_eval_rejects_broken_manifest(tmp_path, monkeypatch):
    from statement_eval import cli

    for i, text in enumerate(["{not json", "{}", '{"images": [{"file": "s01.png"}]}', '{"images": 3}']):
        d = tmp_path / str(i)
        d.mkdir()
        monkeypatch.setattr(cli, "SYNTHETIC_DIR", _broken_manifest_dir(d, text))
        out = io.StringIO()
        code = main(["eval", "--set", "synthetic", "--credential", "api_key"], env={"ANTHROPIC_API_KEY": "k"},
                    reader_factory=lambda *a: pytest.fail("called"), out=out, err=io.StringIO())
        assert code == 2 and "manifest.json が不正です" in out.getvalue()
