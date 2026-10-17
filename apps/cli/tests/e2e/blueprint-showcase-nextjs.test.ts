import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  generateInstalledProject,
  getFreePort,
  runCli,
  runCommand,
  startServer,
} from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_BUILD = 180_000;
const TIMEOUT_BUILD_CF = 300_000;
const TIMEOUT_PREVIEW = 120_000;

const ADDED_POST = `---
title: Added Post
summary: A post added without editing any code
publishedAt: 2026-01-01
---

## Added heading

Served without registration.
`;

const UNKNOWN_POSTS = ['/blog/nope', '/blog/constructor', '/blog/__proto__', '/blog/..%2Fpackage', '/blog/why-carrier.mdx'];

async function postSlugs(projectDir: string): Promise<string[]> {
  return (await readdir(join(projectDir, 'contents/blog')))
    .filter((file) => file.endsWith('.mdx'))
    .map((file) => file.replace(/\.mdx$/, ''));
}

async function expectBlogServed(baseUrl: string, slugs: string[]): Promise<void> {
  const index = await fetch(new URL('/blog', baseUrl));
  expect(index.status).toBe(200);
  const indexHtml = await index.text();

  for (const slug of slugs) {
    expect(indexHtml, `/blog links to ${slug}`).toContain(`href="/blog/${slug}"`);
    const post = await fetch(new URL(`/blog/${slug}`, baseUrl));
    expect(post.status, slug).toBe(200);
    expect((await post.text()).match(/<h1\b/g), `${slug} has one h1`).toHaveLength(1);
  }

  for (const path of UNKNOWN_POSTS) {
    expect((await fetch(new URL(path, baseUrl))).status, path).toBe(404);
  }

  const sitemap = await (await fetch(new URL('/sitemap.xml', baseUrl))).text();
  for (const slug of slugs) expect(sitemap).toContain(`/blog/${slug}</loc>`);
}

describe('blueprint-showcase-nextjs', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      ['showcase', '--blueprint', 'showcase-nextjs', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'showcase');
    await writeFile(join(projectDir, 'contents/blog/added-post.mdx'), ADDED_POST);
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
    'type-checks',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
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
    'next start serves /blog, every post and a post added to contents/blog, and answers 404 for an unknown slug',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], projectDir, { readyPath: '/blog' });
      try {
        const slugs = await postSlugs(projectDir);
        expect(slugs).toContain('added-post');
        await expectBlogServed(server.url, slugs);
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_BUILD + TIMEOUT_PREVIEW,
  );
});

describe('blueprint-showcase-nextjs on cloudflare', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await generateInstalledProject('showcase-cloudflare', [
      '--blueprint',
      'showcase-nextjs',
      '--deployment',
      'cloudflare',
    ]);
    await writeFile(join(projectDir, 'contents/blog/added-post.mdx'), ADDED_POST);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'build:cf then preview serves /blog, every post and a post added to contents/blog in workerd, and answers 404 for an unknown slug',
    async () => {
      const build = await runCommand(['bun', 'run', 'build:cf'], projectDir);
      expect(build.exitCode, build.stderr).toBe(0);

      const port = await getFreePort();
      const inspectorPort = await getFreePort();
      const server = await startServer(
        ['bun', 'run', 'preview', '--', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspectorPort)],
        projectDir,
        { port, readyPath: '/blog', readyTimeout: TIMEOUT_PREVIEW / 2 },
      );
      let stderr: string;
      try {
        const slugs = await postSlugs(projectDir);
        expect(slugs).toContain('added-post');
        await expectBlogServed(server.url, slugs);
      } finally {
        ({ stderr } = await server.stop());
      }
      expect(stderr).not.toContain("readdir '/bundle/contents");
      expect(stderr).not.toContain("ENOENT");
    },
    TIMEOUT_BUILD_CF + TIMEOUT_PREVIEW,
  );
});
