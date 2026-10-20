import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { PACKAGE_MANAGERS } from '@/lib/constants';
import { accept, cleanupTempDir, createTempDir, fileExists, runCliOnTerminal } from './helpers';
import { createStubbedCli } from './stubbed-cli';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const NO_CATEGORY_PROMPTS = [...Object.keys(META.project).flatMap((category) => [`--${category}`, 'none']), '--no-git'];

const installMarker = (pm: string) => `installed-with-${pm}`;

const stubFor = (pm: string) => `if [ "$1" = "--version" ]; then echo 9.9.9; exit 0; fi
touch ${installMarker(pm)}`;

describe('the install prompt', () => {
  let tempDir: string;
  let env: Record<string, string>;

  beforeAll(async () => {
    tempDir = await createTempDir();
    ({ env } = await createStubbedCli(tempDir, Object.fromEntries(PACKAGE_MANAGERS.map((pm) => [pm, stubFor(pm)]))));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('enter installs with the first package manager, not Skip installation', async () => {
    const workDir = join(tempDir, 'work');
    await mkdir(workDir);

    const { exitCode, output } = await runCliOnTerminal(
      ['demo', '--app', 'demo:nextjs', ...NO_CATEGORY_PROMPTS],
      workDir,
      [accept('Install dependencies now?')],
      env,
    );

    const [firstPackageManager = ''] = PACKAGE_MANAGERS;
    expect(exitCode).toBe(0);
    expect(await fileExists(join(workDir, 'demo', installMarker(firstPackageManager)))).toBe(true);
    expect(output).not.toContain('Skipping dependency installation');
  }, 90_000);
});
