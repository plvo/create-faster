import { describe, expect, test } from 'bun:test';
import {
  findMissingPackageManager,
  missingPackageManagerMessage,
  readPackageManagerVersion,
} from '@/lib/package-manager';
import type { TemplateContext } from '@/types/ctx';

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
    const ctx = contextWith({
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: [] },
        { appName: 'api', stackName: 'hono', libraries: [] },
      ],
    });
    expect(findMissingPackageManager(ctx, NOTHING_INSTALLED)).toBe('npm');
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
