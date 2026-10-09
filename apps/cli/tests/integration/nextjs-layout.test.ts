import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const IMPORT_APP_PROVIDERS = "import { AppProviders } from '@/components/app-providers';";

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

function expectChildrenWrappedOnce(layout: string, { withDevtools }: { withDevtools: boolean }): void {
  expect(countOccurrences(layout, IMPORT_APP_PROVIDERS)).toBe(1);
  expect(countOccurrences(layout, '<AppProviders>')).toBe(1);
  expect(countOccurrences(layout, '</AppProviders>')).toBe(1);

  const open = layout.indexOf('<AppProviders>');
  const children = layout.indexOf('{children}');
  const close = layout.indexOf('</AppProviders>');
  expect(open).toBeLessThan(children);
  expect(children).toBeLessThan(close);

  if (withDevtools) {
    const devtools = layout.indexOf('<TanStackDevtools');
    expect(children).toBeLessThan(devtools);
    expect(devtools).toBeLessThan(close);
  } else {
    expect(layout).not.toContain('<TanStackDevtools');
  }

  expect(layout).toContain(`\n${' '.repeat(8)}<AppProviders>\n${' '.repeat(10)}<main>{children}</main>`);
  expect(layout).toContain(`\n${' '.repeat(8)}</AppProviders>\n`);
}

describe('Next.js root layout and AppProviders', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generateProject(projectName: string, args: string[]): Promise<void> {
    const result = await runCli([projectName, ...args, '--no-git', '--no-install'], tempDir);
    expect(result.exitCode).toBe(0);
  }

  async function generateLayout(projectName: string, args: string[]): Promise<string> {
    await generateProject(projectName, args);
    return readTextFile(join(tempDir, projectName, 'src/app/layout.tsx'));
  }

  test('wraps children in AppProviders when no provider library is selected', async () => {
    const layout = await generateLayout('layout-plain', ['--app', 'layout-plain:nextjs:shadcn']);
    expectChildrenWrappedOnce(layout, { withDevtools: false });
  });

  test('wraps children in AppProviders when next-themes is selected', async () => {
    const layout = await generateLayout('layout-themes', ['--app', 'layout-themes:nextjs:next-themes']);
    expectChildrenWrappedOnce(layout, { withDevtools: false });
  });

  test('keeps the devtools inside AppProviders so the query client is available', async () => {
    const layout = await generateLayout('layout-devtools', [
      '--app',
      'layout-devtools:nextjs:tanstack-query,tanstack-devtools',
    ]);
    expectChildrenWrappedOnce(layout, { withDevtools: true });
  });

  test('wraps children once when trpc, tanstack-query, next-themes and devtools are combined', async () => {
    const layout = await generateLayout('layout-combined', [
      '--app',
      'layout-combined:nextjs:trpc,tanstack-query,next-themes,tanstack-devtools',
    ]);
    expectChildrenWrappedOnce(layout, { withDevtools: true });
  });

  test('wraps children in AppProviders in the app layout of a turborepo', async () => {
    await generateProject('layout-turbo', [
      '--app',
      'web:nextjs:next-themes,tanstack-query,tanstack-devtools',
      '--app',
      'api:hono',
    ]);
    const layout = await readTextFile(join(tempDir, 'layout-turbo', 'apps/web/src/app/layout.tsx'));
    expectChildrenWrappedOnce(layout, { withDevtools: true });
  });

  test('app-providers passes children through when no provider library is selected', async () => {
    await generateProject('providers-plain', ['--app', 'providers-plain:nextjs:shadcn']);
    const providers = await readTextFile(join(tempDir, 'providers-plain', 'src/components/app-providers.tsx'));
    expect(providers).toContain('return children;');
    expect(providers).not.toMatch(/return \(\s*\{children\}\s*\)/);
  });
});
