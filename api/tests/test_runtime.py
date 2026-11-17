"""起動の判定 decide_runtime（契約 2・AC-4・ADR-0004）。

接続先のどれかがあり、プロジェクト ID が demo- で始まらなければ必ず起動しない。
"""

import itertools

import pytest

from loss_note_api.app import create_app
from loss_note_api.runtime import Runtime, StartupRefused, decide_runtime

AUTH = "FIREBASE_AUTH_EMULATOR_HOST"
FS = "FIRESTORE_EMULATOR_HOST"
STORAGE = "FIREBASE_STORAGE_EMULATOR_HOST"
STORAGE_GCS = "STORAGE_EMULATOR_HOST"


def test_verify_when_no_emulator_and_real_project():
    assert decide_runtime({"GOOGLE_CLOUD_PROJECT": "example-prod"}) == Runtime("verify", "example-prod")


def test_gcloud_project_is_used_when_google_cloud_project_is_missing():
    assert decide_runtime({"GCLOUD_PROJECT": "example-prod"}) == Runtime("verify", "example-prod")


def test_unconfigured_when_nothing():
    assert decide_runtime({}) == Runtime("unconfigured", "")
    assert decide_runtime({"GOOGLE_CLOUD_PROJECT": "", AUTH: "", FS: ""}) == Runtime("unconfigured", "")


def test_emulator_when_both_hosts_and_demo_project():
    env = {AUTH: "127.0.0.1:9099", FS: "127.0.0.1:8080", "GCLOUD_PROJECT": "demo-loss-note"}
    assert decide_runtime(env) == Runtime("emulator", "demo-loss-note")


@pytest.mark.parametrize("project", ["example-prod", "", "demo", "Demo-x", "xdemo-x", "prod-demo-x"])
@pytest.mark.parametrize("hosts", [{AUTH: "127.0.0.1:9099"}, {FS: "127.0.0.1:8080"}, {STORAGE: "127.0.0.1:9199"}])
def test_refuses_emulator_with_non_demo_project(project, hosts):
    env = {**hosts, "GOOGLE_CLOUD_PROJECT": project}
    with pytest.raises(StartupRefused):
        decide_runtime(env)
    # アプリの組み立てごと失敗し、要求を受ける状態にならない（AC-4）
    with pytest.raises(StartupRefused):
        create_app(env)


def test_refused_message_does_not_contain_values():
    env = {AUTH: "10.0.0.1:9099", "GOOGLE_CLOUD_PROJECT": "example-secret-project"}
    with pytest.raises(StartupRefused) as e:
        decide_runtime(env)
    assert "example-secret-project" not in str(e.value)
    assert "10.0.0.1" not in str(e.value)


@pytest.mark.parametrize(
    "env",
    [
        {AUTH: "127.0.0.1:9099", "GOOGLE_CLOUD_PROJECT": "demo-x"},
        {FS: "127.0.0.1:8080", "GOOGLE_CLOUD_PROJECT": "demo-x"},
        {"GOOGLE_CLOUD_PROJECT": "demo-x"},
        {STORAGE: "127.0.0.1:9199", "GOOGLE_CLOUD_PROJECT": "demo-x"},
    ],
)
def test_demo_project_needs_both_auth_and_firestore(env):
    with pytest.raises(StartupRefused):
        decide_runtime(env)


@pytest.mark.parametrize("bad", ["http://127.0.0.1:9099", "127.0.0.1", "//x:1", "127.0.0.1:port"])
def test_refuses_malformed_host(bad):
    env = {AUTH: bad, FS: "127.0.0.1:8080", "GOOGLE_CLOUD_PROJECT": "demo-x"}
    with pytest.raises(StartupRefused):
        decide_runtime(env)
    env = {AUTH: "127.0.0.1:9099", FS: bad, "GOOGLE_CLOUD_PROJECT": "demo-x"}
    with pytest.raises(StartupRefused):
        decide_runtime(env)


def test_google_cloud_project_wins_over_gcloud_project():
    # 片方が本物の ID なら、エミュレーターの接続先があると起動しない（閉じる側に倒す）
    env = {AUTH: "127.0.0.1:9099", FS: "127.0.0.1:8080", "GOOGLE_CLOUD_PROJECT": "example-prod",
           "GCLOUD_PROJECT": "demo-x"}
    with pytest.raises(StartupRefused):
        decide_runtime(env)


def test_property_emulator_never_with_non_demo_project():
    """性質: 接続先の組み合わせ × プロジェクト ID の候補を総当たりし、emulator を返すのは demo- のときだけ。
    接続先のどれかがあり demo- で無ければ必ず StartupRefused"""
    host_values = ["", "127.0.0.1:9099", "localhost:1", "http://x:1"]
    projects = ["", "demo-loss-note", "demo-", "example-prod", "demo", " demo-x", "DEMO-x"]
    names = [AUTH, FS, STORAGE, STORAGE_GCS]
    for values in itertools.product(host_values, repeat=len(names)):
        for gcp, gcloud in itertools.product(projects, repeat=2):
            env = {n: v for n, v in zip(names, values, strict=True) if v}
            if gcp:
                env["GOOGLE_CLOUD_PROJECT"] = gcp
            if gcloud:
                env["GCLOUD_PROJECT"] = gcloud
            pid = gcp or gcloud
            any_host = any(values)
            try:
                rt = decide_runtime(env)
            except StartupRefused:
                continue
            if any_host:
                assert pid.startswith("demo-"), env
            if rt.mode == "emulator":
                assert pid.startswith("demo-") and env.get(AUTH) and env.get(FS), env
            if rt.mode == "verify":
                assert not any_host and pid and not pid.startswith("demo-"), env
            if rt.mode == "unconfigured":
                assert not any_host and not pid, env
