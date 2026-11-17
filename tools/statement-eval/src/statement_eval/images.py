"""送る前の画像の確認と縮小（メモリ上だけ。ディスクに書かない）。上限と形式の判定は共有のパッケージ
（statement_read.image。API と同じ。option-simulator の ADR-0009 と同じ上限）。

上限の名前（MAX_EDGE・MAX_BYTES）はこのモジュールの名前として持ち、fits・prepare はこの名前を見る（テストが差し替える）
"""

import io

from statement_read.image import JPEG_SIG, MAX_BYTES, MAX_EDGE, PNG_SIG, media_type_of

__all__ = ["JPEG_SIG", "MAX_BYTES", "MAX_EDGE", "PNG_SIG", "fits", "media_type_of", "prepare"]


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
