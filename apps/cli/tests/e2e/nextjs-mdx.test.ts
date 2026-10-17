import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  cleanupTempDir,
  createTempDir,
  fileExists,
  getFreePort,
  runCli,
  runCommand,
  startServer,
} from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_BUILD = 300_000;
const TIMEOUT_PREVIEW = 120_000;

async function generateAndInstall(name: string, extraFlags: string[]): Promise<{ tempDir: string; projectDir: string }> {
  const tempDir = await createTempDir();
  const result = await runCli(
    [name, '--app', `${name}:nextjs:mdx`, ...extraFlags, '--no-git', '--no-install', '--pm', 'bun'],
    tempDir,
  );
  expect(result.exitCode).toBe(0);

  const projectDir = join(tempDir, name);
  const install = await runCommand(['bun', 'install'], projectDir);
  expect(install.exitCode).toBe(0);
  return { tempDir, projectDir };
}

describe('nextjs-mdx on cloudflare', () => {
  let tempDir: string;
  let projectDir: string;

  beforeAll(async () => {
    ({ tempDir, projectDir } = await generateAndInstall('nextjs-mdx-cloudflare', ['--deployment', 'cloudflare']));
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (tempDir) await cleanupTempDir(tempDir);
  });

  test(
    'build:cf then preview serves /mdx and a document, and answers 404 for an unknown slug in workerd',
    async () => {
      const build = await runCommand(['bun', 'run', 'build:cf'], projectDir);
      expect(build.exitCode).toBe(0);

      const port = await getFreePort();
      const inspectorPort = await getFreePort();
      const server = await startServer(
        [
          'bun',
          'run',
          'preview',
          '--',
          '--ip',
          '127.0.0.1',
          '--port',
          String(port),
          '--inspector-port',
          String(inspectorPort),
        ],
        projectDir,
        { port, readyPath: '/mdx', readyTimeout: TIMEOUT_PREVIEW / 2 },
      );
      try {
        const home = await fetch(new URL('/mdx', server.url));
        expect(home.status).toBe(200);
        const homeHtml = await home.text();
        expect(homeHtml).toContain('<h1 class="h1-mdx">Home</h1>');
        expect(homeHtml.match(/<main/g)).toHaveLength(1);
        expect(homeHtml).not.toContain('publishedAt');

        const cool = await fetch(new URL('/mdx/cool', server.url));
        expect(cool.status).toBe(200);
        expect(await cool.text()).toContain('<h1 class="h1-mdx">Cool</h1>');

        expect((await fetch(new URL('/mdx/nope', server.url))).status).toBe(404);
        expect((await fetch(new URL('/mdx/home', server.url))).status).toBe(404);
        expect((await fetch(new URL('/mdx/cool/nope', server.url))).status).toBe(404);
      } finally {
        const { stderr } = await server.stop();
        expect(stderr).not.toContain("readdir '/bundle/contents'");
      }
    },
    TIMEOUT_BUILD + TIMEOUT_PREVIEW,
  );
});

describe('nextjs-mdx without a deployment', () => {
  let tempDir: string;
  let projectDir: string;

  beforeAll(async () => {
    ({ tempDir, projectDir } = await generateAndInstall('nextjs-mdx-plain', []));
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (tempDir) await cleanupTempDir(tempDir);
  });

  test(
    'next build prerenders every document and next start answers 404 for an unknown slug',
    async () => {
      const build = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(build.exitCode).toBe(0);

      const server = await startServer(['bun', 'run', 'start'], projectDir, { readyPath: '/mdx' });
      try {
        expect((await fetch(new URL('/mdx', server.url))).status).toBe(200);
        expect((await fetch(new URL('/mdx/cool', server.url))).status).toBe(200);
        expect((await fetch(new URL('/mdx/nope', server.url))).status).toBe(404);
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_BUILD + TIMEOUT_PREVIEW,
  );
});

describe('nextjs-mdx on cloudflare-static', () => {
  let tempDir: string;
  let projectDir: string;

  beforeAll(async () => {
    ({ tempDir, projectDir } = await generateAndInstall('nextjs-mdx-static', ['--deployment', 'cloudflare-static']));
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (tempDir) await cleanupTempDir(tempDir);
  });

  test(
    'next build exports one HTML page per document',
    async () => {
      const build = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(build.exitCode).toBe(0);

      expect(await fileExists(join(projectDir, 'out/mdx.html'))).toBe(true);
      expect(await fileExists(join(projectDir, 'out/mdx/cool.html'))).toBe(true);
      expect(await Bun.file(join(projectDir, 'out/mdx/cool.html')).text()).toContain('<h1 class="h1-mdx">Cool</h1>');
    },
    TIMEOUT_BUILD,
  );
});
