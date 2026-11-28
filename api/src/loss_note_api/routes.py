"""記録の API（取引・銘柄・口座・設定。Issue #4・#47・設計書 4 章・ADR-0004・ADR-0012）と、
決済明細の読み取りの入口（#11・ADR-0005。``statement_read.py``）、チャートの時間足の読み取りの入口（#27。
``chart_read.py``）。同じ認証を通す。

入口で ID トークンを検証してから処理する（認証の前に ID の形も存在も見ない → 未認証は常に 401）。
検証の後に使える利用者の許可リスト（Issue #43・``allowlist.py``）を見て、外れたら 403
（本文・パス・保存先・AI に触れる前）。
読み書きは検証できた uid の場所だけ。ほかの利用者の資源は、あるか無いかも分からない 404 にする。
判定・R・損益は保存しない（4.2 導出。画面が ``core/record.ts`` の ``toTradeInput`` で計算の入力に写す）。

口座（Issue #47・ADR-0012）: 取引は記録したときの口座（``record.accountId``。無い = 既定の口座）の資金・許容リスクを
``snapshot.capitalYen``・``snapshot.riskTolerancePct`` に写す。既定の口座は口座を読む・使う入口で無ければ設定から
1 回だけ作る（``accounts.py``）。設定の ``capitalYen`` 等は移し替えの元として形を変えずに残す（KEEP-6）。

明細の特徴の覚え（Issue #66・ADR-0017）: ``PUT /api/statement-profiles/{鍵}`` 本文 ``{accountId}``。明細から作った
下書きを記録した後に画面が送り、鍵 → 口座を上書きで覚える（後に記録したものが勝つ）。鍵の形が外れたら保存先に
触れずに 404、口座が無ければ 400 ``accountId`` notFound。204。覚えるのは口座の ID と時刻だけ。

今の値で写し直す（Issue #31・設計書 C36）: 取引の PUT に ``?snapshot=current`` を付けたときだけ、取引の銘柄と口座の
今の値で snapshot を写し直す（利用者が編集の画面で前 → 後を見て選んだとき）。付けなければ今と同じ。

根拠の足のチャート画像（Issue #12・ADR-0006）: 作成は ``POST /api/trades`` の multipart（部分 ``record`` = JSON の文字、
``entryChart`` / ``exitChart`` = 画像。どちらも任意）で取引と 1 トランザクション。差し替え・外す・読み戻しは
``/api/trades/{id}/charts/{slot}``。API が中継し、画面から保存先は直接読めない。multipart は記憶の中だけで読む
（``app.py`` の request_class。一時ファイルを作らない）。

オプションのポジションの足（Issue #116・設計書 4.7・ADR-0020）: ``record.legs`` を持つ取引は ``schemaVersion`` 2
（本文の形で決める。足の無い取引は直しても 1 のまま）。足を持てるのは写した銘柄の商品の形がオプションの取引
だけ。直しは保存先のトランザクションの中で、保存済みに足がある取引への ``legs`` の無い本文を 409 ``legsMissing``
（決定 7 の (b)。足を知らない画面が足を落とさない）、前からの取引に足を追加する本文を 400 ``legacyTrade``
にする。チャートの入口は ``legs`` を書き換えない。

心理のタグ（Issue #156・設計書 C55・ADR-0022）: 取引の文書の最上位の ``emotionTags``（``record`` の外）。書くのは
``PUT /api/trade-emotions`` 本文 ``{tradeIds, tags}`` だけで、集合を置き換える。取引の PUT・チャートの入口は文書を
``{**doc, ...}`` で組むのでタグを保つ（前の版の API も同じ作りなので、切り戻してもタグは消えない。版は上げない）。
選択肢に出さないタグの設定（Issue #163・ADR-0023）は ``GET`` / ``PUT /api/settings/emotion-tags`` 本文 ``{hidden}``
（``users/{uid}/settings/emotionTags``。設定の文書 ``current`` とは別。取引のタグ・集計は変えない）。

Good / More（Issue #123・設計書 C58・ADR-0024）: 取引の文書の最上位の ``reflection``（``record`` の外。心理のタグと同じ
作り）。書くのは ``PUT /api/trade-reflections`` 本文 ``{tradeIds, good, more}`` だけで、取引の集合の Good / More を
置き換える。両側とも空なら鍵ごと消す。

両建てのまとまり（Issue #266・設計書 C75・4.8・ADR-0027）: ``users/{uid}/positionGroups/{id}`` と取引の文書の最上位の
逆参照 ``positionGroupId``（``record`` の外。心理のタグと同じ作り）。入口は ``GET`` / ``POST /api/position-groups``・
``PUT`` / ``DELETE /api/position-groups/{id}`` で、メンバーの取引の逆参照と同じトランザクションで書く。取引の PUT は
メンバーの向きを変えると 409 ``inPositionGroup``、ほかの欄ならまとまりの時刻の写しを直す。取引の DELETE はまとまりから
外し、役割の組が崩れたらまとまりを消して残りの逆参照も外す。決済の時刻の範囲の一覧は、時刻の写しの幅が範囲と重なる
まとまり ``positionGroups`` と範囲の外のメンバーの取引 ``groupMembers`` も返す（6.5）。
"""

