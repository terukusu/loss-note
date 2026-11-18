// 部品の木を関数で展開するテストの補い（#57）。「i」の部品 InfoTip は開閉の状態（hook）を持つので、関数として呼ばず、
// 閉じた状態の InfoTipView（hook を持たない）に置き換えて展開する
import { h, type VNode } from 'preact';
import { InfoTip, type InfoTipProps, InfoTipView } from '../../../ui/src/components/InfoTip';

const noop = () => {};

/** InfoTip の要素なら、閉じた InfoTipView の要素を返す（ほかは null） */
export function closedInfoTip(vn: VNode<Record<string, unknown>>): VNode | null {
  if (vn.type !== (InfoTip as unknown)) return null;
  const { children: _c, ...source } = vn.props ?? {};
  return h(InfoTipView as never, {
    source: source as unknown as InfoTipProps,
    open: false,
    onPress: noop,
    buttonRef: null,
  }) as VNode;
}
