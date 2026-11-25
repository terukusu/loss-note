// 画面の検査の単位（screens/*.mjs）の一覧と、状態・画面・変えたファイルから単位への振り分け。
// 新しい画面・状態を足したら、ここで単位に振り分ける（振り分けの無い状態は起動の誤り = 終了コード 2 にする）
import { PAGES, ZOOM_RECORD, ZOOM_SETTINGS } from './base.mjs';
import { RECORD_STATES } from './record-states.mjs';
import { reviewStates } from './review-states.mjs';
import { SETTINGS_STATES } from './settings-states.mjs';

/**
 * 単位の ID（screens/<ID>.mjs）。並びは全体を 1 本で流すときの順。weight は全体の実行で測った所要のおおよその秒
 * （並列のときに重いものから先に始める目安。合計は必要ない）
 */
export const UNITS = [
  { id: 'shell', weight: 120 },
  { id: 'login', weight: 60 },
  { id: 'home', weight: 120 },
  { id: 'trades', weight: 300 },
  { id: 'detail', weight: 240 },
  { id: 'edit', weight: 200 },
  { id: 'review', weight: 200 },
  { id: 'review-more', weight: 150 },
  { id: 'review-insight', weight: 100 },
  { id: 'settings', weight: 240 },
  { id: 'settings-accounts', weight: 100 },
  { id: 'sheets', weight: 300 },
  { id: 'record', weight: 600 },
  { id: 'record-read', weight: 300 },
  { id: 'record-rows', weight: 200 },
  { id: 'record-chart', weight: 200 },
  { id: 'record-account', weight: 200 },
  { id: 'record-fx', weight: 200 },
  { id: 'option', weight: 120 },
];
export const UNIT_IDS = UNITS.map((u) => u.id);

/** 画面のパス（検索の部分は見ない）→ 単位 */
export function unitOfPath(path) {
  const p = path.split('?')[0];
  if (p === '/login') return 'login';
  if (p === '/') return 'home';
  if (p === '/record') return 'record';
  if (p === '/trades') return 'trades';
  if (p === '/dev/parts') return 'shell';
  if (p === '/review') return 'review';
  if (p === '/review/table') return 'review-more';
  if (p === '/review/trades') return 'review-insight';
  if (p === '/settings/accounts' || p === '/settings/instruments') return 'settings-accounts';
  if (p === '/settings' || p.startsWith('/settings/')) return 'settings';
  if (/^\/trades\/[^/]+\/edit$/.test(p)) return 'edit';
  if (/^\/trades\/[^/]+$/.test(p)) return 'detail';
  return null;
}

