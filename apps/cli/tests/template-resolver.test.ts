// ABOUTME: Tests for template path resolution with frontmatter
// ABOUTME: Tests destination resolution for all addon types and repo configurations

import { describe, expect, test } from 'bun:test';
import { META } from '../src/__meta__';
import type { TemplateFrontmatter } from '../src/lib/frontmatter';
import { resolveAddonDestination } from '../src/lib/template-resolver';
import type { TemplateContext } from '../src/types/ctx';

describe('resolveAddonDestination', () => {
  const turborepoCtx: TemplateContext = {
    projectName: 'test',
    repo: 'turborepo',
    apps: [{ appName: 'web', stackName: 'nextjs', addons: ['shadcn'] }],
    globalAddons: ['drizzle', 'postgres', 'biome'],
    git: true,
  };

  const singleCtx: TemplateContext = {
    projectName: 'test',
    repo: 'single',
    apps: [{ appName: 'test', stackName: 'nextjs', addons: ['shadcn'] }],
    globalAddons: ['drizzle', 'postgres', 'biome'],
    git: true,
  };

  describe('mono.scope = pkg (from META)', () => {
    const shadcnAddon = META.addons.shadcn;

    test('turborepo: goes to packages/{name}/', () => {
      const result = resolveAddonDestination('components/button.tsx', shadcnAddon, turborepoCtx, 'web', {});
      expect(result).toBe('packages/ui/components/button.tsx');
    });

    test('single: uses file-based path (no frontmatter path)', () => {
      const result = resolveAddonDestination('components/button.tsx', shadcnAddon, singleCtx, 'test', {});
      expect(result).toBe('components/button.tsx');
    });

    test('single: uses frontmatter.path when provided', () => {
      const fm: TemplateFrontmatter = { path: 'src/components/ui/button.tsx' };
      const result = resolveAddonDestination('components/button.tsx', shadcnAddon, singleCtx, 'test', fm);
      expect(result).toBe('src/components/ui/button.tsx');
    });

    test('frontmatter mono.scope:app overrides META pkg scope', () => {
      const fm: TemplateFrontmatter = { mono: { scope: 'app' } };
      const result = resolveAddonDestination('components.json', shadcnAddon, turborepoCtx, 'web', fm);
      expect(result).toBe('apps/web/components.json');
    });

    test('frontmatter mono.scope:root overrides META pkg scope', () => {
      const fm: TemplateFrontmatter = { mono: { scope: 'root' } };
      const result = resolveAddonDestination('drizzle.config.ts', META.addons.drizzle, turborepoCtx, 'web', fm);
      expect(result).toBe('drizzle.config.ts');
    });
  });

  describe('mono.scope = root (from META)', () => {
    const biomeAddon = META.addons.biome;

    test('turborepo: goes to root', () => {
      const result = resolveAddonDestination('biome.json', biomeAddon, turborepoCtx, 'web', {});
      expect(result).toBe('biome.json');
    });

    test('single: goes to root', () => {
      const result = resolveAddonDestination('biome.json', biomeAddon, singleCtx, 'test', {});
      expect(result).toBe('biome.json');
    });
  });

  describe('no mono (default = app)', () => {
    const tanstackQueryAddon = META.addons['tanstack-query'];

    test('turborepo: goes to apps/{appName}/', () => {
      const result = resolveAddonDestination(
        'providers/query-provider.tsx',
        tanstackQueryAddon,
        turborepoCtx,
        'web',
        {},
      );
      expect(result).toBe('apps/web/providers/query-provider.tsx');
    });

    test('single: goes to root (file-based)', () => {
      const result = resolveAddonDestination('providers/query-provider.tsx', tanstackQueryAddon, singleCtx, 'test', {});
      expect(result).toBe('providers/query-provider.tsx');
    });
  });

  describe('frontmatter mono.path override', () => {
    test('monorepo uses frontmatter.mono.path instead of file-based', () => {
      const fm: TemplateFrontmatter = { mono: { path: 'src/custom/schema.ts' } };
      const result = resolveAddonDestination('schema.ts', META.addons.drizzle, turborepoCtx, 'web', fm);
      expect(result).toBe('packages/db/src/custom/schema.ts');
    });
  });

  describe('frontmatter path for single repo', () => {
    test('drizzle files use frontmatter.path in single repo', () => {
      const fm: TemplateFrontmatter = { path: 'src/lib/db/schema.ts' };
      const result = resolveAddonDestination('schema.ts', META.addons.drizzle, singleCtx, 'test', fm);
      expect(result).toBe('src/lib/db/schema.ts');
    });
  });
});
