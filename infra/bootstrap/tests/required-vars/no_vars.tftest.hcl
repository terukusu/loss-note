# 例 G1: 変数を何も渡さない plan は、必須の変数の未指定で止まる（既定値で別のプロジェクトに向かない）。
# 必須の変数の未指定は expect_failures で受けられない（テストそのものが失敗する）ので、このテストは「失敗すること」が正しい。
# 既定の terraform test は tests/ の下のディレクトリを読まないので、ここは .github/scripts/tf-required-variables.sh だけが
# -test-directory=tests/required-vars で流し、失敗の出力に出た未指定の変数の名前の集合を検査する。

mock_provider "google" {}
mock_provider "google-beta" {}

run "no_vars" {
  command = plan
}
