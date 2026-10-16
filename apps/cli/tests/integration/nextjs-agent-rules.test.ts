import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

describe('Next.js agent rules', () => {
  let tempDir: string;

  const generate = async (name: string, args: string[]): Promise<string> => {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, name);
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('single repo: the managed block of next dev is turned off', async () => {
    const projectPath = await generate('rules-single', ['--app', 'web:nextjs']);
    const config = await readTextFile(join(projectPath, 'next.config.ts'));
    expect(config).toContain('agentRules: false');
  });

  test('turborepo: every Next.js app turns the managed block off', async () => {
    const projectPath = await generate('rules-mono', ['--app', 'web:nextjs', '--app', 'admin:nextjs']);
    for (const app of ['web', 'admin']) {
      const config = await readTextFile(join(projectPath, 'apps', app, 'next.config.ts'));
      expect(config).toContain('agentRules: false');
    }
  });

  test('the Next.js range includes the release that introduced agentRules', async () => {
    const projectPath = await generate('rules-version', ['--app', 'web:nextjs']);
    const pkg = await readJsonFile<{ dependencies: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.dependencies.next).toBe('^16.3.0');
  });

  test('the generated AGENTS.md points to the bundled Next.js docs', async () => {
    const projectPath = await generate('rules-docs', ['--app', 'web:nextjs']);
    const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
    expect(agents).toContain('node_modules/next/dist/docs/');
  });

  test('without agent context no AGENTS.md is generated', async () => {
    const projectPath = await generate('rules-no-context', ['--app', 'web:nextjs', '--no-agent-context']);
    expect(await fileExists(join(projectPath, 'AGENTS.md'))).toBe(false);
  });
});
