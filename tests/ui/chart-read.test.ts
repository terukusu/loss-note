// チャートの時間足の読み取りの純関数（Issue #27）: 応答の検査・失敗の文言・欄への反映
import { describe, expect, it } from 'vitest';
import { TIMEFRAMES } from '../../core/trade';
import {
  applyChartRead,
  CHART_READ_MSG,
  CHART_READ_NOTICE,
  CHART_SEND_INFO,
  chartReadFailureMessage,
  parseChartReadResponse,
  suggestButton,
  suggestText,
  timeframeConflict,
} from '../../ui/src/lib/chart-read';

describe('parseChartReadResponse', () => {
  it('kind と列挙の timeframe だけを受ける', () => {
    for (const tf of TIMEFRAMES) {
      expect(parseChartReadResponse({ kind: 'chart', timeframe: tf })).toEqual({
        kind: 'chart',
        timeframe: tf,
      });
    }
    expect(parseChartReadResponse({ kind: 'chart', timeframe: null })).toEqual({
      kind: 'chart',
      timeframe: null,
    });
    expect(parseChartReadResponse({ kind: 'not_chart', timeframe: null })).toEqual({
      kind: 'not_chart',
      timeframe: null,
    });
  });

  it.each([
    ['null', null],
    ['配列', []],
    ['文字', 'chart'],
    ['鍵が足りない', { kind: 'chart' }],
    ['余分な鍵', { kind: 'chart', timeframe: '4h', written: '4H' }],
    ['種類の外', { kind: 'statement', timeframe: null }],
    ['列挙の外', { kind: 'chart', timeframe: '2h' }],
    ['書かれたままの表記', { kind: 'chart', timeframe: '4H' }],
    ['チャートでないのに時間足', { kind: 'not_chart', timeframe: '4h' }],
    ['数', { kind: 'chart', timeframe: 4 }],
  ])('形の外は null（%s）', (_name, body) => {
    expect(parseChartReadResponse(body)).toBeNull();
  });
});

describe('chartReadFailureMessage', () => {
  it('状態ごとの決まった文言', () => {
    expect(chartReadFailureMessage(429)).toBe(CHART_READ_MSG.limited);
    expect(chartReadFailureMessage(503)).toBe(CHART_READ_MSG.unavailable);
    for (const s of [400, 404, 500, 502, 504]) {
      expect(chartReadFailureMessage(s)).toBe(CHART_READ_MSG.failed);
    }
  });
});

describe('applyChartRead（画面の例 U1・U2・U4・U5）', () => {
  const read = (timeframe: (typeof TIMEFRAMES)[number] | null) =>
    ({ kind: 'chart', timeframe }) as const;

  it('U1: 空の欄に読んだ値を入れて印', () => {
    expect(applyChartRead(read('4h'), null, false)).toEqual({
      value: '4h',
      marked: true,
      note: null,
    });
  });

  it('U2・U9: 利用者が選んだ値は上書きしない。違う値なら読めた値を案に出す', () => {
    expect(applyChartRead(read('4h'), '1d', true)).toEqual({
      marked: false,
      note: null,
      suggest: '4h',
    });
    // 同じ値を選んでいれば案も出さない
    expect(applyChartRead(read('4h'), '4h', true)).toEqual({ marked: false, note: null });
    // 選んでから「選ばない」に戻した欄も触った扱い（上書きせず、案だけ出す）
    expect(applyChartRead(read('4h'), null, true)).toEqual({
      marked: false,
      note: null,
      suggest: '4h',
    });
  });

  it('U9: 案の文は読めた値だけを述べる（「違います」「誤り」を使わない）', () => {
    expect(suggestText('1d')).toBe('チャートからは 日足 と読めました');
    expect(suggestButton('1d')).toBe('日足にする');
    expect(suggestText('4h')).not.toMatch(/違|誤/);
  });

  it('U4: 読めないときは欄に触れずに知らせる（利用者が選んでいれば知らせない）', () => {
    expect(applyChartRead(read(null), null, false)).toEqual({
      marked: false,
      note: CHART_READ_MSG.noTimeframe,
    });
    expect(applyChartRead(read(null), '1h', true)).toEqual({ marked: false, note: null });
  });

  it('U5: チャートでないと読めたら知らせる（欄に触れない）', () => {
    expect(applyChartRead({ kind: 'not_chart', timeframe: null }, null, false)).toEqual({
      marked: false,
      note: CHART_READ_MSG.notChart,
    });
  });
});

const sp = (t: string | undefined) => t?.replace(/\u00a0/g, ' ');

describe('timeframeConflict（画面の例 U10）', () => {
  const chart = { kind: 'timeframeLonger', source: 'chart', from: '4h', to: '1d' } as const;
  const tap = { kind: 'timeframeLonger', source: 'tap' } as const;

  it('答え「そのまま」とチャートの 4 時間足 → 日足を事実として並べる', () => {
    const c = timeframeConflict('none', [chart]);
    expect({ verdictLine: sp(c?.verdictLine), tapHint: sp(c?.tapHint) }).toEqual({
      verdictLine: 'あなたの答え: そのまま ／ チャート: 4 時間足 → 日足',
      tapHint: 'チャートでは 4 時間足 → 日足',
    });
    expect(sp(timeframeConflict('shorter', [chart])?.verdictLine)).toBe(
      'あなたの答え: 短い足へ ／ チャート: 4 時間足 → 日足',
    );
    // R6: 時間足の名前と矢印の前は折り返さない空白（「4 時間 / 足」と切れない）
    expect(c?.tapHint).toBe('チャートでは 4\u00a0時間足\u00a0→ 日足');
  });

  it('食い違わない・答えていない・チャートの理由が無いときは出さない', () => {
    expect(timeframeConflict('longer', [chart])).toBeNull();
    expect(timeframeConflict(null, [chart])).toBeNull();
    expect(timeframeConflict('none', [tap])).toBeNull();
    expect(timeframeConflict('none', [])).toBeNull();
  });

  it('責める語・感嘆符を使わない', () => {
    const c = timeframeConflict('none', [chart]);
    for (const t of [c?.verdictLine ?? '', c?.tapHint ?? ''])
      expect(t).not.toMatch(/[!！]|違反|嘘|誤り/);
  });
});

describe('CHART_READ_NOTICE（U0）', () => {
  it('常に見える 1 行はチャートを AI の提供元に送ることだけ。何のためか・記録と一緒に保存することは「i」の中（明細の「保存しません」と主語を分ける。#251・C70）', () => {
    expect(CHART_READ_NOTICE).toBe('チャートは AI（Anthropic）に送ります。');
    const more = CHART_SEND_INFO.body.join('');
    expect(more).toContain('時間足を読むため');
    expect(more).toContain('AI の提供元（Anthropic）に送ります');
    expect(more).toContain('記録と一緒に保存します');
    expect(CHART_SEND_INFO.label).toBe('チャートの送り方');
    expect(CHART_SEND_INFO.id.startsWith('record-')).toBe(false);
  });
});
