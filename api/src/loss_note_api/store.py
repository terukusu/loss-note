"""記録の保存先（Firestore。設計書 4 章・ADR-0004）。

場所は利用者ごと: ``users/{uid}/trades/{id}``・``users/{uid}/instruments/{id}``・``users/{uid}/settings/current``・
``users/{uid}/charts/{tradeId}-{slot}``（根拠の足のチャート画像。1 文書 1 枚 ``{contentType, data}``。
Issue #12・ADR-0006）。
チャートは取引の作成・削除・差し替え・外すと同じトランザクションで書く（取引が無いチャート・チャートが書けなかった取引を残さない）。
uid は ``auth.check_claims`` が形を確かめた値、ID は ``schema.ID_PATTERN`` に合う値だけが来る（ほかの利用者の
場所を指せない）。手元・テストはエミュレーター（``FIRESTORE_EMULATOR_HOST`` を google-cloud-firestore が見て、
資格情報なしでつなぐ）。テストでは同じ約束の記憶の保存先（``api/tests/helpers/memory_store.py``）も使う。
"""

from collections.abc import Callable
from functools import wraps
from typing import Protocol

from loss_note_api.charts import SLOTS, chart_doc_id

Doc = dict
Mutate = Callable[[Doc], Doc]


class Conflict(Exception):
    """名前の重複（duplicateName）・指されている銘柄の削除（inUse）"""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class StoreUnavailable(Exception):
    """保存先につながらない・競合で再試行を使い切った（503）"""


class MissingInstrument(Exception):
    """取引が指す銘柄が、その利用者の場所に無い（400）"""


class InvalidRecord(Exception):
    """保存済みの値と合わせて初めて分かる本文の誤り（チャートの無い枠に時間足など。400）。issues は既知の欄と種類だけ"""

    def __init__(self, issues: list[dict]):
        super().__init__("invalid")
        self.issues = issues


# 取引の作成: (銘柄, 設定 or None) -> 保存する文書
BuildTrade = Callable[[Doc, Doc | None], Doc]
# 取引の直し: (今の文書, 付け替え先の銘柄 or None) -> 新しい文書（InvalidRecord を投げれば何も書かない）
MutateTrade = Callable[[Doc, Doc | None], Doc]
# チャートの文書 {contentType, data}。枠（"entry" / "exit"）ごと
Charts = dict[str, Doc]


class Store(Protocol):
    def list_trades(self, uid: str) -> list[tuple[str, Doc]]: ...
    def get_trade(self, uid: str, trade_id: str) -> Doc | None: ...
    # 銘柄（と設定）の読みと取引の書き込みを 1 つのトランザクションで行う（銘柄の削除と同時でも、
    # 無い銘柄を指す取引を残さない）。銘柄が無ければ MissingInstrument
    # charts があれば、同じトランザクションで users/{uid}/charts/{tid}-{slot} を作る（書けなければ取引も無い）
    def create_trade(
        self, uid: str, instrument_id: str, build: BuildTrade, charts: Charts | None = None
    ) -> tuple[str, Doc]: ...
    # instrument_id が今の取引の銘柄と違えば、同じトランザクションで付け替え先の銘柄を読んで mutate に渡す
    def update_trade(self, uid: str, trade_id: str, instrument_id: str, mutate: MutateTrade) -> Doc | None: ...
    # 取引と 2 枠のチャートを 1 トランザクションで消す
    def delete_trade(self, uid: str, trade_id: str) -> bool: ...

    # チャート（Issue #12）。取引が無ければ None。put は置き換え（無い枠なら作る）、delete はチャートが無ければ None
    # （有無は取引の文書の charts の要約で見る。要約とチャートの文書は常に同じトランザクションで書く）。
    # mutate は取引の文書を受けて新しい文書を返す（要約・時間足・updatedAt）。チャートと取引を 1 トランザクションで書く
    def get_chart(self, uid: str, trade_id: str, slot: str) -> Doc | None: ...
    def put_chart(self, uid: str, trade_id: str, slot: str, chart: Doc, mutate: Mutate) -> Doc | None: ...
    def delete_chart(self, uid: str, trade_id: str, slot: str, mutate: Mutate) -> Doc | None: ...

    def list_instruments(self, uid: str) -> list[tuple[str, Doc]]: ...
    def get_instrument(self, uid: str, instrument_id: str) -> Doc | None: ...
    def create_instrument(self, uid: str, doc: Doc) -> str: ...
    def update_instrument(self, uid: str, instrument_id: str, mutate: Mutate) -> Doc | None: ...
    def delete_instrument(self, uid: str, instrument_id: str) -> bool: ...

    def get_settings(self, uid: str) -> Doc | None: ...
    def update_settings(self, uid: str, mutate: Callable[[Doc | None], Doc]) -> Doc: ...


