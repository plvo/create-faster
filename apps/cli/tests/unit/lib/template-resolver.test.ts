import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import type { TemplateFrontmatter } from '@/lib/frontmatter';
import { resolveLibraryDestination, resolveProjectAddonDestination } from '@/lib/template-resolver';
import type { TemplateContext } from '@/types/ctx';

describe('resolveLibraryDestination', () => {
  const turborepoCtx: TemplateContext = {
    projectName: 'test',
    repo: 'turborepo',
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['shadcn'] }],
    project: { database: 'postgres', orm: 'drizzle', tooling: ['biome'] },
    git: true,
  };

  const singleCtx: TemplateContext = {
    projectName: 'test',
    repo: 'single',
    apps: [{ appName: 'test', stackName: 'nextjs', libraries: ['shadcn'] }],
    project: { database: 'postgres', orm: 'drizzle', tooling: ['biome'] },
    git: true,
  };

  test('turborepo: pkg library goes to packages/', () => {
    const result = resolveLibraryDestination('components/button.tsx', META.libraries.shadcn, turborepoCtx, 'web', {});
    expect(result).toBe('packages/ui/components/button.tsx');
  });

  test('single: uses file-based path', () => {
    const result = resolveLibraryDestination('components/button.tsx', META.libraries.shadcn, singleCtx, 'test', {});
    expect(result).toBe('components/button.tsx');
  });

  test('single: uses frontmatter.path when provided', () => {
    const fm: TemplateFrontmatter = { path: 'src/components/ui/button.tsx' };
    const result = resolveLibraryDestination('components/button.tsx', META.libraries.shadcn, singleCtx, 'test', fm);
    expect(result).toBe('src/components/ui/button.tsx');
  });

  test('frontmatter mono.scope:app overrides META pkg scope', () => {
    const fm: TemplateFrontmatter = { mono: { scope: 'app' } };
    const result = resolveLibraryDestination('components.json', META.libraries.shadcn, turborepoCtx, 'web', fm);
    expect(result).toBe('apps/web/components.json');
  });

  test('library without mono defaults to app scope in turborepo', () => {
    const result = resolveLibraryDestination(
      'providers/query-provider.tsx',
      META.libraries['tanstack-query'],
      turborepoCtx,
      'web',
      {},
    );
    expect(result).toBe('apps/web/providers/query-provider.tsx');
  });
});

describe('resolveProjectAddonDestination', () => {
  const turborepoCtx: TemplateContext = {
    projectName: 'test',
    repo: 'turborepo',
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
    project: { database: 'postgres', orm: 'drizzle', tooling: [] },
    git: true,
  };

  const singleCtx: TemplateContext = {
    projectName: 'test',
    repo: 'single',
    apps: [{ appName: 'test', stackName: 'nextjs', libraries: [] }],
    project: { database: 'postgres', orm: 'drizzle', tooling: [] },
    git: true,
  };

  test('database addon goes to root', () => {
    const addon = META.project.database.options.postgres;
    const result = resolveProjectAddonDestination('docker-compose.yml', addon, turborepoCtx, {});
    expect(result).toBe('docker-compose.yml');
  });

  test('orm addon goes to packages/db in turborepo', () => {
    const addon = META.project.orm.options.drizzle;
    const result = resolveProjectAddonDestination('schema.ts', addon, turborepoCtx, {});
    expect(result).toBe('packages/db/schema.ts');
  });

  test('orm addon uses frontmatter path in single repo', () => {
    const addon = META.project.orm.options.drizzle;
    const result = resolveProjectAddonDestination('schema.ts', addon, singleCtx, { path: 'src/lib/db/schema.ts' });
    expect(result).toBe('src/lib/db/schema.ts');
  });

  test('tooling addon goes to root', () => {
    const addon = META.project.tooling.options.biome;
    const result = resolveProjectAddonDestination('biome.json', addon, turborepoCtx, {});
    expect(result).toBe('biome.json');
  });

  test('frontmatter mono.scope:root overrides pkg scope', () => {
    const addon = META.project.orm.options.drizzle;
    const fm: TemplateFrontmatter = { mono: { scope: 'root' } };
    const result = resolveProjectAddonDestination('drizzle.config.ts', addon, turborepoCtx, fm);
    expect(result).toBe('drizzle.config.ts');
  });
});
