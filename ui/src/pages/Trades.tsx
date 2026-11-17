// 取引の一覧（中身は #9。#3 は見出しと空の状態）
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function Trades() {
  return (
    <>
      <PageHeader title="取引の一覧" description="判定・R・リスクで、計画と実行を並べて見ます。" />
      <EmptyState
        icon="list"
        title="まだ取引がありません"
        description="記録した取引がここに並びます。"
      >
        <Button href="/record" icon="record">
          記録する
        </Button>
      </EmptyState>
    </>
  );
}
