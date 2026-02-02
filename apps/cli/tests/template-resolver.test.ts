// ABOUTME: Unit tests for template resolution logic
// ABOUTME: Tests path resolution based on META (asPackage, singlePath) and @dest:

import { describe, test, expect } from 'bun:test';
import { resolveDestination, resolveModuleDestination } from '../src/lib/template-resolver';
import type { TemplateContext } from '../src/types/ctx';

const turborepoCtx: TemplateContext = {
  projectName: 'test',
  projectPath: '/tmp/test',
  repo: 'turborepo',
  apps: [{ appName: 'web', stackName: 'nextjs', modules: ['shadcn'] }],
};

const singleCtx: TemplateContext = {
  projectName: 'test',
  projectPath: '/tmp/test',
  repo: 'single',
  apps: [{ appName: 'web', stackName: 'nextjs', modules: ['shadcn'] }],
};

describe('resolveDestination', () => {
  describe('stack templates', () => {
    test('turborepo: resolves to apps/{appName}/', () => {
      const result = resolveDestination('src/app/page.tsx', { type: 'stack', appName: 'web' }, turborepoCtx);
      expect(result).toBe('apps/web/src/app/page.tsx');
    });

    test('single: resolves to root', () => {
      const result = resolveDestination('src/app/page.tsx', { type: 'stack', appName: 'web' }, singleCtx);
      expect(result).toBe('src/app/page.tsx');
    });
  });

  describe('repo templates', () => {
    test('resolves to root', () => {
      const result = resolveDestination('turbo.json', { type: 'repo' }, turborepoCtx);
      expect(result).toBe('turbo.json');
    });
  });

  describe('database templates', () => {
    test('resolves to root', () => {
      const result = resolveDestination('docker-compose.yml', { type: 'database' }, turborepoCtx);
      expect(result).toBe('docker-compose.yml');
    });
  });

  describe('extras templates', () => {
    test('resolves to root', () => {
      const result = resolveDestination('biome.json', { type: 'extras' }, turborepoCtx);
      expect(result).toBe('biome.json');
    });
  });
});

describe('resolveModuleDestination', () => {
  describe('module with asPackage (shadcn)', () => {
    const moduleConfig = {
      asPackage: 'ui',
      singlePath: 'src/components/ui/',
    };

    test('turborepo: default resolves to packages/{asPackage}/', () => {
      const result = resolveModuleDestination('src/components/button.tsx', moduleConfig, null, 'web', turborepoCtx);
      expect(result).toBe('packages/ui/src/components/button.tsx');
    });

    test('turborepo: @dest:app overrides to apps/{appName}/', () => {
      const result = resolveModuleDestination('components.json', moduleConfig, 'app', 'web', turborepoCtx);
      expect(result).toBe('apps/web/components.json');
    });

    test('turborepo: @dest:pkg explicit (same as default)', () => {
      const result = resolveModuleDestination('src/components/button.tsx', moduleConfig, 'pkg', 'web', turborepoCtx);
      expect(result).toBe('packages/ui/src/components/button.tsx');
    });

    test('turborepo: @dest:root overrides to root', () => {
      const result = resolveModuleDestination('some-config.json', moduleConfig, 'root', 'web', turborepoCtx);
      expect(result).toBe('some-config.json');
    });

    test('single: default resolves to root (template paths contain structure)', () => {
      const result = resolveModuleDestination('src/components/button.tsx', moduleConfig, null, 'web', singleCtx);
      expect(result).toBe('src/components/button.tsx');
    });

    test('single: @dest:app resolves to root (no apps/ prefix)', () => {
      const result = resolveModuleDestination('components.json', moduleConfig, 'app', 'web', singleCtx);
      expect(result).toBe('components.json');
    });
  });

  describe('module without asPackage (tanstack-query)', () => {
    const moduleConfig = {};

    test('turborepo: resolves to apps/{appName}/', () => {
      const result = resolveModuleDestination('src/lib/query-client.ts', moduleConfig, null, 'web', turborepoCtx);
      expect(result).toBe('apps/web/src/lib/query-client.ts');
    });

    test('single: resolves to root', () => {
      const result = resolveModuleDestination('src/lib/query-client.ts', moduleConfig, null, 'web', singleCtx);
      expect(result).toBe('src/lib/query-client.ts');
    });
  });
});
