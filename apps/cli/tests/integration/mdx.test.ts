import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { META } from '@/__meta__';
import {
  cleanupTempDir,
  createTempDir,
  evaluateGeneratedModule,
  fileExists,
  readJsonFile,
  readTextFile,
  runCli,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface DocumentsModule {
  documentComponents: Record<string, { load: () => Promise<{ default: string }> }>;
  hasDocument: (slug: string) => boolean;
  loadDocument: (slug: string) => Promise<{ default: string }>;
}

interface PackageJsonShape {
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
}

describe('MDX Integration', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Single repo: TanStack Start + mdx', () => {
    const projectName = 'test-mdx-start';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', `${projectName}:tanstack-start:mdx`, '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('package.json has the Vite MDX compiler and the frontmatter plugins, not the Next.js ones', async () => {
      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['@mdx-js/rollup']).toBeDefined();
      expect(pkg.dependencies['remark-frontmatter']).toBeDefined();
      expect(pkg.dependencies['remark-mdx-frontmatter']).toBeDefined();
      expect(pkg.devDependencies?.['@types/mdx']).toBeDefined();
      expect(pkg.dependencies['@next/mdx']).toBeUndefined();
      expect(pkg.dependencies['@mdx-js/loader']).toBeUndefined();
      expect(pkg.dependencies['next-mdx-remote']).toBeUndefined();
    });

    test('vite.config.ts compiles MDX before the other plugins with YAML frontmatter and the project components', async () => {
      const content = await readTextFile(join(projectPath, 'vite.config.ts'));
      expect(content).toContain("import mdx from '@mdx-js/rollup'");
      expect(content).toContain("import remarkFrontmatter from 'remark-frontmatter'");
      expect(content).toContain("import remarkMdxFrontmatter from 'remark-mdx-frontmatter'");
      expect(content).toContain("enforce: 'pre'");
      expect(content).toContain("providerImportSource: '/src/mdx-components.tsx'");
      expect(content).toContain('remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter]');
      expect(content).toContain('viteReact({ include:');
      expect(content).not.toContain('prerender');
    });

    test('the example route is /mdx/{-$slug} and renders a lazy component created once per document at module level', async () => {
      const route = await readTextFile(join(projectPath, 'src/routes/mdx/{-$slug}.tsx'));
      expect(route).toContain("createFileRoute('/mdx/{-$slug}')");
      expect(route).toContain('notFound()');

      const lib = await readTextFile(join(projectPath, 'src/lib/mdx.ts'));
      expect(lib).toContain("import.meta.glob<MdxModule>('/contents/*.mdx')");
      expect(lib).toContain('lazy(load)');
      expect(lib).not.toContain('eager');
      expect(lib).not.toContain('node:fs');
      expect(route).toContain('<Suspense>');
      expect(route).toContain('const Document = documentComponents[slug];');
      expect(route).toContain('frontmatter');
    });

    test('lib/mdx.ts has one lazy component per document, keyed by slug, and hasDocument agrees', async () => {
      const slugs = (await readdir(join(projectPath, 'contents')))
        .filter((file) => file.endsWith('.mdx'))
        .map((file) => file.replace(/\.mdx$/, ''));
      expect(slugs.length).toBeGreaterThan(0);

      const loaders = slugs
        .map((slug) => `'/contents/${slug}.mdx': () => Promise.resolve({ default: '${slug}' })`)
        .join(', ');
      const source = await readTextFile(join(projectPath, 'src/lib/mdx.ts'));
      const stubbed = source.replace(/import\.meta\.glob<[^>]*>\('[^']*'\)/, `{ ${loaders} }`);
      expect(stubbed).not.toBe(source);

      const stubs = join(tempDir, 'mdx-stubs');
      await mkdir(stubs, { recursive: true });
      await Bun.write(join(stubs, 'react.mjs'), 'export const lazy = (load) => ({ load });');
      const documents = await evaluateGeneratedModule<DocumentsModule>(stubbed, join(stubs, 'generated-mdx.mjs'), {
        react: join(stubs, 'react.mjs'),
      });

      expect(Object.keys(documents.documentComponents).sort()).toEqual([...slugs].sort());
      for (const slug of slugs) {
        expect((await documents.documentComponents[slug]?.load())?.default).toBe(slug);
        expect(documents.hasDocument(slug)).toBe(true);
        expect((await documents.loadDocument(slug)).default).toBe(slug);
      }
      expect(documents.hasDocument('nope')).toBe(false);
      expect(documents.hasDocument('constructor')).toBe(false);
    });

    test('mdx-components uses the TanStack Router link', async () => {
      const content = await readTextFile(join(projectPath, 'src/mdx-components.tsx'));
      expect(content).toContain("import { Link } from '@tanstack/react-router'");
      expect(content).toContain('<Link to={href}');
      expect(content).not.toContain('next/link');
      expect(content).toContain('export function useMDXComponents()');
    });

    test('does not generate the Next.js example route', async () => {
      expect(await fileExists(join(projectPath, 'src/app'))).toBe(false);
    });

    test('home page links to /mdx and styles import mdx.css', async () => {
      const index = await readTextFile(join(projectPath, 'src/routes/index.tsx'));
      expect(index).toContain('/mdx');
      const styles = await readTextFile(join(projectPath, 'src/styles.css'));
      expect(styles).toContain('@import "./styles/mdx.css"');
      expect(await fileExists(join(projectPath, 'src/styles/mdx.css'))).toBe(true);
    });

    test('contents link to a document that exists', async () => {
      const home = await readTextFile(join(projectPath, 'contents/home.mdx'));
      expect(home).toContain('(/mdx/cool)');
      expect(home).not.toContain('/hello/world');
      expect(await fileExists(join(projectPath, 'contents/cool.mdx'))).toBe(true);
    });
  });

  describe('Single repo: TanStack Start without mdx', () => {
    const projectName = 'test-start-no-mdx';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', `${projectName}:tanstack-start`, '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('vite.config.ts has no MDX wiring and plain viteReact()', async () => {
      const content = await readTextFile(join(projectPath, 'vite.config.ts'));
      expect(content).not.toContain('mdx');
      expect(content).toContain('viteReact()');
    });

    test('styles and home page do not mention MDX', async () => {
      expect(await readTextFile(join(projectPath, 'src/styles.css'))).not.toContain('mdx');
      expect(await readTextFile(join(projectPath, 'src/routes/index.tsx'))).not.toContain('/mdx');
    });
  });

  describe('Single repo: Next.js + mdx', () => {
    const projectName = 'test-mdx-nextjs';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', `${projectName}:nextjs:mdx`, '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('package.json keeps the Next.js MDX pipelines and has no Vite MDX compiler', async () => {
      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['@next/mdx']).toBeDefined();
      expect(pkg.dependencies['@mdx-js/loader']).toBeDefined();
      expect(pkg.dependencies['@mdx-js/react']).toBeDefined();
      expect(pkg.dependencies['next-mdx-remote']).toBeDefined();
      expect(pkg.devDependencies?.['@types/mdx']).toBeDefined();
      expect(pkg.dependencies['@mdx-js/rollup']).toBeUndefined();
      expect(pkg.dependencies['remark-frontmatter']).toBeUndefined();
    });

    test('serves the example under /mdx with an optional slug, like the Start route', async () => {
      expect(await fileExists(join(projectPath, 'src/app/mdx/[[...slug]]/page.tsx'))).toBe(true);
      expect(await readTextFile(join(projectPath, 'src/app/page.tsx'))).toContain("href='/mdx'");
    });

    test('has no dynamic segment at the app root that would capture unrelated paths', async () => {
      const rootEntries = await readdir(join(projectPath, 'src/app'));
      expect(rootEntries.filter((entry) => entry.startsWith('['))).toEqual([]);
    });

    test('prerenders every document at build time and 404s any other slug from the page', async () => {
      const route = await readTextFile(join(projectPath, 'src/app/mdx/[[...slug]]/page.tsx'));
      expect(route).toContain('export function generateStaticParams()');
      expect(route).toContain('notFound()');
    });

    test('keeps its components and frontmatter parser', async () => {
      const components = await readTextFile(join(projectPath, 'src/mdx-components.tsx'));
      expect(components).toContain("import Link from 'next/link'");
      expect(components).toContain('<Link href={href}');
      expect(components).not.toContain('@tanstack/react-router');
      expect(await readTextFile(join(projectPath, 'src/lib/mdx.ts'))).toContain('parseFrontmatter');
      expect(await fileExists(join(projectPath, 'src/routes'))).toBe(false);
    });

    test('contents no longer link to /hello/world', async () => {
      expect(await readTextFile(join(projectPath, 'contents/home.mdx'))).not.toContain('/hello/world');
    });
  });

  describe('Turborepo: Next.js + mdx', () => {
    const projectName = 'test-mdx-nextjs-turbo';
    let appPath: string;

    beforeAll(async () => {
      appPath = join(tempDir, projectName, 'apps/web');
      const result = await runCli(
        [projectName, '--app', 'web:nextjs:mdx', '--app', 'api:hono', '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('serves the example under /mdx with no dynamic segment at the app root', async () => {
      expect(await fileExists(join(appPath, 'src/app/mdx/[[...slug]]/page.tsx'))).toBe(true);
      const rootEntries = await readdir(join(appPath, 'src/app'));
      expect(rootEntries.filter((entry) => entry.startsWith('['))).toEqual([]);
      expect(await fileExists(join(appPath, 'contents/home.mdx'))).toBe(true);
      expect(await fileExists(join(appPath, 'contents/cool.mdx'))).toBe(true);
    });
  });

  describe('Blueprints with mdx', () => {
    const blueprintsWithMdx = Object.entries(META.blueprints)
      .filter(([, blueprint]) =>
        blueprint.context.apps.some((app) => (app.libraries as readonly string[]).includes('mdx')),
      )
      .map(([name]) => name);

    test('at least one blueprint composes mdx', () => {
      expect(blueprintsWithMdx.length).toBeGreaterThan(0);
    });

    for (const blueprint of blueprintsWithMdx) {
      test(`${blueprint} ships no example content without the example route`, async () => {
        const result = await runCli([`bp-${blueprint}`, '--blueprint', blueprint, '--no-git', '--no-install'], tempDir);
        expect(result.exitCode).toBe(0);
        const projectPath = join(tempDir, `bp-${blueprint}`);
        const appPath = (await fileExists(join(projectPath, 'apps/web'))) ? join(projectPath, 'apps/web') : projectPath;
        expect(await fileExists(join(appPath, 'src/app/mdx'))).toBe(false);
        expect(await fileExists(join(appPath, 'contents/home.mdx'))).toBe(false);
        expect(await fileExists(join(appPath, 'contents/cool.mdx'))).toBe(false);
        expect(await fileExists(join(appPath, 'contents/blog'))).toBe(true);
      });
    }
  });

  describe('Example content without a blueprint', () => {
    test('is written as plain documents, without template frontmatter', async () => {
      const projectName = 'test-mdx-content';
      const result = await runCli([projectName, '--app', `${projectName}:nextjs:mdx`, '--no-git', '--no-install'], tempDir);
      expect(result.exitCode).toBe(0);
      const cool = await readTextFile(join(tempDir, projectName, 'contents/cool.mdx'));
      expect(cool.startsWith('---\ntitle: Cool\n')).toBe(true);
      expect(cool).not.toContain('only:');
    });
  });
});
