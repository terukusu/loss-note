"""合成の画像（PNG / JPEG の見出しだけ本物の形。中身は埋め草）と、チャートつきの取引を送る道具。値はすべて架空。

- ``png`` / ``jpeg``: 決済明細の読み取りのテスト（``test_statement_read.py``）とチャートのテストが共有する
- ``encode_multipart``: multipart の本文を自分で組み立てる（Werkzeug のテスト用の組み立ては大きな本文で一時ファイルを
  使うので、サーバー側の「一時ファイルを使わない」を確かめるテストを邪魔しないよう、バイト列で渡す）
- ``chart_count``: その利用者の保存先にあるチャートの枚数（記憶 = 件数、Firestore = ``users/{uid}/charts`` の文書の数）
"""

import json
import struct
import zlib

# 合成の画像に埋める印（画像のバイト列が応答・ログ・端末の保存先に出ていないかを探す。架空の文字列）
CHART_MARKER = b"CHARTMARK-9d3f"


def png(width: int, height: int, size: int | None = None, filler: bytes = b"\x00") -> bytes:
    ihdr = struct.pack(">II", width, height) + bytes([8, 2, 0, 0, 0])
    data = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + ihdr + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr))
    if size is not None:
        pad = size - len(data)
        data += (filler * (pad // len(filler) + 1))[:pad]
    return data


def jpeg(width: int, height: int, size: int, filler: bytes = b"\x00") -> bytes:
    sof_body = bytes([8]) + struct.pack(">HH", height, width) + bytes([1, 1, 0x11, 0])
    data = b"\xff\xd8" + b"\xff\xc0" + struct.pack(">H", len(sof_body) + 2) + sof_body + b"\xff\xda\x00\x02"
    pad = size - len(data)
    return data + (filler * (pad // len(filler) + 1))[:pad]


def chart_png(filler: bytes = CHART_MARKER, size: int = 3_000) -> bytes:
    return png(1200, 800, size=size, filler=filler)


def chart_jpeg(filler: bytes = b"\x11\x22", size: int = 3_000) -> bytes:
    return jpeg(1200, 800, size=size, filler=filler)


Part = tuple[str, bytes | str, str | None, str | None]  # (名前, 中身, ファイル名 or None, Content-Type or None)


def encode_multipart(parts: list[Part], boundary: str = "chartboundary7b1e") -> tuple[bytes, str]:
    out = bytearray()
    for name, value, filename, ctype in parts:
        out += f"--{boundary}\r\n".encode()
        disp = f'Content-Disposition: form-data; name="{name}"'
        if filename is not None:
            disp += f'; filename="{filename}"'
        out += disp.encode() + b"\r\n"
        if ctype is not None:
            out += f"Content-Type: {ctype}\r\n".encode()
        out += b"\r\n"
        out += value.encode() if isinstance(value, str) else value
        out += b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def chart_parts(record: dict | str | None, charts: dict[str, tuple[bytes, str]] | None = None) -> list[Part]:
    """record（JSON にする）と、枠ごとのチャート {"entry": (バイト列, 形式)} を部分に並べる"""
    parts: list[Part] = []
    if record is not None:
        parts.append(("record", record if isinstance(record, str) else json.dumps(record), None, None))
    for slot, (data, ctype) in (charts or {}).items():
        parts.append((f"{slot}Chart", data, "chart", ctype))
    return parts


def post_multipart(api, uid: str | None, parts: list[Part], path: str = "/api/trades"):
    body, ctype = encode_multipart(parts)
    return api.call("POST", path, uid, raw=body, content_type=ctype)


def post_with_charts(api, uid: str, record: dict, charts: dict[str, tuple[bytes, str]]):
    return post_multipart(api, uid, chart_parts(record, charts))


def chart_count(api, uid: str) -> int:
    if api.kind == "memory":
        return api.store.count(uid, "charts")
    return len(list(api.store._db().collection("users").document(uid).collection("charts").stream()))


def stored_chart(api, uid: str, doc_id: str) -> dict | None:
    """保存先のチャートの文書（読み戻しの API を通さずに、置き場の中身を見る）"""
    if api.kind == "memory":
        return api.store.users.get(uid, {}).get("charts", {}).get(doc_id)
    snap = api.store._db().collection("users").document(uid).collection("charts").document(doc_id).get()
    return snap.to_dict() if snap.exists else None
