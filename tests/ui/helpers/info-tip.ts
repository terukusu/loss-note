// 部品の木を関数で展開するテストの補い（#57）。「i」の部品 InfoTip は開閉の状態（hook）を持つので、関数として呼ばず、
// 閉じた状態の InfoTipView（hook を持たない）に置き換えて展開する。
// 下のシートの部品 Sheet（#129）も hook を持つので、hook を持たない SheetView に置き換える（中身は閉じていても DOM にあるので
// 展開する。開いているかは包みの data-open に写す。記録する画面のシート。#130）
import { h, type VNode } from 'preact';
import { InfoTip, type InfoTipProps, InfoTipView } from '../../../ui/src/components/InfoTip';
import { Sheet, type SheetProps, SheetView } from '../../../ui/src/components/Sheet';

const noop = () => {};

/** InfoTip の要素なら閉じた InfoTipView、Sheet の要素なら SheetView の要素を返す（ほかは null） */
export function closedInfoTip(vn: VNode<Record<string, unknown>>): VNode | null {
  if (vn.type === (Sheet as unknown)) {
    const p = vn.props as unknown as SheetProps;
    const { open, onDismiss, focusKey: _k, ...rest } = p;
    return h(
      'div',
      { 'data-sheet': p.id, 'data-open': open ? 'true' : 'false' },
      h(SheetView as never, { ...rest, onClose: () => onDismiss('button') }),
    ) as VNode;
  }
  if (vn.type !== (InfoTip as unknown)) return null;
  const { children: _c, ...source } = vn.props ?? {};
  return h(InfoTipView as never, {
    source: source as unknown as InfoTipProps,
    open: false,
    onPress: noop,
    buttonRef: null,
  }) as VNode;
}