/** 記録する画面の状態（RECORD_STATES の slug）→ 単位 */
const RECORD_UNIT = {
  record: [
    'record-1-open',
    'record-2-typing',
    'record-3-judged-b',
    'record-4-risky-win',
    'record-5-no-lc-c',
    'record-6-saved',
    'record-6b-saved-emotion',
    'record-6d-saved-more',
    'record-6c-saved-closed',
    'record-13-error',
    'record-14-safe-win',
    'record-20-more-open',
    'record-42-manual',
    'record-28-widen-s-error',
  ],
  'record-read': [
    'record-7-reading',
    'record-8-read',
    'record-8b-read-fields',
    'record-8c-read-missing',
    'record-8d-read-failed',
    'record-8e-read-cancelled',
    'record-10-read-failed',
    'record-11-tall',
    'record-41-read-judged',
    'record-45-read-long-name',
    'record-46-read-real-digits',
  ],
  'record-rows': [
    'record-8f-rows-next',
    'record-8g-rows-next2',
    'record-9-rows',
    'record-9-tz-other',
    'record-9-tz-remembered',
    'record-43-rows-accounts',
    'record-40-stage1-statement',
    'record-45-stage1-removed',
    'record-46-stage1-undo',
    'record-47-reread-reading',
    'record-48-reread-failed',
  ],
  'record-chart': [
    'record-12-charts',
    'record-15-chart-reading',
    'record-16-chart-not-chart',
    'record-17-chart-failed',
    'record-18-chart-suggest',
    'record-19-chart-conflict',
    'record-30-extra-1',
    'record-31-extra-full',
    'record-32-extra-note-err',
    'record-33-extra-fifth',
    'record-44-stage1-chart',
  ],
  'record-account': [
    'record-15-accounts-2',
    'record-15b-accounts-2-top',
    'record-15c-accounts-2-top-default',
    'record-16-accounts-3-long',
    'record-17-accounts-4',
    'record-18-add-open',
    'record-19-add-error',
    'record-29-account-suggested',
    'record-31-account-first',
    'record-32-account-rechosen',
    'record-33-account-currency-mismatch',
    'record-34-accounts-4-suggested',
    'record-35-learned-saved',
  ],
  'record-fx': [
    'record-21-fx',
    'record-22-fx-7digits',
    'record-23-fx-derived',
    'record-24-fx-error',
    'record-25-fx-none',
    'record-25b-fx-empty',
    'record-26-usd-account',
    'record-27-usd-eur',
    'record-28-usd-statement',
    'record-29-usd-unset',
    'record-30-currency-mismatch',
    'record-36-usd-statement-usd',
  ],
  sheets: [
    'record-11-info-tap',
    'record-11b-info-lcmove',
    'record-11c-info-stop',
    'record-12-info-judge',
    'record-13-info-r',
    'record-14-info-ruler',
    'record-15-info-statement',
    'record-16-info-link2',
  ],
};
const RECORD_UNIT_OF = new Map(
  Object.entries(RECORD_UNIT).flatMap(([unit, slugs]) => slugs.map((s) => [s, unit])),
);

/** 記録する画面の状態の slug → 単位（無ければ null） */
export function recordUnitOf(slug) {
  return RECORD_UNIT_OF.get(slug) ?? null;
}

/**
 * 振り返りのタブの状態（review-states.mjs の slug）→ 単位。/review/table・/review/trades は画面のパスで決め
 * （数で見る = review-more、期間の取引 = review-insight）、/review の状態はここで分ける
 */
const REVIEW_MORE = new Set([
  'review-info',
  'review-info-rate',
  'review-clean',
  'review-empty-1d',
  'review-empty-7d',
  'review-empty-1m',
  'review-empty-3m',
  'review-focus-toggle',
  'review-focus',
  'review-imports-off',
  'review-imports-on',
  'review-imports-only',
]);

/** 振り返りのタブの状態の slug → 単位 */
export function reviewUnitOf(slug) {
  const st = reviewStates({}).find(([, , , s]) => s === slug);
  if (!st) return null;
  const byPath = unitOfPath(st[0]);
  if (byPath !== 'review') return byPath;
  if (slug.startsWith('review-insight')) return 'review-insight';
  return REVIEW_MORE.has(slug) ? 'review-more' : 'review';
}

/** 文字の拡大で測る記録する画面の状態のうち、この単位の状態 */
export function zoomRecordStates(unit) {
  return ZOOM_RECORD.map((slug) => RECORD_STATES.find((x) => x.slug === slug)).filter(
    (st) => recordUnitOf(st.slug) === unit,
  );
}

/** 文字の拡大で測る設定の画面の状態のうち、この単位の画面の状態 */
export function zoomSettingsStates(unit) {
  return ZOOM_SETTINGS.map((slug) => SETTINGS_STATES.find((x) => x.slug === slug)).filter(
    (st) => unitOfPath(st.path) === unit,
  );
}

/**
 * 振り分けの検査。どの単位にも入らない画面・状態、2 つの単位に入る状態、知らない単位があれば、その一覧を返す
 * （空なら ok）。起動の前に流し、外れは終了コード 2
 */
