import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface PackageJson {
  scripts: Record<string, string>;
}

interface TurboConfig {
  tasks: Record<string, { passThroughEnv?: string[] }>;
}

let tempDir: string;

beforeAll(async () => {
  tempDir = await createTempDir();
});

afterAll(async () => {
  await cleanupTempDir(tempDir);
});

async function generate(projectName: string, args: string[], pm = 'npm'): Promise<string> {
  const result = await runCli([projectName, ...args, '--no-git', '--no-install', '--pm', pm], tempDir);
  expect(result.exitCode, result.stderr).toBe(0);
  return join(tempDir, projectName);
}

const MONO_APPS = ['--app', 'web:nextjs', '--app', 'docs:tanstack-start', '--app', 'api:hono'];

describe('turborepo', () => {
  let project: string;

  beforeAll(async () => {
    project = await generate('port-mono', MONO_APPS);
  });

  test('turbo hands PORT to the tasks that serve an app, which strict env mode would drop', async () => {
    const { tasks } = await readJsonFile<TurboConfig>(join(project, 'turbo.json'));
    expect(tasks.dev?.passThroughEnv).toEqual(['PORT']);
    expect(tasks.start?.passThroughEnv).toEqual(['PORT']);
  });

  test.each(['web', 'docs', 'api'])('every port flag of %s lets PORT override its own port', async (app) => {
    const { scripts } = await readJsonFile<PackageJson>(join(project, 'apps', app, 'package.json'));
    const flags = Object.values(scripts).filter((script) => script.includes('--port'));

    expect(flags.length).toBeGreaterThan(0);
    for (const script of flags) expect(script).toMatch(/--port \$\{PORT:-300\d\}/);
  });

  test('the Start server reads PORT before the port of its app', async () => {
    const config = await readTextFile(join(project, 'apps/docs/vite.config.ts'));
    expect(config).toContain('port: Number(process.env.PORT ?? 3001),');
    expect(await readTextFile(join(project, 'apps/docs/.env.start'))).toBe('NODE_ENV=production\nPORT=3001\n');
  });

  test('the README and AGENTS.md say how to move one app', async () => {
    for (const file of ['README.md', 'AGENTS.md']) {
      const text = await readTextFile(join(project, file));
      for (const app of ['web', 'docs', 'api']) {
        expect(text, file).toContain(`- ${app}: \`(cd apps/${app} && PORT=4000 npm run dev)\``);
      }
      expect(text, file).toContain('`PORT` on the root `npm run dev` reaches every app');
    }
  });
});

describe('single repo', () => {
  test('the Start server reads PORT, the one runtime that ignores it', async () => {
    const project = await generate('port-single-start', ['--app', 'app:tanstack-start']);
    expect(await readTextFile(join(project, 'vite.config.ts'))).toContain('port: Number(process.env.PORT ?? 3000),');
  });

  test('the README and AGENTS.md say how to change the port', async () => {
    const project = await generate('port-single-docs', ['--app', 'app:nextjs']);
    const readme = await readTextFile(join(project, 'README.md'));
    const agents = await readTextFile(join(project, 'AGENTS.md'));

    expect(readme).toContain('Open [http://localhost:3000](http://localhost:3000) in your browser.');
    for (const text of [readme, agents]) {
      expect(text).toContain('listens on port 3000');
      expect(text).toContain('`PORT=4000 npm run dev`');
    }
  });

  test('portless owns the port, and the docs follow the URL it serves', async () => {
    const project = await generate('port-single-portless', ['--app', 'app:nextjs', '--tooling', 'portless']);
    const readme = await readTextFile(join(project, 'README.md'));

    expect(readme).toContain('Open [https://port-single-portless.localhost:1355]');
    expect(readme).toContain('portless, which assigns the port itself and ignores `PORT`');
    expect(readme).toContain('`PORTLESS_APP_PORT`');
  });

  test('without portless the docs do not mention it', async () => {
    const project = await generate('port-single-no-portless', ['--app', 'app:nextjs']);
    expect(await readTextFile(join(project, 'README.md'))).not.toContain('PORTLESS_APP_PORT');
  });
});

describe('blueprints', () => {
  test('the cloudflare-fullstack-nextjs seed takes BETTER_AUTH_URL from the .env of the web app', async () => {
    const project = await generate('port-blueprint-cf', ['--blueprint', 'cloudflare-fullstack-nextjs']);
    const { scripts } = await readJsonFile<PackageJson>(join(project, 'package.json'));

    expect(scripts['db:seed']).toBe('tsx --env-file=apps/web/.env scripts/seed.ts');
  });

  test('the cloudflare-fullstack-nextjs agent notes give the URL of the web app', async () => {
    const project = await generate('port-blueprint-cf-portless', [
      '--blueprint',
      'cloudflare-fullstack-nextjs',
      '--tooling',
      'portless',
    ]);
    const notes = await readTextFile(join(project, 'docs/agents/cloudflare-deploy.md'));

    expect(notes).toContain('`BETTER_AUTH_URL` is already `https://web.localhost:1355`');
  });

  test('the multitenant-saas-nextjs invitation links fall back to the URL of the web app', async () => {
    const project = await generate('port-blueprint-saas', [
      '--blueprint',
      'multitenant-saas-nextjs',
      '--tooling',
      'portless',
    ]);
    const router = await readTextFile(join(project, 'packages/api/src/router/invitation.ts'));
    const auth = await readTextFile(join(project, 'packages/auth/src/auth.ts'));

    for (const source of [router, auth]) {
      expect(source).toContain("process.env.NEXT_PUBLIC_APP_URL ?? 'https://web.localhost:1355'");
    }
  });
});