from collections.abc import Callable

from flask import Blueprint, Response, g, jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge

from loss_note_api import (
    accounts,
    ai_usage,
    allowlist,
    chart_read,
    charts,
    emotion_tags,
    export,
    position_groups,
    reflection,
    schema,
    statement_profile,
    statement_read,
    trade_pages,
    trade_range,
)
from loss_note_api.auth import AuthUnavailable, InvalidToken, TokenVerifier, bearer_token
from loss_note_api.logs import log_event
from loss_note_api.read_limits import ReadLimits
from loss_note_api.store import (
    Conflict,
    InvalidRecord,
    MissingAccount,
    MissingInstrument,
    Store,
    StoreUnavailable,
    UnknownSchemaVersion,
)
from loss_note_api.trade_version import version_of

# 両建てのまとまり（#266）
GROUPS_PATH = "/position-groups"
# 心理のタグの選択肢の設定（#163）
EMOTION_SETTINGS_PATH = "/settings/emotion-tags"
DEFAULT_SETTINGS = {"capitalYen": None, "riskTolerancePct": 1, "performanceUnit": "R"}
_INSTRUMENT_SNAPSHOT_KEYS = ("multiplier", "quantityStep", "priceCurrency", "underlyingKind", "productForm")
# 明細の特徴の覚えの入口（#66）
STATEMENT_PROFILES_PATH = "/statement-profiles"
# 知らない版の取引への書き込みの 409 の理由（#115。ADR-0020 の決定 7 の (a)）
UNKNOWN_SCHEMA_VERSION = "unknownSchemaVersion"
# 足を持つ取引への legs の無い PUT の 409 の理由（#116。ADR-0020 の決定 7 の (b)）
LEGS_MISSING = "legsMissing"
# 足を持てる銘柄の商品の形（ADR-0020 の決定 9。原資産 + オプション）
LEGS_PRODUCT_FORM = "option"
# 心理のタグの鍵（#156・ADR-0022。取引の文書の最上位 = record の外）
EMOTION_TAGS_KEY = "emotionTags"
REFLECTION_KEY = "reflection"
# 取引の PUT のクエリ snapshot の決まった値（#31。今の口座・銘柄の値で写し直す）
SNAPSHOT_CURRENT = "current"


def error(status: int, code: str, **extra) -> Response:
    res = jsonify({"error": code, **extra})
    res.status_code = status
    if status == 401:
        res.headers["WWW-Authenticate"] = "Bearer"
    return res


def unknown_version() -> Response:
    """知らない版の取引への書き込みを拒む（#115）。切り戻しの間に守りが働いた回数を数えられるよう、経路の形だけを
    ログに出す（取引の ID・uid・本文は出さない）"""
    log_event(event="trade_unknown_version", route=request.url_rule.rule if request.url_rule else None,
              method=request.method)  # fmt: skip
    return error(409, "conflict", reason=UNKNOWN_SCHEMA_VERSION)


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


def leg_issues(record: dict, snapshot: dict) -> list[dict]:
    """足を持つ取引は、写した銘柄の商品の形がオプションのときだけ（決定 9。作成・直しの後の snapshot で見る）"""
    if "legs" in record and snapshot["instrument"].get("productForm") != LEGS_PRODUCT_FORM:
        return [{"field": "legs", "kind": "productForm"}]
    return []


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
    # 心理のタグ（#156）: 付いている取引だけ。無い取引は今と同じ形（KEEP-4）
    if doc.get(EMOTION_TAGS_KEY):
        res[EMOTION_TAGS_KEY] = doc[EMOTION_TAGS_KEY]
    # Good / More（#123）: 付いている取引だけ。無い取引は今と同じ形（KEEP-1）
    if doc.get(REFLECTION_KEY):
        res[REFLECTION_KEY] = doc[REFLECTION_KEY]
    # 両建てのまとまりの逆参照（#266）: メンバーの取引だけ。無い取引は今と同じ形
    if doc.get(position_groups.KEY):
        res[position_groups.KEY] = doc[position_groups.KEY]
    return res


