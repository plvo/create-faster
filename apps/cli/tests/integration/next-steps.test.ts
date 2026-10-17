import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface Generated {
  scripts: string[];
  readme: string;
  agents: string;
  stdout: string;
}

describe('next steps printed by the summary, the README and AGENTS.md', () => {
  let tempDir: string;

  async function generate(name: string, args: string[]): Promise<Generated> {
    const result = await runCli([name, ...args, '--git', '--no-install', '--pm', 'npm'], tempDir);
    expect(result.exitCode).toBe(0);
    const pkg = await readJsonFile<{ scripts: Record<string, string> }>(join(tempDir, name, 'package.json'));
    return {
      scripts: Object.keys(pkg.scripts),
      readme: await readTextFile(join(tempDir, name, 'README.md')),
      agents: await readTextFile(join(tempDir, name, 'AGENTS.md')),
      stdout: result.stdout,
    };
  }

  function printedScripts(text: string): string[] {
    return [...text.matchAll(/npm run ([\w:-]+)/g)].map(([, script]) => script as string);
  }

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('a Hono single repo has no build script, so no document tells to run one', async () => {
    const { scripts, readme, agents, stdout } = await generate('hono-single', ['--app', 'api:hono']);

    for (const text of [readme, agents, stdout]) {
      expect(text).not.toContain('npm run build');
      expect(text).toContain('npm run start');
      for (const script of printedScripts(text)) expect(scripts).toContain(script);
    }
  });

  test('a Next.js app on Cloudflare lists its Worker build, preview and deploy and has no start', async () => {
    const { scripts, readme, agents, stdout } = await generate('next-cloudflare', [
      '--app',
      'web:nextjs',
      '--deployment',
      'cloudflare',
    ]);

    for (const text of [readme, agents, stdout]) {
      expect(text).toContain('npm run build:cf');
      expect(text).toContain('npm run preview');
      expect(text).toContain('npm run deploy');
      expect(text).not.toContain('npm run start');
      for (const script of printedScripts(text)) expect(scripts).toContain(script);
    }
  });

  test('the first commit comes before the push, on a branch named main', async () => {
    const { stdout } = await generate('git-steps', ['--app', 'web:nextjs']);
    const steps = ['git add .', 'git commit -m', 'git branch -M main', 'git remote add origin', 'git push -u origin main'];
    const positions = steps.map((step) => stdout.indexOf(step));

    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test.each(['cloudflare-static-site-nextjs', 'showcase-nextjs'])(
    'the %s blueprint README copies the env file before the dev server, as the summary does',
    async (blueprint) => {
      const { readme, stdout } = await generate(blueprint, ['--blueprint', blueprint]);

      for (const text of [readme, stdout]) {
        expect(text).toContain('cp .env.example .env');
        expect(text.indexOf('cp .env.example .env')).toBeLessThan(text.indexOf('npm run dev'));
      }
    },
  );
});
