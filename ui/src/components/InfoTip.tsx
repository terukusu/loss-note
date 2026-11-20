// 「i」の説明のボタン（Issue #57 契約 UI-57。#129 で吹き出しから説明のシートへ。docs/ui-guidelines.md 9.3・P8）。言葉の横の
// 丸い i のボタンを押すと、アプリに 1 つの説明のシート（components/InfoSheet.tsx の InfoHost）が開く。シートの開閉・中の
// 用語集のたどり・戻るの層・フォーカスはシートの側（lib/sheet.ts・lib/info-tip.ts）
// - ボタンの名前は「「〈言葉〉」の説明」、開閉は aria-haspopup="dialog"・aria-expanded・開いている間の aria-controls（シートの ID）
// - 見た目は 20px の丸（size="sm" は 16px）、当たりは 44×44px で、負の余白でラベルの段の高さを変えない（CSS の .info-wrap）
// - 欄の見出し・判定の枠・押せるカードの中に置かれるので、ここに dialog を置かない（中の押下が祖先へ伝わらないように）
// - 描く木は hook を持たない InfoTipView（テストはこちらを関数として呼ぶ）
import type { Ref } from 'preact';
import { useContext, useRef } from 'preact/hooks';
import { badgeModel } from '../lib/badge';
import type { GlossaryItem } from '../lib/glossary';
import { InfoContext } from '../lib/info-context';
import { type InfoSource, infoContent } from '../lib/info-tip';
import { Icon } from './Icon';

export type InfoTipProps = InfoSource & {
  /** 見た目の大きさ（sm = 16px。小さいラベル「R」・物差しの見出し） */
  readonly size?: 'sm';
  /** 広い形の吹き出しで先に試す向き（3 つの質問・物差しは above = 説明している所を隠さない） */
  readonly prefer?: 'above' | 'below';
};

export interface InfoTipViewProps {
  readonly source: InfoSource;
  /** この「i」の説明のシートが開いている */
  readonly open: boolean;
  readonly size?: 'sm' | undefined;
  readonly onPress: () => void;
  readonly buttonRef: Ref<HTMLButtonElement> | null;
}

export function InfoTipView(p: InfoTipViewProps) {
  const c = infoContent(p.source);
  const wrapCls = `info-wrap${p.size === 'sm' ? ' info-wrap--sm' : ''}`;
  return (
    <span class={wrapCls}>
      <button
        ref={p.buttonRef}
        type="button"
        class="info"
        aria-label={c.name}
        aria-haspopup="dialog"
        aria-expanded={p.open ? 'true' : 'false'}
        aria-controls={p.open ? c.panelId : undefined}
        onClick={p.onPress}
      >
        <Icon name="info" class="info__icon" />
      </button>
    </span>
  );
}

/** 判定の名前（判定のバッジと同じ形の記号を前に。記号は読み上げから外す。#57 デザインの再レビュー 4） */
export function GradeName({
  name,
  grade,
}: {
  readonly name: string;
  readonly grade?: GlossaryItem['grade'];
}) {
  const model = grade ? badgeModel(grade) : null;
  return (
    <span class={model ? `info__name info__name--${model.tier}` : 'info__name'}>
      {model ? <Icon name={model.symbol} class="info__grade" /> : null}
      {name}
    </span>
  );
}

export function InfoTip(p: InfoTipProps) {
  const host = useContext(InfoContext);
  /** この「i」の印（同じ言葉の「i」が 2 つあっても、押した方だけが開いて見える） */
  const me = useRef<object>({});
  const open = host !== null && host.owner === me.current;
  return (
    <InfoTipView
      source={p}
      open={open}
      size={p.size}
      onPress={() => host?.open({ source: p, prefer: p.prefer, owner: me.current })}
      buttonRef={null}
    />
  );
}
