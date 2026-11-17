"""記録の API（取引・銘柄・設定。Issue #4・設計書 4 章・ADR-0004）と、決済明細の読み取りの入口（#11・ADR-0005。
``statement_read.py``。同じ認証を通す）。

入口で ID トークンを検証してから処理する（認証の前に ID の形も存在も見ない → 未認証は常に 401）。
読み書きは検証できた uid の場所だけ。ほかの利用者の資源は、あるか無いかも分からない 404 にする。
判定・R・損益は保存しない（4.2 導出。画面が ``core/record.ts`` の ``toTradeInput`` で計算の入力に写す）。

根拠の足のチャート画像（Issue #12・ADR-0006）: 作成は ``POST /api/trades`` の multipart（部分 ``record`` = JSON の文字、
``entryChart`` / ``exitChart`` = 画像。どちらも任意）で取引と 1 トランザクション。差し替え・外す・読み戻しは
``/api/trades/{id}/charts/{slot}``。API が中継し、画面から保存先は直接読めない。multipart は記憶の中だけで読む
（``app.py`` の request_class。一時ファイルを作らない）。
"""

from collections.abc import Callable

from flask import Blueprint, Response, g, jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge

from loss_note_api import charts, schema, statement_read
from loss_note_api.auth import AuthUnavailable, InvalidToken, TokenVerifier, bearer_token
from loss_note_api.logs import log_event
from loss_note_api.store import Conflict, InvalidRecord, MissingInstrument, Store, StoreUnavailable

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
    res = {
        "id": trade_id,
        "schemaVersion": doc["schemaVersion"],
        "createdAt": doc["createdAt"],
        "updatedAt": doc["updatedAt"],
        "snapshot": doc["snapshot"],
        "record": doc["record"],
    }
    # チャートのある取引だけ要約（形式と大きさ）を足す。無い取引は今と同じ形（Issue #12 KEEP-2）
    if doc.get("charts"):
        res["charts"] = doc["charts"]
    return res


def read_trade_multipart() -> tuple[object | None, dict[str, bytes], Response | None]:
    """multipart の作成の本文 → (記録の JSON, 枠ごとの画像のバイト列, 誤りの応答)。

    上限: 本文全体・部分の数・文字の部分の大きさ（超えたら RequestEntityTooLarge → アプリの処理で 400 tooLarge）。
    issues は既知の名前と種類だけ（送った部分の名前・値を返さない）。画像の中身の検査は呼び出し側
    """
    request.max_content_length = charts.MAX_MULTIPART_BYTES
    request.max_form_parts = charts.MAX_PARTS
    request.max_form_memory_size = charts.MAX_RECORD_PART
    form, files = request.form, request.files
    known_files = {charts.PART[s]: s for s in charts.SLOTS}
    if any(k != "record" for k in form) or any(k not in known_files for k in files):
        return None, {}, invalid([{"field": "", "kind": "unknownPart"}])
    for name in ("record", *known_files):
        if len((form if name == "record" else files).getlist(name)) > 1:
            return None, {}, invalid([{"field": name, "kind": "duplicate"}])
    if "record" not in form:
        return None, {}, invalid([{"field": "record", "kind": "required"}])
    try:
        body = schema.parse_json_body(form["record"].encode("utf-8"), "application/json")
    except schema.BodyError as e:
        return None, {}, invalid([{"field": "", "kind": e.kind}])
    images: dict[str, bytes] = {}
    issues = []
    for part, slot in known_files.items():
        f = files.get(part)
        if f is None:
            continue
        data = f.stream.read()
        kind = charts.check_chart(data, f.content_type)
        if kind is not None:
            issues.append({"field": part, "kind": kind})
        else:
            images[slot] = data
    return body, images, (invalid(issues) if issues else None)


def read_chart_body() -> tuple[bytes | None, Response | None]:
    """差し替えの本文（画像の生のバイト）。上限 + 1 B まで読み、超えた分で大きすぎるを見分ける（分割の本文も）"""
    request.max_content_length = charts.MAX_BYTES + 1
    too_large = invalid([{"field": "chart", "kind": "imageBytes"}])
    if request.content_length is not None and request.content_length > charts.MAX_BYTES:
        return None, too_large
    try:
        data = request.get_data(cache=False)
    except RequestEntityTooLarge:
        return None, too_large
    kind = charts.check_chart(data, request.headers.get("Content-Type"))
    if kind is not None:
        return None, invalid([{"field": "chart", "kind": kind}])
    return data, None


def with_chart_summary(doc: dict, chart_docs: dict[str, dict]) -> dict:
    """取引の文書の charts の要約を、枠ごとの文書（無い枠は消す）で直す。空なら鍵ごと消す"""
    summary = {s: m for s, m in (doc.get("charts") or {}).items() if s in charts.SLOTS}
    for slot, chart in chart_docs.items():
        if chart is None:
            summary.pop(slot, None)
        else:
            summary[slot] = charts.chart_meta(chart)
    out = {k: v for k, v in doc.items() if k != "charts"}
    if summary:
        out["charts"] = {s: summary[s] for s in charts.SLOTS if s in summary}
    return out


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


