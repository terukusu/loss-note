from loss_note_api.app import create_app


def client():
    return create_app().test_client()


def test_health_returns_ok_json():
    res = client().get("/api/health")
    assert res.status_code == 200
    assert res.mimetype == "application/json"
    assert res.get_json() == {"status": "ok"}


def test_health_ignores_query():
    res = client().get("/api/health?x=1")
    assert res.status_code == 200
    assert res.get_json() == {"status": "ok"}


def test_unknown_path_is_404():
    res = client().get("/api/unknown")
    assert res.status_code == 404
