// ログインの接続先（設計書 10 章・Issue #3 の what 4・ADR-0003）。値は環境変数で受け取り、コードに埋め込まない。
// 既定値（架空のプロジェクト demo-loss-note と手元の Auth のエミュレーター）は開発のビルドのときだけ main.tsx が渡す
// （devDefaults.ts。本番のビルドには入らない）。本番のビルドは変数で明示したときだけエミュレーターに繋ぐ。
// さらに、プロジェクト ID が demo- で始まらないときはエミュレーターに繋がない（実プロジェクトの ID のまま
// エミュレーターへ向けない守り）
export interface AuthConfig {
  readonly projectId: string;
  readonly apiKey: string;
  readonly authDomain: string;
  readonly emulatorUrl: string | null;
}

export interface AuthDefaults {
  readonly projectId?: string;
  readonly apiKey?: string;
  readonly emulatorUrl?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/** エミュレーターは架空のプロジェクト（demo-）にだけ繋ぐ */
export function isDemoProject(projectId: string): boolean {
  return projectId.startsWith('demo-');
}

export function readAuthConfig(
  env: Readonly<Record<string, unknown>>,
  defaults: AuthDefaults = {},
): AuthConfig {
  const projectId = str(env.VITE_FIREBASE_PROJECT_ID) ?? defaults.projectId ?? '';
  const rawEmu = env.VITE_FIREBASE_AUTH_EMULATOR_URL;
  // 変数があればそれ（空 = 繋がない）、無ければ既定（本番のビルドは既定が無い = 繋がない）
  const emu = typeof rawEmu === 'string' ? rawEmu : (defaults.emulatorUrl ?? '');
  const emulatorUrl = /^https?:\/\/[^\s/]+/.test(emu) && isDemoProject(projectId) ? emu : null;
  return {
    projectId,
    apiKey: str(env.VITE_FIREBASE_API_KEY) ?? defaults.apiKey ?? '',
    // ポップアップの SDK が値を必須にする（エミュレーターでは使われない）
    authDomain:
      str(env.VITE_FIREBASE_AUTH_DOMAIN) ?? (projectId ? `${projectId}.firebaseapp.com` : ''),
    emulatorUrl,
  };
}
