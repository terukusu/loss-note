"""画像の上限と寸法の読み取り（Issue #11 の例 #29〜#32。AC-2 の純関数の側）。画像は合成のバイト列"""

import random
import struct
import zlib

import pytest

from statement_read import image

WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 32
GIF = b"GIF89a" + b"\x00" * 32


def png(width: int, height: int, size: int | None = None) -> bytes:
    """署名 + IHDR（+ 長さをそろえる詰め物）。寸法を読むのに要る部分だけの合成の PNG"""
    ihdr = struct.pack(">II", width, height) + bytes([8, 2, 0, 0, 0])
    chunk = struct.pack(">I", len(ihdr)) + b"IHDR" + ihdr + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr))
    data = image.PNG_SIG + chunk
    if size is not None:
        assert size >= len(data)
        data += b"\x00" * (size - len(data))
    return data


def jpeg(width: int, height: int, size: int | None = None, sof: int = 0xC0, before: bytes = b"") -> bytes:
    """SOI + APP0 + (前置きの segment) + SOFn。寸法を読むのに要る部分だけの合成の JPEG"""
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00" + b"\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof_body = bytes([8]) + struct.pack(">HH", height, width) + bytes([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
    sof_seg = bytes([0xFF, sof]) + struct.pack(">H", len(sof_body) + 2) + sof_body
    data = b"\xff\xd8" + app0 + before + sof_seg + b"\xff\xda" + struct.pack(">H", 2)
    if size is not None:
        assert size >= len(data)
        data += b"\x00" * (size - len(data))
    return data


# ---- image_info ----


def test_png_dimensions():
    assert image.image_info(png(1600, 900)) == ("image/png", 1600, 900)


@pytest.mark.parametrize("sof", [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xCF])
def test_jpeg_dimensions(sof):
    assert image.image_info(jpeg(1200, 800, sof=sof)) == ("image/jpeg", 1200, 800)


def test_jpeg_skips_non_frame_markers():
    # DHT（C4）は SOF ではない。寸法は後ろの SOF0 から取る
    dht = b"\xff\xc4" + struct.pack(">H", 2 + 5) + struct.pack(">HH", 7777, 7777) + b"\x00"
    fill = b"\xff\xff"  # 詰め物の FF は飛ばす
    assert image.image_info(jpeg(640, 480, before=dht + fill)) == ("image/jpeg", 640, 480)


@pytest.mark.parametrize(
    "data",
    [
        b"",
        image.PNG_SIG,
        image.PNG_SIG + b"\x00\x00\x00\x0dIHDR\x00\x00",  # 途中で切れている
        image.PNG_SIG + b"\x00\x00\x00\x0cIHDR" + b"\x00" * 13,  # IHDR の長さが 13 でない
        image.PNG_SIG + b"\x00\x00\x00\x0dIDAT" + b"\x00" * 13,  # 最初のチャンクが IHDR でない
        b"\xff\xd8\xff",
        b"\xff\xd8\xff\xe0\x00",  # 長さが切れている
        b"\xff\xd8\xff\xe0\x00\x01",  # 長さが 2 未満
        b"\xff\xd8\xff\xda\x00\x02",  # SOF より前に SOS
        b"\xff\xd8\xff\xd9",  # SOF より前に EOI
        b"\xff\xd8\xff\xc0\x00\x11\x08\x01",  # SOF の中身が切れている
        WEBP,
        GIF,
    ],
)
def test_unreadable_is_none(data):
    assert image.image_info(data) is None


def test_never_raises_on_random_bytes():
    # 性質: どんなバイト列でも例外を出さず、None か (形式, 幅, 高さ) を返す
    rng = random.Random(20261118)
    heads = [image.PNG_SIG, b"\xff\xd8\xff", b"\xff\xd8", b""]
    for _ in range(3000):
        head = rng.choice(heads)
        data = head + bytes(rng.randrange(256) for _ in range(rng.randrange(0, 40)))
        got = image.image_info(data)
        assert got is None or (got[0] in ("image/png", "image/jpeg") and got[1] >= 0 and got[2] >= 0)


def test_truncation_of_valid_images_is_none():
    for full in (png(100, 50), jpeg(100, 50)):
        for n in range(len(full) - 1):
            got = image.image_info(full[:n])
            assert got is None or got == image.image_info(full)


# ---- check_limits（例 #29〜#32） ----


def test_example_29_png_1600x900_300000_bytes_passes():
    data = png(1600, 900, size=300_000)
    assert len(data) == 300_000
    assert image.check_limits(data, "image/png") is None


@pytest.mark.parametrize("w,h", [(2001, 900), (900, 2001)])
def test_example_30_long_edge_2001_rejected(w, h):
    assert image.check_limits(png(w, h), "image/png") == "dimensions"


def test_example_31_jpeg_500001_bytes_rejected():
    data = jpeg(1200, 800, size=500_001)
    assert image.check_limits(data, "image/jpeg") == "bytes"


@pytest.mark.parametrize(
    "data,ct,reason",
    [
        (WEBP, "image/webp", "format"),
        (WEBP, "image/png", "format"),
        (GIF, "image/gif", "format"),
        (b"", "image/png", "format"),
        (image.PNG_SIG + b"\x00" * 30, "image/png", "dimensions"),  # PNG の署名だが寸法を読めない
    ],
)
def test_example_32_rejected(data, ct, reason):
    assert image.check_limits(data, ct) == reason


def test_boundaries_pass():
    assert image.check_limits(png(2000, 2000, size=500_000), "image/png") is None
    assert image.check_limits(jpeg(2000, 1, size=500_000), "image/jpeg") is None


@pytest.mark.parametrize("w,h", [(0, 900), (900, 0)])
def test_zero_dimension_rejected(w, h):
    assert image.check_limits(png(w, h), "image/png") == "dimensions"


def test_content_type_must_match_signature():
    assert image.check_limits(png(10, 10), "image/jpeg") == "format"
    assert image.check_limits(jpeg(10, 10), "image/png") == "format"
    assert image.check_limits(png(10, 10), None) == "format"
    assert image.check_limits(png(10, 10), "application/octet-stream") == "format"


def test_content_type_parameters_and_case_ignored():
    assert image.check_limits(png(10, 10), "Image/PNG; charset=binary") is None


def test_bytes_checked_before_format():
    # 大きすぎるものは中身を見ずに bytes（WebP でも）
    assert image.check_limits(WEBP + b"\x00" * 500_000, "image/webp") == "bytes"
