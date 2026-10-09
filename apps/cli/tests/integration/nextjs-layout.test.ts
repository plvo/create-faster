import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const IMPORT_APP_PROVIDERS = "import { AppProviders } from '@/components/app-providers';";

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

describe('Next.js root layout and AppProviders', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generateLayout(projectName: string, args: string[]): Promise<string> {
    const result = await runCli([projectName, ...args, '--no-git', '--no-install'], tempDir);
    expect(result.exitCode).toBe(0);
    return readTextFile(join(tempDir, projectName, 'src/app/layout.tsx'));
  }

  test('wraps children in AppProviders when next-themes is selected', async () => {
    const layout = await generateLayout('layout-themes', ['--app', 'layout-themes:nextjs:next-themes']);
    expect(layout).toContain(IMPORT_APP_PROVIDERS);
    expect(layout).toMatch(/<AppProviders>\s*<main>\{children\}<\/main>\s*<\/AppProviders>/);
  });

  test('wraps children in AppProviders when tanstack-query is selected', async () => {
    const layout = await generateLayout('layout-query', ['--app', 'layout-query:nextjs:tanstack-query']);
    expect(layout).toContain(IMPORT_APP_PROVIDERS);
    expect(layout).toMatch(/<AppProviders>\s*<main>\{children\}<\/main>\s*<\/AppProviders>/);
  });

  test('wraps children in AppProviders once when trpc, tanstack-query and next-themes are combined', async () => {
    const layout = await generateLayout('layout-trpc', ['--app', 'layout-trpc:nextjs:trpc,tanstack-query,next-themes']);
    expect(countOccurrences(layout, IMPORT_APP_PROVIDERS)).toBe(1);
    expect(countOccurrences(layout, '<AppProviders>')).toBe(1);
  });

  test('renders the devtools inside AppProviders so the query client is available', async () => {
    const layout = await generateLayout('layout-devtools', [
      '--app',
      'layout-devtools:nextjs:tanstack-query,tanstack-devtools',
    ]);
    expect(layout).toMatch(/<AppProviders>[\s\S]*<TanStackDevtools[\s\S]*<\/AppProviders>/);
  });

  test('does not import or render AppProviders when no library provides a provider', async () => {
    const layout = await generateLayout('layout-plain', ['--app', 'layout-plain:nextjs:shadcn']);
    expect(layout).not.toContain('AppProviders');
    expect(layout).toContain('<main>{children}</main>');
  });

  test('a blueprint layout mounts AppProviders exactly once', async () => {
    const layout = await generateLayout('layout-showcase', ['--blueprint', 'showcase']);
    expect(countOccurrences(layout, IMPORT_APP_PROVIDERS)).toBe(1);
    expect(countOccurrences(layout, '<AppProviders>')).toBe(1);
  });
});
