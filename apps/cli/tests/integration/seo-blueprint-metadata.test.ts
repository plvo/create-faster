import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

interface SocialMetadata {
  title?: string;
  description?: string;
  url?: string;
  siteName?: string;
  locale?: string;
  type?: string;
  publishedTime?: string;
  card?: string;
  images?: string[];
}

interface PageMetadata {
  title?: string;
  description?: string;
  openGraph: SocialMetadata;
  twitter: SocialMetadata;
}

interface SeoModule {
  siteOpenGraph: SocialMetadata;
  siteTwitter: SocialMetadata;
  createPageMetadata: (input: {
    title?: string;
    description: string;
    path: string;
    image?: string;
    publishedTime?: string;
  }) => PageMetadata;
}

interface SiteConfigModule {
  siteConfig: { name: string; description: string; ogImage: string };
}

describe('Open Graph and Twitter metadata of the SEO blueprints', () => {
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
      let seo: SeoModule;
      let siteConfig: SiteConfigModule['siteConfig'];

      const readPage = (path: string) => readTextFile(join(projectPath, 'src/app', path));

      beforeAll(async () => {
        const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install'], tempDir);
        expect(result.exitCode).toBe(0);
        projectPath = join(tempDir, blueprint);
        seo = (await import(join(projectPath, 'src/lib/seo.ts'))) as SeoModule;
        siteConfig = ((await import(join(projectPath, 'src/lib/data/site-config.ts'))) as SiteConfigModule).siteConfig;
      });

      test('a page keeps the site name, locale and image and sets its own title, description and url', () => {
        const metadata = seo.createPageMetadata({ title: 'About', description: 'About us.', path: '/about' });

        expect(metadata.title).toBe('About');
        expect(metadata.description).toBe('About us.');
        expect(metadata.openGraph).toEqual({
          ...seo.siteOpenGraph,
          title: 'About',
          description: 'About us.',
          url: '/about',
        });
        expect(metadata.openGraph.siteName).toBe(siteConfig.name);
        expect(metadata.openGraph.locale).toBe('en_US');
        expect(metadata.openGraph.type).toBe('website');
        expect(metadata.openGraph.images).toEqual([siteConfig.ogImage]);
        expect(metadata.twitter).toEqual({
          ...seo.siteTwitter,
          title: 'About',
          description: 'About us.',
        });
        expect(metadata.twitter.card).toBe('summary_large_image');
        expect(metadata.twitter.images).toEqual([siteConfig.ogImage]);
      });

      test('a dated page is an article with its publication time and image', () => {
        const metadata = seo.createPageMetadata({
          title: 'Post',
          description: 'A post.',
          path: '/blog/post',
          image: '/post.png',
          publishedTime: '2025-02-20',
        });

        expect(metadata.openGraph.type).toBe('article');
        expect(metadata.openGraph.publishedTime).toBe('2025-02-20');
        expect(metadata.openGraph.url).toBe('/blog/post');
        expect(metadata.openGraph.siteName).toBe(siteConfig.name);
        expect(metadata.openGraph.images).toEqual(['/post.png']);
        expect(metadata.twitter.images).toEqual(['/post.png']);
      });

      test('a page without a date is not an article', () => {
        const metadata = seo.createPageMetadata({
          title: 'Post',
          description: 'A post.',
          path: '/blog/p',
          publishedTime: '',
        });

        expect(metadata.openGraph.type).toBe('website');
        expect(metadata.openGraph).not.toHaveProperty('publishedTime');
      });

      test('a page without a title takes the site name for sharing and leaves the page title to the layout', () => {
        const metadata = seo.createPageMetadata({ description: 'Home.', path: '/' });

        expect(metadata).not.toHaveProperty('title');
        expect(metadata.openGraph.title).toBe(siteConfig.name);
        expect(metadata.openGraph.url).toBe('/');
        expect(metadata.twitter.title).toBe(siteConfig.name);
      });

      test('the root layout takes its Open Graph and Twitter defaults from the shared helper', async () => {
        const layout = await readPage('layout.tsx');

        expect(layout).toContain('metadataBase: new URL(siteConfig.url)');
        expect(layout).toContain('openGraph: siteOpenGraph,');
        expect(layout).toContain('twitter: siteTwitter,');
        expect(layout).not.toContain('openGraph: {');
        expect(seo.siteOpenGraph.url).toBe(siteConfig.url);
        expect(seo.siteOpenGraph.title).toBe(siteConfig.name);
      });

      for (const [file, path] of [
        ['page.tsx', "path: '/'"],
        ['about/page.tsx', "path: '/about'"],
        ['blog/page.tsx', "path: '/blog'"],
        ['contact/page.tsx', "path: '/contact'"],
        ['for/[persona]/page.tsx', 'path: `/for/${slug}`'],
        ['blog/[slug]/page.tsx', 'path: `/blog/${slug}`'],
      ] as const) {
        test(`${file} builds its metadata with the shared helper for its own url`, async () => {
          const page = await readPage(file);

          expect(page).toContain("from '@/lib/seo'");
          expect(page).toContain('createPageMetadata({');
          expect(page).toContain(path);
          expect(page).not.toContain('openGraph');
          expect(page).not.toContain('twitter');
        });
      }

      test('a blog post is dated by its publication date and shares its own image', async () => {
        const page = await readPage('blog/[slug]/page.tsx');

        expect(page).toContain('image: post.metadata.imageUrl');
        expect(page).toContain('publishedTime: post.metadata.publishedAt');
      });

      test('a persona page shares its own title and description', async () => {
        const page = await readPage('for/[persona]/page.tsx');

        expect(page).toContain('title: persona.title');
        expect(page).toContain('description: persona.description');
      });
    });
  }
});
