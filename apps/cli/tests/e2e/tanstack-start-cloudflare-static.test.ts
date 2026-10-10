import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  expectServesPageWithClientScript,
  fileExists,
  getFreePort,
  type RunningServer,
  runCli,
  runCommand,
  startServer,
} from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_BUILD = 360_000;
const TIMEOUT_DEPLOY_DRY_RUN = 120_000;
const TIMEOUT_PREVIEW = 90_000;

interface Scenario {
  name: string;
  args: string[];
  startAppDirs: string[];
  otherWorkerDirs: string[];
}

const NOT_FOUND_TEXT = 'Page not found';

// The generated app only has a home page: these test-only routes give the prerenderer a static page
// and a dynamic page that is reachable through a link only.
const TEST_ROUTES: Record<string, string> = {
  'src/routes/about.tsx': `import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/about')({
  component: () => (
    <div>
      <h2>About page</h2>
      <a href="/posts/1">First post</a>
    </div>
  ),
});
`,
  'src/routes/posts.$id.tsx': `import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/posts/$id')({
  component: () => <h2>Post {Route.useParams().id}</h2>,
});
`,
};

const SCENARIOS: Scenario[] = [
  {
    name: 'tanstack-start-static',
    args: ['--app', 'tanstack-start-static:tanstack-start:shadcn,evlog'],
    startAppDirs: ['.'],
    otherWorkerDirs: [],
  },
  {
    name: 'tanstack-start-static-turborepo',
    args: ['--app', 'web:tanstack-start', '--app', 'admin:tanstack-start'],
    startAppDirs: ['apps/web', 'apps/admin'],
    otherWorkerDirs: [],
  },
  {
    name: 'tanstack-start-static-next-turborepo',
    args: ['--app', 'web:tanstack-start', '--app', 'docs:nextjs'],
    startAppDirs: ['apps/web'],
    otherWorkerDirs: ['apps/docs'],
  },
];

describe.each(SCENARIOS)('$name', ({ name, args, startAppDirs, otherWorkerDirs }) => {
  let projectDir: string;
  let installResult: CommandResult;
  const servers: RunningServer[] = [];

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [name, ...args, '--deployment', 'cloudflare-static', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    for (const dir of startAppDirs) {
      for (const [path, content] of Object.entries(TEST_ROUTES)) {
        const routePath = join(projectDir, dir, path);
        await mkdir(dirname(routePath), { recursive: true });
        await writeFile(routePath, content);
      }
    }
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'installs dependencies',
    () => {
      expect(installResult.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );

  test(
    'builds and prerenders flat html files into dist/client',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);

      for (const dir of startAppDirs) {
        const client = join(projectDir, dir, 'dist/client');
        for (const file of ['index.html', '404.html', 'about.html', 'posts/1.html']) {
          expect(await fileExists(join(client, file))).toBe(true);
        }
        expect(await fileExists(join(client, 'about/index.html'))).toBe(false);
      }
    },
    TIMEOUT_BUILD,
  );

  test(
    'wrangler deploy --dry-run succeeds and ships assets only',
    async () => {
      for (const dir of [...startAppDirs, ...otherWorkerDirs]) {
        const result = await runCommand(['bunx', 'wrangler', 'deploy', '--dry-run'], join(projectDir, dir));
        expect(result.exitCode).toBe(0);
        expect(result.stdout + result.stderr).toContain('assets directory');
      }
    },
    TIMEOUT_DEPLOY_DRY_RUN,
  );

  test(
    'wrangler dev serves the home page, the linked pages and a 404 page on unknown urls',
    async () => {
      for (const dir of startAppDirs) {
        const port = await getFreePort();
        const server = await startServer(
          ['bunx', 'wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port)],
          join(projectDir, dir),
          { port },
        );
        servers.push(server);

        await expectServesPageWithClientScript(server.url);

        const about = await fetch(new URL('/about', server.url), { redirect: 'manual' });
        expect(about.status).toBe(200);
        expect(await about.text()).toContain('About page');

        const post = await fetch(new URL('/posts/1', server.url), { redirect: 'manual' });
        expect(post.status).toBe(200);
        expect(await post.text()).toContain('Post');

        const missing = await fetch(new URL('/does-not-exist', server.url));
        expect(missing.status).toBe(404);
        expect(await missing.text()).toContain(NOT_FOUND_TEXT);
      }
    },
    TIMEOUT_PREVIEW,
  );

  test(
    'type-checks',
    async () => {
      for (const dir of startAppDirs) {
        const result = await runCommand(['bunx', 'tsc', '--noEmit'], join(projectDir, dir));
        expect(result.exitCode).toBe(0);
      }
    },
    TIMEOUT_TYPECHECK,
  );
});
