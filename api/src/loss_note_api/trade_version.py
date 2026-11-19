"""取引の文書の版（schemaVersion）の純関数（Issue #115・#116。ADR-0020 の決定 7・設計書 4.7）。

版は本文の形で決める: レッグ（``record.legs``）を持つ文書だけ 2、レッグの無い文書（先物・現物・CFD・前からの
オプションの取引）は 1 のまま（#116。直しても 1 のまま。2 にすると、前の版へ戻したときに先物の取引まで (a) の 409 で
直せなくなるため）。

この版の API が知る版は ``SCHEMA_VERSION`` まで。保存済みの版がそれより大きい（新しい版の API が書いた）取引を
直すと、この版の知らない欄を落として上書きしてしまうので、書き込みの入口は 409 で拒む（(a)。#115）。
int（bool を除く）で ``SCHEMA_VERSION`` 以下のときだけ知る版とし、形の崩れた値・無い値も知らない版として扱う
（上書きしない側に倒す）。
"""

# レッグの無い文書の版
LEGACY_VERSION = 1
# レッグを持つ文書の版（#116）
LEGS_VERSION = 2
# この版の API が知る最大の版
SCHEMA_VERSION = LEGS_VERSION


def is_known(doc: dict) -> bool:
    v = doc.get("schemaVersion")
    return type(v) is int and v <= SCHEMA_VERSION


def version_of(record: dict) -> int:
    """保存する record の形から版を決める（レッグを持てば 2、無ければ 1）"""
    return LEGS_VERSION if "legs" in record else LEGACY_VERSION
