// 記録する（中身は #13・#15。#3 は見出しと空の状態）
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function Record() {
  return (
    <>
      <PageHeader
        title="記録する"
        description="決済の後に 1 回だけ。スクショを貼り、LC と 3 つのタップで記録します。"
      />
      <ol class="steps" aria-label="記録の流れ">
        <li class="steps__item">
          <span class="steps__no mono">1</span>
          <span>スクショを貼る</span>
        </li>
        <li class="steps__item">
          <span class="steps__no mono">2</span>
          <span>LC と一言</span>
        </li>
        <li class="steps__item">
          <span class="steps__no mono">3</span>
          <span>3 つのタップ</span>
        </li>
      </ol>
      <EmptyState
        icon="image"
        title="記録の入力はまだありません"
        description="決済明細と根拠にした足のチャートを貼る欄が、ここに入ります。"
      />
    </>
  );
}