def make_blueprint(
    store: Store,
    verifier: TokenVerifier,
    clock: Callable[[], int],
    read_config: statement_read.ReadConfig | None = None,
) -> Blueprint:
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
        images: dict[str, bytes] = {}
        if request.mimetype == "multipart/form-data":
            body, images, err = read_trade_multipart()
        else:
            body, err = read_body()
        if err:
            return err
        record, issues = schema.validate_trade(body)
        if record is None:
            return invalid(issues)
        tf_issues = charts.chart_timeframe_issues(record, set(images))
        if tf_issues:
            return invalid(tf_issues)
        chart_docs = {slot: charts.chart_doc(data) for slot, data in images.items()}

        def build(instrument: dict, stored_settings: dict | None) -> dict:
            settings = settings_response(stored_settings)
            now = clock()
            doc = {
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
            return with_chart_summary(doc, chart_docs)

        try:
            tid, doc = store.create_trade(g.uid, record["instrumentId"], build, chart_docs or None)
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
            # チャートの時間足は、保存済みのチャートがある枠にだけ（トランザクションの中で見る。R4）
            tf_issues = charts.chart_timeframe_issues(record, set(doc.get("charts") or {}))
            if tf_issues:
                raise InvalidRecord(tf_issues)
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
        except InvalidRecord as e:
            return invalid(e.issues)
        if doc is None:
            return error(404, "not_found")
        return trade_response(trade_id, doc)

    @bp.delete("/trades/<path:trade_id>")
    def delete_trade(trade_id: str):
        if not valid_id(trade_id) or not store.delete_trade(g.uid, trade_id):
            return error(404, "not_found")
        return Response(status=204)

    # ── チャート（Issue #12。差し替え・外すの画面は #9）──
    # 経路は /trades/<path:trade_id> より先に当たる。ID・枠の形が違えば保存先に触れずに 404
    def chart_target(trade_id: str, slot: str) -> bool:
        return valid_id(trade_id) and charts.valid_slot(slot)

    @bp.get("/trades/<path:trade_id>/charts/<slot>")
    def get_chart(trade_id: str, slot: str):
        doc = store.get_chart(g.uid, trade_id, slot) if chart_target(trade_id, slot) else None
        if doc is None:
            return error(404, "not_found")
        return Response(bytes(doc["data"]), status=200, content_type=doc["contentType"])

    @bp.put("/trades/<path:trade_id>/charts/<slot>")
    def put_chart(trade_id: str, slot: str):
        if not chart_target(trade_id, slot):
            return error(404, "not_found")
        data, err = read_chart_body()
        if err:
            return err
        chart = charts.chart_doc(data)
        tf_field = charts.TIMEFRAME_FIELD[slot]

        def mutate(doc: dict) -> dict:
            # 差し替えた枠の時間足は消して選び直しにする（前のチャートの足が残って、誤って「時間足を変えた」にしない）
            record = {k: v for k, v in doc["record"].items() if k != tf_field}
            new = {**doc, "record": record, "updatedAt": next_updated_at(clock(), doc.get("updatedAt"))}
            return with_chart_summary(new, {slot: chart})

        doc = store.put_chart(g.uid, trade_id, slot, chart, mutate)
        if doc is None:
            return error(404, "not_found")
        return trade_response(trade_id, doc)

    @bp.delete("/trades/<path:trade_id>/charts/<slot>")
    def delete_chart(trade_id: str, slot: str):
        if not chart_target(trade_id, slot):
            return error(404, "not_found")
        tf_field = charts.TIMEFRAME_FIELD[slot]

        def mutate(doc: dict) -> dict:
            # 外すとその枠の時間足も消える（R4。判定もそれに従う）
            record = {k: v for k, v in doc["record"].items() if k != tf_field}
            new = {**doc, "record": record, "updatedAt": next_updated_at(clock(), doc.get("updatedAt"))}
            return with_chart_summary(new, {slot: None})

        doc = store.delete_chart(g.uid, trade_id, slot, mutate)
        if doc is None:
            return error(404, "not_found")
        return trade_response(trade_id, doc)

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

    # ── 決済明細の読み取り（#11）──
    statement_read.register(bp, read_config or statement_read.ReadConfig(None))

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
    @bp.route("/trades/<path:_id>/charts/<_slot>", methods=["GET", "PUT", "DELETE"])
    @bp.route("/instruments", methods=["GET", "POST"])
    @bp.route("/instruments/<path:_id>", methods=["GET", "PUT", "DELETE"])
    @bp.route("/settings", methods=["GET", "PUT"])
    @bp.route(statement_read.PATH, methods=["POST"])
    def unavailable(_id: str | None = None, _slot: str | None = None):
        return error(503, "unavailable")

    return bp
