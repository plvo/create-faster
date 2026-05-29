import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CommandResult, cleanupTempDir, createTempDir, fileExists, runCli, runCommand } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_BUILD = 180_000;
const TIMEOUT_TEST = 120_000;

describe('nextjs-vitest-playwright', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      ['nx-test', '--app', 'nx-test:nextjs:vitest,playwright', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'nx-test');
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test('installs dependencies', () => {
    expect(installResult.exitCode).toBe(0);
  }, TIMEOUT_INSTALL);

  test('keeps test for vitest and exposes playwright under test:e2e', async () => {
    const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf-8'));
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:e2e']).toBe('playwright test');
    expect(await fileExists(join(projectDir, 'playwright.config.ts'))).toBe(true);
  });

  test('type-checks', async () => {
    const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
    expect(result.exitCode).toBe(0);
  }, TIMEOUT_TYPECHECK);

  test('runs vitest', async () => {
    const result = await runCommand(['bun', 'run', 'test'], projectDir);
    expect(result.exitCode).toBe(0);
  }, TIMEOUT_TEST);
});

describe('tanstack-start-vitest', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      ['ts-test', '--app', 'ts-test:tanstack-start:vitest', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'ts-test');
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test('installs dependencies', () => {
    expect(installResult.exitCode).toBe(0);
  }, TIMEOUT_INSTALL);

  test('builds', async () => {
    const result = await runCommand(['bun', 'run', 'build'], projectDir);
    expect(result.exitCode).toBe(0);
  }, TIMEOUT_BUILD);

  test('type-checks', async () => {
    const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
    expect(result.exitCode).toBe(0);
  }, TIMEOUT_TYPECHECK);

  test('runs vitest', async () => {
    const result = await runCommand(['bun', 'run', 'test'], projectDir);
    expect(result.exitCode).toBe(0);
  }, TIMEOUT_TEST);
});

describe('hono-vitest-node', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      ['hn-test', '--app', 'hn-test:hono:vitest-node', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'hn-test');
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test('installs dependencies', () => {
    expect(installResult.exitCode).toBe(0);
  }, TIMEOUT_INSTALL);

  test('type-checks', async () => {
    const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
    expect(result.exitCode).toBe(0);
  }, TIMEOUT_TYPECHECK);

  test('runs vitest', async () => {
    const result = await runCommand(['bun', 'run', 'test'], projectDir);
    expect(result.exitCode).toBe(0);
  }, TIMEOUT_TEST);
});

describe('expo-jest', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      ['ex-test', '--app', 'ex-test:expo:jest-expo', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'ex-test');
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test('installs dependencies', () => {
    expect(installResult.exitCode).toBe(0);
  }, TIMEOUT_INSTALL);

  test('type-checks', async () => {
    const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
    expect(result.exitCode).toBe(0);
  }, TIMEOUT_TYPECHECK);

  test('runs jest', async () => {
    const result = await runCommand(['bun', 'run', 'test'], projectDir);
    expect(result.exitCode).toBe(0);
  }, TIMEOUT_TEST);
});

describe('turborepo testing isolation', () => {
  let projectDir: string;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [
        'mono-test',
        '--app',
        'web:nextjs:vitest',
        '--app',
        'api:hono:vitest-node',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    projectDir = join(tempDir, 'mono-test');
  });

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test('react test deps stay in the nextjs app', async () => {
    const web = JSON.parse(await readFile(join(projectDir, 'apps/web/package.json'), 'utf-8'));
    expect(web.devDependencies.jsdom).toBeDefined();
    expect(web.devDependencies['@testing-library/react']).toBeDefined();
  });

  test('hono app gets no react or jsdom test deps', async () => {
    const api = JSON.parse(await readFile(join(projectDir, 'apps/api/package.json'), 'utf-8'));
    expect(api.devDependencies.vitest).toBeDefined();
    expect(api.devDependencies.jsdom).toBeUndefined();
    expect(api.devDependencies['@testing-library/react']).toBeUndefined();
    expect(api.devDependencies['@vitejs/plugin-react']).toBeUndefined();
  });
});