def read_trade_multipart(
    allow_remove: bool = False,
) -> tuple[object | None, dict[str, bytes], set[str], Response | None]:
    """multipart の作成・直しの本文 → (記録の JSON, 枠ごとの画像のバイト列, 外す枠, 誤りの応答)。

    外す枠（部分 ``removeChart`` = 枠の名前。枠ごとに 1 つ）は取引の直し（allow_remove）だけ。同じ枠に画像と外すの
    両方は 400 conflict。上限: 本文全体・部分の数・文字の部分の大きさ（超えたら RequestEntityTooLarge → アプリの処理で
    400 tooLarge）。record の 64 KiB はここで UTF-8 のバイト数で数える（Werkzeug の max_form_memory_size はファイルの
    部分の読み込みにも掛かるので、塊より大きい MAX_FORM_MEMORY にする。#151）。issues は既知の名前と種類だけ（送った
    部分の名前・値を返さない）。画像の中身の検査は呼び出し側
    """
    request.max_content_length = charts.MAX_MULTIPART_BYTES
    request.max_form_parts = charts.MAX_PARTS
    request.max_form_memory_size = charts.MAX_FORM_MEMORY
    form, files = request.form, request.files
    # schema.parse_json_body も MAX_BODY_BYTES（64 KiB）で見ているが、ここでも見る: unknownPart・duplicate・required
    # より先に tooLarge を返す（#151 の前の Werkzeug の 413 と同じ順）。消さない
    if any(len(v.encode("utf-8")) > charts.MAX_RECORD_PART for v in form.getlist("record")):
        return None, {}, set(), invalid([{"field": "", "kind": "tooLarge"}])
    known_files = {charts.PART[s]: s for s in charts.SLOTS}
    known_form = ("record", charts.REMOVE_PART) if allow_remove else ("record",)
    if any(k not in known_form for k in form) or any(k not in known_files for k in files):
        return None, {}, set(), invalid([{"field": "", "kind": "unknownPart"}])
    for name in ("record", *known_files):
        if len((form if name == "record" else files).getlist(name)) > 1:
            return None, {}, set(), invalid([{"field": name, "kind": "duplicate"}])
    if "record" not in form:
        return None, {}, set(), invalid([{"field": "record", "kind": "required"}])
    removes: set[str] = set()
    for value in form.getlist(charts.REMOVE_PART):
        if value not in charts.SLOTS:
            return None, {}, set(), invalid([{"field": charts.REMOVE_PART, "kind": "enum"}])
        if value in removes:
            return None, {}, set(), invalid([{"field": charts.REMOVE_PART, "kind": "duplicate"}])
        removes.add(value)
    if any(charts.PART[s] in files for s in removes):
        return None, {}, set(), invalid([{"field": charts.REMOVE_PART, "kind": "conflict"}])
    try:
        body = schema.parse_json_body(form["record"].encode("utf-8"), "application/json")
    except schema.BodyError as e:
        return None, {}, set(), invalid([{"field": "", "kind": e.kind}])
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
    return body, images, removes, (invalid(issues) if issues else None)


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


def instrument_sort_key(item: tuple[str, dict]):
    """銘柄の一覧の並び（名前の同一視の鍵 → 名前 → ID）"""
    iid, doc = item
    return (doc["nameKey"], doc["name"], iid)


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


# 一覧の並び（決済の時刻の新しい順 → 作った時刻の新しい順 → ID の昇順）。ページ分けと同じ鍵（Issue #87。trade_pages.py）
trade_sort_key = trade_pages.exit_key


def next_updated_at(now: int, prev: int | None) -> int:
    """直した時刻は必ず進める（同じミリ秒に 2 回直しても前より大きい）"""
    return now if prev is None else max(now, prev + 1)


