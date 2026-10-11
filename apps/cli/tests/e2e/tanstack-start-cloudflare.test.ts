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
const TIMEOUT_BUILD = 240_000;
const TIMEOUT_DEPLOY_DRY_RUN = 120_000;
const TIMEOUT_PREVIEW = 90_000;

interface D1Probe {
  appDir: string;
  dbImport: string;
}

interface Scenario {
  name: string;
  deployment: 'cloudflare' | 'cloudflare-static';
  args: string[];
  startAppDirs: string[];
  workerDirs: string[];
  d1Probe?: D1Probe;
}

const PROBE_ROUTE_PATH = '/api/d1-probe';
const PROBE_BURST = 20;

// No generated route imports src/lib/server.ts, so a build alone tree-shakes the module-scope db away.
// This route is test-only: it forces the db into the Worker bundle and queries it.
const probeRoute = (dbImport: string): string => `import { createFileRoute } from '@tanstack/react-router';
import { userTable } from '${dbImport}';
import { db } from '@/lib/server';

export const Route = createFileRoute('${PROBE_ROUTE_PATH}')({
  server: {
    handlers: {
      GET: async () => {
        await db.insert(userTable).values({ username: crypto.randomUUID(), email: \`\${crypto.randomUUID()}@example.com\` });
        const rows = await db.select().from(userTable);
        return Response.json({ count: rows.length });
      },
    },
  },
});
`;

async function expectProbeAnswers(url: string): Promise<void> {
  const responses = await Promise.all(
    Array.from({ length: PROBE_BURST }, () => fetch(new URL(PROBE_ROUTE_PATH, url))),
  );
  for (const response of responses) {
    expect(response.status).toBe(200);
    const body = (await response.json()) as { count: number };
    expect(body.count).toBeGreaterThanOrEqual(1);
  }
}

const NOT_FOUND_TEXT = 'Page not found';

