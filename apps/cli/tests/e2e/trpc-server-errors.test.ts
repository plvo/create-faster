import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type CommandResult, cleanupTempDir, createTempDir, runCli, runCommand, type ServerOutput, startServer } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_BUILD = 180_000;
const TIMEOUT_START = 60_000;

const INTERNAL_DETAIL = "select * from users where email = 'leak@example.com'";
const BROWSER_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

const probeRouter = `import { publicProcedure, router } from '@/trpc/init';

export const probeRouter = router({
  failOnServer: publicProcedure.query((): { ok: boolean } => {
    throw new Error("${INTERNAL_DETAIL}");
  }),
});
`;

const nextjsPrefetchPage = `import { HydrateClient, prefetch, trpc } from '@/trpc/server';

export const dynamic = 'force-dynamic';

export default function Page() {
  prefetch(trpc.probe.failOnServer.queryOptions());
  return (
    <HydrateClient>
      <h1 id='prefetch-probe'>prefetch probe</h1>
    </HydrateClient>
  );
}
`;

const startPrefetchRoute = `import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/prefetch-probe')({
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(context.trpc.probe.failOnServer.queryOptions());
  },
  component: () => <h1 id='prefetch-probe'>prefetch probe</h1>,
});
`;

async function writeProjectFile(projectDir: string, path: string, content: string): Promise<void> {
  const file = join(projectDir, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function registerProbeRouter(projectDir: string): Promise<void> {
  const path = join(projectDir, 'src/trpc/routers/_app.ts');
  const root = await Bun.file(path).text();
  const registered = root
    .replace("import { helloRouter } from './hello';", "import { helloRouter } from './hello';\nimport { probeRouter } from './probe';")
    .replace('hello: helloRouter,', 'hello: helloRouter,\n  probe: probeRouter,');
  expect(registered).toContain('probe: probeRouter');
  await writeFile(path, registered);
}

describe.each([
  { stack: 'nextjs', pagePath: 'src/app/prefetch-probe/page.tsx', page: nextjsPrefetchPage },
  { stack: 'tanstack-start', pagePath: 'src/routes/prefetch-probe.tsx', page: startPrefetchRoute },
])('$stack: a procedure that throws during a server-side prefetch', ({ stack, pagePath, page }) => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const name = `trpc-server-errors-${stack}`;
    const result = await runCli(
      [name, '--app', `${name}:${stack}:trpc,tanstack-query`, '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    await writeProjectFile(projectDir, 'src/trpc/routers/probe.ts', probeRouter);
    await registerProbeRouter(projectDir);
    await writeProjectFile(projectDir, pagePath, page);
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
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
    'builds',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  test(
    'the page renders, the server logs the error once with its path and stack, the page never carries it',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], projectDir);
      let response: Response;
      let html: string;
      let output: ServerOutput | undefined;
      try {
        response = await fetch(new URL('/prefetch-probe', server.url), { headers: { 'user-agent': BROWSER_USER_AGENT } });
        html = await response.text();
        // The log is written while the page streams: give the server time to flush it.
        await Bun.sleep(500);
      } finally {
        output = await server.stop();
      }
      const logged = `${output?.stdout}\n${output?.stderr}`;
      expect(response.status).toBe(200);
      expect(html).toContain('prefetch probe');
      expect(html).not.toContain('leak@example.com');
      expect(logged.match(/tRPC failed on probe\.failOnServer/g)).toHaveLength(1);
      expect(logged).toContain(INTERNAL_DETAIL);
      expect(logged).toMatch(/\n\s+at /);
    },
    TIMEOUT_START,
  );
});
