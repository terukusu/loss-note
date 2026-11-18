"""合成の明細の配置（synthetic.Layout）を PNG に描く（Pillow）。I/O はここだけ。

日本語のフォントは --font で渡すか、代表的な置き場所（IPA ゴシック・Noto Sans CJK）から探す。見つからなければ止まる。
フォントはコミットしない（描いた画像だけをコミットする）。画像のバイトはフォントの版で変わりうるので、
作り直したときにバイトの一致は求めない（正解と manifest は一致を求める）。
"""

import io
from pathlib import Path

from .synthetic import Layout

FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
)
FONT_SIZE = 17
PAD_X = 10
LINE_GAP = 4
MARGIN = 24
GRID = (190, 190, 190)
HEAD_BG = (238, 238, 238)
INK = (20, 20, 20)
SUB_INK = (90, 90, 90)


class FontNotFound(RuntimeError):
    pass


def find_font(explicit: str | None = None) -> str:
    if explicit:
        if not Path(explicit).is_file():
            raise FontNotFound("--font のファイルがありません")
        return explicit
    for c in FONT_CANDIDATES:
        if Path(c).is_file():
            return c
    raise FontNotFound("日本語のフォントが見つかりません。--font <パス> で渡してください")


def render_png(lay: Layout, font_path: str) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.truetype(font_path, FONT_SIZE)
    title_font = ImageFont.truetype(font_path, FONT_SIZE + 5)
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))

    def text_w(s: str, f) -> int:
        return max((int(probe.textlength(line, font=f)) for line in s.split("\n")), default=0)

    line_h = FONT_SIZE + LINE_GAP
    widths = [
        max(text_w(c, font) for c in [col, *(row[i] for row in lay.cells)]) + PAD_X * 2
        for i, col in enumerate(lay.columns)
    ]

    def row_h(cells) -> int:
        return max(c.count("\n") + 1 for c in cells) * line_h + 12

    head_h = row_h(lay.columns)
    body_hs = [row_h(r) for r in lay.cells]
    table_w = sum(widths)
    width = table_w + MARGIN * 2
    # 上部に会社の名前（架空。#66）の 1 行
    issuer_h = line_h + 6 if lay.issuer else 0
    top = MARGIN + issuer_h + (FONT_SIZE + 5) + 10 + line_h + 14
    height = top + head_h + sum(body_hs) + MARGIN
    width = max(width, text_w(lay.issuer, font) + MARGIN * 2)
    img = Image.new("RGB", (width, height), "white")
    d = ImageDraw.Draw(img)
    if lay.issuer:
        d.text((MARGIN, MARGIN), lay.issuer, font=font, fill=INK)
    d.text((MARGIN, MARGIN + issuer_h), lay.title, font=title_font, fill=INK)
    d.text((MARGIN, MARGIN + issuer_h + FONT_SIZE + 5 + 10), lay.subtitle, font=font, fill=SUB_INK)

    def draw_row(y: int, cells, h: int, head: bool) -> None:
        x = MARGIN
        if head:
            d.rectangle([MARGIN, y, MARGIN + table_w, y + h], fill=HEAD_BG)
        for w, c in zip(widths, cells, strict=True):
            lines = c.split("\n")
            ty = y + (h - len(lines) * line_h) // 2 + 2
            for line in lines:
                lw = int(d.textlength(line, font=font))
                # 数は右寄せ、文字は左寄せ（明細の見た目に寄せる）
                numeric = bool(line) and all(ch in "0123456789,.-" for ch in line)
                tx = x + w - PAD_X - lw if numeric and not head else x + PAD_X
                d.text((tx, ty), line, font=font, fill=INK)
                ty += line_h
            d.rectangle([x, y, x + w, y + h], outline=GRID)
            x += w

    y = top
    draw_row(y, lay.columns, head_h, True)
    y += head_h
    for cells, h in zip(lay.cells, body_hs, strict=True):
        draw_row(y, cells, h, False)
        y += h
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
