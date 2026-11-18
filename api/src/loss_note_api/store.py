"""記録の保存先（Firestore。設計書 4 章・ADR-0004）。

場所は利用者ごと: ``users/{uid}/trades/{id}``・``users/{uid}/instruments/{id}``・``users/{uid}/settings/current``・
``users/{uid}/accounts/{id}``（口座。#47・ADR-0012。既定の口座 ``default`` は口座を読む・使う入口で無ければ、
設定から決まった ID の 1 文書を create で 1 回だけ作る。取引・設定は書かない）・
``users/{uid}/charts/{tradeId}-{slot}``（根拠の足のチャート画像。1 文書 1 枚 ``{contentType, data}``。
Issue #12・ADR-0006）。
明細の読み取りの 1 日の計上（Issue #44・ADR-0010、Issue #51・ADR-0014）: 利用者ごと
``users/{uid}/statement_read_days/{YYYY-MM-DD}`` = ``{count, microUsd}``（``microUsd`` は #51 から。欠け・負は
回数 × 予約額に見積もる = ``read_limits.effective_user_micro``）、
全体 ``statement_read_spend/{YYYY-MM-DD}`` =
``{count, microUsd}``（日付は日本時間。日付・回数・金額だけ）。
チャートは取引の作成・削除・差し替え・外すと同じトランザクションで書く（取引が無いチャート・チャートが書けなかった取引を残さない）。
uid は ``auth.check_claims`` が形を確かめた値、ID は ``schema.ID_PATTERN`` に合う値だけが来る（ほかの利用者の
場所を指せない）。手元・テストはエミュレーター（``FIRESTORE_EMULATOR_HOST`` を google-cloud-firestore が見て、
資格情報なしでつなぐ）。テストでは同じ約束の記憶の保存先（``api/tests/helpers/memory_store.py``）も使う。
"""

import threading
from collections.abc import Callable
from functools import wraps
from typing import Protocol

from loss_note_api import accounts
from loss_note_api.accounts import DEFAULT_ACCOUNT_ID, BuildDefault
from loss_note_api.charts import SLOTS, chart_doc_id
from loss_note_api.read_limits import effective_user_micro

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


class MissingAccount(Exception):
    """取引が指す口座が、その利用者の場所に無い（400）"""


class _NeedDefault(Exception):
    """口座を使うトランザクションの中で、既定の口座がまだ無いと分かった（作ってからやり直す。外へは出さない）"""


class InvalidRecord(Exception):
    """保存済みの値と合わせて初めて分かる本文の誤り（チャートの無い枠に時間足など。400）。issues は既知の欄と種類だけ"""

    def __init__(self, issues: list[dict]):
        super().__init__("invalid")
        self.issues = issues


# 取引の作成: (銘柄, 口座) -> 保存する文書
BuildTrade = Callable[[Doc, Doc], Doc]
# 取引の直し: (今の文書, 付け替え先の銘柄 or None, 付け替え先の口座 or None) -> 新しい文書
# （InvalidRecord を投げれば何も書かない）
MutateTrade = Callable[[Doc, Doc | None, Doc | None], Doc]
# チャートの文書 {contentType, data}。枠（"entry" / "exit"）ごと
Charts = dict[str, Doc]
# 読み取りの上限の判定: (その日の利用者の回数, 利用者の計上額 µUSD, 全体の計上額 µUSD)
# -> "ok" / "user" / "user_spend" / "spend"（read_limits.decide）
DecideRead = Callable[[int, int, int], str]
# 計上の文書の場所（ADR-0010）
READ_DAYS = "statement_read_days"
READ_SPEND = "statement_read_spend"
# 起動の準備（#60）で読む、存在しない決まった文書（書かない。利用者の文書でない）
WARM_COLLECTION = "warmup"
WARM_DOC = "ping"
# 準備の 1 回の読み取りの待ちの上限（秒。起動の確かめ = 3 秒ごと 10 回の内に収める）
WARM_TIMEOUT_SECONDS = 3.0


