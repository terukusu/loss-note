// 取引の詳細（中身は #9。#3 は取引をまだ読まないので、どの ID でも「見つかりません」= V4）
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function TradeDetail(_props: { readonly id: string }) {
  return (
    <>
      <PageHeader title="取引の詳細" />
      <EmptyState
        icon="list"
        title="この取引は見つかりません"
        description="消されたか、URL が違うようです。"
      >
        <Button href="/trades" variant="secondary" icon="back">
          一覧へ戻る
        </Button>
      </EmptyState>
    </>
  );
}
