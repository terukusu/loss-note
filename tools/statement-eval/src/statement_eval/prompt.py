"""読み取りの指示（system）と、画像に添える決まった短い文。本体は共有のパッケージ（statement_read.prompt。#11）"""

from statement_read.prompt import READ_SYSTEM, READ_USER_TEXT

__all__ = ["READ_SYSTEM", "READ_USER_TEXT"]
