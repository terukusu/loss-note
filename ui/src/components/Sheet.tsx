// 下のシート（#129。docs/ui-guidelines.md 9.3・9.7・ADR-0021 の決定 4）。補足と小さな入力の重ね方の部品は 1 つ。
// - <dialog> の showModal()（最上層・フォーカスを中に閉じ込める・後ろを操作できない）。後ろの暗い面は ::backdrop
// - 開いている間は戻るの層（lib/back-layers.ts）に 1 段積み、戻るで閉じる。UI（✕・Esc・外を押す）で閉じたら糊が段を戻す
// - Android の Chrome の close watcher: showModal() の間の戻るは dialog の cancel に回り popstate が出ない。取り消せる cancel は
//   Esc と同じに扱い、取り消せない cancel の後の close（とこちらが頼んでいない close）は UI で閉じたのと同じ（lib/sheet.ts）。
//   キーの Esc は keydown を取り消して自分で扱う（close watcher を通さない = 続けて押しても 1 段ずつ戻る）
// - 開くとフォーカスを見出しへ。閉じたら開いたボタンへ戻す（画面が移ってボタンが外れたときは戻さない）
// - 開いている間は殻（SheetsContext）に知らせ、トーストの取り消しの時間を止める
// - 見せ方は形で替える（同じ要素のクラスと <html data-form> の CSS だけ。縦 = 下から・横 = 右のパネル・広い = 説明は押した所の
//   吹き出し / 入力は中央のダイアログ）。部品は形を知らない。高さは中身で、最大 86dvh で中がスクロールする（#110）
// - 描く木は hook を持たない SheetView（テストはこちらを関数として呼ぶ）。style 属性を使わない（CSP）
import type { ComponentChildren, Ref } from 'preact';
import { useContext, useLayoutEffect, useRef } from 'preact/hooks';
import { backLayers, useBackLayer } from '../lib/back-layers';
import {
  isBackdropHit,
  type SheetDismiss,
  sheetCancel,
  sheetEscapeKey,
  sheetReturnFocus,
} from '../lib/sheet';
import { SheetsContext } from '../lib/sheets-context';
import { IconButton } from './Button';

/** info = 説明と小さな操作（広い形は押した所の吹き出し）、form = 入力のあるもの（広い形は中央のダイアログ） */
export type SheetKind = 'info' | 'form';

export interface SheetViewProps {
  /** dialog の id（開いたボタンの aria-controls） */
  readonly id: string;
  readonly title: string;
  readonly kind?: SheetKind;
  /** 広い形の吹き出しで先に試す向き（3 つの質問・物差しは上 = 説明している所を隠さない） */
  readonly prefer?: 'above' | 'below';
  /** 見出しの前に置くもの（たどった説明の［‹ 前の言葉］など） */
  readonly lead?: ComponentChildren;
  /** ✕ の読み上げの名前（既定「閉じる」。8.1） */
  readonly closeLabel?: string;
  readonly onClose: () => void;
  readonly dialogRef?: Ref<HTMLDialogElement> | null;
  readonly titleRef?: Ref<HTMLHeadingElement> | null;
  readonly bodyRef?: Ref<HTMLDivElement> | null;
  readonly children: ComponentChildren;
}

export function sheetClass(kind: SheetKind, prefer: 'above' | 'below' | undefined): string {
  return `sheet sheet--${kind}${prefer === 'above' ? ' sheet--above' : ''}`;
}

/** シートの木（hook なし）。つまみ・見出しの行（前に置くもの・題・✕）・中身（スクロールする段） */
export function SheetView(p: SheetViewProps) {
  const titleId = `${p.id}-title`;
  return (
    <dialog
      id={p.id}
      ref={p.dialogRef ?? null}
      class={sheetClass(p.kind ?? 'info', p.prefer)}
      aria-labelledby={titleId}
    >
      <div class="sheet__panel">
        <div class="sheet__grip" aria-hidden="true" />
        <div class="sheet__head">
          {p.lead ? <div class="sheet__lead">{p.lead}</div> : null}
          <h2 class="sheet__title" id={titleId} tabIndex={-1} ref={p.titleRef ?? null}>
            {p.title}
          </h2>
          <IconButton
            icon="cross"
            label={p.closeLabel ?? '閉じる'}
            class="sheet__close"
            onClick={p.onClose}
          />
        </div>
        <div class="sheet__body" ref={p.bodyRef ?? null}>
          {p.children}
        </div>
      </div>
    </dialog>
  );
}

export interface SheetProps
  extends Omit<SheetViewProps, 'onClose' | 'dialogRef' | 'titleRef' | 'bodyRef'> {
  readonly open: boolean;
  /**
   * 閉じたい（✕・Esc・外を押す・戻る・close watcher）。呼ぶ側が open を false にする（中でたどった段があれば 1 つ前へ戻すなど、
   * 決めるのは呼ぶ側。規則は lib/sheet.ts の sheetDismiss）。native は「もう閉じた」の知らせで、必ず open を false にする
   * （部品の側は、受けた時点で殻の記録（トーストの時間）とシート自身の戻るの層を外す。呼ぶ側が積んだ層は呼ぶ側が外す）
   */
  readonly onDismiss: (reason: SheetDismiss) => void;
  /** 替わったら見出しへフォーカスを移し、中身のスクロールを先頭へ戻す（中身を替えた = たどった・戻った。押したリンクが消える
   *  ため。題は新しい言葉なのに本文が途中から、にしない） */
  readonly focusKey?: string | number;
}

