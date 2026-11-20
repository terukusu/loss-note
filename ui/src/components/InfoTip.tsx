// 「i」の説明の吹き出し（Issue #57 契約 UI-57）。言葉の横の丸い i のボタンを押すと、ボタンの下（3 つの質問は上を先に）に
// 吹き出しが開く。閉じるのは、もう一度押す・Esc・戻る（バックキー・ブラウザの戻る）・吹き出しの外を押す・ほかの「i」を開く。
// 開いてもフォーカスは動かさず、画面も移らず、ダイアログにしない。吹き出しは同時に 1 つ。
// - 説明の文の中の用語集の言葉はボタンのリンク（GlossaryText）。押すとその言葉の説明へ替わり、たどった言葉を 1 つ積む。
//   戻る・Esc・[‹ 前の説明] で 1 つずつ前の説明へ戻り、「i」の言葉で戻ると吹き出しが閉じる（オーナーの要望。#57）。
//   末尾の「用語集で見る」は用語集の画面のその項目へ（#76）
// - 戻るは開いて閉じる層の糊（lib/back-layers.ts）に乗る。開いている間は「i」の言葉で 1 段、たどった言葉ごとに 1 段ずつ
//   履歴に積み、UI で閉じた・戻した段は糊が history.go で戻して数を合わせる
// - 規則は lib/info-tip.ts（開閉 infoNext・たどり infoTrail・位置 infoPlace・中身 infoContent）。ここは状態と測りだけ
// - 位置は絶対配置 + 揃えのクラス（end / fit / above。style 属性を使わない = CSP）。start / end は .info-wrap に対して、
//   fit はボタンを含むカードに対して（左右 8px の内側に広げる。縦はボタンの下 / 上）。start / end には「i」を指す矢印
// - 描く中身は hook を持たない InfoTipView（テストはこちらを関数として呼ぶ）。中身はテキストのノードと部品だけ
// - 当たりは 44×44px で、負の余白でラベルの段の高さを変えない（CSS の .info-wrap）。size="sm" は見た目 16px
import type { Ref } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { backLayers } from '../lib/back-layers';
import { badgeModel } from '../lib/badge';
import type { GlossaryId, GlossaryItem } from '../lib/glossary';
import { glossaryHref } from '../lib/glossary-text';
import {
  type Box,
  type InfoAlign,
  type InfoEvent,
  type InfoSource,
  infoContent,
  infoFocusCloses,
  infoNext,
  infoPlace,
  infoRefocus,
  infoReveal,
  infoTrail,
} from '../lib/info-tip';
import { Link } from '../lib/router';
import { GlossaryText } from './GlossaryText';
import { Icon } from './Icon';

export type InfoTipProps = InfoSource & {
  /** 見た目の大きさ（sm = 16px。小さいラベル「R」・物差しの見出し） */
  readonly size?: 'sm';
  /** 先に試す向き（3 つの質問は above = 説明している選択肢を隠さない） */
  readonly prefer?: 'above' | 'below';
};

export interface InfoTipViewProps {
  readonly source: InfoSource;
  readonly open: boolean;
  readonly trail?: readonly GlossaryId[];
  readonly align?: InfoAlign;
  readonly above?: boolean;
  readonly size?: 'sm' | undefined;
  readonly onPress: () => void;
  /** 文の中の用語集のリンク */
  readonly onLink?: (id: GlossaryId) => void;
  /** [‹ 前の説明]（たどった先を見ている間だけ出す） */
  readonly onUp?: () => void;
  readonly buttonRef: Ref<HTMLButtonElement> | null;
  readonly wrapRef?: Ref<HTMLSpanElement> | null;
  readonly popRef?: Ref<HTMLDivElement> | null;
  /** 今の画面のパス（「用語集で見る」の ?from=。用語集の画面の戻るリンクの名前） */
  readonly from?: string | undefined;
}

