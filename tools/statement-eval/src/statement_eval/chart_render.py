"""合成のチャート（chart_synthetic.ChartCase）を PNG に描く（Pillow）。I/O はここだけ。

ろうそく足・格子・凡例（時間足の表示）を描く。価格の目盛りの数は描かない（K11: チャートから価格は読まない）。
フォントは明細の合成と同じ探し方（render.find_font）。画像のバイトはフォントの版で変わりうるので、作り直したときに
バイトの一致は求めない（正解と manifest は一致を求める）。
"""

import io

from .chart_synthetic import TOOLBAR, ChartCase, candles, header

W, H = 1000, 560
MARGIN = 24
TOP = 70
LIGHT = {"bg": (255, 255, 255), "grid": (232, 232, 232), "ink": (30, 30, 30), "up": (38, 166, 154),
         "down": (239, 83, 80), "sub": (110, 110, 110), "sel": (41, 98, 255)}
DARK = {"bg": (19, 23, 34), "grid": (42, 46, 57), "ink": (215, 218, 224), "up": (38, 166, 154),
        "down": (239, 83, 80), "sub": (140, 145, 155), "sel": (41, 98, 255)}


def _plot(d, case: ChartCase, box: tuple[int, int, int, int], pal: dict, seed_shift: int = 0) -> None:
    x0, y0, x1, y1 = box
    for i in range(1, 6):
        y = y0 + (y1 - y0) * i // 6
        d.line([(x0, y), (x1, y)], fill=pal["grid"])
    for i in range(1, 8):
        x = x0 + (x1 - x0) * i // 8
        d.line([(x, y0), (x, y1)], fill=pal["grid"])
    cs = candles(case.seed + seed_shift)
    lo = min(c.low for c in cs)
    hi = max(c.high for c in cs)
    span = (hi - lo) or 1.0

    def py(v: float) -> float:
        return y1 - 8 - (v - lo) / span * (y1 - y0 - 16)

    step = (x1 - x0 - 16) / len(cs)
    for i, c in enumerate(cs):
        cx = x0 + 8 + step * (i + 0.5)
        col = pal["up"] if c.close >= c.open else pal["down"]
        d.line([(cx, py(c.high)), (cx, py(c.low))], fill=col, width=1)
        top, bot = py(max(c.open, c.close)), py(min(c.open, c.close))
        d.rectangle([cx - step * 0.35, top, cx + step * 0.35, max(bot, top + 1)], fill=col)


def render_chart_png(case: ChartCase, font_path: str) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    pal = DARK if case.dark else LIGHT
    font = ImageFont.truetype(font_path, 18)
    small = ImageFont.truetype(font_path, 15)
    img = Image.new("RGB", (W, H), pal["bg"])
    d = ImageDraw.Draw(img)
    if case.style == "not_chart":
        # チャートでない画像（表の形の文字。架空の値）
        rows = (("項目", "値"), ("取引", "決済売"), ("数量", "1"), ("備考", "合成・架空の値"))
        for i, (a, b) in enumerate(rows):
            y = MARGIN + 40 * i
            d.rectangle([MARGIN, y, W - MARGIN, y + 40], outline=pal["grid"])
            d.text((MARGIN + 10, y + 10), a, font=font, fill=pal["ink"])
            d.text((W // 2, y + 10), b, font=font, fill=pal["ink"])
        return _png(img)
    if case.style == "two_panes":
        left, right = (case.label or "|").split("|")
        mid = W // 2
        d.text((MARGIN, 20), f"{case.symbol} · {left}", font=font, fill=pal["ink"])
        d.text((mid + MARGIN, 20), f"{case.symbol} · {right}", font=font, fill=pal["ink"])
        _plot(d, case, (MARGIN, TOP, mid - MARGIN // 2, H - MARGIN), pal)
        _plot(d, case, (mid + MARGIN // 2, TOP, W - MARGIN, H - MARGIN), pal, seed_shift=100)
        return _png(img)
    text = header(case)
    if case.style == "toolbar":
        # 時間足のボタンの並び。選ばれているもの（case.label）だけを枠で囲む
        x = MARGIN
        for tf in TOOLBAR:
            w = int(d.textlength(tf, font=small)) + 16
            if tf == case.label:
                d.rounded_rectangle([x, 8, x + w, 34], radius=4, fill=pal["sel"])
                d.text((x + 8, 12), tf, font=small, fill=(255, 255, 255))
            else:
                d.text((x + 8, 12), tf, font=small, fill=pal["sub"])
            x += w + 6
        if text:
            d.text((MARGIN, 42), text, font=small, fill=pal["ink"])
    elif text:
        d.text((MARGIN, 24), text, font=font, fill=pal["ink"])
    _plot(d, case, (MARGIN, TOP, W - MARGIN, H - MARGIN), pal)
    return _png(img)


def _png(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
