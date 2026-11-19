// 判定に関わる言葉の用語集のデータ（「i」の吹き出しと用語集の画面の文。Issue #57・#76）。説明の文はここ 1 か所だけに置き、
// 画面はここから引く。純データ（Preact・DOM に依存しない。関数・undefined を持たず JSON にそのまま直せる。外部の URL を置かない）。
// 文は設計書の定義（3 章の用語・5 章）の言い換えにとどめ、定義を足さない。値・警告は入れない（画面のガイドライン P5）。
// 判定の名前は判定のバッジ（badge.ts）と同じ言葉。例の数はすべて架空の値。
// 文の中の [[id]]・[[id|見せる文字]] は用語集のほかの項目へのリンク（画面は glossary-text.ts の linkSegments で部品に組む。
// HTML の文字列にしない）。[[id]] だけなら見せる文字はその項目の label

export type GlossaryId =
  | 'lc'
  | 'brokenCondition'
  | 'tp'
  | 'oneR'
  | 'r'
  | 'risk'
  | 'riskTolerance'
  | 'capital'
  | 'timeframe'
  | 'gapSlip'
  | 'lcDecided'
  | 'lcMove'
  | 'timeframeChange'
  | 'ruler'
  | 'judgment'
  | 'planRate'
  | 'disciplineCost';

export interface GlossaryItem {
  /** 名前（判定の説明では判定のバッジの名前） */
  readonly name: string;
  readonly text: string;
  /** 判定の名前の項目なら、その判定（バッジと同じ記号を名前の前に出す） */
  readonly grade?: 'A' | 'B' | 'C' | 'safeWin' | 'riskyWin';
}

/** 用語集の区切り（用語集の画面の索引と見出し） */
export type GlossaryGroup = 'plan' | 'action' | 'judge';

export const GLOSSARY_GROUPS: readonly { readonly id: GlossaryGroup; readonly name: string }[] = [
  { id: 'plan', name: '計画の言葉' },
  { id: 'action', name: '決済までの行動' },
  { id: 'judge', name: '判定と図' },
];

export interface GlossaryTerm {
  readonly id: GlossaryId;
  /** 見出しの言葉（ボタンの名前「「〈言葉〉」の説明」・用語集の見出しに使う） */
  readonly term: string;
  /** 文の中のリンクで見せる短い形（LC・1R など） */
  readonly label: string;
  /** 用語集の画面の区切り */
  readonly group: GlossaryGroup;
  /** 短い説明（1 文。吹き出しの先頭・用語集の一覧） */
  readonly summary: string;
  /** 説明の続き（0〜3 文） */
  readonly body: readonly string[];
  /** 名前と 1 行の意味の一覧（判定の 5 つ） */
  readonly items?: readonly GlossaryItem[];
  /** 架空の値の例（1 つまで） */
  readonly example?: string;
  /** 定義のある設計書の節の番号（「5.3」など。設計書の見出しにあることをテストが確かめる） */
  readonly design: readonly string[];
}