export function coverageErrors() {
  const out = [];
  const ids = new Set(UNIT_IDS);
  for (const p of PAGES) {
    const u = unitOfPath(p.path);
    if (!u || !ids.has(u)) out.push(`画面 ${p.path} の単位が無い`);
  }
  const seen = new Map();
  for (const [unit, slugs] of Object.entries(RECORD_UNIT)) {
    if (!ids.has(unit)) out.push(`知らない単位 ${unit}`);
    for (const s of slugs) {
      if (seen.has(s)) out.push(`状態 ${s} が ${seen.get(s)} と ${unit} の 2 つに入る`);
      seen.set(s, unit);
    }
  }
  const slugs = new Set(RECORD_STATES.map((s) => s.slug));
  if (slugs.size !== RECORD_STATES.length) out.push('RECORD_STATES に同じ slug が 2 つある');
  for (const st of RECORD_STATES) {
    if (!seen.has(st.slug))
      out.push(`記録する画面の状態 ${st.slug} の単位が無い（units.mjs の RECORD_UNIT）`);
  }
  for (const s of seen.keys()) {
    if (!slugs.has(s)) out.push(`RECORD_UNIT の ${s} が RECORD_STATES に無い`);
  }
  for (const slug of ZOOM_RECORD) {
    if (!slugs.has(slug)) out.push(`ZOOM_RECORD の ${slug} が RECORD_STATES に無い`);
  }
  for (const st of SETTINGS_STATES) {
    if (!ids.has(unitOfPath(st.path))) out.push(`設定の画面の状態 ${st.slug} の単位が無い`);
  }
  const reviewSlugs = reviewStates({}).map(([, , , s]) => s);
  for (const s of reviewSlugs) {
    if (!ids.has(reviewUnitOf(s))) out.push(`振り返りの状態 ${s} の単位が無い`);
  }
  for (const s of REVIEW_MORE) {
    if (!reviewSlugs.includes(s)) out.push(`REVIEW_MORE の ${s} が振り返りの状態に無い`);
  }
  for (const slug of ZOOM_SETTINGS) {
    if (!SETTINGS_STATES.some((x) => x.slug === slug))
      out.push(`ZOOM_SETTINGS の ${slug} が SETTINGS_STATES に無い`);
  }
  return out;
}

const RECORD_ALL = UNIT_IDS.filter((u) => u.startsWith('record'));

/**
 * 変えたファイル → 流す単位（`--changed`）。上から順に当て、当たった行の単位をすべて足す。
 * 'all' は全体。画面のソース（ui/・core/）で、どの行にも当たらないファイルは全体を流す（共有の部品・トークンなど）
 */