export function InfoTipView(p: InfoTipViewProps) {
  const c = infoContent(p.source, p.trail ?? []);
  const align = p.align ?? 'start';
  const wrapCls = `info-wrap${align === 'fit' ? ' info-wrap--fit' : ''}${p.size === 'sm' ? ' info-wrap--sm' : ''}`;
  const cls = `info__pop${align === 'end' ? ' info__pop--end' : align === 'fit' ? ' info__pop--fit' : ''}${
    p.above ? ' info__pop--above' : ''
  }`;
  const text = (t: string) => (
    <GlossaryText text={t} link="button" onLink={(id) => p.onLink?.(id)} />
  );
  return (
    <span class={wrapCls} ref={p.wrapRef ?? null}>
      <button
        ref={p.buttonRef}
        type="button"
        class="info"
        aria-label={c.name}
        aria-expanded={p.open ? 'true' : 'false'}
        aria-controls={p.open ? c.panelId : undefined}
        onClick={p.onPress}
      >
        <Icon name="info" class="info__icon" />
      </button>
      {p.open ? (
        <div id={c.panelId} class={cls} ref={p.popRef ?? null} tabIndex={-1}>
          {c.title ? (
            <>
              <div class="info__nav">
                <button
                  type="button"
                  class="info__up"
                  aria-label={`${c.back}の説明へ戻る`}
                  onClick={() => p.onUp?.()}
                >
                  <Icon name="back" />
                  <span>{c.back}</span>
                </button>
              </div>
              <p class="info__title">{c.title}</p>
            </>
          ) : null}
          {c.lead ? <p class="info__lead">{text(c.lead)}</p> : null}
          {c.body.length > 0 ? (
            <p>
              {c.body.map((b, i) => (
                <span key={i}>{text(b)}</span>
              ))}
            </p>
          ) : null}
          {c.items.length > 0 ? (
            <ul class="info__items">
              {c.items.map((i) => (
                <li key={i.name}>
                  <GradeName name={i.name} grade={i.grade} /> {text(i.text)}
                </li>
              ))}
            </ul>
          ) : null}
          {c.example ? <p class="info__example">{c.example}</p> : null}
          {c.glossary ? (
            <p class="info__more">
              {/* 押せる行の形（文字 + ›。9.12）。吹き出しの面の中に面を重ねない（入れ子 3 段にしない。#33） */}
              <Link class="info__glossary" href={glossaryHref(c.glossary, p.from)}>
                <span>用語集で見る</span>
                <Icon name="chevron" />
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
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

/** 開いている吹き出しの閉じ方（同時に 1 つ。ほかの「i」を開いたら前のものを閉じる） */
let openCloser: (() => void) | null = null;

/** 窓の見える範囲（上の帯・下部の行き先・貼り付きの帯を除く） */
function viewBox(button: DOMRect): Box {
  let top = 0;
  let bottom = window.innerHeight;
  // 上に貼り付いた帯（幅 720 以上の上の帯・画面ごとの上の帯・タブの根の小さな題。#127）
  for (const el of Array.from(document.querySelectorAll('.apphead, .appbar, .rootbar--shown'))) {
    const pos = getComputedStyle(el).position;
    const r = el.getBoundingClientRect();
    if ((pos === 'sticky' || pos === 'fixed') && r.height > 0 && r.top <= 0.5)
      top = Math.max(top, r.bottom);
  }
  for (const el of Array.from(document.querySelectorAll('.appnav, .record__submit'))) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.top >= button.bottom && r.top < bottom) bottom = r.top;
  }
  return { left: 0, right: window.innerWidth, top, bottom };
}

/** 吹き出しを切る祖先の箱（左右は overflow-x、上下は overflow-y が visible でない最も近い祖先。無い向きは無限） */
function clipBox(wrap: HTMLElement): Box | null {
  let x: DOMRect | null = null;
  let y: DOMRect | null = null;
  for (let a = wrap.parentElement; a && a !== document.body && (!x || !y); a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (!x && cs.overflowX !== 'visible') x = a.getBoundingClientRect();
    if (!y && cs.overflowY !== 'visible') y = a.getBoundingClientRect();
  }
  if (!x && !y) return null;
  return {
    left: x ? x.left : Number.NEGATIVE_INFINITY,
    right: x ? x.right : Number.POSITIVE_INFINITY,
    top: y ? y.top : Number.NEGATIVE_INFINITY,
    bottom: y ? y.bottom : Number.POSITIVE_INFINITY,
  };
}

/** ボタンと吹き出しのすき間（CSS の .info__pop の位置と同じ。矢印の分を含む） */
const GAP = 8;

export function InfoTip(p: InfoTipProps) {
  const path = typeof window === 'undefined' ? undefined : window.location.pathname;
  const [open, setOpen] = useState(false);
  const [trail, setTrail] = useState<readonly GlossaryId[]>([]);
  // placed = 開いた後（たどった後）の測りで位置が決まった（決まる前の仮の位置ではスクロールしない）
  const [place, setPlace] = useState<{ align: InfoAlign; above: boolean; placed: number }>({
    align: 'start',
    above: false,
    placed: 0,
  });
  const button = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const c = infoContent(p);
  /** 履歴に積んだ層の数（0 = 閉じている、1 = 「i」の言葉、1 + n = n 個たどった） */
  const layered = useRef(0);
  const layerId = (k: number) => (k === 0 ? c.panelId : `${c.panelId}~${k}`);

  const focusInside = () => {
    const w = wrap.current;
    return w ? w.contains(document.activeElement) : false;
  };
  const close = (ev: InfoEvent) => {
    const inside = focusInside();
    setOpen((o) => infoNext(o, ev));
    setTrail(infoTrail([], { type: 'clear' }));
    if (infoRefocus(ev, inside)) button.current?.focus({ preventScroll: true });
  };
  /** 1 つ前の説明へ（戻る・Esc・[‹ 前の説明]）。「i」の言葉を見ているときは閉じる */
  const up = (ev: InfoEvent) => {
    if (trail.length === 0) {
      close(ev);
      return;
    }
    setTrail((t) => infoTrail(t, { type: 'up', depth: t.length - 1 }));
  };

  // 層の数を、開いている・たどった数に合わせる（積む = 開く、外す = UI で戻した・閉じた）。戻るで外れた層の閉じ方は
  // その段まで戻す（k = 0 なら閉じる）
  useLayoutEffect(() => {
    const layers = backLayers();
    if (!layers) return;
    const want = open ? 1 + trail.length : 0;
    while (layered.current < want) {
      const k = layered.current;
      layers.open(layerId(k), () => {
        layered.current = Math.min(layered.current, k);
        if (k === 0) close('back');
        else setTrail((t) => infoTrail(t, { type: 'up', depth: k - 1 }));
      });
      layered.current++;
    }
    while (layered.current > want) {
      layered.current--;
      layers.close(layerId(layered.current));
    }
  });
  // 外れる（画面を離れる）ときは積んだ層をすべて外す
  useLayoutEffect(
    () => () => {
      const layers = backLayers();
      while (layers && layered.current > 0) {
        layered.current--;
        layers.close(layerId(layered.current));
      }
    },
    [],
  );

  // 開いたら・たどったら位置を決める（揃えは今の中身の幅で決まる）
  useLayoutEffect(() => {
    if (!open) {
      setPlace({ align: 'start', above: false, placed: 0 });
      return;
    }
    const w = wrap.current;
    const b = button.current;
    const el = pop.current;
    if (!w || !b || !el) return;
    const br = b.getBoundingClientRect();
    const pr = el.getBoundingClientRect();
    setPlace((prev) => ({
      ...infoPlace({
        button: br,
        width: pr.width,
        height: pr.height,
        clip: clipBox(w),
        view: viewBox(br),
        gap: GAP,
        prefer: p.prefer ?? 'below',
      }),
      placed: prev.placed + 1,
    }));
  }, [open, trail.length]);

  // 位置が決まった後、下端が見える範囲（下部の行き先・貼り付きの帯の上）からはみ出すなら、その分だけ窓をスクロールする
  // （「i」と吹き出しの上端は隠さない）
  useLayoutEffect(() => {
    if (!open || place.placed === 0) return;
    const b = button.current;
    const el = pop.current;
    if (!b || !el) return;
    const br = b.getBoundingClientRect();
    // 「i」の見た目（当たりの 44px の内側 12px）の上端を隠さない
    const d = infoReveal(el.getBoundingClientRect(), viewBox(br), br.top + 12);
    if (d > 0) window.scrollBy({ top: d, behavior: 'instant' });
  }, [open, place.placed]);

  // たどった・戻った後は吹き出しにフォーカス（押したリンク・[‹ 前の説明] が消えるため。読み上げは新しい見出しから）
  const depthSeen = useRef(0);
  useLayoutEffect(() => {
    if (!open) {
      depthSeen.current = 0;
      return;
    }
    if (trail.length !== depthSeen.current) {
      depthSeen.current = trail.length;
      pop.current?.focus({ preventScroll: true });
    }
  }, [open, trail.length]);

  // 同時に 1 つ・外側を押したら閉じる・Esc（1 つ前へ。「i」の言葉なら閉じる）
  useLayoutEffect(() => {
    if (!open) return;
    const mine = () => close('other');
    openCloser?.();
    openCloser = mine;
    const onDown = (e: PointerEvent) => {
      const w = wrap.current;
      if (w && e.target instanceof Node && w.contains(e.target)) return;
      close('outside');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      up('escape');
    };
    // フォーカスが吹き出しと「i」の外へ出たら閉じる（キーで先の [削除]・[保存] などへ移ったとき。#57 再レビュー B3）
    const onFocus = (e: FocusEvent) => {
      const w = wrap.current;
      if (e.target instanceof Node && infoFocusCloses<Node>(w, e.target)) close('outside');
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      if (openCloser === mine) openCloser = null;
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
    };
  }, [open, trail]);

  return (
    <InfoTipView
      source={p}
      open={open}
      trail={trail}
      align={place.align}
      above={place.above}
      size={p.size}
      onPress={() => {
        if (open) close('press');
        else setOpen(true);
      }}
      onLink={(id) => setTrail((t) => infoTrail(t, { type: 'link', id }))}
      onUp={() => up('press')}
      buttonRef={button}
      wrapRef={wrap}
      popRef={pop}
      from={path}
    />
  );
}
