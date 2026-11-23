// 部品の見本（開発の時だけ。/dev/parts）。オーナーが見た目を確かめる場所。値はすべて架空。
// 本番のビルドには入らない（devPages.ts）
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Grade } from '../../../../core/judge';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Icon, type IconName } from '../../components/Icon';
import { InfoTip } from '../../components/InfoTip';
import { JudgeBadge } from '../../components/JudgeBadge';
import { RNum, YenNum } from '../../components/Num';
import { NumberField } from '../../components/NumberField';
import { PageHeader } from '../../components/PageHeader';
import { Segment } from '../../components/Segment';
import { TextField } from '../../components/TextField';
import { badgeModel, TIER_NAME } from '../../lib/badge';
import './parts.css';

const BADGES: readonly { id: string; grade: Grade | null }[] = [
  { id: 'J1', grade: 'A' },
  { id: 'J2', grade: 'safeWin' },
  { id: 'J3', grade: 'B' },
  { id: 'J4', grade: 'riskyWin' },
  { id: 'J5', grade: 'C' },
  { id: 'J6', grade: null },
];

const R_EXAMPLES: readonly { id: string; input: string; value: number | null }[] = [
  { id: 'N1', input: '2.34', value: 2.34 },
  { id: 'N2', input: '−1', value: -1 },
  { id: 'N3', input: '−1.25', value: -1.25 },
  { id: 'N4', input: '0', value: 0 },
  { id: 'N5', input: '−0.04', value: -0.04 },
  { id: 'N6', input: '0.04', value: 0.04 },
  { id: 'N7', input: 'LC なし', value: null },
];

const YEN_EXAMPLES: readonly { id: string; input: string; value: number }[] = [
  { id: 'N8', input: '12345', value: 12345 },
  { id: 'N9', input: '−1234.5', value: -1234.5 },
  { id: 'N10', input: '0', value: 0 },
];

const SWATCHES: readonly string[] = [
  'bg',
  's1',
  's2',
  's3',
  'line-2',
  'ink',
  'ink-2',
  'ink-3',
  'accent',
  'danger',
  'tier-plan',
  'tier-break',
  'tier-worst',
  'tier-neutral',
];

const ICONS: readonly IconName[] = [
  'home',
  'record',
  'list',
  'settings',
  'circle',
  'triangle',
  'cross',
  'dash',
  'check',
  'logout',
  'back',
  'moon',
  'sun',
  'image',
  'lock',
  'mark',
];

function Section(p: { title: string; note?: string; children: ComponentChildren }) {
  return (
    <section class="card section">
      <h2 class="section__title">{p.title}</h2>
      {p.note ? <p class="section__note">{p.note}</p> : null}
      {p.children}
    </section>
  );
}

