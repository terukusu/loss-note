"""取引の文書の版（schemaVersion）の純関数（Issue #115。ADR-0020 の決定 7 の (a)・設計書 4.7）。

この版の API が知る版は ``SCHEMA_VERSION`` まで。保存済みの版がそれより大きい（新しい版の API が書いた）取引を
直すと、この版の知らない欄（レッグなど）を落として上書きしてしまうので、書き込みの入口は 409 で拒む。
int（bool を除く）で ``SCHEMA_VERSION`` 以下のときだけ知る版とし、形の崩れた値・無い値も知らない版として扱う
（上書きしない側に倒す）。
"""

SCHEMA_VERSION = 1


def is_known(doc: dict) -> bool:
    v = doc.get("schemaVersion")
    return type(v) is int and v <= SCHEMA_VERSION