export const CHANGE_RULES = [
  // 共有の部品・殻・トークン（どの画面にも出る）
  [/^ui\/src\/styles\/(tokens|base|layout|components)\.css$/, () => ['all']],
  [/^ui\/src\/(layout|auth)\//, () => ['all']],
  [/^ui\/src\/main\.tsx$|^ui\/src\/App\.tsx$|^ui\/index\.html$|^vite\.config\.ts$/, () => ['all']],
  // 画面ごと
  [
    /^ui\/src\/pages\/Login\.tsx$|GoogleSignIn|GoogleLogo|^ui\/src\/pages\/Forbidden\.tsx$/,
    () => ['login'],
  ],
  [/^ui\/src\/pages\/dev\//, () => ['shell']],
  [
    /^ui\/public\/|InstallApp|install(-prompt|-context)?\.ts$|^ui\/src\/lib\/(routes|tab-nav|router|back-stack|back-layers|theme)\./,
    () => ['shell'],
  ],
  [/Home\.tsx$|HomeCards|home-view|home\.css|StreakStrip|streak\.(ts|css)$/, () => ['home']],
  [
    /Trades\.tsx$|TradeRow|trade-list|trade-pages|trades-(controller|cache)|trades\.css|deletions/,
    () => ['trades', 'detail'],
  ],
  [
    /TradeDetail|TradeNotes|detail-view|detail\.css|trade-detail-controller|Ruler|ruler-view|Resnapshot|resnapshot/,
    () => ['detail', 'edit'],
  ],
  [/TradeEdit|edit-(form|screen|controller)/, () => ['edit']],
  [
    /Emotions?|emotion-|emotions\.css|Reflection|reflection/,
    () => ['detail', 'record', 'review-insight', 'settings'],
  ],
  [
    /Review|review|PeriodPicker|period\.ts|DisciplineCurve/,
    () => ['review', 'review-more', 'review-insight', 'home'],
  ],
  // なぜ・次はの段は振り返りのタブの根にも出る（#228）
  [/InsightCard|WhyCard|insight-view|StreakCard/, () => ['review', 'review-insight']],
  [
    /Settings|settings|AiUsage|ai-usage|export-|download\.ts/,
    () => ['settings', 'settings-accounts'],
  ],
  [/Glossary|glossary|InfoSheet|InfoTip|info-(tip|context)|drafts|draft-status/, () => ['sheets']],
  [/statement-(tz|positions|remove)|zone-memory/, () => ['record-rows', 'record-read']],
  [/statement-(fill|image)|record-screen|RecordArt/, () => ['record-read', 'record-rows']],
  [
    /statement-account|AccountField|AccountAdd|accounts\.ts/,
    () => ['record-account', 'settings-accounts', 'trades', 'detail', 'edit'],
  ],
  [
    /currency|statementFx/,
    () => ['record-fx', 'record-account', 'settings-accounts', 'detail', 'edit'],
  ],
  [/ChartPanel|chart-|charts\.ts/, () => ['record-chart', 'detail', 'edit']],
  [
    /Leg(List|Editor|Table)|legs-form|option-view|legs\.css|^core\/(option|expiry)\.ts$/,
    () => ['option', 'record', 'detail', 'edit'],
  ],
  [/sizing/, () => ['record-fx']],
  [
    /^ui\/src\/(pages\/Record|lib\/record-|lib\/keyboard|lib\/enter-chain|styles\/record\.css|components\/(RecordParts|TradeFields|Verdict))/,
    () => [...RECORD_ALL, 'edit'],
  ],
];

/** 変えたファイルの一覧 → 単位の ID の一覧（全体なら UNIT_IDS）と、全体にした理由のファイル */
export function unitsForChanges(files) {
  const picked = new Set();
  const allBy = [];
  for (const f of files) {
    // 検査そのもの: 単位のファイルはその単位、状態の一覧はそれを測る単位、ほかの共有のファイルは全体
    const unitFile = f.match(/^scripts\/ui-check\/screens\/([\w-]+)\.mjs$/);
    if (unitFile) {
      picked.add(unitFile[1]);
      continue;
    }
    if (f === 'scripts/ui-check/record-states.mjs') {
      for (const u of [...RECORD_ALL, 'sheets']) picked.add(u);
      continue;
    }
    if (f === 'scripts/ui-check/settings-states.mjs') {
      picked.add('settings');
      picked.add('settings-accounts');
      continue;
    }
    if (f === 'scripts/ui-check.mjs' || f.startsWith('scripts/ui-check/')) {
      allBy.push(f);
      continue;
    }
    let hit = false;
    for (const [re, units] of CHANGE_RULES) {
      const m = f.match(re);
      if (!m) continue;
      hit = true;
      for (const u of units(m)) {
        if (u === 'all') allBy.push(f);
        else picked.add(u);
      }
    }
    // 画面のソースでどの行にも当たらないもの（共有の部品・純関数）は全体
    if (!hit && /^(ui|core)\//.test(f)) allBy.push(f);
  }
  if (allBy.length > 0) return { units: [...UNIT_IDS], allBy };
  return { units: UNIT_IDS.filter((u) => picked.has(u)), allBy };
}
