// 「i」の説明のシート（#129。#57 のたどりと戻る。docs/ui-guidelines.md 9.3・P6）。アプリに 1 つ（殻が InfoHost で画面を
// 包む）。「i」（components/InfoTip.tsx）が文脈 InfoContext で開くことを頼み、ここが下のシートの部品 Sheet で出す。
// - 中の説明の文の用語集の言葉は文と一緒に折れるリンク（GlossaryText。#143）。押すとその言葉の説明へ替わり、たどった言葉を 1 つ積む。
//   たどった言葉ごとに戻るの層を 1 段積み（`〈シートの ID〉~k`）、戻る・Esc・［‹ 〈前の言葉〉］ で 1 つずつ前へ、「i」の言葉で
//   戻るとシートが閉じる（オーナーの要望。#57）。✕・外を押すはシートごと閉じる（lib/sheet.ts の sheetDismiss）
// - 関係する言葉の札（#144。用語集の画面と同じ relatedIds）も押すとその言葉へたどる
// - 末尾の ［用語集で見る］（2 番目の重さのボタン。9.12）は用語集の画面のその項目へ（#76）。画面が替わったらシートを閉じる
// - 描く中身は hook を持たない InfoSheetBody（テストはこちらを関数として呼ぶ）
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { backLayers } from '../lib/back-layers';
import { type GlossaryId, glossaryTerm } from '../lib/glossary';
import { glossaryHref } from '../lib/glossary-text';
import { InfoContext, type InfoHostValue, type InfoRequest } from '../lib/info-context';
import { type InfoContent, infoContent, infoTrail } from '../lib/info-tip';
import { layerPlan, type SheetDismiss, sheetDismiss } from '../lib/sheet';
import { Button } from './Button';
import { followClick, GlossaryText } from './GlossaryText';
import { Icon } from './Icon';
import { GradeName } from './InfoTip';
import { Sheet } from './Sheet';

export interface InfoSheetBodyProps {
  readonly content: InfoContent;
  /** 文の中の用語集のリンク */
  readonly onLink?: (id: GlossaryId) => void;
  /** 今の画面のパス（［用語集で見る］ の ?from=。用語集の画面の戻るボタンの名前） */
  readonly from?: string | undefined;
}

