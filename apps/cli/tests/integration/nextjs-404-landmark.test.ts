import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const MAIN_OPENING_TAG = /<main[\s>]/g;

function countMains(source: string): number {
  return source.match(MAIN_OPENING_TAG)?.length ?? 0;
}

const NEXTJS_ROOTS = [
  { title: 'a plain Next.js app', args: ['--app', 'site:nextjs'], root: 'site' },
  { title: 'showcase-nextjs', args: ['--blueprint', 'showcase-nextjs'], root: 'site' },
  { title: 'cloudflare-static-site-nextjs', args: ['--blueprint', 'cloudflare-static-site-nextjs'], root: 'site' },
  { title: 'dapp-rainbowkit-nextjs', args: ['--blueprint', 'dapp-rainbowkit-nextjs'], root: 'site' },
  { title: 'dapp-privy-nextjs', args: ['--blueprint', 'dapp-privy-nextjs'], root: 'site' },
  { title: 'org-dashboard-nextjs', args: ['--blueprint', 'org-dashboard-nextjs'], root: 'site/apps/web' },
  { title: 'cloudflare-fullstack-nextjs', args: ['--blueprint', 'cloudflare-fullstack-nextjs'], root: 'site/apps/web' },
  { title: 'multitenant-saas-nextjs', args: ['--blueprint', 'multitenant-saas-nextjs'], root: 'site/apps/web' },
];

describe.each(NEXTJS_ROOTS)('$title root 404', ({ args, root }) => {
  let tempDir: string;
  let appDirectory: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(['site', ...args, '--no-install', '--no-git'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    appDirectory = join(tempDir, root, 'src/app');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('renders exactly one main landmark, counting the root layout around it', async () => {
    const layout = await readTextFile(join(appDirectory, 'layout.tsx'));
    const notFound = await readTextFile(join(appDirectory, 'not-found.tsx'));
    expect(countMains(layout) + countMains(notFound)).toBe(1);
  });

  test('sets its own title', async () => {
    const notFound = await readTextFile(join(appDirectory, 'not-found.tsx'));
    expect(notFound).toContain("title: 'Page not found'");
  });
});
