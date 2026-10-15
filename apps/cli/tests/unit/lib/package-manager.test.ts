import { describe, expect, test } from 'bun:test';
import {
  createCachedVersionReader,
  findMissingPackageManager,
  getPackageManager,
  getScriptCommand,
  getTypeScriptRunner,
  missingPackageManagerMessage,
  readPackageManagerVersion,
  resolvePackageManager,
} from '@/lib/package-manager';
import type { TemplateContext } from '@/types/ctx';

const TURBOREPO_APPS: TemplateContext['apps'] = [
  { appName: 'web', stackName: 'nextjs', libraries: [] },
  { appName: 'api', stackName: 'hono', libraries: [] },
];

function contextWith(overrides: Partial<TemplateContext>): TemplateContext {
  return {
    projectName: 'demo',
    repo: 'single',
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
    project: { tooling: [] },
    git: false,
    ...overrides,
  };
}

const NOTHING_INSTALLED = () => undefined;
const EVERYTHING_INSTALLED = () => '1.0.0';

describe('readPackageManagerVersion', () => {
  test('reads the version of an installed package manager', () => {
    expect(readPackageManagerVersion('bun')).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('createCachedVersionReader', () => {
  test('looks each package manager up once, including a missing one', () => {
    const lookups: string[] = [];
    const read = createCachedVersionReader((pm) => {
      lookups.push(pm);
      return pm === 'pnpm' ? undefined : '1.0.0';
    });

    expect([read('bun'), read('bun'), read('pnpm'), read('pnpm')]).toEqual(['1.0.0', '1.0.0', undefined, undefined]);
    expect(lookups).toEqual(['bun', 'pnpm']);
  });
});

describe('resolvePackageManager', () => {
  test('uses the selected package manager', () => {
    expect(resolvePackageManager(contextWith({ pm: 'pnpm' }))).toBe('pnpm');
    expect(resolvePackageManager(contextWith({ repo: 'turborepo', apps: TURBOREPO_APPS, pm: 'bun' }))).toBe('bun');
  });

  test('defaults a turborepo to npm', () => {
    expect(resolvePackageManager(contextWith({ repo: 'turborepo', apps: TURBOREPO_APPS }))).toBe('npm');
  });

  test('resolves none for a single repo without a selection', () => {
    expect(resolvePackageManager(contextWith({}))).toBeUndefined();
  });
});

describe('findMissingPackageManager', () => {
  test('reports the selected package manager when it is not installed', () => {
    expect(findMissingPackageManager(contextWith({ pm: 'pnpm' }), NOTHING_INSTALLED)).toBe('pnpm');
  });

  test('reports nothing when the selected package manager is installed', () => {
    expect(findMissingPackageManager(contextWith({ pm: 'pnpm' }), EVERYTHING_INSTALLED)).toBeUndefined();
  });

  test('requires no package manager for a single repo that skips installation', () => {
    expect(findMissingPackageManager(contextWith({ pm: undefined }), NOTHING_INSTALLED)).toBeUndefined();
  });

  test('requires npm for a turborepo without a selected package manager', () => {
    const ctx = contextWith({ repo: 'turborepo', apps: TURBOREPO_APPS });
    expect(findMissingPackageManager(ctx, NOTHING_INSTALLED)).toBe('npm');
  });
});

describe('getPackageManager', () => {
  test('returns bun@<version> format', () => {
    expect(getPackageManager('bun')).toMatch(/^bun@\d+\.\d+\.\d+/);
  });

  test('returns npm@<version> format', () => {
    expect(getPackageManager('npm')).toMatch(/^npm@\d+\.\d+\.\d+/);
  });

  test('joins the package manager and its version', () => {
    expect(getPackageManager('pnpm', EVERYTHING_INSTALLED)).toBe('pnpm@1.0.0');
  });

  test('throws the missing package manager message when it is not installed', () => {
    expect(() => getPackageManager('pnpm', NOTHING_INSTALLED)).toThrow(missingPackageManagerMessage('pnpm'));
  });
});

describe('missingPackageManagerMessage', () => {
  test('names the package manager and both ways to fix it', () => {
    const message = missingPackageManagerMessage('pnpm');
    expect(message).toContain("'pnpm'");
    expect(message).toContain('Install pnpm');
    expect(message).toContain('--pm');
  });
});

describe('getScriptCommand', () => {
  test.each([
    ['bun', 'bun run db:seed --fixtures'],
    ['pnpm', 'pnpm run db:seed --fixtures'],
    ['npm', 'npm run db:seed -- --fixtures'],
    [undefined, 'npm run db:seed -- --fixtures'],
  ] as const)('forwards arguments to the script under %s', (pm, expected) => {
    expect(getScriptCommand(contextWith({ pm }), 'db:seed', '--fixtures')).toBe(expected);
  });

  test('without arguments it is the bare run command', () => {
    expect(getScriptCommand(contextWith({ pm: 'npm' }), 'dev')).toBe('npm run dev');
  });
});

describe('getTypeScriptRunner', () => {
  test('Bun runs TypeScript itself, the others use tsx', () => {
    expect(getTypeScriptRunner(contextWith({ pm: 'bun' }))).toBe('bun');
    expect(getTypeScriptRunner(contextWith({ pm: 'pnpm' }))).toBe('tsx');
    expect(getTypeScriptRunner(contextWith({ pm: undefined }))).toBe('tsx');
  });
});
