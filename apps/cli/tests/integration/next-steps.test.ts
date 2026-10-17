import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, printedScriptsMissingFrom, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface Generated {
  project: string;
  readme: string;
  agents: string;
  stdout: string;
}

function expectInOrder(text: string, commands: string[]): void {
  const positions = commands.map((command) => text.indexOf(command));
  expect(positions).not.toContain(-1);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

describe('next steps printed by the summary, the README and AGENTS.md', () => {
  let tempDir: string;

  async function generate(name: string, args: string[], pm = 'npm'): Promise<Generated> {
    const result = await runCli([name, ...args, '--git', '--no-install', '--pm', pm], tempDir);
    expect(result.exitCode).toBe(0);
    const project = join(tempDir, name);
    return {
      project,
      readme: await readTextFile(join(project, 'README.md')),
      agents: await readTextFile(join(project, 'AGENTS.md')),
      stdout: result.stdout,
    };
  }

  async function expectEveryPrintedScriptToExist({ project, readme, agents, stdout }: Generated): Promise<void> {
    for (const text of [readme, agents, stdout]) {
      expect(await printedScriptsMissingFrom(project, text)).toEqual([]);
    }
  }

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('a Hono single repo has no build script, so no document tells to run one', async () => {
    const generated = await generate('hono-single', ['--app', 'api:hono']);

    for (const text of [generated.readme, generated.agents, generated.stdout]) {
      expect(text).not.toContain('npm run build');
      expect(text).toContain('npm run start');
    }
    await expectEveryPrintedScriptToExist(generated);
  });

  test('a Next.js app on Cloudflare lists its Worker build, preview and deploy and has no start', async () => {
    const generated = await generate('next-cloudflare', ['--app', 'web:nextjs', '--deployment', 'cloudflare']);

    for (const text of [generated.readme, generated.agents, generated.stdout]) {
      expect(text).toContain('npm run build:cf');
      expect(text).toContain('npm run preview');
      expect(text).toContain('npm run deploy');
      expect(text).not.toContain('npm run start');
    }
    await expectEveryPrintedScriptToExist(generated);
  });

  describe.each(['bun', 'npm', 'pnpm'])('a Cloudflare turborepo with %s', (pm) => {
    test('runs each app-only script from a subshell per app that defines it, and every command exists', async () => {
      const generated = await generate(
        `next-cloudflare-turbo-${pm}`,
        ['--app', 'web:nextjs', '--app', 'docs:nextjs', '--deployment', 'cloudflare'],
        pm,
      );

      for (const text of [generated.readme, generated.stdout]) {
        for (const app of ['web', 'docs']) {
          for (const script of ['build:cf', 'preview', 'deploy']) {
            expect(text).toContain(`(cd apps/${app} && ${pm} run ${script})`);
          }
        }
        expect(text).toContain(`${pm} run build`);
        expect(text).not.toContain('<app>');
      }
      await expectEveryPrintedScriptToExist(generated);
    });
  });

  test('an Expo single repo has no dev script, so no document tells to run one', async () => {
    const generated = await generate('expo-single', ['--app', 'mobile:expo']);

    for (const text of [generated.readme, generated.agents, generated.stdout]) {
      expect(text).not.toContain('npm run dev');
    }
    await expectEveryPrintedScriptToExist(generated);
  });

  test('the first commit comes before the push, on a branch named main', async () => {
    const { stdout } = await generate('git-steps', ['--app', 'web:nextjs']);
    const gitSteps = stdout.slice(stdout.indexOf('# Git:'));

    expect(stdout).toContain('# Git:');
    expectInOrder(gitSteps, [
      'git add .',
      'git commit -m',
      'git branch -M main',
      'git remote add origin',
      'git push -u origin main',
    ]);
  });

  describe.each([
    'cloudflare-static-site-nextjs',
    'showcase-nextjs',
  ])('the %s blueprint', (blueprint) => {
    test('copies the env file between the install and the dev server, in the README and the summary', async () => {
      const generated = await generate(blueprint, ['--blueprint', blueprint]);

      for (const text of [generated.readme, generated.stdout]) {
        expectInOrder(text, ['npm install', 'cp .env.example .env', 'npm run dev']);
      }
      await expectEveryPrintedScriptToExist(generated);
    });
  });

  test('the org-dashboard-nextjs turborepo blueprint prints only commands that exist', async () => {
    const generated = await generate('org-dashboard', ['--blueprint', 'org-dashboard-nextjs']);

    expectInOrder(generated.readme, ['npm install', 'cp apps/web/.env.example apps/web/.env', 'npm run dev']);
    await expectEveryPrintedScriptToExist(generated);
  });
});
