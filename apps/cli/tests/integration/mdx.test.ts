import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

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

    test('the example route is /mdx/{-$slug} and loads each document lazily', async () => {
      const route = await readTextFile(join(projectPath, 'src/routes/mdx/{-$slug}.tsx'));
      expect(route).toContain("createFileRoute('/mdx/{-$slug}')");
      expect(route).toContain('notFound()');

      const lib = await readTextFile(join(projectPath, 'src/lib/mdx.ts'));
      expect(lib).toContain("import.meta.glob<MdxModule>('/contents/*.mdx')");
      expect(lib).toContain('lazy(() => loadDocument(slug))');
      expect(lib).not.toContain('eager');
      expect(lib).not.toContain('node:fs');
      expect(route).toContain('<Suspense>');
      expect(route).toContain('frontmatter');
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

    test('keeps its example route, components and frontmatter parser', async () => {
      expect(await fileExists(join(projectPath, 'src/app/[...mdxExampleSlug]/page.tsx'))).toBe(true);
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
});
