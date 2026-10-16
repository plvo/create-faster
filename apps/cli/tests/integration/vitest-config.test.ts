import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

describe('Vitest config', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const cases = [
    { stack: 'nextjs', library: 'vitest' },
    { stack: 'tanstack-start', library: 'vitest' },
    { stack: 'hono', library: 'vitest-node' },
    { stack: 'node', library: 'vitest-node' },
  ];

  for (const { stack, library } of cases) {
    test(`${stack} resolves tsconfig paths natively, without the vite-tsconfig-paths plugin`, async () => {
      const name = `vt-${stack}`;
      const result = await runCli(
        [name, '--app', `${name}:${stack}:${library}`, '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);

      const projectPath = join(tempDir, name);
      const config = await readTextFile(join(projectPath, 'vitest.config.mts'));
      expect(config).toContain('tsconfigPaths: true');
      expect(config).not.toContain('vite-tsconfig-paths');
      expect(await fileExists(join(projectPath, 'vitest.config.ts'))).toBe(false);

      const pkg = await readJsonFile<{ devDependencies: Record<string, string> }>(join(projectPath, 'package.json'));
      expect(pkg.devDependencies['vite-tsconfig-paths']).toBeUndefined();
    });
  }
});
