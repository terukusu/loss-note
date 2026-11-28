"""記録の保存先（Firestore。設計書 4 章・ADR-0004）。

場所は利用者ごと: ``users/{uid}/trades/{id}``・``users/{uid}/instruments/{id}``・``users/{uid}/settings/current``・
``users/{uid}/accounts/{id}``（口座。#47・ADR-0012。既定の口座 ``default`` は口座を読む・使う入口で無ければ、
設定から決まった ID の 1 文書を create で 1 回だけ作る。取引・設定は書かない）・
``users/{uid}/settings/emotionTags``（心理のタグのうち選択肢に出さないものの集合 = ``{hidden, updatedAt}``。
設定の文書 ``current`` とは別の文書。Issue #163・ADR-0023）・
``users/{uid}/charts/{tradeId}-{slot}``（根拠の足のチャート画像。1 文書 1 枚 ``{contentType, data}``。
Issue #12・ADR-0006）・``users/{uid}/statement_profiles/{鍵}``（明細の特徴の覚え = ``{accountId, updatedAt}`` だけ。
Issue #66・ADR-0017）・``users/{uid}/positionGroups/{id}``（両建てのまとまり。メンバーの取引の最上位の逆参照
``positionGroupId`` と同じトランザクションで書く。Issue #266・ADR-0027）。
明細の読み取りの 1 日の計上（Issue #44・ADR-0010、Issue #51・ADR-0014）: 利用者ごと
``users/{uid}/statement_read_days/{YYYY-MM-DD}`` = ``{count, microUsd}``（``microUsd`` は #51 から。欠け・負は
回数 × 予約額に見積もる = ``read_limits.effective_user_micro``）、
全体 ``statement_read_spend/{YYYY-MM-DD}`` =
``{count, microUsd}``（日付は日本時間。日付・回数・金額だけ）。使った量（Issue #62）は利用者の日の文書を
文書 ID の範囲（今月 1 日〜今日）で読むだけ（``read_days_between``）。
チャートは取引の作成・削除・差し替え・外すと同じトランザクションで書く（取引が無いチャート・チャートが書けなかった取引を残さない）。
uid は ``auth.check_claims`` が形を確かめた値、ID は ``schema.ID_PATTERN`` に合う値だけが来る（ほかの利用者の
場所を指せない）。手元・テストはエミュレーター（``FIRESTORE_EMULATOR_HOST`` を google-cloud-firestore が見て、
資格情報なしでつなぐ）。テストでは同じ約束の記憶の保存先（``api/tests/helpers/memory_store.py``）も使う。
"""

import threading
from collections.abc import Callable
from functools import wraps
from typing import Protocol

from loss_note_api import accounts, position_groups, trade_pages, trade_version
from loss_note_api.accounts import DEFAULT_ACCOUNT_ID, BuildDefault
from loss_note_api.charts import SLOTS, chart_doc_id
from loss_note_api.logs import log_event
from loss_note_api.read_limits import USAGE_MAX_DAYS, effective_user_micro

Doc = dict
# 心理のタグの選択肢の設定の文書の ID（users/{uid}/settings/ の下。#163）
EMOTION_SETTINGS_DOC = "emotionTags"
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


class UnknownSchemaVersion(Exception):
    """保存済みの取引の版（schemaVersion）がこの版の知る値より大きい（409。Issue #115・ADR-0020 の決定 7 の (a)）。
    直すと知らない欄（足など）を落とすので、取引の直し・チャートの差し替え・外すは何も書かない"""


def check_known_version(doc: dict) -> None:
    """取引の書き込みのトランザクションの中で、読んだ文書に対して呼ぶ（銘柄・口座・枠を見る前、mutate の前）"""
    if not trade_version.is_known(doc):
        raise UnknownSchemaVersion()


class InvalidRecord(Exception):
    """保存済みの値と合わせて初めて分かる本文の誤り（チャートの無い枠に時間足など。400）。issues は既知の欄と種類だけ"""

    def __init__(self, issues: list[dict]):
        super().__init__("invalid")
        self.issues = issues