export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    id: 'lc',
    group: 'plan',
    term: 'LC',
    label: 'LC',
    summary: '思惑が外れたと確認できる価格です。',
    body: [
      '[[brokenCondition]]を価格にしたもので、金額ではなくチャートで決めます。',
      'LC で切れたときの損失が [[oneR]] です。',
    ],
    design: ['3'],
  },
  {
    id: 'brokenCondition',
    group: 'plan',
    term: '根拠が崩れる条件',
    label: '根拠が崩れる条件',
    summary: 'エントリーの根拠が崩れたと判断できる状態の説明です。',
    body: ['例えば「押し目の安値を割ったら」。この条件を価格にしたものが [[lc]] です。'],
    design: ['3'],
  },
  {
    id: 'tp',
    group: 'plan',
    term: 'TP',
    label: 'TP',
    summary: '利益を確定する目標の価格です。',
    body: ['エントリー時の根拠から推定した値で構いません。'],
    design: ['3'],
  },
  {
    id: 'oneR',
    group: 'plan',
    term: '1R',
    label: '1R',
    summary: '決めた [[lc]] で切れたときの損失（計画のリスク）です。',
    body: [
      'インと LC の幅 × 数量 × 乗数 × 為替で、円で表します。',
      '[[r|R（損益 ÷ 1R）]]の 1 単位になります。',
    ],
    design: ['3', '5.1'],
  },
  {
    id: 'r',
    group: 'plan',
    term: 'R',
    label: 'R',
    summary: 'R は、損益を [[oneR]] で割った値です。',
    body: [
      '計画どおりの [[lc]] で切れれば −1R 前後になります。',
      '金額ではなく R で見ると、数量や銘柄の違う取引を同じ尺度で比べられます。',
    ],
    example:
      '例（架空の値）: ロング、イン 100.00・LC 99.50・決済 99.40 → (99.40 − 100.00) ÷ 0.50 = −1.2R',
    design: ['3', '5.1', '6.3'],
  },
  {
    id: 'risk',
    group: 'plan',
    term: 'リスク（%）',
    label: 'リスク',
    summary: '[[oneR]] が[[capital|資金]]の何 % にあたるかです。',
    body: [
      '[[riskTolerance]]（初期値 1%）に収まっているかを見ます。',
      '2% を超えると、負けなら B 悪い損失（過剰リスク）になります。',
    ],
    design: ['5.1', '5.3'],
  },
  {
    id: 'riskTolerance',
    group: 'plan',
    term: '許容リスク',
    label: '許容リスク',
    summary: '1 回の取引で失ってよい[[capital|資金]]の割合です（初期値 1%）。',
    body: ['[[lc]] で切れたときの損失がこの割合に収まるように、数量を決めます。'],
    design: ['3', '5.2'],
  },
  {
    id: 'capital',
    group: 'plan',
    term: '資金',
    label: '資金',
    summary: '[[risk]] の分母にする、口座の資金です。',
    body: ['設定で口座ごとに決め、取引には記録したときの値を保存します。'],
    design: ['3', '4.6'],
  },
  {
    id: 'timeframe',
    group: 'action',
    term: '時間足',
    label: '時間足',
    summary: 'エントリーの根拠にしたチャートの足（1 分足〜月足）です。',
    body: [
      '計画の一部で、保有中に長い足へ変えて持ち続けると B 悪い損失です（[[timeframeChange]]）。',
    ],
    design: ['3'],
  },
  {
    id: 'gapSlip',
    group: 'action',
    term: '窓・滑り',
    label: '窓・滑り',
    summary: '価格が飛んだり約定が遅れたりして、[[lc]] より不利な価格で決済になることです。',
    body: [
      '窓・滑りで LC より不利に約定しても「LC で切らずに持ち続けた」には数えません（ほかの条件に当たらなければ A いい損失）。',
    ],
    design: ['5.3'],
  },
  {
    id: 'lcDecided',
    group: 'action',
    term: 'LC を入る前に決めていたか',
    label: 'LC を入る前に決めていたか',
    summary: 'エントリーする前に、思惑が外れたと分かる価格（[[lc]]）を決めていたかどうかです。',
    body: ['決めていなかったときは、負けなら C 極悪な損失、勝っても危ない勝ちになります。'],
    design: ['5.3', '5.4'],
  },
  {
    id: 'lcMove',
    group: 'action',
    term: 'LC を動かしたか',
    label: 'LC を動かしたか',
    summary:
      'エントリーした後に、決めた [[lc]] をインに近づけた（狭めた）か、インから遠ざけた（広げた）かです。',
    body: [
      '広げた（リスクが増える向き）ときは、負けなら B 悪い損失、勝っても危ない勝ちになります。',
      '狭めた（リスクが減る向き）ときは、判定に影響しません。',
      '[[r|R の値]]は、動かす前の決めた LC で計ります。',
    ],
    design: ['5.1', '5.3', '5.4'],
  },
  {
    id: 'timeframeChange',
    group: 'action',
    term: '時間足を変えたか',
    label: '時間足を変えたか',
    summary:
      'エントリーの根拠にした[[timeframe]]とは別の足を見て、持ち続けるか決済するかを決めたかどうかです。',
    body: [
      '長い足へ: 例えば 5 分足で入ったのに、含み損になってから日足を見て「まだ崩れていない」と持ち続けた。負けなら B 悪い損失、勝っても危ない勝ちになります。',
      '短い足へ・そのまま: 判定に影響しません。',
    ],
    design: ['3', '5.3', '5.4'],
  },
  {
    id: 'ruler',
    group: 'judge',
    term: 'LC の物差し',
    label: 'LC の物差し',
    summary:
      '入る前に決めた [[lc]] を −1R、インを 0 として、決済・広げた後の LC・[[tp]] の位置を [[r|R（損益 ÷ 1R）]]で並べた図です。',
    body: [
      '決済が −1R より左（損の側）にあれば、決めた LC を超えて負けた幅が太線で見えます。',
      'LC を入る前に決めていなかったときは、後から決めた LC を −1R として破線で示します。',
    ],
    design: ['5.1', '5.3'],
  },
  {
    id: 'judgment',
    group: 'judge',
    term: '判定',
    label: '判定',
    summary: '損益ではなく、エントリーの前に決めた計画を守れたかの判定です。',
    body: [],
    items: [
      {
        name: 'A いい損失',
        grade: 'A',
        text: '決めた [[lc]] で切れた負け（[[gapSlip]]で LC より不利に約定したものも含む）。',
      },
      {
        name: 'B 悪い損失',
        grade: 'B',
        text: '決めたことを崩した負け（[[lcMove|LC を広げた]]・[[timeframeChange|長い足へ変えた]]・LC で切らなかった・2% 超の[[risk|リスク]]・金額ありきの LC・ナンピン）。',
      },
      {
        name: 'C 極悪な損失',
        grade: 'C',
        text: 'LC が無い、または [[lcDecided|入る前に決めていない]]負け。',
      },
      { name: '計画どおりの勝ち', grade: 'safeWin', text: 'B・C の条件のどれにも当たらない勝ち。' },
      {
        name: '危ない勝ち',
        grade: 'riskyWin',
        text: 'B・C の条件のどれかに当たる勝ち。勝っても規律は崩れています。',
      },
    ],
    design: ['5.3', '5.4'],
  },
  {
    id: 'planRate',
    group: 'judge',
    term: '計画どおり率',
    label: '計画どおり率',
    summary:
      '[[judgment]]の出た取引のうち、A いい損失と計画どおりの勝ちの割合で、勝ち負けではなく計画を守れたかを表します。',
    body: [
      '判定の出た取引が 5 件未満の期間は、偶然を癖に見せないよう率を出しません。',
      '取り込んだ取引は、最初は集計に含めません（切り替えで含められます）。',
      '崩れで失った R は [[disciplineCost]] で見ます。',
    ],
    example: '判定の出た 7 件のうち A が 2 件・計画どおりの勝ちが 2 件なら、4 / 7 = 57% です。',
    design: ['6.1'],
  },
  {
    id: 'disciplineCost',
    group: 'judge',
    term: '規律コスト',
    label: '規律コスト',
    summary: '計画どおりに [[lc]] で切れていたらの R と、実際の R の差で、崩れで失った R です。',
    body: [
      'B 悪い損失・C 極悪な損失で −1.0R より大きく負けた取引だけを −1.0R に置き換えて「守っていれば」の R を出します。',
      '危ない勝ちはそのまま数え、運として別に示します。',
      '[[r|R の値]]が出ない取引は入れず、崩れた件数の割合は [[planRate]] で見ます。',
    ],
    example: '−1.6R で負けた B 悪い損失は、守っていれば −1.0R なので、規律コストは −0.6R です。',
    design: ['6.2'],
  },
];

/** ID から項目を引く（GLOSSARY に全 ID があることはテストが確かめる） */
export function glossaryTerm(id: GlossaryId): GlossaryTerm {
  const t = GLOSSARY.find((g) => g.id === id);
  if (!t) throw new Error(`glossary: ${id}`);
  return t;
}

export function isGlossaryId(s: string): s is GlossaryId {
  return GLOSSARY.some((g) => g.id === s);
}
