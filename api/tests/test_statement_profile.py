"""明細の特徴の鍵の純関数（Issue #66 の AC-2。例 S5・S15・S16 と、利用者・会社が違うとき）。

会社の名前はすべて架空（「架空証券 X」「架空 FX Y」）。行は検査済みの結果の形（``statement_read.result.check_read_row``
の出力のうち鍵に使う ``side_of``・``pnl_currency`` だけ）。
"""

import random
import re

import pytest

from loss_note_api.statement_profile import (
    KEY_PATTERN,
    issuer_key,
    profile_doc,
    profile_key,
    profile_response,
    valid_key,
)

U1 = "profileUser1"
U2 = "profileUser2"
X = "架空証券 X"
Y = "架空 FX Y"


def rows(*currencies, side_of="position"):
    return [{"side_of": side_of, "pnl_currency": c} for c in currencies]


JPY = rows("JPY")


@pytest.mark.parametrize("written", ["架空証券 X", "架空証券Ｘ", " 架空証券 x ", "架空証券　X", "架空証券X"])
def test_s15_same_key_for_written_forms(written):
    # S15: 全角 / 半角・大文字 / 小文字・前後と間の空白の違いは同じ鍵
    assert profile_key(U1, written, JPY) == profile_key(U1, X, JPY)


def test_s16_currency_set_differs():
    # S16: 行の通貨が JPY だけ / USD だけは別の鍵
    assert profile_key(U1, X, rows("JPY")) != profile_key(U1, X, rows("USD"))
    # 集合なので順序と重なりは効かない
    assert profile_key(U1, X, rows("JPY", "USD", "JPY")) == profile_key(U1, X, rows("USD", "JPY"))
    # 不明の行は数えない（読めた行の通貨の集合）
    assert profile_key(U1, X, rows("JPY", "unknown")) == profile_key(U1, X, rows("JPY"))


def test_side_of_set_differs():
    # 行の向きの書き方（建玉の向き / 決済の向き）が違えば別の鍵。読めない（None）行は数えない
    assert profile_key(U1, X, rows("JPY", side_of="position")) != profile_key(U1, X, rows("JPY", side_of="close"))
    mixed = [{"side_of": "position", "pnl_currency": "JPY"}, {"side_of": None, "pnl_currency": "JPY"}]
    assert profile_key(U1, X, mixed) == profile_key(U1, X, JPY)


def test_different_issuer_and_user():
    # 会社が違う / 利用者が違う → 別の鍵（S6・S11）
    assert profile_key(U1, X, JPY) != profile_key(U1, Y, JPY)
    assert profile_key(U1, X, JPY) != profile_key(U2, X, JPY)


@pytest.mark.parametrize("issuer", [None, "", "   ", "　　"])
def test_s5_no_issuer_no_key(issuer):
    # S5: 会社の名前が写っていない（切り取った）→ 鍵なし
    assert profile_key(U1, issuer, JPY) is None
    assert issuer_key(issuer) is None


def test_key_shape_and_no_name():
    key = profile_key(U1, X, JPY)
    assert KEY_PATTERN.fullmatch(key) and valid_key(key)
    assert "架空" not in key and U1 not in key


def test_properties_deterministic_and_distinct():
    # 性質: 同じ材料なら同じ値（決定的）。材料のどれかが違えば別の値（衝突しない。種つき乱数で 500 組）
    rng = random.Random(66)
    seen: dict[str, tuple] = {}
    for i in range(500):
        uid = rng.choice([U1, U2])
        name = f"架空証券 {i % 50}"
        cur = tuple(sorted(rng.sample(["JPY", "USD", "EUR"], rng.randint(1, 2))))
        side = rng.choice(["position", "close"])
        material = (uid, issuer_key(name), cur, side)
        key = profile_key(uid, name, rows(*cur, side_of=side))
        assert key == profile_key(uid, name, rows(*reversed(cur), side_of=side))
        assert re.fullmatch(r"[0-9a-f]{32}", key)
        if key in seen:
            assert seen[key] == material
        seen[key] = material


@pytest.mark.parametrize("bad", ["", "0" * 31, "0" * 33, "G" * 32, "ABCDEF0123456789ABCDEF0123456789", "../x", None, 1])
def test_valid_key_rejects(bad):
    assert valid_key(bad) is False


def test_profile_doc_and_response():
    assert profile_doc("acctA", 123) == {"accountId": "acctA", "updatedAt": 123}
    key = "0" * 32
    assert profile_response(None, None) is None
    assert profile_response(key, None) == {"key": key, "accountId": None}
    assert profile_response(key, {"accountId": "acctA", "updatedAt": 1}) == {"key": key, "accountId": "acctA"}
    assert profile_response(key, {"accountId": 5}) == {"key": key, "accountId": None}
