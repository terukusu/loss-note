// キーボードの印の間の送信の門（#183。ui/src/lib/keyboard-reveal.ts の notePress・takeSubmit）を、記録する・編集の View の
// <form> の props に偽のイベントを渡して確かめる。DOM のライブラリを使わない（View は hook を持たない）
import { expect } from 'vitest';

interface FormEl {
  readonly props: Record<string, unknown>;
}

/** form = View の <form> の要素、saved = onSave の呼ばれた回数 */
export function checkSubmitGate(form: FormEl, saved: () => number): void {
  let mark: string | null = null;
  let blurred = 0;
  const submitBtn = {
    closest: (sel: string) => (sel === 'button[type="submit"]' ? submitBtn : null),
  };
  const outside = { closest: () => null };
  const field = {
    tagName: 'INPUT',
    getAttribute: (n: string) => (n === 'type' ? 'text' : null),
    isContentEditable: false,
    blur: () => {
      blurred++;
    },
  };
  const fakeForm = {
    ownerDocument: {
      documentElement: { hasAttribute: (n: string) => n === 'data-keyboard' && mark !== null },
      activeElement: field,
    },
    contains: (n: unknown) => n === submitBtn || n === field,
  };
  const handler = (name: string) => form.props[name] as (e: unknown) => void;
  const fire = (type: string, target: unknown) =>
    handler(
      type === 'keydown'
        ? 'onKeyDown'
        : type === 'pointerup'
          ? 'onPointerUp'
          : type === 'pointercancel'
            ? 'onPointerCancel'
            : 'onPointerDown',
    )({ type, currentTarget: fakeForm, target });
  const submit = () => {
    let prevented = false;
    handler('onSubmit')({
      preventDefault: () => {
        prevented = true;
      },
      currentTarget: fakeForm,
    });
    return prevented;
  };
  const start = saved();
  // 4 つの入口は同じ糊
  for (const n of ['onPointerUp', 'onPointerCancel', 'onKeyDown'])
    expect(form.props[n]).toBe(form.props.onPointerDown);
  // 印の間の暗黙の送信（押し始めが無い）は送らない・欄を外さない
  for (const m of ['resize', 'overlay']) {
    mark = m;
    expect(submit()).toBe(true);
  }
  expect(saved() - start).toBe(0);
  expect(blurred).toBe(0);
  // 欄の上で押し始めても数えない
  fire('pointerdown', outside);
  expect(submit()).toBe(true);
  // ［記録する］ / ［保存］ を押し始めて、スクロールに替わった（pointercancel）・ボタンの外で離した（pointerup）・その後に
  // キーを押した（keydown = 欄の Enter の暗黙の送信の前）なら数えない
  for (const end of [
    ['pointercancel', submitBtn],
    ['pointerup', outside],
    ['keydown', field],
  ] as const) {
    fire('pointerdown', submitBtn);
    fire(end[0], end[1]);
    expect(submit()).toBe(true);
  }
  expect(saved() - start).toBe(0);
  // 押したら（ボタンの上で離すのは数えたまま）、フォーカス中の欄を外して（入力を確定させて）から送る。1 回で使い切る
  fire('pointerdown', submitBtn);
  fire('pointerup', submitBtn);
  expect(submit()).toBe(true);
  expect(blurred).toBe(1);
  expect(saved() - start).toBe(1);
  expect(submit()).toBe(true);
  expect(saved() - start).toBe(1);
  // 印が外れれば送る。印の無い送信では欄を外さない（誤りで止まったときにフォーカスを欄に残す）
  mark = null;
  expect(submit()).toBe(true);
  expect(saved() - start).toBe(2);
  expect(blurred).toBe(1);
}