def make_blueprint(
    store: Store,
    verifier: TokenVerifier,
    clock: Callable[[], int],
    read_config: statement_read.ReadConfig | None = None,
    *,
    allowed: frozenset[str] | None = None,
    read_limits: ReadLimits | None = None,
) -> Blueprint:
    """allowed は許可リスト（``allowlist.policy_for`` の結果。None = 制限しない）"""
    bp = Blueprint("records", __name__, url_prefix="/api")

    def build_default(settings: dict | None) -> dict:
        # 既定の口座（移し替え）。設定の資金・許容リスク・資金の履歴から作る
        return accounts.default_account(settings, clock())

    @bp.before_request
    def authenticate():
        token = bearer_token(request.headers.get("Authorization"))
        if token is None:
            log_event(event="auth_failed", reason="missing")
            return error(401, "unauthorized")
        try:
            identity = verifier.verify_identity(token, clock())
        except InvalidToken as e:
            log_event(event="auth_failed", reason=e.reason)
            return error(401, "unauthorized")
        except AuthUnavailable as e:
            log_event(event="auth_unavailable", exc=str(e))
            return error(503, "unavailable")
        # 許可リスト（R2・R3・R5）: 応答は決まった本文だけ。ログは決まった語の理由だけ
        # （メール・uid・許可リストを出さない）
        denied = allowlist.denial_reason(identity.claims, allowed)
        if denied is not None:
            log_event(event="forbidden", reason=denied)
            return error(403, "forbidden")
        g.uid = identity.uid
        g.claims = identity.claims  # 読み取りのバイパスのリスト（#51）の照らし合わせにだけ使う（ログ・応答に出さない）
        return None

    # ── 取引 ──
    @bp.get("/trades")
    def list_trades():
        # 決済の時刻の範囲（Issue #88・C44）: exitFrom・exitTo を付けたときだけ。範囲の中の全件を一覧と同じ並びで
        # （集計は画面。長さは 367 日まで）。ページ分けの引数とは同時に受けない
        # ページ分け（Issue #87・ADR-0016）: limit を付けたときだけ。付けなければ今と同じ全件（古い画面が壊れない）
        try:
            span = trade_range.parse_range_params(request.args)
            params = None if span is not None else trade_pages.parse_page_params(request.args)
        except trade_pages.PageParamError as e:
            return invalid(e.issues)
        if span is not None:
            # 件数の上限（C44）: 決済の新しい順に上限 + 1 件まで読み、超えたら先頭の上限の件数と印 truncated を返す
            got = store.list_trades_in_exit_range(g.uid, *span, trade_range.MAX_RANGE_ITEMS + 1)
            items = sorted(got, key=trade_sort_key)
            truncated = len(items) > trade_range.MAX_RANGE_ITEMS
            items = items[: trade_range.MAX_RANGE_ITEMS]
            # 両建てのまとまり（#266・6.5）: 時刻の写しの幅が範囲と重なるまとまりと、範囲の外のメンバーの取引。
            # まとまりはまれなので本人のまとまりをすべて読んで絞る（13.2）。件数の上限はメンバーの取引も数える
            groups = sorted(((gid, doc) for gid, doc in store.list_position_groups(g.uid, None)
                             if position_groups.overlaps(doc, *span)), key=position_groups.sort_key)  # fmt: skip
            in_range = {tid for tid, _ in items}
            outside = [tid for _, doc in groups for tid in position_groups.member_ids(doc) if tid not in in_range]
            room = trade_range.MAX_RANGE_ITEMS - len(items)
            outside = list(dict.fromkeys(outside))
            if len(outside) > room:
                truncated = True
                outside = outside[:room]
            members = store.get_trades(g.uid, outside) if outside else []
            return {
                "items": [trade_response(tid, doc) for tid, doc in items],
                "truncated": truncated,
                "positionGroups": [position_groups.group_response(gid, doc) for gid, doc in groups],
                "groupMembers": [trade_response(tid, doc) for tid, doc in sorted(members, key=trade_sort_key)],
            }
        if params is None:
            items = sorted(store.list_trades(g.uid), key=trade_sort_key)
            return {"items": [trade_response(tid, doc) for tid, doc in items]}
        order, limit, after = params
        page, next_cursor = trade_pages.split_page(order, store.list_trades_page(g.uid, order, after, limit), limit)
        return {"items": [trade_response(tid, doc) for tid, doc in page], "next": next_cursor}

    @bp.post("/trades")
    def create_trade():
        images: dict[str, bytes] = {}
        if request.mimetype == "multipart/form-data":
            body, images, _, err = read_trade_multipart()
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

        def build(instrument: dict, account: dict) -> dict:
            now = clock()
            # 資金・許容リスク・口座の通貨は記録したときのその取引の口座の値（#47。通貨は PR-2）
            snapshot = {"instrument": instrument_snapshot(instrument), **accounts.account_snapshot(account)}
            issues = leg_issues(record, snapshot)
            if issues:
                raise InvalidRecord(issues)
            doc = {
                # 足を持つ取引だけ 2（#116。本文の形で決める）
                "schemaVersion": version_of(record),
                "createdAt": now,
                "updatedAt": now,
                "snapshot": snapshot,
                "record": record,
            }
            return with_chart_summary(doc, chart_docs)

        try:
            tid, doc = store.create_trade(g.uid, record["instrumentId"], accounts.account_id_of(record), build,
                                          chart_docs or None, build_default=build_default)  # fmt: skip
        except MissingInstrument:
            # 自分の銘柄に無い（ほかの利用者の銘柄も「無い」と同じ）
            return invalid([{"field": "instrumentId", "kind": "notFound"}])
        except MissingAccount:
            # 自分の口座に無い（ほかの利用者の口座も「無い」と同じ。A5）
            return invalid([{"field": "accountId", "kind": "notFound"}])
        except InvalidRecord as e:
            return invalid(e.issues)
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
        # 今の値で写し直す（#31）: ?snapshot=current のときだけ。無ければ今と同じ（付け替えたときだけ写し直す）
        # 重ねた指定（?snapshot=current&snapshot=x）も 400（先頭だけを見て黙って通さない）
        modes = request.args.getlist("snapshot")
        if modes and modes != [SNAPSHOT_CURRENT]:
            return invalid([{"field": "snapshot", "kind": "invalid"}])
        refresh = bool(modes)
        # チャートの変更（#89）: multipart なら、差し替え・足す画像と外す枠を取引と同じトランザクションで書く
        images: dict[str, bytes] = {}
        removes: set[str] = set()
        if request.mimetype == "multipart/form-data":
            body, images, removes, err = read_trade_multipart(allow_remove=True)
        else:
            body, err = read_body()
        if err:
            return err
        record, issues = schema.validate_trade(body)
        if record is None:
            return invalid(issues)
        chart_docs: dict[str, dict | None] = {slot: charts.chart_doc(data) for slot, data in images.items()}
        chart_docs.update({slot: None for slot in removes})

        def mutate(doc: dict, new_instrument: dict | None, new_account: dict | None) -> dict:
            # 足を落とさない守り（#116。ADR-0020 の決定 7 の (b)）: 保存済みに足がある取引へ legs の無い
            # 本文（足を知らない画面 = 切り戻した後・古いタブ・今の mergeEdit）は 409。前からの取引（足の
            # 無い取引）に足を追加するのは 400（記録し直す）。どちらも書き込みと同じトランザクションの中で見る
            stored_legs = "legs" in doc["record"]
            if stored_legs and "legs" not in record:
                raise Conflict(LEGS_MISSING)
            if not stored_legs and "legs" in record:
                raise InvalidRecord([{"field": "legs", "kind": "legacyTrade"}])
            # チャートの時間足・付属の並びは、直した後にチャートがある枠にだけ（トランザクションの中で見る。R4）
            slots = (set(doc.get("charts") or {}) - removes) | set(images)
            checked = charts.kept_extras(record, doc["record"], slots)
            tf_issues = charts.chart_timeframe_issues(checked, slots)
            if tf_issues:
                raise InvalidRecord(tf_issues)
            snapshot = dict(doc["snapshot"])
            # 銘柄を別の銘柄に変えたときだけ、その銘柄の今の値で写し直す（資金・許容リスクは変えない。C36）
            if new_instrument is not None:
                snapshot["instrument"] = instrument_snapshot(new_instrument)
            # 口座を別の口座に付け替えたときだけ、その口座の今の資金・許容リスク・通貨で写し直す（#47 A4・A9）
            if new_account is not None:
                snapshot.update(accounts.account_snapshot(new_account))
            issues = leg_issues(record, snapshot)
            if issues:
                raise InvalidRecord(issues)
            new_record = checked
            # 本文に口座が無ければ保存済みの口座を保つ（古い画面が黙って既定の口座へ付け替えない）
            if "accountId" not in record and "accountId" in doc["record"]:
                new_record = {**new_record, "accountId": doc["record"]["accountId"]}
            new = {
                **doc,
                # 版は本文の形で決める（足の無い取引は 1 のまま。上の守りで足の有無は変わらない）
                "schemaVersion": version_of(new_record),
                "updatedAt": next_updated_at(clock(), doc.get("updatedAt")),
                "snapshot": snapshot,
                "record": new_record,
            }
            return with_chart_summary(new, chart_docs) if chart_docs else new

        def regroup(group: dict, old: dict, new: dict) -> dict | None:
            # 両建てのまとまり（#266）: 向きを変えたら 409。ほかの欄なら時刻の写しを直す
            return position_groups.after_trade_updated(group, trade_id, old, new, clock())

        try:
            doc = store.update_trade(g.uid, trade_id, record["instrumentId"], record.get("accountId"), mutate,
                                     build_default=build_default, refresh=refresh,
                                     charts=chart_docs or None, regroup=regroup)  # fmt: skip
        except MissingInstrument:
            return invalid([{"field": "instrumentId", "kind": "notFound"}])
        except MissingAccount:
            return invalid([{"field": "accountId", "kind": "notFound"}])
        except InvalidRecord as e:
            return invalid(e.issues)
        except UnknownSchemaVersion:
            return unknown_version()
        except position_groups.MemberSideChanged:
            return error(409, "conflict", reason=position_groups.IN_POSITION_GROUP)
        except Conflict as e:
            # 足を知らない画面（切り戻し・古いタブ）の保存を止めた回数を数えられるよう、決まった語だけをログに出す
            # （取引の ID・uid・本文は出さない）
            if e.reason == LEGS_MISSING:
                log_event(event="trade_legs_missing")
            return error(409, "conflict", reason=e.reason)
        if doc is None:
            return error(404, "not_found")
        return trade_response(trade_id, doc)

    @bp.delete("/trades/<path:trade_id>")
    def delete_trade(trade_id: str):
        def regroup(gid: str, group: dict, tid: str, others: dict[str, dict]):
            # 両建てのまとまり（#266・4.8）: メンバーから外し、役割の組が崩れたらまとまりを消して残りの逆参照も外す
            now = clock()
            action, new_group = position_groups.after_trade_removed(group, tid, now)
            if action == "skip":
                return None
            writes = {} if action == "write" else position_groups.relink_writes(gid, others, [], others, now)
            return new_group, writes

        if not valid_id(trade_id) or not store.delete_trade(g.uid, trade_id, regroup=regroup):
            return error(404, "not_found")
        return Response(status=204)

    # ── チャート（Issue #12。画面の差し替え・外すは取引の PUT の multipart で取引と一緒に。#89）──
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

        def mutate(doc: dict) -> dict:
            # 差し替えた枠の時間足は消して選び直しにする（前のチャートの足が残って、誤って「時間足を変えた」にしない）
            record = charts.record_after_replace(doc["record"], slot)
            new = {**doc, "record": record, "updatedAt": next_updated_at(clock(), doc.get("updatedAt"))}
            return with_chart_summary(new, {slot: chart})

        try:
            doc = store.put_chart(g.uid, trade_id, slot, chart, mutate)
        except UnknownSchemaVersion:
            return unknown_version()
        if doc is None:
            return error(404, "not_found")
        return trade_response(trade_id, doc)

    @bp.delete("/trades/<path:trade_id>/charts/<slot>")
    def delete_chart(trade_id: str, slot: str):
        if not chart_target(trade_id, slot):
            return error(404, "not_found")
        def mutate(doc: dict) -> dict:
            # 外すとその枠の時間足も消える（R4。判定もそれに従う）。付属の枠は並びからも消える
            record = charts.record_after_remove(doc["record"], slot)
            new = {**doc, "record": record, "updatedAt": next_updated_at(clock(), doc.get("updatedAt"))}
            return with_chart_summary(new, {slot: None})

        try:
            doc = store.delete_chart(g.uid, trade_id, slot, mutate)
        except UnknownSchemaVersion:
            return unknown_version()
        if doc is None:
            return error(404, "not_found")
        return trade_response(trade_id, doc)

    # ── 心理のタグ（Issue #156・ADR-0022）──
    # 取引の集合（1〜20 件。複数行の明細なら保存した行すべて）のタグを 1 トランザクションで置き換える。
    # record・snapshot・charts・schemaVersion は変えない（判定・R に入らない）。
    # 空の集合なら鍵ごと消す（タグの無い取引は今と同じ形）
    @bp.put("/trade-emotions")
    def put_trade_emotions():
        body, err = read_body()
        if err:
            return err
        value, issues, bad_id = schema.validate_emotion_tags(body)
        if bad_id:
            # 取引の ID の形が崩れている: 経路の ID と同じく、保存先に触れずに「無い」
            return error(404, "not_found")
        if value is None:
            return invalid(issues)
        tags = value["tags"]

        def mutate(doc: dict) -> dict:
            new = {k: v for k, v in doc.items() if k != EMOTION_TAGS_KEY}
            if tags:
                new[EMOTION_TAGS_KEY] = list(tags)
            new["updatedAt"] = next_updated_at(clock(), doc.get("updatedAt"))
            return new

        try:
            docs = store.set_emotion_tags(g.uid, value["tradeIds"], mutate)
        except UnknownSchemaVersion:
            return unknown_version()
        if docs is None:
            # 1 件でも無い（ほかの利用者の取引も「無い」と同じ）: 何も書いていない
            return error(404, "not_found")
        return {"tags": tags}

    # ── Good / More（Issue #123・ADR-0024）──
    # 心理のタグと同じ作り: 取引の集合（1〜20 件）の Good / More を 1 トランザクションで置き換える。record・snapshot・
    # charts・schemaVersion・心理のタグは変えない。両側とも空なら鍵ごと消す。保存先の書き口は心理のタグと共有する
    # （set_emotion_tags は「取引の集合を読んで mutate を当てて書く」口で、触る鍵は mutate が決める）
    @bp.put("/trade-reflections")
    def put_trade_reflections():
        body, err = read_body()
        if err:
            return err
        value, issues, bad_id = schema.validate_reflection(body)
        if bad_id:
            return error(404, "not_found")
        if value is None:
            return invalid(issues)
        saved = {side: value[side] for side in reflection.SIDES}
        empty = reflection.is_empty(saved)

        def mutate(doc: dict) -> dict:
            new = {k: v for k, v in doc.items() if k != REFLECTION_KEY}
            if not empty:
                new[REFLECTION_KEY] = {side: {"topics": list(p["topics"]), "notes": list(p["notes"])}
                                       for side, p in saved.items()}
            new["updatedAt"] = next_updated_at(clock(), doc.get("updatedAt"))
            return new

        try:
            docs = store.set_emotion_tags(g.uid, value["tradeIds"], mutate)
        except UnknownSchemaVersion:
            return unknown_version()
        if docs is None:
            return error(404, "not_found")
        return saved

    # ── 両建てのまとまり（Issue #266・設計書 C75・4.8・ADR-0027）──
    # 検査は形だけ（決定 3）。読む・書くのは本人の users/{uid} の下だけで、ほかの利用者のまとまり・取引は
    # 「無い」と同じ 404
    @bp.get(GROUPS_PATH)
    def list_position_groups():
        got = store.list_position_groups(g.uid, position_groups.MAX_LIST + 1)
        items = sorted(got, key=position_groups.sort_key)
        truncated = len(items) > position_groups.MAX_LIST
        items = items[: position_groups.MAX_LIST]
        return {"items": [position_groups.group_response(gid, doc) for gid, doc in items], "truncated": truncated}

    def read_group_body() -> tuple[dict | None, Response | None]:
        body, err = read_body()
        if err:
            return None, err
        value, issues, bad_id = schema.validate_position_group(body)
        if bad_id:
            # 取引の ID の形が崩れている: 経路の ID と同じく、保存先に触れずに「無い」
            return None, error(404, "not_found")
        if value is None:
            return None, invalid(issues)
        return value, None

    def check_members(members: list[dict], trades: dict[str, dict], group_id: str | None) -> None:
        # 1 つの取引は 1 つのまとまりにだけ（409）→ 形（足・向き。400）。どちらも書く前に同じトランザクションの中で見る
        if position_groups.in_other_group(members, trades, group_id):
            raise Conflict(position_groups.IN_OTHER_GROUP)
        issues = position_groups.shape_issues(members, trades)
        if issues:
            raise InvalidRecord(issues)

    def group_write_error(e: Exception) -> Response:
        if isinstance(e, UnknownSchemaVersion):
            return unknown_version()
        if isinstance(e, Conflict):
            return error(409, "conflict", reason=e.reason)
        assert isinstance(e, InvalidRecord)
        return invalid(e.issues)

    @bp.post(GROUPS_PATH)
    def create_position_group():
        value, err = read_group_body()
        if err:
            return err
        members = value["members"]
        ids = [m["tradeId"] for m in members]

        def build(gid: str, trades: dict[str, dict]):
            check_members(members, trades, None)
            now = clock()
            group = position_groups.build_group(members, value.get("exit"), trades, now)
            return group, position_groups.relink_writes(gid, [], ids, trades, now)

        try:
            got = store.create_position_group(g.uid, ids, build)
        except (UnknownSchemaVersion, Conflict, InvalidRecord) as e:
            return group_write_error(e)
        if got is None:
            # 1 件でも無い（ほかの利用者の取引も「無い」と同じ）: 何も書いていない
            return error(404, "not_found")
        res = jsonify(position_groups.group_response(*got))
        res.status_code = 201
        return res

    @bp.put(f"{GROUPS_PATH}/<path:group_id>")
    def update_position_group(group_id: str):
        if not valid_id(group_id):
            return error(404, "not_found")
        value, err = read_group_body()
        if err:
            return err
        members = value["members"]
        ids = [m["tradeId"] for m in members]

        def build(group: dict, trades: dict[str, dict]):
            check_members(members, trades, group_id)
            now = clock()
            new = position_groups.build_group(members, value.get("exit"), trades, now, prev=group)
            return new, position_groups.relink_writes(group_id, position_groups.member_ids(group), ids, trades, now)

        try:
            doc = store.update_position_group(g.uid, group_id, ids, build)
        except (UnknownSchemaVersion, Conflict, InvalidRecord) as e:
            return group_write_error(e)
        if doc is None:
            return error(404, "not_found")
        return position_groups.group_response(group_id, doc)

    @bp.delete(f"{GROUPS_PATH}/<path:group_id>")
    def delete_position_group(group_id: str):
        if not valid_id(group_id):
            return error(404, "not_found")

        def unlink(group: dict, trades: dict[str, dict]) -> dict[str, dict]:
            # 逆参照を外すだけ（記録・心理のタグ・Good / More はそのまま）
            return position_groups.relink_writes(group_id, position_groups.member_ids(group), [], trades, clock())

        try:
            done = store.delete_position_group(g.uid, group_id, unlink)
        except UnknownSchemaVersion:
            return unknown_version()
        if not done:
            return error(404, "not_found")
        return Response(status=204)

    # ── 銘柄 ──
    @bp.get("/instruments")
    def list_instruments():
        items = sorted(store.list_instruments(g.uid), key=instrument_sort_key)
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

    # ── 口座（#47）──
    @bp.get("/accounts")
    def list_accounts():
        items = sorted(store.list_accounts(g.uid, build_default), key=accounts.account_sort_key)
        return {"items": [accounts.account_response(aid, doc) for aid, doc in items]}

    @bp.post("/accounts")
    def create_account():
        body, err = read_body()
        if err:
            return err
        value, issues = schema.validate_account(body, create=True)
        if value is None:
            return invalid(issues)
        now = clock()
        doc = {
            **value,
            "nameKey": schema.name_key(value["name"]),
            "capitalHistory": accounts.next_capital_history([], None, value["capitalYen"], now,
                                                            currency=value["currency"]),
            "createdAt": now,
            "updatedAt": now,
        }
        try:
            aid = store.create_account(g.uid, doc, build_default)
        except Conflict as e:
            return error(409, "conflict", reason=e.reason)
        res = jsonify(accounts.account_response(aid, doc))
        res.status_code = 201
        return res

    @bp.get("/accounts/<path:account_id>")
    def get_account(account_id: str):
        doc = store.get_account(g.uid, account_id, build_default) if valid_id(account_id) else None
        if doc is None:
            return error(404, "not_found")
        return accounts.account_response(account_id, doc)

    @bp.put("/accounts/<path:account_id>")
    def update_account(account_id: str):
        if not valid_id(account_id):
            return error(404, "not_found")
        body, err = read_body()
        if err:
            return err
        value, issues = schema.validate_account(body, create=False)
        if value is None:
            return invalid(issues)

        def mutate(doc: dict, in_use) -> dict:
            # 直すと以後に記録する取引に効く。記録済みの取引は snapshot のまま（C36 と同じ）
            now = clock()
            prev_currency = accounts.currency_of(doc)
            currency = value.get("currency", prev_currency)
            # 通貨は取引が 1 件でもあれば変えられない（F14。取引を探すのは通貨を変えるときだけ）
            if currency != prev_currency and in_use():
                raise Conflict("currencyLocked")
            return {
                **value,
                "currency": currency,
                "nameKey": schema.name_key(value["name"]),
                "capitalHistory": accounts.next_capital_history(
                    doc.get("capitalHistory", []), doc.get("capitalYen"), value["capitalYen"], now,
                    currency=currency, prev_currency=prev_currency,
                ),  # fmt: skip
                "createdAt": doc["createdAt"],
                "updatedAt": next_updated_at(now, doc.get("updatedAt")),
            }

        try:
            doc = store.update_account(g.uid, account_id, mutate, build_default)
        except Conflict as e:
            return error(409, "conflict", reason=e.reason)
        if doc is None:
            return error(404, "not_found")
        return accounts.account_response(account_id, doc)

    # ── 明細の特徴の覚え（#66）──
    @bp.put(f"{STATEMENT_PROFILES_PATH}/<path:key>")
    def put_statement_profile(key: str):
        if not statement_profile.valid_key(key):
            return error(404, "not_found")
        body, err = read_body()
        if err:
            return err
        value, issues = schema.validate_statement_profile(body)
        if value is None:
            return invalid(issues)
        try:
            store.put_statement_profile(g.uid, key, statement_profile.profile_doc(value["accountId"], clock()),
                                        build_default)
        except MissingAccount:
            return invalid([{"field": "accountId", "kind": "notFound"}])
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
            # 口座ができた後は画面から使わない（移し替えの元。KEEP-6 で形と振る舞いは変えない）
            prev = prev or {}
            now = clock()
            history = accounts.next_capital_history(
                prev.get("capitalHistory", []), prev.get("capitalYen", DEFAULT_SETTINGS["capitalYen"]),
                value["capitalYen"], now,
            )  # fmt: skip
            return {**value, "capitalHistory": history, "updatedAt": next_updated_at(now, prev.get("updatedAt"))}

        return settings_response(store.update_settings(g.uid, mutate))

    # ── 心理のタグの選択肢の設定（#163・ADR-0023）──
    # 選択肢に出さないタグの ID の集合。設定の文書 current とは別の文書に丸ごと置き換える（PUT /settings が current を
    # 値で置き換えても消えない）。平常心は出さないにできない。記録したタグ・集計は変えない（画面の選択肢の絞り込みだけ）
    @bp.get(EMOTION_SETTINGS_PATH)
    def get_emotion_settings():
        return {"hidden": emotion_tags.hidden_of(store.get_emotion_settings(g.uid))}

    @bp.put(EMOTION_SETTINGS_PATH)
    def put_emotion_settings():
        body, err = read_body()
        if err:
            return err
        value, issues = schema.validate_emotion_settings(body)
        if value is None:
            return invalid(issues)
        store.put_emotion_settings(g.uid, {"hidden": value["hidden"], "updatedAt": clock()})
        return {"hidden": value["hidden"]}
    # ── データの書き出し（#167・ADR-0025）──
    @bp.get(export.PATH)
    def export_data():
        # 本人の記録を一覧の API と同じ形・同じ並びで 1 つに。画像のバイト列は含めない（取引の charts は要約だけ）
        now = clock()
        trades = sorted(store.list_trades(g.uid), key=trade_sort_key)
        accts = sorted(store.list_accounts(g.uid, build_default), key=accounts.account_sort_key)
        insts = sorted(store.list_instruments(g.uid), key=instrument_sort_key)
        body = export.export_body(
            now,
            settings_response(store.get_settings(g.uid)),
            [accounts.account_response(aid, doc) for aid, doc in accts],
            [instrument_response(iid, doc) for iid, doc in insts],
            [trade_response(tid, doc) for tid, doc in trades],
            {"hidden": emotion_tags.hidden_of(store.get_emotion_settings(g.uid))},
            [position_groups.group_response(gid, doc)
             for gid, doc in sorted(store.list_position_groups(g.uid, None), key=position_groups.sort_key)],
        )
        res = jsonify(body)
        res.headers["Cache-Control"] = "no-store"
        res.headers["Content-Disposition"] = f'attachment; filename="{export.file_name(now)}"'
        return res

    # ── 決済明細の読み取り（#11）──
    limits = read_limits or ReadLimits()
    statement_read.register(bp, read_config or statement_read.ReadConfig(None), store, clock, limits)
    # ── チャートの時間足の読み取り（#27。明細と同じ設定・同じ上限 = 同じ財布）──
    chart_read.register(bp, read_config or statement_read.ReadConfig(None), store, clock, limits)
    # ── AI の利用状況（#62。同じ計上を読むだけ）──
    ai_usage.register(bp, store, clock, limits)

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
    @bp.route("/accounts", methods=["GET", "POST"])
    @bp.route("/accounts/<path:_id>", methods=["GET", "PUT"])
    @bp.route("/settings", methods=["GET", "PUT"])
    @bp.route(EMOTION_SETTINGS_PATH, methods=["GET", "PUT"])
    @bp.route(GROUPS_PATH, methods=["GET", "POST"])
    @bp.route(f"{GROUPS_PATH}/<path:_id>", methods=["PUT", "DELETE"])
    @bp.route(f"{STATEMENT_PROFILES_PATH}/<path:_id>", methods=["PUT"])
    @bp.route(statement_read.PATH, methods=["POST"])
    @bp.route(chart_read.PATH, methods=["POST"])
    @bp.route(ai_usage.PATH, methods=["GET"])
    @bp.route(export.PATH, methods=["GET"])
    def unavailable(_id: str | None = None, _slot: str | None = None):
        return error(503, "unavailable")

    return bp
