"""合成の明細（Issue #14 の R6）: 架空の値の表 → 明細の配置（セルの文字列）と正解。純関数（乱数・I/O なし）。

値はすべて架空。2 つの形（欄の並び・日時の書き方・時間帯・向きの言葉・手数料の欄の分け方）だけを真似て、
ロゴ・配色は入れない（白地・黒字・灰色の罫線、見出しに「合成・架空の値」）。明細を出した会社の名前は実在しない
架空の名前（「架空証券 X」「架空 FX Y」）だけを上部に描く（#66。会社の名前と損益の通貨の読み取りを測る）。

- 形 1（form1。CFD）: 1 行 1 取引。「方向」の欄は建玉そのものの向き（買約定 = L、売約定 = S）。
  日時は 日 / 月 / 年・GMT。損益は円。手数料の欄なし
- 形 2（form2_future・form2_option。先物・オプション）: 「取引」の欄は決済の向き（決済売 = L、決済買 = S）。
  日時は 年 / 月 / 日（日本時間）。数量は枚。建て・決済の手数料と消費税が別の欄。損益は手数料と消費税を引いた後の円。
  オプションは銘柄名に限月・プット / コール・行使価格
- order_type = True の明細は「決済注文」の欄（逆指値 / 成行）を足した版
- currency = "USD" の明細（形 1 だけ。#66）は損益を USD（セント未満は四捨五入）で書き、見出しを「損益 (USD)」にする
- オプションの行（#118）は正解に ``option``（原資産の名前・限月「YYYY-MM」・P / C・行使価格）を持つ。s17〜s19 は
  ポジションのまとまり（同じ原資産・同じ建てた日の 2 本）、年の無い限月（「1月限」。建てた日の翌年）、先物と
  オプションが混ざった明細（form2_mixed。形は形 2 と同じ）、原資産の違うオプションを同じ日に建てた明細
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from .score import parse_statement_datetime

TITLE = "約定明細（合成・架空の値）"
FORMS = ("form1", "form2_future", "form2_option", "form2_mixed")
ORDER_TYPE_LABEL = {"stop": "逆指値", "market": "成行", "limit": "指値"}
# 明細を出した会社の名前（実在しない架空の名前だけ。#66）
ISSUER_X = "架空証券 X"
ISSUER_Y = "架空 FX Y"


@dataclass(frozen=True)
class OptionAnswer:
    """オプションの行の正解（#118。架空）。expiry は「YYYY-MM」（年の無い限月は建てた日から直した値）"""

    underlying: str
    expiry: str
    put_call: str  # put / call
    strike: str


def _op(underlying: str, expiry: str, put_call: str, strike: str) -> OptionAnswer:
    return OptionAnswer(underlying, expiry, put_call, strike)


@dataclass(frozen=True)
class Trade:
    """架空の 1 取引。日時は明細の書き方の文字列（形 1 は DD/MM/YYYY HH:MM、形 2 は YYYY/MM/DD HH:MM）"""

    symbol: str
    side: str  # L / S（建てた向き）
    entry: str
    exit: str
    qty: str
    entry_time: str
    exit_time: str
    multiplier: str  # 1 単位の損益の倍率（円換算を含む。架空）
    fees: tuple[str, ...] | None = None  # 形 2: 建手数料・建消費税・決済手数料・決済消費税
    order_type: str = "unknown"
    option: OptionAnswer | None = None


@dataclass(frozen=True)
class Statement:
    file: str
    form: str
    trades: tuple[Trade, ...]
    order_type_column: bool = False
    # 明細を出した会社の名前（架空）と損益の通貨（#66）。形 1 は「架空 FX Y」、形 2 は「架空証券 X」
    issuer: str | None = None
    currency: str = "JPY"

    @property
    def issuer_name(self) -> str:
        if self.issuer is not None:
            return self.issuer
        return ISSUER_Y if self.form == "form1" else ISSUER_X


@dataclass(frozen=True)
class Layout:
    """描く中身（render.py が描く）。cells は行ごとのセルの文字列（改行で 2 段）"""

    title: str
    subtitle: str
    columns: tuple[str, ...]
    cells: tuple[tuple[str, ...], ...]
    issuer: str = ""  # 上部に描く会社の名前（架空。#66）


