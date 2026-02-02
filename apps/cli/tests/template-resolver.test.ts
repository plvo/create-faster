// ABOUTME: Tests for unified template resolution
// ABOUTME: Tests destination resolution for all addon types

import { describe, test, expect } from 'bun:test';
import { resolveAddonDestination } from '../src/lib/template-resolver';
import { META } from '../src/__meta__';
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

  describe('destination.target = package', () => {
    const shadcnAddon = META.addons.shadcn;

    test('turborepo: goes to packages/{name}/', () => {
      const result = resolveAddonDestination('components/button.tsx', shadcnAddon, turborepoCtx, 'web', null);
      expect(result).toBe('packages/ui/components/button.tsx');
    });

    test('single: goes to singlePath', () => {
      const result = resolveAddonDestination('components/button.tsx', shadcnAddon, singleCtx, 'test', null);
      expect(result).toBe('src/components/ui/components/button.tsx');
    });

    test('@dest:app override goes to app', () => {
      const result = resolveAddonDestination('components.json', shadcnAddon, turborepoCtx, 'web', 'app');
      expect(result).toBe('apps/web/components.json');
    });

    test('@dest:root override goes to root', () => {
      const result = resolveAddonDestination('drizzle.config.ts', META.addons.drizzle, turborepoCtx, 'web', 'root');
      expect(result).toBe('drizzle.config.ts');
    });
  });

  describe('destination.target = root', () => {
    const biomeAddon = META.addons.biome;

    test('turborepo: goes to root', () => {
      const result = resolveAddonDestination('biome.json', biomeAddon, turborepoCtx, 'web', null);
      expect(result).toBe('biome.json');
    });

    test('single: goes to root', () => {
      const result = resolveAddonDestination('biome.json', biomeAddon, singleCtx, 'test', null);
      expect(result).toBe('biome.json');
    });
  });

  describe('destination.target = app (default)', () => {
    const tanstackQueryAddon = META.addons['tanstack-query'];

    test('turborepo: goes to apps/{appName}/', () => {
      const result = resolveAddonDestination(
        'providers/query-provider.tsx',
        tanstackQueryAddon,
        turborepoCtx,
        'web',
        null,
      );
      expect(result).toBe('apps/web/providers/query-provider.tsx');
    });

    test('single: goes to root', () => {
      const result = resolveAddonDestination(
        'providers/query-provider.tsx',
        tanstackQueryAddon,
        singleCtx,
        'test',
        null,
      );
      expect(result).toBe('providers/query-provider.tsx');
    });
  });
});
