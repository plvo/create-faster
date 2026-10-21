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

  test('the README and AGENTS.md put the command that moves an app on its line of the app list', async () => {
    const readme = await readTextFile(join(project, 'README.md'));
    const agents = await readTextFile(join(project, 'AGENTS.md'));

    for (const [app, stack, port] of [
      ['web', 'nextjs', 3000],
      ['docs', 'tanstack-start', 3001],
      ['api', 'hono', 3002],
    ] as const) {
      const command = `on another port: \`(cd apps/${app} && PORT=4000 npm run dev)\``;
      expect(readme).toContain(`- ${app}: [http://localhost:${port}](http://localhost:${port}), ${command}`);
      expect(agents).toContain(`- \`apps/${app}\` — ${stack} (http://localhost:${port}), ${command}`);
    }
    for (const text of [readme, agents]) {
      expect(text).toContain('`PORT` on the root `npm run dev` reaches every app');
      expect(text.match(/PORT=4000/g)).toHaveLength(3);
    }
  });

  test('under portless the app lines point to PORTLESS_APP_PORT, which portless honors, not to PORT', async () => {
    const portless = await generate('port-mono-portless', [...MONO_APPS, '--tooling', 'portless']);
    for (const file of ['README.md', 'AGENTS.md']) {
      const text = await readTextFile(join(portless, file));
      for (const app of ['web', 'docs', 'api']) {
        expect(text, file).toContain(`on another port: \`(cd apps/${app} && PORTLESS_APP_PORT=4000 npm run dev)\``);
      }
      expect(text, file).not.toMatch(/(?<![A-Z_])PORT=4000/);
    }
  });

  test('a turborepo of apps that do not listen says nothing about PORT', async () => {
    const quiet = await generate('port-mono-quiet', ['--app', 'mobile:expo', '--app', 'jobs:node']);
    for (const file of ['README.md', 'AGENTS.md']) {
      expect(await readTextFile(join(quiet, file)), file).not.toContain('PORT');
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

describe('origin variables of an app served on another port', () => {
  const AUTH_APPS = ['--app', 'web:nextjs:better-auth,trpc', '--app', 'api:hono'];
  const AUTH_PROJECT = ['--database', 'sqlite', '--orm', 'drizzle'];
  const BUILD_AGAIN = '`npm run build` again before `start`';

  test('a turborepo lists the variables to change in the .env of each app that has them', async () => {
    const project = await generate('port-url-mono', [...AUTH_APPS, ...AUTH_PROJECT]);

    for (const file of ['README.md', 'AGENTS.md']) {
      const text = await readTextFile(join(project, file));
      expect(text, file).toContain('set them to the new origin (`http://localhost:4000`)');
      expect(text, file).toContain(BUILD_AGAIN);
      expect(text, file).toMatch(
        /variables below[^\n]*\n\n- `apps\/web\/\.env`: `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`\n(?!- )/,
      );
    }
  });

  test('a single repo lists them for its root .env', async () => {
    const project = await generate('port-url-single', [
      '--app',
      'app:nextjs:better-auth',
      '--database',
      'sqlite',
      '--orm',
      'drizzle',
    ]);

    for (const file of ['README.md', 'AGENTS.md']) {
      const text = await readTextFile(join(project, file));
      expect(text, file).toContain(BUILD_AGAIN);
      expect(text, file).toContain('- `.env`: `BETTER_AUTH_URL`');
    }
  });

  test('a project whose apps receive no such variable says nothing about them', async () => {
    const project = await generate('port-url-none', ['--app', 'app:nextjs']);

    for (const file of ['README.md', 'AGENTS.md']) {
      const text = await readTextFile(join(project, file));
      expect(text, file).toContain('`start` takes `PORT` the same way.');
      expect(text, file).not.toContain('again before `start`');
    }
  });

  test('a variable that only holds the URL of the app is not an origin to change', async () => {
    const project = await generate('port-url-playwright', ['--app', 'app:nextjs:playwright']);
    const agents = await readTextFile(join(project, 'AGENTS.md'));

    expect(agents).toContain('`start` takes `PORT` the same way.');
    expect(agents).not.toContain('variables below');
    expect(agents).not.toContain('again before `start`');
  });

  test('under portless, plain start needs the origin of the port it serves on', async () => {
    const project = await generate('port-url-portless', [...AUTH_APPS, ...AUTH_PROJECT, '--tooling', 'portless']);

    for (const file of ['README.md', 'AGENTS.md']) {
      const text = await readTextFile(join(project, file));
      expect(text, file).toContain('Plain `start` does not go through portless');
      expect(text, file).toContain('`http://localhost:<port>`');
      expect(text, file).toContain('`start:portless`');
    }
  });
});

describe('preview of a Worker', () => {
  const previewOnAppPort = (port: number, persist: string) =>
    `sh -c 'opennextjs-cloudflare preview -- --port=\${PORT:-${port}} --persist-to ${persist} "$@"' sh`;

  async function previewOf(project: string, packageDir = ''): Promise<string | undefined> {
    const { scripts } = await readJsonFile<PackageJson>(join(project, packageDir, 'package.json'));
    return scripts.preview;
  }

  test('a Next.js Worker serves its preview on the port of its app, which PORT overrides', async () => {
    const single = await generate('port-preview-single', ['--app', 'app:nextjs', '--deployment', 'cloudflare']);
    expect(await previewOf(single)).toBe(previewOnAppPort(3000, './.wrangler'));

    const mono = await generate('port-preview-mono', [
      '--app',
      'api:hono',
      '--app',
      'web:nextjs',
      '--deployment',
      'cloudflare',
    ]);
    expect(await previewOf(mono, 'apps/web')).toBe(previewOnAppPort(3001, '../../.wrangler'));
  });

  test('a TanStack Start Worker keeps the port flag in a single repo, where --port <port> would be dropped', async () => {
    const single = await generate('port-preview-start', ['--app', 'app:tanstack-start', '--deployment', 'cloudflare']);
    expect(await previewOf(single)).toBe('vite preview --port=${PORT:-3000}');

    const mono = await generate('port-preview-start-mono', [
      '--app',
      'api:hono',
      '--app',
      'web:tanstack-start',
      '--deployment',
      'cloudflare',
    ]);
    expect(await previewOf(mono, 'apps/web')).toBe('vite preview --port=${PORT:-3001}');
  });
});

describe('blueprints', () => {
  test('the cloudflare-fullstack-nextjs seed takes BETTER_AUTH_URL from the .env of the web app', async () => {
    const project = await generate('port-blueprint-cf', ['--blueprint', 'cloudflare-fullstack-nextjs']);
    const { scripts } = await readJsonFile<PackageJson>(join(project, 'package.json'));

    expect(scripts['db:seed']).toBe('tsx --env-file=apps/web/.env --env-file=.env.seed scripts/seed.ts');
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

  test('the cloudflare-fullstack-nextjs preview serves on the port of the web app, so BETTER_AUTH_URL matches it', async () => {
    const project = await generate('port-blueprint-cf-preview', ['--blueprint', 'cloudflare-fullstack-nextjs']);
    const { scripts } = await readJsonFile<PackageJson>(join(project, 'apps/web/package.json'));

    expect(scripts.preview).toBe(
      `sh -c 'opennextjs-cloudflare preview -- --port=\${PORT:-3000} --persist-to ../../.wrangler "$@"' sh`,
    );
  });

  describe('multitenant-saas-nextjs invitation links', () => {
    interface InvitationLinkModule {
      invitationLink: (id: string) => string;
    }
    interface AppUrlModule {
      getAppUrl: () => string;
    }

    const original = process.env.NEXT_PUBLIC_APP_URL;
    let invitationLink: InvitationLinkModule['invitationLink'];
    let getAppUrl: AppUrlModule['getAppUrl'];
    let project: string;

    beforeAll(async () => {
      project = await generate('port-blueprint-saas', ['--blueprint', 'multitenant-saas-nextjs']);
      invitationLink = ((await import(join(project, 'packages/auth/src/invitation-link.ts'))) as InvitationLinkModule)
        .invitationLink;
      getAppUrl = ((await import(join(project, 'apps/web/src/lib/get-app-url.ts'))) as AppUrlModule).getAppUrl;
    });

    afterAll(() => {
      if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = original;
    });

    test.each([undefined, 'https://example.com', 'https://example.com//', 'https://example.com/app/'])(
      'builds the link on the origin getAppUrl gives, with NEXT_PUBLIC_APP_URL %p',
      (value) => {
        if (value === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
        else process.env.NEXT_PUBLIC_APP_URL = value;

        expect(invitationLink('abc')).toBe(`${getAppUrl()}/accept-invitation/abc`);
      },
    );

    test('falls back to the dev URL of the web app', () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      expect(invitationLink('abc')).toBe('http://localhost:3000/accept-invitation/abc');
    });

    test('the router and the auth package both use it', async () => {
      for (const file of ['packages/api/src/router/invitation.ts', 'packages/auth/src/auth.ts']) {
        const source = await readTextFile(join(project, file));
        expect(source, file).toContain('invitationLink(');
        expect(source, file).not.toContain('NEXT_PUBLIC_APP_URL');
      }
    });
  });
});