/** 説明の中身（短い説明・続きの文・判定の一覧・例・［用語集で見る］）。hook なし */
export function InfoSheetBody(p: InfoSheetBodyProps) {
  const c = p.content;
  const text = (t: string) => (
    <GlossaryText text={t} link="sheet" onLink={(id) => p.onLink?.(id)} from={p.from} />
  );
  return (
    <div class="info__content">
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
      {c.related.length > 0 ? (
        <div class="info__related">
          <span class="info__related-label" id={`${c.panelId}-related`}>
            関係する言葉
          </span>
          {/* 関係する言葉の札（用語集の画面と同じチップ。9.12。#144）。押すとその言葉へたどる（文の中のリンクと同じ） */}
          <ul class="chips" aria-labelledby={`${c.panelId}-related`}>
            {c.related.map((id) => (
              <li key={id}>
                <a
                  class="chip"
                  href={glossaryHref(id, p.from)}
                  data-term={id}
                  onClick={(e) => followClick(e, id, p.onLink)}
                >
                  {glossaryTerm(id).term}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {c.glossary ? (
        <Button
          variant="secondary"
          block
          class="info__glossary"
          href={glossaryHref(c.glossary, p.from)}
        >
          用語集で見る
        </Button>
      ) : null}
    </div>
  );
}

/** たどった先で見出しの前に置く ［‹ 〈前の言葉〉］（読み上げ「〈前の言葉〉の説明へ戻る」） */
export function InfoUp({ back, onUp }: { readonly back: string; readonly onUp: () => void }) {
  return (
    <button type="button" class="info__up" aria-label={`${back}の説明へ戻る`} onClick={onUp}>
      <Icon name="back" />
      <span>{back}</span>
    </button>
  );
}

export function InfoHost({
  pathKey,
  children,
}: {
  /** 今の画面（替わったらシートを閉じる） */
  readonly pathKey: string;
  readonly children: ComponentChildren;
}) {
  const [req, setReq] = useState<(InfoRequest & { readonly from: string }) | null>(null);
  const [open, setOpen] = useState(false);
  const [trail, setTrail] = useState<readonly GlossaryId[]>([]);
  const c = req ? infoContent(req.source, trail) : null;
  const id = c?.panelId ?? 'info-sheet';
  /** 履歴に積んだたどった段の数（シート自身の段は Sheet が積む） */
  const layered = useRef(0);
  const layerId = (k: number) => `${id}~${k}`;

  /** 今の頼み（消えた「i」の後始末は古い文脈の値からも呼ばれるので、ref で今を見る） */
  const reqRef = useRef(req);
  reqRef.current = req;
  const value = useMemo<InfoHostValue>(
    () => ({
      owner: open && req ? req.owner : null,
      open: (r) => {
        setReq({ ...r, from: typeof window === 'undefined' ? '' : window.location.pathname });
        setTrail([]);
        setOpen(true);
      },
      refresh: (owner, source) => {
        setReq((r) => (r && r.owner === owner ? { ...r, source } : r));
      },
      release: (owner) => {
        if (reqRef.current?.owner === owner) setOpen(false);
      },
    }),
    [open, req],
  );

  // 画面が替わったら閉じる（「用語集で見る」で移った・タブを替えた。router が先に層の記録を捨てている）
  const lastPath = useRef(pathKey);
  useLayoutEffect(() => {
    if (lastPath.current === pathKey) return;
    lastPath.current = pathKey;
    setOpen(false);
  }, [pathKey]);

  // たどった段の層を、たどった数に合わせる（積む = たどった、外す = UI で戻した・閉じた。数合わせは lib/sheet.ts の layerPlan）。
  // 戻るで外れた段の閉じ方はその段の 1 つ前まで戻す。描画のたびに走るが、差が無ければ何もしない。層の ID は今の id（panelId）で
  // 作る: id は開いている間（たどっても）変わらないので、積んだ段と外す段の ID はずれない（#129 のレビュー N7）
  useLayoutEffect(() => {
    const layers = backLayers();
    if (!layers) return;
    const plan = layerPlan(layered.current, open ? trail.length : 0);
    for (const k of plan.open) {
      layers.open(layerId(k), () => {
        layered.current = Math.min(layered.current, k - 1);
        setTrail((t) => infoTrail(t, { type: 'up', depth: k - 1 }));
      });
      layered.current = k;
    }
    for (const k of plan.close) {
      layers.close(layerId(k));
      layered.current = k - 1;
    }
  });

  const onDismiss = (reason: SheetDismiss) => {
    if (sheetDismiss(reason, trail.length) === 'up')
      setTrail((t) => infoTrail(t, { type: 'up', depth: t.length - 1 }));
    else setOpen(false);
  };

  return (
    <InfoContext.Provider value={value}>
      {children}
      <Sheet
        id={id}
        open={open && c !== null}
        title={c?.title ?? ''}
        kind="info"
        {...(req?.prefer ? { prefer: req.prefer } : {})}
        lead={
          c?.back ? (
            <InfoUp
              back={c.back}
              onUp={() => setTrail((t) => infoTrail(t, { type: 'up', depth: t.length - 1 }))}
            />
          ) : null
        }
        focusKey={trail.length}
        onDismiss={onDismiss}
      >
        {c ? (
          <InfoSheetBody
            content={c}
            onLink={(lid) => setTrail((t) => infoTrail(t, { type: 'link', id: lid }))}
            from={req?.from}
          />
        ) : null}
      </Sheet>
    </InfoContext.Provider>
  );
}