export function Parts() {
  const [lcDecided, setLcDecided] = useState<'yes' | 'no' | null>('yes');
  const [lcMoved, setLcMoved] = useState<'kept' | 'widened' | 'tightened' | null>(null);
  const [tf, setTf] = useState<'same' | 'longer' | 'shorter' | null>('same');
  const [lc, setLc] = useState('38250');
  const [entry, setEntry] = useState('38,25.0');
  const [name, setName] = useState('架空指数A');
  const [when, setWhen] = useState('2026-03-04T10:00');

  return (
    <div class="parts">
      <PageHeader
        eyebrow="開発の時だけ"
        title="部品の見本"
        description="トークンと部品の見た目を確かめる画面です。値はすべて架空です。"
      />

      <section class="hero card" aria-label="記録の後に出る形の見本">
        <div class="hero__badge">
          <JudgeBadge grade="riskyWin" size="lg" />
        </div>
        <div class="hero__stats">
          <div class="stat">
            <span class="stat__label">R</span>
            <RNum value={2.34} size="xl" />
          </div>
          <div class="stat">
            <span class="stat__label">損益</span>
            <YenNum value={12345} size="lg" />
          </div>
        </div>
        <p class="hero__reason">LC を広げた後に戻った勝ち。勝っても、規律は崩れています。</p>
      </section>

      <Section
        title="判定のバッジ"
        note="色は損益ではなく規律を表します。文字・記号・色の 3 つで、色だけに頼りません。"
      >
        <ul class="badge-list">
          {BADGES.map((b) => {
            const m = badgeModel(b.grade);
            return (
              <li key={b.id} class="badge-list__row">
                <span class="badge-list__id mono">{b.id}</span>
                <JudgeBadge grade={b.grade} />
                <span class="badge-list__tier">{TIER_NAME[m.tier]}</span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        title="R と円の数字"
        note="色を付けず、符号と単位で読みます。マイナスは記号の −、0 は ±。"
      >
        <dl class="num-table">
          {[...R_EXAMPLES, ...YEN_EXAMPLES].map((n) => (
            <div key={n.id} class="num-table__row">
              <dt>
                <span class="num-table__id mono">{n.id}</span>
                <span class="num-table__input">{n.input}</span>
              </dt>
              <dd>
                {n.id === 'N8' || n.id === 'N9' || n.id === 'N10' ? (
                  <YenNum value={n.value as number} size="lg" />
                ) : (
                  <RNum value={n.value} size="lg" />
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="タップ（セグメント）" note="矢印キーでも選べます。">
        <div class="stack">
          <Segment
            label="LC を入る前に決めていたか"
            value={lcDecided}
            onChange={setLcDecided}
            options={[
              { value: 'yes', label: '決めていた' },
              { value: 'no', label: '決めていない' },
            ]}
          />
          <Segment
            label="LC を動かしたか"
            value={lcMoved}
            onChange={setLcMoved}
            options={[
              { value: 'kept', label: 'そのまま' },
              { value: 'tightened', label: '狭めた' },
              { value: 'widened', label: '広げた' },
            ]}
          />
          <Segment
            label="時間足を変えたか"
            value={tf}
            onChange={setTf}
            options={[
              { value: 'same', label: 'そのまま' },
              { value: 'longer', label: '長い足へ' },
              { value: 'shorter', label: '短い足へ' },
            ]}
          />
        </div>
      </Section>

      <Section
        title="言葉の説明（i）"
        note="押すと説明のシートが開きます（#129）。文の中の言葉で用語集をたどり、戻るで 1 つずつ戻ります（#57）。"
      >
        <p class="field__head">
          <span class="field__label">判定</span>
          <InfoTip term="judgment" id="parts-info-judgment" />
          <span class="field__label">R</span>
          <InfoTip term="r" size="sm" id="parts-info-r" />
        </p>
      </Section>
      <Section title="入力欄">
        <div class="stack">
          <NumberField
            id="parts-lg"
            label="イン（大きい数字）"
            size="lg"
            value="100.00"
            onInput={() => {}}
          />
          <NumberField
            id="parts-disabled"
            label="止めた欄"
            value=""
            placeholder="なし"
            disabled
            onInput={() => {}}
          />
          <TextField id="parts-name" label="銘柄（文字）" value={name} onInput={setName} />
          <TextField
            id="parts-when"
            label="決済の時刻（日時）"
            type="datetime-local"
            value={when}
            onInput={setWhen}
          />
          <TextField
            id="parts-name-error"
            label="銘柄（誤り）"
            value={'あ'.repeat(41)}
            onInput={() => {}}
            error="40 字までで、制御文字を含めないでください"
          />
          <NumberField
            id="parts-lc"
            label="LC"
            value={lc}
            onInput={setLc}
            unit="円"
            hint="思惑が外れたと確認できる価格"
          />
          <NumberField
            id="parts-entry"
            label="イン"
            value={entry}
            onInput={setEntry}
            unit="円"
            error="数字で入れてください"
          />
        </div>
      </Section>

      <Section title="ボタン">
        <div class="row-wrap">
          <Button icon="record">記録する</Button>
          <Button variant="secondary">保存する</Button>
          <Button variant="secondary">キャンセル</Button>
          <Button variant="tonal" icon="undo">
            元に戻す
          </Button>
          <Button variant="secondary" size="sm" icon="edit">
            編集
          </Button>
          <Button disabled>押せない</Button>
        </div>
        <Button size="lg" block icon="record">
          記録する
        </Button>
      </Section>

      <Section title="空の状態">
        <EmptyState
          icon="list"
          title="まだ取引がありません"
          description="記録した取引がここに並びます。"
        >
          <Button variant="secondary">記録する</Button>
        </EmptyState>
      </Section>

      <Section title="色のトークン" note="色の値は tokens.css のテーマの定義の中だけにあります。">
        <ul class="swatches">
          {SWATCHES.map((s) => (
            <li key={s} class="swatches__item">
              <span class={`swatch swatch--${s}`} />
              <code class="swatches__name">--{s}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="記号">
        <ul class="icons">
          {ICONS.map((name) => (
            <li key={name} class="icons__item">
              <Icon name={name} />
              <code>{name}</code>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