def _guard(fn):
    """つながらない・時間切れは StoreUnavailable に直す（例外の文言は捨てる。文書のパスが入りうる）"""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        from google.api_core import exceptions as gexc

        try:
            return fn(*args, **kwargs)
        # Aborted = トランザクションの競合で再試行を使い切った（こちらの都合の一時的な失敗）
        except (gexc.ServiceUnavailable, gexc.DeadlineExceeded, gexc.RetryError, gexc.Aborted) as e:
            raise StoreUnavailable(type(e).__name__) from None

    return wrapper


class FirestoreStore:
    def __init__(self, project_id: str):
        self._project_id = project_id
        self._client = None

    def _db(self):
        if self._client is None:
            from google.cloud import firestore

            self._client = firestore.Client(project=self._project_id)
        return self._client

    def _user(self, uid: str):
        return self._db().collection("users").document(uid)

    def _transaction(self, body):
        from google.cloud import firestore

        return firestore.transactional(body)(self._db().transaction())

    # ── 取引 ──
    @_guard
    def list_trades(self, uid):
        return [(s.id, s.to_dict()) for s in self._user(uid).collection("trades").stream()]

    @_guard
    def get_trade(self, uid, trade_id):
        snap = self._user(uid).collection("trades").document(trade_id).get()
        return snap.to_dict() if snap.exists else None

    def _chart_ref(self, uid, trade_id, slot):
        return self._user(uid).collection("charts").document(chart_doc_id(trade_id, slot))

    @_guard
    def create_trade(self, uid, instrument_id, build, charts=None):
        user = self._user(uid)
        ref = user.collection("trades").document()
        inst_ref = user.collection("instruments").document(instrument_id)
        settings_ref = user.collection("settings").document("current")

        def body(tx):
            inst = inst_ref.get(transaction=tx)
            if not inst.exists:
                raise MissingInstrument()
            settings = settings_ref.get(transaction=tx)
            doc = build(inst.to_dict(), settings.to_dict() if settings.exists else None)
            tx.create(ref, doc)
            for slot, chart in (charts or {}).items():
                tx.create(self._chart_ref(uid, ref.id, slot), chart)
            return ref.id, doc

        return self._transaction(body)

    @_guard
    def update_trade(self, uid, trade_id, instrument_id, mutate):
        user = self._user(uid)
        ref = user.collection("trades").document(trade_id)

        def body(tx):
            snap = ref.get(transaction=tx)
            if not snap.exists:
                return None
            doc = snap.to_dict()
            instrument = None
            if instrument_id != doc["record"]["instrumentId"]:
                inst = user.collection("instruments").document(instrument_id).get(transaction=tx)
                if not inst.exists:
                    raise MissingInstrument()
                instrument = inst.to_dict()
            new = mutate(doc, instrument)
            tx.set(ref, new)
            return new

        return self._transaction(body)

    @_guard
    def delete_trade(self, uid, trade_id):
        ref = self._user(uid).collection("trades").document(trade_id)

        def body(tx):
            if not ref.get(transaction=tx).exists:
                return False
            tx.delete(ref)
            for slot in SLOTS:
                tx.delete(self._chart_ref(uid, trade_id, slot))
            return True

        return self._transaction(body)

    # ── チャート ──
    @_guard
    def get_chart(self, uid, trade_id, slot):
        snap = self._chart_ref(uid, trade_id, slot).get()
        return snap.to_dict() if snap.exists else None

    @_guard
    def put_chart(self, uid, trade_id, slot, chart, mutate):
        ref = self._user(uid).collection("trades").document(trade_id)
        chart_ref = self._chart_ref(uid, trade_id, slot)

        def body(tx):
            snap = ref.get(transaction=tx)
            if not snap.exists:
                return None
            new = mutate(snap.to_dict())
            tx.set(chart_ref, chart)
            tx.set(ref, new)
            return new

        return self._transaction(body)

    @_guard
    def delete_chart(self, uid, trade_id, slot, mutate):
        ref = self._user(uid).collection("trades").document(trade_id)
        chart_ref = self._chart_ref(uid, trade_id, slot)

        def body(tx):
            snap = ref.get(transaction=tx)
            # 有無は取引の文書の要約で見る（要約とチャートの文書は常に同じトランザクションで書く。
            # 約 500 KB のチャートの文書を読まない）
            if not snap.exists:
                return None
            doc = snap.to_dict()
            if slot not in (doc.get("charts") or {}):
                return None
            new = mutate(doc)
            tx.delete(chart_ref)
            tx.set(ref, new)
            return new

        return self._transaction(body)

    # ── 銘柄 ──
    def _name_taken(self, tx, uid, key, except_id=None) -> bool:
        from google.cloud.firestore_v1.base_query import FieldFilter

        q = self._user(uid).collection("instruments").where(filter=FieldFilter("nameKey", "==", key)).limit(2)
        return any(s.id != except_id for s in q.get(transaction=tx))

    @_guard
    def list_instruments(self, uid):
        return [(s.id, s.to_dict()) for s in self._user(uid).collection("instruments").stream()]

    @_guard
    def get_instrument(self, uid, instrument_id):
        snap = self._user(uid).collection("instruments").document(instrument_id).get()
        return snap.to_dict() if snap.exists else None

    @_guard
    def create_instrument(self, uid, doc):
        ref = self._user(uid).collection("instruments").document()

        def body(tx):
            if self._name_taken(tx, uid, doc["nameKey"]):
                raise Conflict("duplicateName")
            tx.create(ref, doc)
            return ref.id

        return self._transaction(body)

    @_guard
    def update_instrument(self, uid, instrument_id, mutate):
        ref = self._user(uid).collection("instruments").document(instrument_id)

        def body(tx):
            snap = ref.get(transaction=tx)
            if not snap.exists:
                return None
            new = mutate(snap.to_dict())
            if self._name_taken(tx, uid, new["nameKey"], except_id=instrument_id):
                raise Conflict("duplicateName")
            tx.set(ref, new)
            return new

        return self._transaction(body)

    @_guard
    def delete_instrument(self, uid, instrument_id):
        from google.cloud.firestore_v1.base_query import FieldFilter

        user = self._user(uid)
        ref = user.collection("instruments").document(instrument_id)

        def body(tx):
            if not ref.get(transaction=tx).exists:
                return False
            q = user.collection("trades").where(filter=FieldFilter("record.instrumentId", "==", instrument_id))
            if list(q.limit(1).get(transaction=tx)):
                raise Conflict("inUse")
            tx.delete(ref)
            return True

        return self._transaction(body)

    # ── 設定 ──
    @_guard
    def get_settings(self, uid):
        snap = self._user(uid).collection("settings").document("current").get()
        return snap.to_dict() if snap.exists else None

    @_guard
    def update_settings(self, uid, mutate):
        ref = self._user(uid).collection("settings").document("current")

        def body(tx):
            snap = ref.get(transaction=tx)
            new = mutate(snap.to_dict() if snap.exists else None)
            tx.set(ref, new)
            return new

        return self._transaction(body)