// The generated app only has a home page: these test-only routes give the static prerender a static page
// and a dynamic page that is reachable through a link only.
const STATIC_TEST_ROUTES: Record<string, string> = {
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

async function expectServesStaticSite(url: string): Promise<void> {
  await expectServesPageWithClientScript(url);

  const about = await fetch(new URL('/about', url), { redirect: 'manual' });
  expect(about.status).toBe(200);
  expect(await about.text()).toContain('About page');

  const post = await fetch(new URL('/posts/1', url), { redirect: 'manual' });
  expect(post.status).toBe(200);
  expect(await post.text()).toContain('Post');

  const missing = await fetch(new URL('/does-not-exist', url));
  expect(missing.status).toBe(404);
  expect(await missing.text()).toContain(NOT_FOUND_TEXT);
}

const SCENARIOS: Scenario[] = [
  {
    name: 'tanstack-start-cloudflare',
    deployment: 'cloudflare',
    args: ['--app', 'tanstack-start-cloudflare:tanstack-start'],
    startAppDirs: ['.'],
    workerDirs: ['.'],
  },
  {
    name: 'tanstack-start-cloudflare-d1',
    deployment: 'cloudflare',
    args: ['--app', 'tanstack-start-cloudflare-d1:tanstack-start', '--database', 'd1', '--orm', 'drizzle'],
    startAppDirs: ['.'],
    workerDirs: ['.'],
    d1Probe: { appDir: '.', dbImport: '@/lib/db' },
  },
  {
    name: 'tanstack-start-cloudflare-postgres',
    deployment: 'cloudflare',
    args: ['--app', 'tanstack-start-cloudflare-postgres:tanstack-start', '--database', 'postgres', '--orm', 'drizzle'],
    startAppDirs: ['.'],
    workerDirs: ['.'],
  },
  {
    name: 'tanstack-start-cloudflare-turborepo',
    deployment: 'cloudflare',
    args: ['--app', 'web:tanstack-start', '--app', 'admin:tanstack-start'],
    startAppDirs: ['apps/web', 'apps/admin'],
    workerDirs: ['apps/web', 'apps/admin'],
  },
  {
    name: 'tanstack-start-cloudflare-turborepo-d1',
    deployment: 'cloudflare',
    args: ['--app', 'web:tanstack-start', '--app', 'api:hono', '--database', 'd1', '--orm', 'drizzle'],
    startAppDirs: ['apps/web'],
    workerDirs: ['apps/web', 'apps/api'],
    d1Probe: { appDir: 'apps/web', dbImport: '@repo/db' },
  },
  {
    name: 'tanstack-start-static',
    deployment: 'cloudflare-static',
    args: ['--app', 'tanstack-start-static:tanstack-start:shadcn,evlog,mdx'],
    startAppDirs: ['.'],
    workerDirs: ['.'],
  },
  {
    name: 'tanstack-start-static-turborepo',
    deployment: 'cloudflare-static',
    args: ['--app', 'web:tanstack-start', '--app', 'admin:tanstack-start'],
    startAppDirs: ['apps/web', 'apps/admin'],
    workerDirs: ['apps/web', 'apps/admin'],
  },
  {
    name: 'tanstack-start-static-next-turborepo',
    deployment: 'cloudflare-static',
    args: ['--app', 'web:tanstack-start', '--app', 'docs:nextjs'],
    startAppDirs: ['apps/web'],
    workerDirs: ['apps/web', 'apps/docs'],
  },
];

describe.each(SCENARIOS)('$name', ({ name, deployment, args, startAppDirs, workerDirs, d1Probe }) => {
  const isStatic = deployment === 'cloudflare-static';

  let projectDir: string;
  let installResult: CommandResult;
  const servers: RunningServer[] = [];

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [name, ...args, '--deployment', deployment, '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    if (isStatic) {
      for (const dir of startAppDirs) {
        for (const [path, content] of Object.entries(STATIC_TEST_ROUTES)) {
          const routePath = join(projectDir, dir, path);
          await mkdir(dirname(routePath), { recursive: true });
          await writeFile(routePath, content);
        }
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

  if (d1Probe) {
    test(
      'migrates the local D1 database with the generated scripts',
      async () => {
        const routePath = join(projectDir, d1Probe.appDir, 'src/routes', `${PROBE_ROUTE_PATH}.ts`);
        await mkdir(dirname(routePath), { recursive: true });
        await writeFile(routePath, probeRoute(d1Probe.dbImport));

        const generate = await runCommand(['bun', 'run', 'db:generate'], projectDir);
        expect(generate.exitCode).toBe(0);
        const migrate = await runCommand(['bun', 'run', 'db:migrate'], projectDir);
        expect(migrate.exitCode).toBe(0);
      },
      TIMEOUT_BUILD,
    );
  }

  test(
    'generates the worker types',
    async () => {
      for (const dir of startAppDirs) {
        const result = await runCommand(['bun', 'run', 'cf-typegen'], join(projectDir, dir));
        expect(result.exitCode).toBe(0);
      }
    },
    TIMEOUT_TYPECHECK,
  );

  test(
    'builds',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);

      if (isStatic) {
        for (const dir of startAppDirs) {
          const client = join(projectDir, dir, 'dist/client');
          for (const file of ['index.html', '404.html', 'about.html', 'posts/1.html']) {
            expect(await fileExists(join(client, file))).toBe(true);
          }
          expect(await fileExists(join(client, 'about/index.html'))).toBe(false);
        }
      }
    },
    TIMEOUT_BUILD,
  );

  test(
    'wrangler deploy --dry-run succeeds',
    async () => {
      for (const dir of workerDirs) {
        const result = await runCommand(['bunx', 'wrangler', 'deploy', '--dry-run'], join(projectDir, dir));
        expect(result.exitCode).toBe(0);
        if (isStatic) expect(result.stdout + result.stderr).toContain('assets directory');
      }
    },
    TIMEOUT_DEPLOY_DRY_RUN,
  );

  if (isStatic) {
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
          await expectServesStaticSite(server.url);
        }
      },
      TIMEOUT_PREVIEW,
    );
  } else {
    test(
      'vite preview serves the built app in workerd (and answers a D1 query when there is a database)',
      async () => {
        for (const dir of startAppDirs) {
          const port = await getFreePort();
          const server = await startServer(['bunx', 'vite', 'preview', '--port', String(port)], join(projectDir, dir), {
            port,
          });
          servers.push(server);
          await expectServesPageWithClientScript(server.url);
          if (d1Probe?.appDir === dir) await expectProbeAnswers(server.url);
        }
      },
      TIMEOUT_PREVIEW,
    );
  }

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