class Store(Protocol):
    def list_trades(self, uid: str) -> list[tuple[str, Doc]]: ...
    def get_trade(self, uid: str, trade_id: str) -> Doc | None: ...
    # 銘柄・口座の読みと取引の書き込みを 1 つのトランザクションで行う（銘柄の削除と同時でも、
    # 無い銘柄を指す取引を残さない）。銘柄が無ければ MissingInstrument、口座が無ければ MissingAccount
    # （口座が既定の口座で文書が無いときだけ、先に build_default で作ってからやり直す）。
    # charts があれば、同じトランザクションで users/{uid}/charts/{tid}-{slot} を作る（書けなければ取引も無い）
    def create_trade(
        self, uid: str, instrument_id: str, account_id: str, build: BuildTrade, charts: Charts | None = None,
        build_default: BuildDefault = ...,
    ) -> tuple[str, Doc]: ...
    # instrument_id が今の取引の銘柄と違えば、同じトランザクションで付け替え先の銘柄を読んで mutate に渡す。
    # account_id（None = 今の口座のまま）が今の取引の口座（accountId が無ければ既定の口座）と違うときだけ、
    # 付け替え先の口座を読んで mutate に渡す
    def update_trade(
        self, uid: str, trade_id: str, instrument_id: str, account_id: str | None, mutate: MutateTrade,
        build_default: BuildDefault = ...,
    ) -> Doc | None: ...
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

    # 口座（#47）。どれも、既定の口座が無ければ先に build_default(設定) で作ってから行う
    # （移し替え。取引・設定は書かない。作るのは accounts/default の 1 文書だけで、何度・同時に走っても 1 つ）
    def list_accounts(self, uid: str, build_default: BuildDefault) -> list[tuple[str, Doc]]: ...
    def get_account(self, uid: str, account_id: str, build_default: BuildDefault) -> Doc | None: ...
    # 名前が重複すれば Conflict("duplicateName")
    def create_account(self, uid: str, doc: Doc, build_default: BuildDefault) -> str: ...
    def update_account(self, uid: str, account_id: str, mutate: Mutate, build_default: BuildDefault) -> Doc | None: ...

    def get_settings(self, uid: str) -> Doc | None: ...
    def update_settings(self, uid: str, mutate: Callable[[Doc | None], Doc]) -> Doc: ...

    # 明細の読み取りの 1 日の計上（#44・#51）。利用者の日の文書と全体の日の文書を 1 つのトランザクションで読み、
    # decide が "ok" のときだけ利用者の回数 + 1・利用者の金額 + reserve_micro・全体の回数 + 1・
    # 全体の金額 + reserve_micro を書く。decide の結果を返す（同時の要求でも上限を越えて "ok" を返さない）
    def reserve_read(self, uid: str, day: str, decide: DecideRead, reserve_micro: int) -> str: ...
    # 送った後に利用者と全体の金額を delta_micro だけ直す（実額 − 予約額。負もある。2 つを 1 回の書き込みで）
    def settle_read(self, uid: str, day: str, delta_micro: int) -> None: ...

    # 起動の準備（#60）: 最初の要求が払う初期化（クライアント・接続）を先に済ませる。記録を書かない・利用者の文書を
    # 読まない。失敗は例外（起動は止めない。最初の要求で作り直す）
    def warm(self) -> None: ...


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
        # commit の再試行を使い切った: SDK は ValueError を最後の Aborted から上げる（原因が Aborted のときだけ写す。
        # ほかの ValueError はこちらの誤りなので 500 のまま）
        except ValueError as e:
            if isinstance(e.__cause__, gexc.Aborted):
                raise StoreUnavailable("Aborted") from None
            raise

    return wrapper


