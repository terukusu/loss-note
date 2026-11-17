"""記録の API（取引・銘柄・設定。Issue #4・設計書 4 章・ADR-0004）。

入口で ID トークンを検証してから処理する（認証の前に ID の形も存在も見ない → 未認証は常に 401）。
読み書きは検証できた uid の場所だけ。ほかの利用者の資源は、あるか無いかも分からない 404 にする。
判定・R・損益は保存しない（4.2 導出。画面が ``core/record.ts`` の ``toTradeInput`` で計算の入力に写す）。
"""

from collections.abc import Callable

from flask import Blueprint, Response, g, jsonify, request

from loss_note_api import schema
from loss_note_api.auth import AuthUnavailable, InvalidToken, TokenVerifier, bearer_token
from loss_note_api.logs import log_event
from loss_note_api.store import Conflict, MissingInstrument, Store, StoreUnavailable

SCHEMA_VERSION = 1
DEFAULT_SETTINGS = {"capitalYen": None, "riskTolerancePct": 1, "performanceUnit": "R"}
_INSTRUMENT_SNAPSHOT_KEYS = ("multiplier", "quantityStep", "priceCurrency", "underlyingKind", "productForm")


def error(status: int, code: str, **extra) -> Response:
    res = jsonify({"error": code, **extra})
    res.status_code = status
    if status == 401:
        res.headers["WWW-Authenticate"] = "Bearer"
    return res


def invalid(issues: list[dict]) -> Response:
    return error(400, "invalid", issues=issues)


def read_body() -> tuple[object | None, Response | None]:
    try:
        raw = request.get_data(cache=False)
        return schema.parse_json_body(raw, request.headers.get("Content-Type")), None
    except schema.BodyError as e:
        return None, invalid([{"field": "", "kind": e.kind}])


def valid_id(value: str) -> bool:
    return bool(schema.ID_PATTERN.match(value))


def instrument_snapshot(instrument: dict) -> dict:
    return {k: instrument[k] for k in _INSTRUMENT_SNAPSHOT_KEYS}


def trade_response(trade_id: str, doc: dict) -> dict:
    return {
        "id": trade_id,
        "schemaVersion": doc["schemaVersion"],
        "createdAt": doc["createdAt"],
        "updatedAt": doc["updatedAt"],
        "snapshot": doc["snapshot"],
        "record": doc["record"],
    }


def instrument_response(instrument_id: str, doc: dict) -> dict:
    return {"id": instrument_id, **{k: v for k, v in doc.items() if k != "nameKey"}}


def settings_response(doc: dict | None) -> dict:
    doc = doc or {}
    return {
        "capitalYen": doc.get("capitalYen", DEFAULT_SETTINGS["capitalYen"]),
        "riskTolerancePct": doc.get("riskTolerancePct", DEFAULT_SETTINGS["riskTolerancePct"]),
        "performanceUnit": doc.get("performanceUnit", DEFAULT_SETTINGS["performanceUnit"]),
        "capitalHistory": doc.get("capitalHistory", []),
    }


def trade_sort_key(item: tuple[str, dict]):
    """決済の時刻の新しい順、同じなら作った時刻の新しい順、さらに ID（並びを決まったものにする）"""
    tid, doc = item
    return (-doc["record"]["exit"]["time"], -doc["createdAt"], tid)


def next_updated_at(now: int, prev: int | None) -> int:
    """直した時刻は必ず進める（同じミリ秒に 2 回直しても前より大きい）"""
    return now if prev is None else max(now, prev + 1)


