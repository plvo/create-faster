import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { cleanupTempDir, evaluateNextConfig, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const DYNAMIC_SEGMENT = /\[[^\]]+\]/;

async function dynamicPages(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name === 'page.tsx')
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((page) => DYNAMIC_SEGMENT.test(relative(directory, page)));
}

const APPS = [
  {
    title: 'cloudflare-static-site-nextjs',
    args: ['--blueprint', 'cloudflare-static-site-nextjs'],
    routes: ['blog/[slug]', 'for/[persona]'],
    staticExport: true,
  },
  {
    title: 'showcase-nextjs',
    args: ['--blueprint', 'showcase-nextjs'],
    routes: ['blog/[slug]', 'for/[persona]'],
    staticExport: false,
  },
  {
    title: 'an mdx app on cloudflare-static',
    args: ['--app', 'web:nextjs:mdx', '--deployment', 'cloudflare-static'],
    routes: ['mdx/[[...slug]]'],
    staticExport: true,
  },
];

describe.each(APPS)('$title dynamic routes', ({ args, routes, staticExport }) => {
  let tempDir: string;
  let pages: string[];
  let appDirectory: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(['routes', ...args, '--no-install', '--no-git'], tempDir);
    expect(result.exitCode).toBe(0);
    appDirectory = join(tempDir, 'routes', 'src/app');
    pages = await dynamicPages(appDirectory);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('ships the dynamic routes the guard covers', () => {
    const found = pages.map((page) => relative(appDirectory, join(page, '..')));
    for (const route of routes) expect(found).toContain(route);
  });

  test.if(staticExport)('next dev does not run under the static export, which answers an unknown param with a 500', async () => {
    const config = await readTextFile(join(tempDir, 'routes', 'next.config.ts'));
    expect((await evaluateNextConfig(config, tempDir, 'production')).output).toBe('export');
    expect((await evaluateNextConfig(config, tempDir, 'development')).output).toBeUndefined();
  });

  test('every dynamic route sets dynamicParams = false', async () => {
    for (const page of pages) {
      const source = await readTextFile(page);
      const route = relative(appDirectory, page);
      expect(source, route).toContain('export function generateStaticParams');
      expect(source, route).toContain('export const dynamicParams = false;');
    }
  });
});
