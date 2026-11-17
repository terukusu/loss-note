// ホーム（中身は #9・縦切り 3。#3 は見出しと空の状態）
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function Home() {
  return (
    <>
      <PageHeader
        eyebrow="今日の記録"
        title="ホーム"
        description="決済したら、その場で 30 秒。計画どおりだったかを残します。"
      />
      <EmptyState
        icon="record"
        title="最初の取引を記録しましょう"
        description="決済明細とチャートのスクショを貼り、LC と 3 つのタップで判定が出ます。"
      >
        <Button href="/record" icon="record" size="lg">
          記録する
        </Button>
      </EmptyState>
    </>
  );
}
