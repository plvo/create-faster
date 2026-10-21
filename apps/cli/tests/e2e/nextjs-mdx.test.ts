import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, fileExists, generateInstalledProject, getFreePort, runCommand, startServer } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_BUILD = 300_000;
const TIMEOUT_PREVIEW = 120_000;

const ADDED_DOCUMENT = `---
title: Added
summary: A document added without editing the page
publishedAt: 2025-10-23
---

# Added

Served without registration.
`;

const UNKNOWN_PATHS = [
  '/mdx/nope',
  '/mdx/home',
  '/mdx/cool/nope',
  '/mdx/constructor',
  '/mdx/__proto__',
  '/mdx/..%2Fpackage',
  '/mdx/cool.mdx',
];

async function expectNotFound(baseUrl: string): Promise<void> {
  for (const path of UNKNOWN_PATHS) {
    const response = await fetch(new URL(path, baseUrl));
    expect(response.status, path).toBe(404);
  }
}

describe('nextjs-mdx on cloudflare', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await generateInstalledProject('nextjs-mdx-cloudflare', [
      '--app',
      'nextjs-mdx-cloudflare:nextjs:mdx',
      '--deployment',
      'cloudflare',
    ]);
    await writeFile(join(projectDir, 'contents/added.mdx'), ADDED_DOCUMENT);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'build:cf then preview serves /mdx, a document and one added to contents/, and answers 404 for any other slug in workerd',
    async () => {
      const build = await runCommand(['bun', 'run', 'build:cf'], projectDir);
      expect(build.exitCode, build.stderr).toBe(0);

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
          '--inspector-port',
          String(inspectorPort),
        ],
        projectDir,
        { port, readyPath: '/mdx', readyTimeout: TIMEOUT_PREVIEW / 2, env: { PORT: String(port) } },
      );
      let stderr: string;
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

        const added = await fetch(new URL('/mdx/added', server.url));
        expect(added.status).toBe(200);
        expect(await added.text()).toContain('<h1 class="h1-mdx">Added</h1>');

        await expectNotFound(server.url);
      } finally {
        ({ stderr } = await server.stop());
      }
      expect(stderr).not.toContain("readdir '/bundle/contents'");
    },
    TIMEOUT_BUILD + TIMEOUT_PREVIEW,
  );
});

describe('nextjs-mdx without a deployment', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await generateInstalledProject('nextjs-mdx-plain', ['--app', 'nextjs-mdx-plain:nextjs:mdx']);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'next build prerenders every document and next start answers 404 for any other slug',
    async () => {
      const build = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(build.exitCode, build.stderr).toBe(0);

      const server = await startServer(['bun', 'run', 'start'], projectDir, { readyPath: '/mdx' });
      try {
        expect((await fetch(new URL('/mdx', server.url))).status).toBe(200);
        expect((await fetch(new URL('/mdx/cool', server.url))).status).toBe(200);
        await expectNotFound(server.url);
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_BUILD + TIMEOUT_PREVIEW,
  );
});

describe('nextjs-mdx on cloudflare-static', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await generateInstalledProject('nextjs-mdx-static', [
      '--app',
      'nextjs-mdx-static:nextjs:mdx',
      '--deployment',
      'cloudflare-static',
    ]);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'next build exports one HTML page per document',
    async () => {
      const build = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(build.exitCode, build.stderr).toBe(0);

      expect(await fileExists(join(projectDir, 'out/mdx.html'))).toBe(true);
      expect(await Bun.file(join(projectDir, 'out/mdx/cool.html')).text()).toContain('<h1 class="h1-mdx">Cool</h1>');
    },
    TIMEOUT_BUILD,
  );
});