def _d(s: str) -> Decimal:
    return Decimal(s)


def gross_pnl(t: Trade) -> Decimal:
    """(決済 − 建て) × 数量 × 倍率。S は符号が逆"""
    sign = 1 if t.side == "L" else -1
    return (_d(t.exit) - _d(t.entry)) * _d(t.qty) * _d(t.multiplier) * sign


def net_pnl(t: Trade, currency: str = "JPY") -> Decimal:
    """手数料と消費税を引いた損益（円は 1 円未満、USD は 1 セント未満を四捨五入）"""
    fees = sum((_d(f) for f in t.fees), Decimal(0)) if t.fees else Decimal(0)
    unit = Decimal(1) if currency == "JPY" else Decimal("0.01")
    return (gross_pnl(t) - fees).quantize(unit, rounding=ROUND_HALF_UP)


def _plain(d: Decimal) -> str:
    """正解の数の文字列（桁区切りなし。整数は小数点なし）"""
    s = format(d, "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _shown(s: str) -> str:
    """明細に描く数（桁区切りあり）"""
    return format(_d(s), ",f")


def _side_word(form: str, side: str) -> str:
    if form == "form1":  # 建玉そのものの向き
        return "買約定" if side == "L" else "売約定"
    return "決済売" if side == "L" else "決済買"  # 決済の向き（L は売って決済）


def _order(form: str) -> str:
    return "DMY" if form == "form1" else "YMD"


# ---- 架空の値の表 ----

_F2_FEE_1 = ("38", "3", "38", "3")
_F2_FEE_2 = ("76", "7", "76", "7")
_OP_FEE_1 = ("275", "27", "275", "27")
_OP_FEE_2 = ("550", "55", "550", "55")

STATEMENTS: tuple[Statement, ...] = (
    Statement("s01.png", "form1", (
        Trade("JP225", "L", "38250", "38610", "10", "04/03/2026 01:15", "04/03/2026 06:40", "1"),
    )),
    Statement("s02.png", "form1", (
        Trade("US30", "S", "42180.5", "42305.5", "2", "17/02/2026 14:30", "17/02/2026 15:05", "150"),
    )),
    Statement("s03.png", "form1", (
        Trade("JP225", "S", "39120", "38870", "5", "20/01/2026 00:45", "20/01/2026 02:10", "1"),
        Trade("USD/JPY", "L", "151.234", "151.534", "100000", "21/01/2026 08:00", "21/01/2026 12:30", "1"),
        Trade("GOLD", "L", "2345.6", "2345.6", "10", "22/01/2026 13:20", "22/01/2026 16:55", "150"),
    )),
    Statement("s04.png", "form1", (
        Trade("JP225", "L", "38840", "38715", "4", "09/01/2026 02:00", "09/01/2026 03:35", "1"),
        Trade("JP225", "S", "38700", "38455", "4", "11/01/2026 05:10", "11/01/2026 07:45", "1"),
    )),
    Statement("s05.png", "form2_future", (
        Trade("日経225mini 26/03", "L", "38250", "38610", "1", "2026/03/04 09:12", "2026/03/04 10:15", "100",
              _F2_FEE_1),
    )),
    Statement("s06.png", "form2_future", (
        Trade("日経225mini 26/03", "S", "38900", "39025", "2", "2026/02/18 13:40", "2026/02/18 14:25", "100",
              _F2_FEE_2),
    )),
    Statement("s07.png", "form2_option", (
        Trade("日経225OP 26/03 P 37500", "S", "120", "85", "1", "2026/02/24 10:05", "2026/02/26 13:50", "1000",
              _OP_FEE_1, option=_op("日経225OP", "2026-03", "put", "37500")),
    )),
    Statement("s08.png", "form2_option", (
        Trade("日経225OP 26/04 C 39500", "L", "210", "150", "2", "2026/03/23 09:30", "2026/03/25 14:10", "1000",
              _OP_FEE_2, option=_op("日経225OP", "2026-04", "call", "39500")),
        Trade("日経225OP 26/04 C 40000", "L", "95", "140", "1", "2026/03/24 11:20", "2026/03/27 10:45", "1000",
              _OP_FEE_1, option=_op("日経225OP", "2026-04", "call", "40000")),
    )),
    Statement("s09.png", "form2_future", (
        Trade("日経225 26/06", "L", "38000", "38250", "5", "2026/05/13 09:00", "2026/05/14 14:30", "1000",
              ("1100", "110", "1100", "110")),
        Trade("日経225mini 26/06", "S", "38480", "38480", "3", "2026/05/15 10:10", "2026/05/15 11:40", "100",
              ("114", "11", "114", "11")),
        Trade("日経225mini 26/06", "L", "38320", "38155", "2", "2026/05/18 13:05", "2026/05/18 14:50", "100",
              _F2_FEE_2),
    )),
    Statement("s10.png", "form1", (
        Trade("US500", "L", "5612.5", "5598.0", "10", "03/04/2026 13:35", "03/04/2026 14:02", "150", None, "stop"),
        Trade("JP225", "S", "37950", "37780", "3", "07/04/2026 01:20", "07/04/2026 04:05", "1", None, "market"),
    ), order_type_column=True),
    Statement("s11.png", "form2_future", (
        Trade("日経225mini 26/06", "L", "37850", "37760", "1", "2026/04/08 09:45", "2026/04/08 10:20", "100",
              _F2_FEE_1, "stop"),
    ), order_type_column=True),
    Statement("s12.png", "form2_option", (
        Trade("日経225OP 26/05 P 36000", "S", "180", "95", "2", "2026/04/14 13:10", "2026/04/16 10:30", "1000",
              _OP_FEE_2, "market", option=_op("日経225OP", "2026-05", "put", "36000")),
    ), order_type_column=True),
    Statement("s13.png", "form1", (
        Trade("USD/JPY", "S", "152.018", "151.703", "50000", "05/06/2026 07:30", "05/06/2026 11:15", "1"),
    )),
    Statement("s14.png", "form2_future", (
        Trade("日経225mini 26/06", "L", "38410", "38575", "1", "2026/06/05 09:20", "2026/06/05 09:55", "100",
              _F2_FEE_1),
        Trade("日経225mini 26/06", "S", "38590", "38665", "1", "2026/06/05 10:40", "2026/06/05 11:30", "100",
              _F2_FEE_1),
    )),
    # #66: 同じ架空の会社（架空 FX Y）の USD 建ての明細（損益は USD・倍率 1 = 1 単位あたり USD）
    Statement("s15.png", "form1", (
        Trade("US500", "L", "5612.5", "5598.25", "2", "08/06/2026 13:35", "08/06/2026 14:02", "1"),
    ), currency="USD"),
    Statement("s16.png", "form1", (
        Trade("US30", "S", "42180.5", "42095.75", "1", "09/06/2026 14:30", "09/06/2026 15:05", "1"),
        Trade("EUR/USD", "L", "1.08425", "1.08190", "10000", "10/06/2026 08:00", "10/06/2026 12:30", "1"),
    ), currency="USD"),
    # #118: プットのバーティカル（売り 36000 + 買い 35500。同じ日に建てた 1 つのポジション）と、別の日に建てたコール
    Statement("s17.png", "form2_option", (
        Trade("日経225OP 26/07 P 36000", "S", "240", "110", "2", "2026/06/10 09:40", "2026/06/24 13:15", "1000",
              _OP_FEE_2, option=_op("日経225OP", "2026-07", "put", "36000")),
        Trade("日経225OP 26/07 P 35500", "L", "150", "70", "2", "2026/06/10 09:41", "2026/06/24 13:16", "1000",
              _OP_FEE_2, option=_op("日経225OP", "2026-07", "put", "35500")),
        Trade("日経225OP 26/07 C 41000", "L", "60", "35", "1", "2026/06/12 10:20", "2026/06/19 14:05", "1000",
              _OP_FEE_1, option=_op("日経225OP", "2026-07", "call", "41000")),
    )),
    # #118: 年の無い限月（「1月限」を 12 月に建てた = 翌年の 1 月）のストラングルの売りと、先物の 1 行が混ざった明細
    Statement("s18.png", "form2_mixed", (
        Trade("日経225OP 1月限 P 37000", "S", "185", "90", "1", "2026/12/08 10:05", "2026/12/22 11:30", "1000",
              _OP_FEE_1, option=_op("日経225OP", "2027-01", "put", "37000")),
        Trade("日経225OP 1月限 C 41500", "S", "130", "205", "1", "2026/12/08 10:06", "2026/12/22 11:31", "1000",
              _OP_FEE_1, option=_op("日経225OP", "2027-01", "call", "41500")),
        Trade("日経225mini 27/03", "L", "39120", "39255", "1", "2026/12/09 09:15", "2026/12/09 10:40", "100",
              _F2_FEE_1),
    )),
    # #118: 同じ日に建てた、原資産の違うオプション（2 つのポジション）
    Statement("s19.png", "form2_option", (
        Trade("TOPIXOP 26/09 C 2850", "L", "18.5", "26", "3", "2026/08/20 09:30", "2026/08/27 14:20", "10000",
              ("660", "66", "660", "66"), option=_op("TOPIXOP", "2026-09", "call", "2850")),
        Trade("日経225OP 26/09 C 40500", "L", "120", "95", "1", "2026/08/20 09:32", "2026/08/27 14:22", "1000",
              _OP_FEE_1, option=_op("日経225OP", "2026-09", "call", "40500")),
    )),
)


# ---- 正解 ----


def answer_row(form: str, t: Trade, currency: str = "JPY") -> dict:
    order = _order(form)
    row = {
        "symbol": t.symbol,
        "side": t.side,
        "entry_price": _plain(_d(t.entry)),
        "entry_time": parse_statement_datetime(t.entry_time, order),
        "exit_price": _plain(_d(t.exit)),
        "exit_time": parse_statement_datetime(t.exit_time, order),
        "qty": _plain(_d(t.qty)),
        "fees": list(t.fees) if t.fees is not None else None,
        "pnl": _plain(net_pnl(t, currency)),
        "pnl_currency": currency,
        "exit_order_type": t.order_type,
    }
    if t.option is not None:
        o = t.option
        row["option"] = {"underlying": o.underlying, "expiry": o.expiry, "put_call": o.put_call,
                         "strike": _plain(_d(o.strike))}
    return row


def answers(statements: tuple[Statement, ...] = STATEMENTS) -> dict:
    """answers.json の中身（作り直しても同じ）"""
    return {
        "schema_version": 1,
        "images": [
            {"file": s.file, "issuer": s.issuer_name, "rows": [answer_row(s.form, t, s.currency) for t in s.trades]}
            for s in statements
        ],
    }


# ---- 場面（AC-2。正解の中身から性質で判定する） ----

SCENES = (
    "form1_long",  # 形 1・L（「買約定」）
    "form1_short",  # 形 1・S（「売約定」）
    "form2_future_close_sell",  # 形 2・先物・決済売
    "form2_option_close_buy",  # 形 2・オプション・決済買
    "day_le_12",  # 日が 12 以下（日 / 月 / 年と年 / 月 / 日の両方）
    "multi_rows",  # 1 枚に 2〜3 行
    "pnl_zero_and_loss",  # 損益 0 円と損失
    "order_type_column",  # 決済の注文の種類の欄（逆指値と成行）
    "decimal_and_separator",  # 小数のある価格・桁区切りのある大きな数
    "pnl_usd",  # 損益が USD の明細（#66）
    "option_position_legs",  # 同じ原資産・同じ建てた日のオプションの行が 2 本以上（1 つのポジション。#118）
    "option_month_no_year",  # 年の無い限月（建てた日から年を直す。#118）
)


def scenes_of(s: Statement) -> list[str]:
    rows = [answer_row(s.form, t, s.currency) for t in s.trades]
    out = []
    sides = {r["side"] for r in rows}
    if s.form == "form1" and "L" in sides:
        out.append("form1_long")
    if s.form == "form1" and "S" in sides:
        out.append("form1_short")
    # 先物とオプションが混ざった明細（form2_mixed）は、先物の行・オプションの行ごとに数える
    fut_sides = {r["side"] for r in rows if "option" not in r}
    opt_sides = {r["side"] for r in rows if "option" in r}
    if (s.form == "form2_future" and "L" in sides) or (s.form == "form2_mixed" and "L" in fut_sides):
        out.append("form2_future_close_sell")
    if (s.form == "form2_option" and "S" in sides) or (s.form == "form2_mixed" and "S" in opt_sides):
        out.append("form2_option_close_buy")
    if any(int(r[k][8:10]) <= 12 and int(r[k][8:10]) != int(r[k][5:7]) for r in rows for k in ("entry_time",
                                                                                            "exit_time")):
        out.append("day_le_12")
    if 2 <= len(rows) <= 3:
        out.append("multi_rows")
    if any(_d(r["pnl"]) <= 0 for r in rows):
        out.append("pnl_zero_and_loss")
    if s.order_type_column:
        out.append("order_type_column")
    if any("." in r[k] for r in rows for k in ("entry_price", "exit_price")) or any(
        abs(_d(r[k])) >= 1000 for r in rows for k in ("qty", "pnl")
    ):
        out.append("decimal_and_separator")
    if s.currency == "USD":
        out.append("pnl_usd")
    opened = [(r["option"]["underlying"], r["entry_time"][:10]) for r in rows if "option" in r]
    if len(opened) != len(set(opened)):
        out.append("option_position_legs")
    if any(t.option is not None and "/" not in t.symbol for t in s.trades):
        out.append("option_month_no_year")
    return out


def manifest(statements: tuple[Statement, ...] = STATEMENTS) -> dict:
    """manifest.json の中身（形と場面の ID だけ。値は持たない）"""
    return {
        "schema_version": 1,
        "images": [
            {
                "file": s.file,
                "form": s.form,
                "order_type_column": s.order_type_column,
                "date_order": _order(s.form),
                "scenes": scenes_of(s),
            }
            for s in statements
        ],
    }


# ---- 配置 ----


def layout(s: Statement) -> Layout:
    """明細の見た目の中身（セルの文字列）"""
    ot = s.order_type_column
    unit = "円" if s.currency == "JPY" else s.currency
    if s.form == "form1":
        cols = ["銘柄", "方向", "数量", "建値", "建玉日時 (GMT)", "決済値", "決済日時 (GMT)", f"損益 ({unit})"]
        if ot:
            cols.insert(7, "決済注文")
        cells = []
        for t in s.trades:
            row = [t.symbol, _side_word(s.form, t.side), _shown(t.qty), _shown(t.entry), t.entry_time,
                   _shown(t.exit), t.exit_time, _shown(_plain(net_pnl(t, s.currency)))]
            if ot:
                row.insert(7, ORDER_TYPE_LABEL.get(t.order_type, ""))
            cells.append(tuple(row))
        sub = "取引履歴（決済済み）・時刻は GMT"
    else:
        cols = ["約定日時", "銘柄", "取引", "数量\n(枚)", "決済単価", "建単価", "建約定日時", "建手数料",
                "建消費税", "決済手数料", "決済消費税", "損益金額\n(円)"]
        if ot:
            cols.insert(5, "決済注文")
        cells = []
        for t in s.trades:
            f = t.fees or ("", "", "", "")
            et, xt = t.entry_time.split(" "), t.exit_time.split(" ")
            row = [f"{xt[0]}\n{xt[1]}", t.symbol, _side_word(s.form, t.side), _shown(t.qty), _shown(t.exit),
                   _shown(t.entry), f"{et[0]}\n{et[1]}", *(_shown(x) for x in f),
                   _shown(_plain(net_pnl(t, s.currency)))]
            if ot:
                row.insert(5, ORDER_TYPE_LABEL.get(t.order_type, ""))
            cells.append(tuple(row))
        futures = s.form in ("form2_future", "form2_mixed")
        sub = "先物・オプション 決済明細" if futures else "先物・オプション 決済明細（オプション）"
    return Layout(title=TITLE, subtitle=sub, columns=tuple(cols), cells=tuple(cells), issuer=s.issuer_name)