export function Sheet(p: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  /** 今の ID（出来事の手は最初の描画で作るので、ID は ref で読む） */
  const idNow = useRef(p.id);
  idNow.current = p.id;
  const opener = useRef<HTMLElement | null>(null);
  /** こちらが close() を呼んでいる最中（その close の出来事は利用者の閉じではない） */
  const closing = useRef(false);
  /** 押し始めの的（外を押したかの判定） */
  const downAt = useRef<EventTarget | null>(null);
  const sheets = useContext(SheetsContext);
  /** 殻に開いたと知らせた ID（閉じる・外れるときに同じ ID で知らせる） */
  const told = useRef<string | null>(null);
  const dismiss = useRef(p.onDismiss);
  dismiss.current = p.onDismiss;

  // 戻るで閉じる（層の段から下りた）
  useBackLayer(p.id, p.open, () => dismiss.current('back'));

  // 開く・閉じる
  useLayoutEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (p.open) {
      if (!d.open) {
        const a = document.activeElement;
        opener.current = a instanceof HTMLElement && a !== document.body ? a : null;
        try {
          d.showModal();
        } catch {
          // 文書に無い・ほかの理由で開けない: 開かない（例外を外へ出さない）
          return;
        }
        told.current = p.id;
        sheets?.opened(p.id);
      }
      title.current?.focus({ preventScroll: true });
      return;
    }
    if (d.open) {
      closing.current = true;
      d.close();
      closing.current = false;
    }
    if (told.current !== null) sheets?.closed(told.current);
    told.current = null;
    restoreFocus(d);
  }, [p.open]);

  // 中身を替えたら見出しへ（読み上げは新しい見出しから）
  const seenKey = useRef(p.focusKey);
  useLayoutEffect(() => {
    if (seenKey.current === p.focusKey) return;
    seenKey.current = p.focusKey;
    if (!p.open) return;
    if (body.current) body.current.scrollTop = 0;
    title.current?.focus({ preventScroll: true });
  }, [p.focusKey, p.open]);

  // 外れる（画面を離れる）ときに開いていれば閉じる
  useLayoutEffect(
    () => () => {
      const d = dialog.current;
      if (d?.open) {
        closing.current = true;
        d.close();
        closing.current = false;
      }
      if (told.current !== null) sheets?.closed(told.current);
      told.current = null;
    },
    [],
  );

  // cancel（Esc・close watcher）・close（取り消せない close watcher など）・外を押す
  useLayoutEffect(() => {
    const d = dialog.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      if (sheetCancel(e.cancelable) === 'native') return;
      e.preventDefault();
      dismiss.current('escape');
    };
    const onClose = () => {
      if (closing.current) return;
      // こちらが頼んでいない close（取り消せない close watcher）: UI で閉じたのと同じ。呼ぶ側を待たずに、殻の記録（トーストの
      // 時間）とシート自身の戻るの層を外す（呼ぶ側が open を false にし忘れても止まったままにしない。#129 のレビュー N3）
      if (told.current !== null) sheets?.closed(told.current);
      told.current = null;
      backLayers()?.close(idNow.current);
      dismiss.current('native');
    };
    // Esc の keydown を自分で扱う（取り消して close request を出さない）。Esc の close watcher は、操作をはさまずに続けて押すと
    // 2 回目を取り消させずシートごと閉じるため、たどった段を 1 つずつ戻れなくなる（#129 のレビュー N1）
    const onKey = (e: KeyboardEvent) => {
      if (!sheetEscapeKey(e)) return;
      e.preventDefault();
      dismiss.current('escape');
    };
    const onDown = (e: PointerEvent) => {
      downAt.current = e.target;
    };
    const onClick = (e: MouseEvent) => {
      const down = downAt.current;
      downAt.current = null;
      if (isBackdropHit(down, e.target, d)) dismiss.current('backdrop');
    };
    d.addEventListener('cancel', onCancel);
    d.addEventListener('close', onClose);
    d.addEventListener('keydown', onKey);
    d.addEventListener('pointerdown', onDown);
    d.addEventListener('click', onClick);
    return () => {
      d.removeEventListener('cancel', onCancel);
      d.removeEventListener('close', onClose);
      d.removeEventListener('keydown', onKey);
      d.removeEventListener('pointerdown', onDown);
      d.removeEventListener('click', onClick);
    };
  }, []);

  function restoreFocus(d: HTMLDialogElement) {
    const o = opener.current;
    opener.current = null;
    if (!o) return;
    const a = document.activeElement;
    const focus = !a || a === document.body ? 'body' : d.contains(a) ? 'inside' : 'outside';
    if (sheetReturnFocus({ openerConnected: o.isConnected, focus }))
      o.focus({ preventScroll: true });
  }

  return (
    <SheetView
      id={p.id}
      title={p.title}
      {...(p.kind ? { kind: p.kind } : {})}
      {...(p.prefer ? { prefer: p.prefer } : {})}
      lead={p.lead}
      {...(p.closeLabel ? { closeLabel: p.closeLabel } : {})}
      onClose={() => dismiss.current('button')}
      dialogRef={dialog}
      titleRef={title}
      bodyRef={body}
    >
      {p.children}
    </SheetView>
  );
}