# 口座の直し: (今の文書, 取引があるか（呼んだときだけ読む）) -> 新しい文書（Conflict を投げれば何も書かない）
MutateAccount = Callable[[Doc, Callable[[], bool]], Doc]
# 取引の作成: (銘柄, 口座) -> 保存する文書
BuildTrade = Callable[[Doc, Doc], Doc]
# 取引の直し: (今の文書, 付け替え先の銘柄 or None, 付け替え先の口座 or None) -> 新しい文書
# （InvalidRecord・Conflict〔足を落とす本文。#116〕を投げれば何も書かない）。作成の BuildTrade も InvalidRecord を
# 投げれば取引を書かない
MutateTrade = Callable[[Doc, Doc | None, Doc | None], Doc]
# チャートの文書 {contentType, data}。枠（"entry" / "exit"）ごと
Charts = dict[str, Doc]
# 取引の直しのチャートの変更（#89）: 枠 → 置く文書 or None（消す）
ChartChanges = dict[str, Doc | None]
# 両建てのまとまり（#266）: (今のまとまり or None〔作る〕, 読んだ取引 {ID: 文書}) ->
# (まとまりの文書, 書く取引 {ID: 文書})
# （InvalidRecord・Conflict を投げれば何も書かない）
BuildGroup = Callable[[Doc | None, dict[str, Doc]], tuple[Doc, dict[str, Doc]]]
# 解く: (まとまり, 読めたメンバーの取引) -> 書く取引
UnlinkGroup = Callable[[Doc, dict[str, Doc]], dict[str, Doc]]
# 取引を消すときのまとまりの直し: (まとまりの ID, まとまり, 消す取引の ID, 読めたほかのメンバーの取引) ->
# None（書かない）/ (まとまりの新しい文書 or None〔消す〕, 書く取引)
RemoveFromGroup = Callable[[str, Doc, str, dict[str, Doc]], tuple[Doc | None, dict[str, Doc]] | None]
# 取引を直すときのまとまりの直し: (まとまり, 消す前の取引, 直した取引) -> まとまりの新しい文書 or None（書かない）。
# 例外（向きを変えた）を投げれば何も書かない
RegroupTrade = Callable[[Doc, Doc, Doc], Doc | None]
GROUPS = "positionGroups"
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
    # 一覧の 1 ページ（#87・ADR-0016）: 並び order（"exit" / "created"。trade_pages.py）で after（並びの鍵の値。
    # None = 先頭）より後の取引を最大 limit + 1 件読む（続きがあるかを見分ける 1 件を含む）。全件を読まない
    def list_trades_page(self, uid: str, order: str, after: tuple | None, limit: int) -> list[tuple[str, Doc]]: ...
    # 決済の時刻が [start, end) の取引を、決済の新しい順に最大 limit 件（#88・C44）。並べ直すのは呼ぶ側。
    # 単一フィールドの索引（record.exit.time）で読む
    def list_trades_in_exit_range(self, uid: str, start: int, end: int, limit: int) -> list[tuple[str, Doc]]: ...
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
    # refresh = True（#31）なら、銘柄・口座が保存済みと同じでも今の値を読んで mutate に渡す（今の値で写し直す）
    # charts（#89）があれば、同じトランザクションで枠ごとにチャートの文書を置く（文書）・消す（None）。
    # 書けなければ取引も前のまま
    # update_trade・put_chart・delete_chart は、読んだ取引の版を知らなければ何も書かずに UnknownSchemaVersion（#115）
    # regroup（#266）があれば、取引の逆参照の指すまとまりを同じトランザクションで読み、regroup の結果を書く
    def update_trade(
        self, uid: str, trade_id: str, instrument_id: str, account_id: str | None, mutate: MutateTrade,
        build_default: BuildDefault = ..., refresh: bool = False, charts: ChartChanges | None = None,
        regroup: RegroupTrade | None = None,
    ) -> Doc | None: ...
    # 取引とチャートを 1 トランザクションで消す。regroup（#266）があれば、取引の逆参照の指すまとまりとほかのメンバーを
    # 同じトランザクションで読み、regroup の結果（まとまりの直し・消す、メンバーの逆参照）を書く
    def delete_trade(self, uid: str, trade_id: str, regroup: RemoveFromGroup | None = None) -> bool: ...
    # trade_ids のうちある取引だけ（並びは trade_ids の順）
    def get_trades(self, uid: str, trade_ids: list[str]) -> list[tuple[str, Doc]]: ...

    # 両建てのまとまり（#266・ADR-0027）。users/{uid}/positionGroups/{id}。どれもまとまりとメンバーの取引を
    # 1 トランザクションで書く。取引が 1 件でも無ければ何も書かずに None。結ぶ・加える取引の版を知らなければ
    # UnknownSchemaVersion。まとまりの版を知らなければ（PUT・DELETE）UnknownSchemaVersion
    # 一覧は作った新しい順に最大 limit 件（None = すべて）
    def list_position_groups(self, uid: str, limit: int | None) -> list[tuple[str, Doc]]: ...
    def create_position_group(self, uid: str, trade_ids: list[str],
                              build: Callable[[str, dict[str, Doc]], tuple[Doc, dict[str, Doc]]]
                              ) -> tuple[str, Doc] | None: ...  # fmt: skip
    # 今のメンバー（読めたものだけ）と trade_ids の取引を読んで build に渡す。まとまりが無ければ None
    def update_position_group(self, uid: str, group_id: str, trade_ids: list[str],
                              build: BuildGroup) -> Doc | None: ...  # fmt: skip
    # まとまりを消し、unlink の結果を書く。まとまりが無ければ False
    def delete_position_group(self, uid: str, group_id: str, unlink: UnlinkGroup) -> bool: ...

    # チャート（Issue #12）。取引が無ければ None。put は置き換え（無い枠なら作る）、delete はチャートが無ければ None
    # （有無は取引の文書の charts の要約で見る。要約とチャートの文書は常に同じトランザクションで書く）。
    # mutate は取引の文書を受けて新しい文書を返す（要約・時間足・updatedAt）。チャートと取引を 1 トランザクションで書く
    def get_chart(self, uid: str, trade_id: str, slot: str) -> Doc | None: ...
    def put_chart(self, uid: str, trade_id: str, slot: str, chart: Doc, mutate: Mutate) -> Doc | None: ...
    def delete_chart(self, uid: str, trade_id: str, slot: str, mutate: Mutate) -> Doc | None: ...
    # 心理のタグ（#156・ADR-0022）: trade_ids の取引をすべて読み、1 件でも無ければ何も書かずに None。
    # 知らない版が 1 件でもあれば何も書かずに UnknownSchemaVersion。mutate は 1 件の文書を受けて新しい文書を返す。
    # 全件を 1 トランザクションで書く。Good / More（#123・ADR-0024）の入口も同じ口を使う（触る鍵は mutate が決める）
    def set_emotion_tags(self, uid: str, trade_ids: list[str], mutate: Mutate) -> list[Doc] | None: ...

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
    # mutate の 2 つ目の引数を呼ぶと、その口座の取引があるかを同じトランザクションの中で読む（既定の口座は
    # accountId の無い取引も数える）
    def update_account(self, uid: str, account_id: str, mutate: MutateAccount,
                       build_default: BuildDefault) -> Doc | None: ...  # fmt: skip

    def get_settings(self, uid: str) -> Doc | None: ...
    def update_settings(self, uid: str, mutate: Callable[[Doc | None], Doc]) -> Doc: ...

    # 心理のタグの選択肢の設定（#163・ADR-0023）。users/{uid}/settings/emotionTags を丸ごと置き換える
    def get_emotion_settings(self, uid: str) -> Doc | None: ...
    def put_emotion_settings(self, uid: str, doc: Doc) -> None: ...

    # 明細の特徴の覚え（#66・ADR-0017）。users/{uid}/statement_profiles/{鍵} = {accountId, updatedAt}。
    # 読むだけ（明細の読み取り）と、口座の存在の確かめと上書きを 1 つのトランザクションで（覚える入口）。
    # 口座が無ければ MissingAccount（何も書かない）
    def get_statement_profile(self, uid: str, key: str) -> Doc | None: ...
    def put_statement_profile(self, uid: str, key: str, doc: Doc, build_default: BuildDefault) -> None: ...

    # 明細の読み取りの 1 日の計上（#44・#51）。利用者の日の文書と全体の日の文書を 1 つのトランザクションで読み、
    # decide が "ok" のときだけ利用者の回数 + 1・利用者の金額 + reserve_micro・全体の回数 + 1・
    # 全体の金額 + reserve_micro を書く。decide の結果を返す（同時の要求でも上限を越えて "ok" を返さない）
    def reserve_read(self, uid: str, day: str, decide: DecideRead, reserve_micro: int) -> str: ...
    # 送った後に利用者と全体の金額を delta_micro だけ直す（実額 − 予約額。負もある。2 つを 1 回の書き込みで）
    def settle_read(self, uid: str, day: str, delta_micro: int) -> None: ...
    # 使った量（#62）: 利用者の日の文書のうち、日付（文書の ID）が first〜last（両端を含む）のものを日付の順に
    # 最大 31 件読む（書かない。全体の日の文書は読まない）
    def read_days_between(self, uid: str, first: str, last: str) -> list[tuple[str, Doc]]: ...

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
    def list_trades_page(self, uid, order, after, limit):
        from google.api_core import exceptions as gexc
        from google.cloud import firestore

        col = self._user(uid).collection("trades")
        down, up = firestore.Query.DESCENDING, firestore.Query.ASCENDING
        if order == "exit":
            # 複合索引（record.exit.time 降・createdAt 降・__name__ 昇）。infra/bootstrap/firestore.tf
            q = col.order_by("record.exit.time", direction=down).order_by("createdAt", direction=down)
            q = q.order_by("__name__", direction=up)
            fields = ("record.exit.time", "createdAt", "__name__")
        else:
            # 単一フィールドの索引（createdAt）で足りる並び（__name__ は最後の並びと同じ向き）
            q = col.order_by("createdAt", direction=down).order_by("__name__", direction=down)
            fields = ("createdAt", "__name__")
        if after is not None:
            q = q.start_after(dict(zip(fields, after, strict=True)))
        try:
            return [(s.id, s.to_dict()) for s in q.limit(limit + 1).stream()]
        except gexc.FailedPrecondition:
            # 索引がまだ無い・作成中（apply とデプロイの順が前後したとき）: 全件を読んで切る形に一時的に戻す
            log_event(event="trades_page_fallback", reason=f"index_{order}")
            items = [(s.id, s.to_dict()) for s in col.stream()]
            return trade_pages.page_of(items, order, after, limit)

    @_guard
    def list_trades_in_exit_range(self, uid, start, end, limit):
        from google.cloud import firestore
        from google.cloud.firestore_v1.base_query import FieldFilter

        # 同じフィールドの範囲 2 つと同じフィールドの並び = 自動の単一フィールドの索引で足りる（複合の索引は要らない）
        q = self._user(uid).collection("trades").where(filter=FieldFilter("record.exit.time", ">=", start))
        q = q.where(filter=FieldFilter("record.exit.time", "<", end))
        q = q.order_by("record.exit.time", direction=firestore.Query.DESCENDING).limit(limit)
        return [(s.id, s.to_dict()) for s in q.stream()]

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
                     build_default=accounts.build_default_now, refresh=False, charts=None,
                     regroup=None):  # fmt: skip
        user = self._user(uid)
        ref = user.collection("trades").document(trade_id)

        def body(tx):
            snap = ref.get(transaction=tx)
            if not snap.exists:
                return None
            doc = snap.to_dict()
            check_known_version(doc)  # 知らない版は銘柄・口座を読む前に止める（#115）
            instrument = None
            if refresh or instrument_id != doc["record"]["instrumentId"]:
                inst = user.collection("instruments").document(instrument_id).get(transaction=tx)
                if not inst.exists:
                    raise MissingInstrument()
                instrument = inst.to_dict()
            account = None
            target = account_id if account_id is not None else accounts.account_id_of(doc["record"])
            if refresh or target != accounts.account_id_of(doc["record"]):
                account = self._read_account(tx, uid, target)
                if account is None:
                    raise MissingAccount()
            # 両建てのまとまり（#266）: 読みは書きより先
            group_ref, group = self._read_group_of(tx, uid, doc) if regroup else (None, None)
            new = mutate(doc, instrument, account)
            new_group = regroup(group, doc, new) if group is not None else None
            for slot, chart in (charts or {}).items():
                if chart is None:
                    tx.delete(self._chart_ref(uid, trade_id, slot))
                else:
                    tx.set(self._chart_ref(uid, trade_id, slot), chart)
            if new_group is not None:
                tx.set(group_ref, new_group)
            tx.set(ref, new)
            return new

        return self._with_default(uid, build_default, body)

    @_guard
    def delete_trade(self, uid, trade_id, regroup=None):
        trades = self._user(uid).collection("trades")
        ref = trades.document(trade_id)

        def body(tx):
            snap = ref.get(transaction=tx)
            if not snap.exists:
                return False
            # 両建てのまとまり（#266）: まとまりとほかのメンバーを先に読む（読みは書きより先）
            plan = None
            group_ref, group = self._read_group_of(tx, uid, snap.to_dict()) if regroup else (None, None)
            if group is not None:
                others = [tid for tid in position_groups.member_ids(group) if tid != trade_id]
                plan = regroup(group_ref.id, group, trade_id, self._read_trades(tx, uid, others))
            if plan is not None:
                new_group, writes = plan
                if new_group is None:
                    tx.delete(group_ref)
                else:
                    tx.set(group_ref, new_group)
                for tid, doc in writes.items():
                    tx.set(trades.document(tid), doc)
            tx.delete(ref)
            for slot in SLOTS:
                tx.delete(self._chart_ref(uid, trade_id, slot))
            return True

        return self._transaction(body)

    @_guard
    def get_trades(self, uid, trade_ids):
        col = self._user(uid).collection("trades")
        got = {s.id: s.to_dict() for s in self._db().get_all([col.document(t) for t in trade_ids]) if s.exists}
        return [(tid, got[tid]) for tid in trade_ids if tid in got]

    # ── 両建てのまとまり（#266）──
    def _group_ref(self, uid, group_id):
        return self._user(uid).collection(GROUPS).document(group_id)

    def _read_group_of(self, tx, uid, trade_doc):
        """取引の逆参照の指すまとまり (参照, 文書 or None)。逆参照が無ければ (None, None)"""
        gid = trade_doc.get(position_groups.KEY)
        if not isinstance(gid, str) or not gid:
            return None, None
        group_ref = self._group_ref(uid, gid)
        snap = group_ref.get(transaction=tx)
        return group_ref, (snap.to_dict() if snap.exists else None)

    def _read_trades(self, tx, uid, trade_ids):
        """ある取引だけ {ID: 文書}"""
        col = self._user(uid).collection("trades")
        out = {}
        for tid in dict.fromkeys(trade_ids):
            snap = col.document(tid).get(transaction=tx)
            if snap.exists:
                out[tid] = snap.to_dict()
        return out

    @_guard
    def list_position_groups(self, uid, limit):
        from google.cloud import firestore

        q = self._user(uid).collection(GROUPS).order_by("createdAt", direction=firestore.Query.DESCENDING)
        if limit is not None:
            q = q.limit(limit)
        return [(s.id, s.to_dict()) for s in q.stream()]

    @_guard
    def create_position_group(self, uid, trade_ids, build):
        group_ref = self._user(uid).collection(GROUPS).document()
        col = self._user(uid).collection("trades")

        def body(tx):
            trades = self._read_trades(tx, uid, trade_ids)
            if len(trades) != len(trade_ids):
                return None
            for doc in trades.values():
                check_known_version(doc)
            group, writes = build(group_ref.id, trades)
            tx.create(group_ref, group)
            for tid, doc in writes.items():
                tx.set(col.document(tid), doc)
            return group_ref.id, group

        return self._transaction(body)

    @_guard
    def update_position_group(self, uid, group_id, trade_ids, build):
        group_ref = self._group_ref(uid, group_id)
        col = self._user(uid).collection("trades")

        def body(tx):
            snap = group_ref.get(transaction=tx)
            if not snap.exists:
                return None
            group = snap.to_dict()
            if not position_groups.is_known(group):
                raise UnknownSchemaVersion()
            trades = self._read_trades(tx, uid, [*position_groups.member_ids(group), *trade_ids])
            if any(tid not in trades for tid in trade_ids):
                return None
            for tid in trade_ids:
                check_known_version(trades[tid])
            new_group, writes = build(group, trades)
            tx.set(group_ref, new_group)
            for tid, doc in writes.items():
                tx.set(col.document(tid), doc)
            return new_group

        return self._transaction(body)

    @_guard
    def delete_position_group(self, uid, group_id, unlink):
        group_ref = self._group_ref(uid, group_id)
        col = self._user(uid).collection("trades")

        def body(tx):
            snap = group_ref.get(transaction=tx)
            if not snap.exists:
                return False
            group = snap.to_dict()
            if not position_groups.is_known(group):
                raise UnknownSchemaVersion()
            writes = unlink(group, self._read_trades(tx, uid, position_groups.member_ids(group)))
            tx.delete(group_ref)
            for tid, doc in writes.items():
                tx.set(col.document(tid), doc)
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
            doc = snap.to_dict()
            check_known_version(doc)  # #115
            new = mutate(doc)
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
            check_known_version(doc)  # 枠の有無より先（#115）
            if slot not in (doc.get("charts") or {}):
                return None
            new = mutate(doc)
            tx.delete(chart_ref)
            tx.set(ref, new)
            return new

        return self._transaction(body)

    # ── 心理のタグ（#156）──
    @_guard
    def set_emotion_tags(self, uid, trade_ids, mutate):
        col = self._user(uid).collection("trades")
        refs = [col.document(tid) for tid in trade_ids]

        def body(tx):
            # 読みは書きより先（トランザクションの約束）。1 件でも無い・知らない版なら何も書かない
            snaps = [ref.get(transaction=tx) for ref in refs]
            if any(not s.exists for s in snaps):
                return None
            docs = [s.to_dict() for s in snaps]
            for doc in docs:
                check_known_version(doc)
            news = [mutate(doc) for doc in docs]
            for ref, new in zip(refs, news, strict=True):
                tx.set(ref, new)
            return news

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
            new = mutate(prev, lambda: self._account_in_use(tx, uid, account_id))
            if self._name_taken(tx, uid, new["nameKey"], except_id=account_id, collection="accounts"):
                raise Conflict("duplicateName")
            tx.set(ref, new)
            return new

        return self._with_default(uid, build_default, body)

    def _account_in_use(self, tx, uid, account_id) -> bool:
        """その口座の取引が 1 件でもあるか。既定の口座は accountId の無い取引も数える（Firestore は「欄が無い」を
        問い合わせられないので、accountId だけの射影で取引を流して見る。通貨を変えるときだけ呼ぶ）"""
        from google.cloud.firestore_v1.base_query import FieldFilter

        trades = self._user(uid).collection("trades")
        if account_id == DEFAULT_ACCOUNT_ID:
            q = trades.select(["record.accountId"])
            return any(
                accounts.account_id_of((s.to_dict() or {}).get("record") or {}) == DEFAULT_ACCOUNT_ID
                for s in q.get(transaction=tx)
            )
        q = trades.where(filter=FieldFilter("record.accountId", "==", account_id)).limit(1)
        return bool(list(q.get(transaction=tx)))

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

    @_guard
    def read_days_between(self, uid, first, last):
        from google.cloud.firestore_v1.field_path import FieldPath

        # 文書 ID の範囲で読む（読む文書は月の日数まで。費用と速さのため、月の外・全体の日の文書を読まない）
        doc_id = FieldPath.document_id()
        q = (
            self._user(uid).collection(READ_DAYS).order_by(doc_id)
            .start_at({doc_id: first}).end_at({doc_id: last}).limit(USAGE_MAX_DAYS)
        )
        return [(s.id, s.to_dict()) for s in q.stream()]

    # ── 明細の特徴の覚え（#66）──
    def _profile_ref(self, uid, key):
        return self._user(uid).collection("statement_profiles").document(key)

    @_guard
    def get_statement_profile(self, uid, key):
        snap = self._profile_ref(uid, key).get()
        return snap.to_dict() if snap.exists else None

    @_guard
    def put_statement_profile(self, uid, key, doc, build_default):
        ref = self._profile_ref(uid, key)

        def body(tx):
            if self._read_account(tx, uid, doc["accountId"]) is None:
                raise MissingAccount()
            tx.set(ref, doc)

        self._with_default(uid, build_default, body)

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

    # ── 心理のタグの選択肢の設定（#163・ADR-0023。設定の文書 current とは別の文書）──
    @_guard
    def get_emotion_settings(self, uid):
        snap = self._user(uid).collection("settings").document(EMOTION_SETTINGS_DOC).get()
        return snap.to_dict() if snap.exists else None

    @_guard
    def put_emotion_settings(self, uid, doc):
        self._user(uid).collection("settings").document(EMOTION_SETTINGS_DOC).set(doc)
