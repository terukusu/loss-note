"""送る前の画像の確認と縮小（メモリ上だけ。ディスクに書かない）。上限は option-simulator の ADR-0009 と同じ"""

import io

MAX_EDGE = 2000
MAX_BYTES = 500_000
PNG_SIG = b"\x89PNG\r\n\x1a\n"
JPEG_SIG = b"\xff\xd8\xff"


def media_type_of(data: bytes) -> str | None:
    if data.startswith(PNG_SIG):
        return "image/png"
    if data.startswith(JPEG_SIG):
        return "image/jpeg"
    return None


def fits(data: bytes) -> bool:
    """形式・バイト数・長辺が上限の中か"""
    from PIL import Image

    if media_type_of(data) is None or len(data) > MAX_BYTES:
        return False
    with Image.open(io.BytesIO(data)) as im:
        return max(im.size) <= MAX_EDGE


def prepare(data: bytes) -> tuple[bytes, str, bool]:
    """(送るバイト, media_type, 縮めたか)。上限を超えたら長辺 ≤ MAX_EDGE・≤ MAX_BYTES の PNG に作り直す。
    PNG / JPEG でなければ ValueError("image_format")、縮めても上限に収まらなければ ValueError("image_size")
    （値・ファイル名は持たない）"""
    from PIL import Image

    mt = media_type_of(data)
    if mt is None:
        raise ValueError("image_format")
    if fits(data):
        return data, mt, False
    with Image.open(io.BytesIO(data)) as src:
        im = src.convert("RGB")
    scale = min(1.0, MAX_EDGE / max(im.size))
    while True:
        size = (max(1, int(im.width * scale)), max(1, int(im.height * scale)))
        buf = io.BytesIO()
        im.resize(size, Image.Resampling.LANCZOS).save(buf, format="PNG", optimize=True)
        out = buf.getvalue()
        if len(out) <= MAX_BYTES:
            return out, "image/png", True
        if min(size) <= 64:  # これ以上縮めると読めない。上限を超えたまま送らない
            raise ValueError("image_size")
        scale *= 0.85
