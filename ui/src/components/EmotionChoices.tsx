// 心理のタグの選択肢の設定（#163・設計書 9.2・C55・ADR-0023・docs/ui-guidelines.md 9.12）。
// 3 層: 純関数（core/emotion-tags.ts の normalizeHidden・toggleHidden、lib/emotion-tags.ts の文字）→ 通信と状態
// （lib/emotion-choices-controller.ts）→ この部品。
// - useEmotionChoices: controller を作って購読する（開くたびに読み直す）。設定の画面・設定の根の添え・心理を付けるシート
//   （保存の後・詳細）が使う
// - EmotionChoicesView: 設定の次の画面「心理のタグ」の中身（hook を持たない）。シートと同じまとまりの見出しの下に押す形の
//   チップ（aria-pressed = 選択肢に出す）。平常心は押せない輪郭の札で「常に出します」。押した時点で保存
// 色はどのタグにも付けない（C34）。名前は固定の文字（ID から引く）をテキストのノードで入れる
import { useEffect, useMemo, useState } from 'preact/hooks';
import { CALM, type EmotionTagId } from '../../../core/emotion-tags';
import { api, signOutActive } from '../auth/session';
import {
  createEmotionChoicesController,
  type EmotionChoicesController,
  type EmotionChoicesState,
} from '../lib/emotion-choices-controller';
import {
  EMOTION_CHOICES_CALM_NOTE,
  EMOTION_CHOICES_INFO,
  EMOTION_CHOICES_LEAD,
  emotionChoicesCount,
  emotionGroups,
} from '../lib/emotion-tags';
import { createRequest } from '../lib/request';
import { Button, Chip } from './Button';
import { InfoTip } from './InfoTip';
import '../styles/emotions.css';

export interface EmotionChoicesHandle {
  readonly state: EmotionChoicesState;
  readonly onToggle: (id: EmotionTagId) => void;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
}

/** controller を作って購読する（開くたびに読み直す。読めない・読み込み中のシートはすべて出す = hiddenOf） */
export function useEmotionChoices(): EmotionChoicesHandle {
  const controller = useMemo<EmotionChoicesController>(
    () => createEmotionChoicesController({ request: createRequest(api) }),
    [],
  );
  const [state, setState] = useState<EmotionChoicesState>(controller.getState());
  useEffect(() => {
    const off = controller.subscribe(setState);
    void controller.load();
    return () => {
      off();
      controller.dispose();
    };
  }, [controller]);
  return {
    state,
    onToggle: (id) => controller.toggle(id),
    onReload: () => {
      void controller.load();
    },
    onRelogin: () => {
      void signOutActive();
    },
  };
}

export function EmotionChoicesView(p: EmotionChoicesHandle) {
  const s = p.state;
  if (s.phase === 'loading') {
    return (
      <p class="loading" role="status">
        読み込んでいます…
      </p>
    );
  }
  if (s.phase === 'failed') {
    return (
      <section class="card section">
        <p class="notice notice--error" role="alert">
          {s.error}
        </p>
        <div>
          {s.errorKind === 'auth' ? (
            <Button variant="secondary" icon="logout" onClick={p.onRelogin}>
              もう一度ログイン
            </Button>
          ) : (
            <Button variant="secondary" onClick={p.onReload}>
              再読み込み
            </Button>
          )}
        </div>
      </section>
    );
  }
  const hidden = new Set(s.hidden);
  return (
    <div class="emotions emotionchoices">
      <p class="setlead">
        {EMOTION_CHOICES_LEAD}
        <InfoTip
          label={EMOTION_CHOICES_INFO.label}
          body={EMOTION_CHOICES_INFO.body}
          id={EMOTION_CHOICES_INFO.id}
        />
      </p>
      <section class="card emotionchoices__card" aria-labelledby="settings-emotion-count">
        <p class="emotionchoices__count" id="settings-emotion-count">
          {emotionChoicesCount(s.hidden)}
        </p>
        {emotionGroups().map((g) => {
          const gid = `settings-emotion-${g.group}`;
          const good = g.group === 'good';
          return (
            <div
              key={g.group}
              class={good ? 'emotions__group emotions__group--good' : 'emotions__group'}
            >
              <div class="emotions__ghead">
                <h2 class="emotions__gname" id={gid}>
                  {g.name}
                </h2>
                {good ? (
                  <span class="emotions__gnote" id={`${gid}-note`}>
                    {EMOTION_CHOICES_CALM_NOTE}
                  </span>
                ) : null}
              </div>
              <fieldset
                class="chips emotions__chips"
                aria-labelledby={gid}
                {...(good ? { 'aria-describedby': `${gid}-note` } : {})}
              >
                {g.tags.map((t) =>
                  t.id === CALM ? (
                    // 平常心は出さないにできない（気づきの基準の行。R2）: 押せない輪郭の札（詳細のカードの札と同じ形）
                    <span key={t.id} class="emotioncard__tag">
                      {t.name}
                    </span>
                  ) : (
                    <Chip key={t.id} selected={!hidden.has(t.id)} onClick={() => p.onToggle(t.id)}>
                      {t.name}
                    </Chip>
                  ),
                )}
              </fieldset>
            </div>
          );
        })}
      </section>
      {s.error !== null ? (
        <div class="notice notice--error" role="alert">
          <p>{s.error}</p>
          {s.errorKind === 'auth' ? (
            <Button variant="secondary" icon="logout" onClick={p.onRelogin}>
              もう一度ログイン
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
