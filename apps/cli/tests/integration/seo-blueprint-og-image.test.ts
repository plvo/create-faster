import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

function extractBlock(source: string, key: string): string {
  const match = source.match(new RegExp(`\\n( *)${key}: \\{[\\s\\S]*?\\n\\1\\}`));
  if (!match) throw new Error(`No ${key} block found`);
  return match[0];
}

describe('Open Graph and Twitter images of the SEO blueprints', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  for (const blueprint of ['showcase', 'cloudflare-static-site']) {
    describe(blueprint, () => {
      let projectPath: string;

      beforeAll(async () => {
        const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install'], tempDir);
        expect(result.exitCode).toBe(0);
        projectPath = join(tempDir, blueprint);
      });

      test('the root layout links the site image from openGraph and twitter against metadataBase', async () => {
        const layout = await readTextFile(join(projectPath, 'src/app/layout.tsx'));
        expect(layout).toContain('metadataBase: new URL(siteConfig.url)');
        expect(extractBlock(layout, 'openGraph')).toContain('images: [siteConfig.ogImage]');
        expect(extractBlock(layout, 'twitter')).toContain('images: [siteConfig.ogImage]');
      });

      test('a blog post uses its own image or the site image in openGraph and twitter', async () => {
        const page = await readTextFile(join(projectPath, 'src/app/blog/[slug]/page.tsx'));
        expect(page).toContain('const image = post.metadata.imageUrl ?? siteConfig.ogImage;');
        expect(extractBlock(page, 'openGraph')).toContain('images: [image]');
        expect(extractBlock(page, 'twitter')).toContain('images: [image]');
        expect(extractBlock(page, 'twitter')).toContain("card: 'summary_large_image'");
      });
    });
  }
});