def make_blueprint(store: Store, verifier: TokenVerifier, clock: Callable[[], int]) -> Blueprint:
    bp = Blueprint("records", __name__, url_prefix="/api")

    @bp.before_request
    def authenticate():
        token = bearer_token(request.headers.get("Authorization"))
        if token is None:
            log_event(event="auth_failed", reason="missing")
            return error(401, "unauthorized")
        try:
            g.uid = verifier.verify(token, clock())
        except InvalidToken as e:
            log_event(event="auth_failed", reason=e.reason)
            return error(401, "unauthorized")
        except AuthUnavailable as e:
            log_event(event="auth_unavailable", exc=str(e))
            return error(503, "unavailable")
        return None

    # ── 取引 ──
    @bp.get("/trades")
    def list_trades():
        items = sorted(store.list_trades(g.uid), key=trade_sort_key)
        return {"items": [trade_response(tid, doc) for tid, doc in items]}

    @bp.post("/trades")
    def create_trade():
        body, err = read_body()
        if err:
            return err
        record, issues = schema.validate_trade(body)
        if record is None:
            return invalid(issues)

        def build(instrument: dict, stored_settings: dict | None) -> dict:
            settings = settings_response(stored_settings)
            now = clock()
            return {
                "schemaVersion": SCHEMA_VERSION,
                "createdAt": now,
                "updatedAt": now,
                "snapshot": {
                    "instrument": instrument_snapshot(instrument),
                    "capitalYen": settings["capitalYen"],
                    "riskTolerancePct": settings["riskTolerancePct"],
                },
                "record": record,
            }

        try:
            tid, doc = store.create_trade(g.uid, record["instrumentId"], build)
        except MissingInstrument:
            # 自分の銘柄に無い（ほかの利用者の銘柄も「無い」と同じ）
            return invalid([{"field": "instrumentId", "kind": "notFound"}])
        res = jsonify(trade_response(tid, doc))
        res.status_code = 201
        return res

    @bp.get("/trades/<path:trade_id>")
    def get_trade(trade_id: str):
        doc = store.get_trade(g.uid, trade_id) if valid_id(trade_id) else None
        if doc is None:
            return error(404, "not_found")
        return trade_response(trade_id, doc)

    @bp.put("/trades/<path:trade_id>")
    def update_trade(trade_id: str):
        if not valid_id(trade_id):
            return error(404, "not_found")
        body, err = read_body()
        if err:
            return err
        record, issues = schema.validate_trade(body)
        if record is None:
            return invalid(issues)

        def mutate(doc: dict, new_instrument: dict | None) -> dict:
            snapshot = dict(doc["snapshot"])
            # 銘柄を別の銘柄に変えたときだけ、その銘柄の今の値で写し直す（資金・許容リスクは変えない。C36）
            if new_instrument is not None:
                snapshot["instrument"] = instrument_snapshot(new_instrument)
            return {
                **doc,
                "updatedAt": next_updated_at(clock(), doc.get("updatedAt")),
                "snapshot": snapshot,
                "record": record,
            }

        try:
            doc = store.update_trade(g.uid, trade_id, record["instrumentId"], mutate)
        except MissingInstrument:
            return invalid([{"field": "instrumentId", "kind": "notFound"}])
        if doc is None:
            return error(404, "not_found")
        return trade_response(trade_id, doc)

    @bp.delete("/trades/<path:trade_id>")
    def delete_trade(trade_id: str):
        if not valid_id(trade_id) or not store.delete_trade(g.uid, trade_id):
            return error(404, "not_found")
        return Response(status=204)

    # ── 銘柄 ──
    @bp.get("/instruments")
    def list_instruments():
        items = sorted(store.list_instruments(g.uid), key=lambda it: (it[1]["nameKey"], it[1]["name"], it[0]))
        return {"items": [instrument_response(iid, doc) for iid, doc in items]}

    @bp.post("/instruments")
    def create_instrument():
        body, err = read_body()
        if err:
            return err
        value, issues = schema.validate_instrument(body)
        if value is None:
            return invalid(issues)
        now = clock()
        doc = {**value, "nameKey": schema.name_key(value["name"]), "createdAt": now, "updatedAt": now}
        try:
            iid = store.create_instrument(g.uid, doc)
        except Conflict as e:
            return error(409, "conflict", reason=e.reason)
        res = jsonify(instrument_response(iid, doc))
        res.status_code = 201
        return res

    @bp.get("/instruments/<path:instrument_id>")
    def get_instrument(instrument_id: str):
        doc = store.get_instrument(g.uid, instrument_id) if valid_id(instrument_id) else None
        if doc is None:
            return error(404, "not_found")
        return instrument_response(instrument_id, doc)

    @bp.put("/instruments/<path:instrument_id>")
    def update_instrument(instrument_id: str):
        if not valid_id(instrument_id):
            return error(404, "not_found")
        body, err = read_body()
        if err:
            return err
        value, issues = schema.validate_instrument(body)
        if value is None:
            return invalid(issues)

        def mutate(doc: dict) -> dict:
            # 直すと以後に記録する取引に効く。記録済みの取引は snapshot のまま（C36）
            return {
                **value,
                "nameKey": schema.name_key(value["name"]),
                "createdAt": doc["createdAt"],
                "updatedAt": next_updated_at(clock(), doc.get("updatedAt")),
            }

        try:
            doc = store.update_instrument(g.uid, instrument_id, mutate)
        except Conflict as e:
            return error(409, "conflict", reason=e.reason)
        if doc is None:
            return error(404, "not_found")
        return instrument_response(instrument_id, doc)

    @bp.delete("/instruments/<path:instrument_id>")
    def delete_instrument(instrument_id: str):
        if not valid_id(instrument_id):
            return error(404, "not_found")
        try:
            deleted = store.delete_instrument(g.uid, instrument_id)
        except Conflict as e:
            return error(409, "conflict", reason=e.reason)
        if not deleted:
            return error(404, "not_found")
        return Response(status=204)

    # ── 設定 ──
    @bp.get("/settings")
    def get_settings():
        return settings_response(store.get_settings(g.uid))

    @bp.put("/settings")
    def put_settings():
        body, err = read_body()
        if err:
            return err
        value, issues = schema.validate_settings(body)
        if value is None:
            return invalid(issues)

        def mutate(prev: dict | None) -> dict:
            prev = prev or {}
            now = clock()
            history = list(prev.get("capitalHistory", []))
            if value["capitalYen"] != prev.get("capitalYen", DEFAULT_SETTINGS["capitalYen"]):
                history.append({"valueYen": value["capitalYen"], "at": now})
                history = history[-schema.MAX_CAPITAL_HISTORY :]
            return {**value, "capitalHistory": history, "updatedAt": next_updated_at(now, prev.get("updatedAt"))}

        return settings_response(store.update_settings(g.uid, mutate))

    @bp.errorhandler(StoreUnavailable)
    def store_unavailable(e: StoreUnavailable):
        log_event(event="store_unavailable", route=request.url_rule.rule if request.url_rule else None, exc=str(e))
        return error(503, "unavailable")

    return bp


def make_unconfigured_blueprint() -> Blueprint:
    """プロジェクト ID が無い設定: 記録の API は 503（閉じる側に倒す）。/api/health はそのまま"""
    bp = Blueprint("records", __name__, url_prefix="/api")

    @bp.route("/trades", methods=["GET", "POST"])
    @bp.route("/trades/<path:_id>", methods=["GET", "PUT", "DELETE"])
    @bp.route("/instruments", methods=["GET", "POST"])
    @bp.route("/instruments/<path:_id>", methods=["GET", "PUT", "DELETE"])
    @bp.route("/settings", methods=["GET", "PUT"])
    def unavailable(_id: str | None = None):
        return error(503, "unavailable")

    return bp
