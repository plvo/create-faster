import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const FORMS_BY_BLUEPRINT: Record<string, string[]> = {
  'org-dashboard-nextjs': ['apps/web/src/app/(auth)/login/login-form.tsx'],
  'cloudflare-fullstack-nextjs': ['apps/web/src/app/(auth)/login/login-form.tsx'],
  'multitenant-saas-nextjs': [
    'apps/web/src/app/(auth)/login/login-form.tsx',
    'apps/web/src/app/(auth)/signup/signup-form.tsx',
  ],
};

const HELPER_PATH = 'apps/web/src/lib/safe-redirect.ts';

type SafeRedirectPath = (value: string | null | undefined, fallback?: string) => string;

describe('post-login redirect target', () => {
  let tempDir: string;
  const projectPaths = new Map<string, string>();

  beforeAll(async () => {
    tempDir = await createTempDir();
    for (const blueprint of Object.keys(FORMS_BY_BLUEPRINT)) {
      const result = await runCli(
        [blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
      projectPaths.set(blueprint, join(tempDir, blueprint));
    }
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const loadHelper = async (blueprint: string): Promise<SafeRedirectPath> => {
    const source = await readTextFile(join(projectPaths.get(blueprint) as string, HELPER_PATH));
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
    const file = join(tempDir, `${blueprint}-safe-redirect.mjs`);
    await Bun.write(file, js);
    return (await import(file)).safeRedirectPath;
  };

  describe.each(Object.entries(FORMS_BY_BLUEPRINT))('%s', (blueprint, forms) => {
    test.each([...forms])('%s navigates only to a validated destination', async (form) => {
      const source = await readTextFile(join(projectPaths.get(blueprint) as string, form));
      expect(source).toContain("from '@/lib/safe-redirect'");
      expect(source).toMatch(/const destination = safeRedirectPath\(/);
      const pushes = [...source.matchAll(/router\.push\(([^)]*)\)/g)].map((match) => match[1]);
      expect(pushes).toContain('destination');
      expect(pushes).not.toContain('redirectTo');
      expect(source).not.toMatch(/params\.get\('redirectTo'\) \?\?/);
    });

    test('safeRedirectPath keeps internal paths and refuses everything else', async () => {
      const safeRedirectPath = await loadHelper(blueprint);
      expect(safeRedirectPath('/contacts?x=1')).toBe('/contacts?x=1');
      expect(safeRedirectPath('/accept-invitation/abc#top')).toBe('/accept-invitation/abc#top');
      for (const hostile of [
        'https://evil.example',
        '//evil.example',
        '/\\evil.example',
        '/\t/evil.example',
        'javascript:alert(1)',
        'contacts',
        '',
        null,
        undefined,
      ]) {
        expect(safeRedirectPath(hostile), String(hostile)).toBe('/');
      }
      expect(safeRedirectPath('https://evil.example', '/dashboard')).toBe('/dashboard');
    });

    test('safeRedirectPath refuses a path that normalizes to a protocol-relative URL', async () => {
      const safeRedirectPath = await loadHelper(blueprint);
      for (const hostile of [
        '/.//evil.example',
        '/a/..//evil.example',
        '/%2e//evil.example',
        '/%2E/%2e//evil.example',
        '/a/%2e%2e//evil.example',
        '/..//evil.example',
        '/././/evil.example',
        '/./\\evil.example',
        '/a/../\\evil.example',
        '/.//\\evil.example',
        '/.\t//evil.example',
      ]) {
        expect(safeRedirectPath(hostile), JSON.stringify(hostile)).toBe('/');
      }
      expect(safeRedirectPath('/.//evil.example', '/dashboard')).toBe('/dashboard');
    });

    test('safeRedirectPath refuses control characters that move the URL to another origin', async () => {
      const safeRedirectPath = await loadHelper(blueprint);
      for (const hostile of ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example']) {
        expect(safeRedirectPath(hostile), JSON.stringify(hostile)).toBe('/');
      }
    });

    test('safeRedirectPath falls back instead of throwing on a value the URL parser rejects', async () => {
      const safeRedirectPath = await loadHelper(blueprint);
      for (const unparsable of ['/\t/', '/\n/', '/\r/', '/\t//', '/\t/?x=1', '/\t/#top']) {
        expect(safeRedirectPath(unparsable, '/dashboard'), JSON.stringify(unparsable)).toBe('/dashboard');
      }
    });

    test('safeRedirectPath keeps legitimate paths that need normalization', async () => {
      const safeRedirectPath = await loadHelper(blueprint);
      expect(safeRedirectPath('/a/../contacts?x=1#top')).toBe('/contacts?x=1#top');
      expect(safeRedirectPath('/./contacts')).toBe('/contacts');
      expect(safeRedirectPath('/a/..\\contacts')).toBe('/contacts');
      expect(safeRedirectPath('/%2f/contacts')).toBe('/%2f/contacts');
      expect(safeRedirectPath('/contacts?next=//evil.example')).toBe('/contacts?next=//evil.example');
      expect(safeRedirectPath('/contacts#//evil.example')).toBe('/contacts#//evil.example');
      expect(safeRedirectPath('/')).toBe('/');
    });
  });
});
