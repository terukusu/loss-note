// ログインの接続先（契約 C-7。設計書 10 章・ADR-0003）。値は架空
import { describe, expect, it } from 'vitest';
import { isDemoProject, readAuthConfig } from '../../ui/src/auth/config';
import { DEV_AUTH_DEFAULTS } from '../../ui/src/auth/devDefaults';

describe('readAuthConfig', () => {
  it('開発のビルド（既定値あり）で変数が無ければ、架空の demo-loss-note と手元のエミュレーター', () => {
    expect(readAuthConfig({}, DEV_AUTH_DEFAULTS)).toEqual({
      projectId: 'demo-loss-note',
      apiKey: 'demo-api-key',
      authDomain: 'demo-loss-note.firebaseapp.com',
      emulatorUrl: 'http://127.0.0.1:9099',
    });
  });

  it('本番のビルド（既定値なし）で変数が無ければ、エミュレーターに繋がず、架空の値も入らない', () => {
    expect(readAuthConfig({})).toEqual({
      projectId: '',
      apiKey: '',
      authDomain: '',
      emulatorUrl: null,
    });
  });

  it('本番のビルドで実プロジェクトの値を受け取る（エミュレーターの変数なし → 繋がない）', () => {
    expect(
      readAuthConfig({
        VITE_FIREBASE_PROJECT_ID: 'example-prod',
        VITE_FIREBASE_API_KEY: 'k',
      }),
    ).toEqual({
      projectId: 'example-prod',
      apiKey: 'k',
      authDomain: 'example-prod.firebaseapp.com',
      emulatorUrl: null,
    });
  });

  it('demo- でないプロジェクト ID は、エミュレーターの URL があっても繋がない（開発のビルドでも）', () => {
    expect(
      readAuthConfig(
        {
          VITE_FIREBASE_PROJECT_ID: 'example-prod',
          VITE_FIREBASE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
        },
        DEV_AUTH_DEFAULTS,
      ).emulatorUrl,
    ).toBeNull();
    expect(
      readAuthConfig({ VITE_FIREBASE_PROJECT_ID: 'example-prod' }, DEV_AUTH_DEFAULTS).emulatorUrl,
    ).toBeNull();
  });

  it('本番のビルドでも、demo- のプロジェクトとエミュレーターの URL を明示すれば繋ぐ', () => {
    expect(
      readAuthConfig({
        VITE_FIREBASE_PROJECT_ID: 'demo-other',
        VITE_FIREBASE_AUTH_EMULATOR_URL: 'http://localhost:19099',
      }).emulatorUrl,
    ).toBe('http://localhost:19099');
  });

  it('変数で受け取る（値は架空）', () => {
    expect(
      readAuthConfig(
        { VITE_FIREBASE_PROJECT_ID: 'demo-other', VITE_FIREBASE_API_KEY: 'k' },
        DEV_AUTH_DEFAULTS,
      ),
    ).toEqual({
      projectId: 'demo-other',
      apiKey: 'k',
      authDomain: 'demo-other.firebaseapp.com',
      emulatorUrl: 'http://127.0.0.1:9099',
    });
    expect(
      readAuthConfig({ VITE_FIREBASE_AUTH_DOMAIN: 'auth.example.test' }, DEV_AUTH_DEFAULTS)
        .authDomain,
    ).toBe('auth.example.test');
  });

  it('エミュレーターの URL が空ならエミュレーターに繋がない', () => {
    expect(
      readAuthConfig({ VITE_FIREBASE_AUTH_EMULATOR_URL: '' }, DEV_AUTH_DEFAULTS).emulatorUrl,
    ).toBeNull();
  });

  it('http(s) でない値はエミュレーターの URL にしない', () => {
    expect(
      readAuthConfig({ VITE_FIREBASE_AUTH_EMULATOR_URL: 'javascript:alert(1)' }, DEV_AUTH_DEFAULTS)
        .emulatorUrl,
    ).toBeNull();
  });

  it('空の値・文字列でない値は既定に戻す', () => {
    expect(
      readAuthConfig({ VITE_FIREBASE_PROJECT_ID: '', VITE_FIREBASE_API_KEY: 3 }, DEV_AUTH_DEFAULTS),
    ).toMatchObject({ projectId: 'demo-loss-note', apiKey: 'demo-api-key' });
  });

  it('isDemoProject', () => {
    expect(isDemoProject('demo-loss-note')).toBe(true);
    expect(isDemoProject('example-prod')).toBe(false);
    expect(isDemoProject('')).toBe(false);
    expect(isDemoProject('my-demo-x')).toBe(false);
  });
});
