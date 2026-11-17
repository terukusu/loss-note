"""起動の判定（純関数。ADR-0004）。

署名の無いエミュレーターのトークンを受けるのは、Auth と Firestore のエミュレーターの接続先があり、
プロジェクト ID が ``demo-`` で始まるときだけ。接続先があるのに ``demo-`` で始まらない設定では起動しない
（本物のプロジェクトで署名を検証しない状態を作らない）。``os.environ`` は読まない（呼ぶ側が渡す）。
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

AUTH_EMULATOR = "FIREBASE_AUTH_EMULATOR_HOST"
FIRESTORE_EMULATOR = "FIRESTORE_EMULATOR_HOST"
# Storage は firebase の名前と google-cloud-storage の名前の 2 つがある（どちらでも「接続先あり」とみなす）
STORAGE_EMULATORS = ("FIREBASE_STORAGE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST")
PROJECT_VARS = ("GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT")
DEMO_PREFIX = "demo-"

# firebase-admin と同じく host:port の形だけを受ける（// を含むものは受けない）
_HOST_PORT = re.compile(r"^[A-Za-z0-9.\-]+:\d{1,5}$|^\[[0-9A-Fa-f:]+\]:\d{1,5}$")

Mode = Literal["verify", "emulator", "unconfigured"]


@dataclass(frozen=True)
class Runtime:
    mode: Mode
    project_id: str


class StartupRefused(Exception):
    """この設定では起動しない（文言に環境変数の値を入れない。名前だけ）。"""


def project_id_of(env: Mapping[str, str]) -> str:
    for name in PROJECT_VARS:
        value = env.get(name) or ""
        if value:
            return value
    return ""


def decide_runtime(env: Mapping[str, str]) -> Runtime:
    auth = env.get(AUTH_EMULATOR) or ""
    firestore = env.get(FIRESTORE_EMULATOR) or ""
    storage = any(env.get(n) for n in STORAGE_EMULATORS)
    any_emulator = bool(auth or firestore or storage)
    project_id = project_id_of(env)
    demo = project_id.startswith(DEMO_PREFIX)

    if any_emulator and not demo:
        raise StartupRefused(
            "エミュレーターの接続先（FIREBASE_AUTH_EMULATOR_HOST・FIRESTORE_EMULATOR_HOST・"
            "FIREBASE_STORAGE_EMULATOR_HOST・STORAGE_EMULATOR_HOST）があるのに、"
            "プロジェクト ID（GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT）が demo- で始まりません"
        )
    if demo:
        if not (auth and firestore):
            raise StartupRefused(
                "プロジェクト ID が demo- で始まるときは、FIREBASE_AUTH_EMULATOR_HOST と "
                "FIRESTORE_EMULATOR_HOST の両方が要ります"
            )
        if not (_HOST_PORT.match(auth) and _HOST_PORT.match(firestore)):
            raise StartupRefused(
                "FIREBASE_AUTH_EMULATOR_HOST・FIRESTORE_EMULATOR_HOST は host:port の形で書いてください"
            )
        return Runtime("emulator", project_id)
    if not project_id:
        return Runtime("unconfigured", "")
    return Runtime("verify", project_id)