class FirestoreStore:
    def __init__(self, project_id: str):
        self._project_id = project_id
        self._client = None
        self._client_lock = threading.Lock()

    def _db(self):
        # 起動直後に同時に来た要求でクライアントを 2 度作らない（#60）。作れなければ None のまま = 次の要求で作り直す
        if self._client is None:
            with self._client_lock:
                if self._client is None:
                    from google.cloud import firestore

                    self._client = firestore.Client(project=self._project_id)
        return self._client

    def warm(self):
        """クライアントを作り、存在しない決まった文書を 1 件読む（gRPC の接続・アクセス トークンの取得を先に済ませる）。
        書かない。再試行しない（起動を長く止めない）"""
        self._db().collection(WARM_COLLECTION).document(WARM_DOC).get(timeout=WARM_TIMEOUT_SECONDS, retry=None)

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
    def create_trade(self, uid, instrument_id, account_id, build, charts=None,
                     build_default=accounts.build_default_now):  # fmt: skip
        user = self._user(uid)
        ref = user.collection("trades").document()
        inst_ref = user.collection("instruments").document(instrument_id)

        def body(tx):
            # 読みを全部先に（銘柄 → 口座）。書くのはその後
            inst = inst_ref.get(transaction=tx)
            if not inst.exists:
                raise MissingInstrument()
            account = self._read_account(tx, uid, account_id)
            if account is None:
                raise MissingAccount()
            doc = build(inst.to_dict(), account)
            tx.create(ref, doc)
            for slot, chart in (charts or {}).items():
                tx.create(self._chart_ref(uid, ref.id, slot), chart)
            return ref.id, doc

        return self._with_default(uid, build_default, body)

    @_guard
    def update_trade(self, uid, trade_id, instrument_id, account_id, mutate,
                     build_default=accounts.build_default_now):  # fmt: skip
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
            account = None
            if account_id is not None and account_id != accounts.account_id_of(doc["record"]):
                account = self._read_account(tx, uid, account_id)
                if account is None:
                    raise MissingAccount()
            new = mutate(doc, instrument, account)
            tx.set(ref, new)
            return new

        return self._with_default(uid, build_default, body)

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

    # ── 口座（#47）──
    # 既定の口座の移し替え: 口座を読む・使う入口で accounts/default が無ければ、設定を読んで決まった ID の文書を
    # create（無いときだけ作る。あれば AlreadyExists = ほかの要求が先に作った）。トランザクションの外で 1 文書だけを
    # 作るので、同時に何本走っても読み書きの競合の再試行を使い切らず、文書は 1 つしかできない。取引・設定は書かない。
    # 口座を使うトランザクションの中で既定の口座が無いと分かったら _NeedDefault で抜け、作ってからもう一度だけやり直す
    def _account_ref(self, uid, account_id):
        return self._user(uid).collection("accounts").document(account_id)

    def _read_account(self, tx, uid, account_id):
        snap = self._account_ref(uid, account_id).get(transaction=tx)
        if snap.exists:
            return snap.to_dict()
        if account_id == DEFAULT_ACCOUNT_ID:
            raise _NeedDefault()
        return None

    def _ensure_default(self, uid, build_default):
        from google.api_core import exceptions as gexc

        ref = self._account_ref(uid, DEFAULT_ACCOUNT_ID)
        if ref.get().exists:
            return
        settings_snap = self._user(uid).collection("settings").document("current").get()
        settings = settings_snap.to_dict() if settings_snap.exists else None
        doc = build_default(settings)
        try:
            ref.create(doc)
        except gexc.Conflict:
            # AlreadyExists（Conflict の下位）: ほかの要求が先に作った（作らない）
            return
        accounts.log_default_created(settings, doc)

    def _with_default(self, uid, build_default, body):
        # SDK は commit の Aborted だけを再試行し、トランザクションの中の読みで出た Aborted はそのまま上げる。
        # 移し替えの瞬間は、外の create と、同じ既定の口座を読むトランザクションがぶつかり、
        # 読みの段で Aborted になりうる。
        # 読みの段の Aborted は何も書いていないので、ここでもう 1 回だけやり直す（2 回目も Aborted なら _guard が 503）
        from google.api_core import exceptions as gexc

        need_default_done = False
        aborted_retried = False
        while True:
            try:
                return self._transaction(body)
            except _NeedDefault:
                if need_default_done:
                    raise StoreUnavailable("NeedDefault") from None
                need_default_done = True
                self._ensure_default(uid, build_default)
            except gexc.Aborted:
                if aborted_retried:
                    raise
                aborted_retried = True

    @_guard
    def list_accounts(self, uid, build_default):
        col = self._user(uid).collection("accounts")
        items = [(s.id, s.to_dict()) for s in col.stream()]
        if any(aid == DEFAULT_ACCOUNT_ID for aid, _ in items):
            return items
        # 普段は書かない。既定の口座が無いときだけ作って読み直す
        self._ensure_default(uid, build_default)
        return [(s.id, s.to_dict()) for s in col.stream()]

    @_guard
    def get_account(self, uid, account_id, build_default):
        if account_id == DEFAULT_ACCOUNT_ID:
            self._ensure_default(uid, build_default)
        snap = self._account_ref(uid, account_id).get()
        return snap.to_dict() if snap.exists else None

    @_guard
    def create_account(self, uid, doc, build_default):
        ref = self._user(uid).collection("accounts").document()

        def body(tx):
            # 既定の口座を先に確かめる（無ければ作ってからやり直す = 「口座 1」との重複も見られる）
            self._read_account(tx, uid, DEFAULT_ACCOUNT_ID)
            if self._name_taken(tx, uid, doc["nameKey"], collection="accounts"):
                raise Conflict("duplicateName")
            tx.create(ref, doc)
            return ref.id

        return self._with_default(uid, build_default, body)

    @_guard
    def update_account(self, uid, account_id, mutate, build_default):
        ref = self._account_ref(uid, account_id)

        def body(tx):
            prev = self._read_account(tx, uid, account_id)
            if prev is None:
                return None
            new = mutate(prev)
            if self._name_taken(tx, uid, new["nameKey"], except_id=account_id, collection="accounts"):
                raise Conflict("duplicateName")
            tx.set(ref, new)
            return new

        return self._with_default(uid, build_default, body)

    # ── 銘柄 ──
    def _name_taken(self, tx, uid, key, except_id=None, collection="instruments") -> bool:
        from google.cloud.firestore_v1.base_query import FieldFilter

        q = self._user(uid).collection(collection).where(filter=FieldFilter("nameKey", "==", key)).limit(2)
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

    # ── 明細の読み取りの計上（#44）──
    @_guard
    def reserve_read(self, uid, day, decide, reserve_micro):
        user_ref = self._user(uid).collection(READ_DAYS).document(day)
        spend_ref = self._db().collection(READ_SPEND).document(day)

        def body(tx):
            user_snap = user_ref.get(transaction=tx)
            spend_snap = spend_ref.get(transaction=tx)
            user = user_snap.to_dict() if user_snap.exists else {}
            spend = spend_snap.to_dict() if spend_snap.exists else {}
            count = int(user.get("count", 0))
            # 欠け・負は「数えられない」として回数 × 予約額に見積もる（#51。多めに数える側）
            user_spent = effective_user_micro(count, user.get("microUsd"), reserve_micro)
            spent = int(spend.get("microUsd", 0))
            decision = decide(count, user_spent, spent)
            if decision == "ok":
                tx.set(user_ref, {"count": count + 1, "microUsd": user_spent + reserve_micro})
                tx.set(spend_ref, {"count": int(spend.get("count", 0)) + 1, "microUsd": spent + reserve_micro})
            return decision

        return self._transaction(body)

    @_guard
    def settle_read(self, uid, day, delta_micro):
        from google.cloud import firestore

        if delta_micro == 0:
            return
        # 利用者と全体を 1 回の書き込み（バッチ）で直す（片方だけ直った状態を残さない）
        db = self._db()
        batch = db.batch()
        inc = {"microUsd": firestore.Increment(delta_micro)}
        batch.set(self._user(uid).collection(READ_DAYS).document(day), inc, merge=True)
        batch.set(db.collection(READ_SPEND).document(day), inc, merge=True)
        batch.commit()

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
