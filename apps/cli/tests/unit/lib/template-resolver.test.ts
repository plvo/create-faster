import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { getAllTemplatesForContext, resolveAddonNames, resolveDestination } from '@/lib/template-resolver';
import type { TemplateContext } from '@/types/ctx';

const turborepoCtx: TemplateContext = {
  projectName: 'test',
  repo: 'turborepo',
  apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['shadcn'] }],
  project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: [] },
  git: true,
};

const singleCtx: TemplateContext = {
  projectName: 'test',
  repo: 'single',
  apps: [{ appName: 'test', stackName: 'nextjs', libraries: ['shadcn'] }],
  project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: [] },
  git: true,
};

describe('resolveDestination', () => {
  describe('single repo', () => {
    test('uses file-based path by default', () => {
      const result = resolveDestination({
        relativePath: 'components/button.tsx',
        ctx: singleCtx,
      });
      expect(result).toBe('components/button.tsx');
    });

    test('uses frontmatter.path when provided', () => {
      const result = resolveDestination({
        relativePath: 'components/button.tsx',
        ctx: singleCtx,
        frontmatter: { path: 'src/components/ui/button.tsx' },
      });
      expect(result).toBe('src/components/ui/button.tsx');
    });

    test('ignores addon mono scope in single repo', () => {
      const result = resolveDestination({
        relativePath: 'schema.ts',
        ctx: singleCtx,
        addon: META.project.orm.options.drizzle,
        frontmatter: { path: 'src/lib/db/schema.ts' },
      });
      expect(result).toBe('src/lib/db/schema.ts');
    });
  });

  describe('turborepo: library (defaultScope app)', () => {
    test('pkg library goes to packages/', () => {
      const result = resolveDestination({
        relativePath: 'components/button.tsx',
        ctx: turborepoCtx,
        addon: META.libraries.shadcn,
        appName: 'web',
      });
      expect(result).toBe('packages/ui/components/button.tsx');
    });

    test('frontmatter mono.scope:app overrides META pkg scope', () => {
      const result = resolveDestination({
        relativePath: 'components.json',
        ctx: turborepoCtx,
        addon: META.libraries.shadcn,
        appName: 'web',
        frontmatter: { mono: { scope: 'app' } },
      });
      expect(result).toBe('apps/web/components.json');
    });

    test('library without mono defaults to app scope', () => {
      const result = resolveDestination({
        relativePath: 'providers/query-provider.tsx',
        ctx: turborepoCtx,
        addon: META.libraries['tanstack-query'],
        appName: 'web',
      });
      expect(result).toBe('apps/web/providers/query-provider.tsx');
    });
  });

  describe('turborepo: project addon (defaultScope root)', () => {
    test('database addon goes to root', () => {
      const result = resolveDestination({
        relativePath: 'docker-compose.yml',
        ctx: turborepoCtx,
        addon: META.project.database.options.postgres,
        defaultScope: 'root',
      });
      expect(result).toBe('docker-compose.yml');
    });

    test('orm addon goes to packages/db', () => {
      const result = resolveDestination({
        relativePath: 'schema.ts',
        ctx: turborepoCtx,
        addon: META.project.orm.options.drizzle,
        defaultScope: 'root',
      });
      expect(result).toBe('packages/db/schema.ts');
    });

    test('linter addon goes to root', () => {
      const result = resolveDestination({
        relativePath: 'biome.json',
        ctx: turborepoCtx,
        addon: META.project.linter.options.biome,
        defaultScope: 'root',
      });
      expect(result).toBe('biome.json');
    });

    test('frontmatter mono.scope:root overrides pkg scope', () => {
      const result = resolveDestination({
        relativePath: 'drizzle.config.ts',
        ctx: turborepoCtx,
        addon: META.project.orm.options.drizzle,
        defaultScope: 'root',
        frontmatter: { mono: { scope: 'root' } },
      });
      expect(result).toBe('drizzle.config.ts');
    });

    test('eslint addon goes to packages/eslint-config', () => {
      const result = resolveDestination({
        relativePath: 'base.js',
        ctx: turborepoCtx,
        addon: META.project.linter.options.eslint,
        defaultScope: 'root',
      });
      expect(result).toBe('packages/eslint-config/base.js');
    });

    test('eslint addon uses frontmatter mono path', () => {
      const result = resolveDestination({
        relativePath: 'next.js',
        ctx: turborepoCtx,
        addon: META.project.linter.options.eslint,
        defaultScope: 'root',
        frontmatter: { mono: { scope: 'pkg', path: 'next.js' } },
      });
      expect(result).toBe('packages/eslint-config/next.js');
    });

    test('eslint addon uses file-based path in single repo', () => {
      const result = resolveDestination({
        relativePath: 'base.js',
        ctx: singleCtx,
        addon: META.project.linter.options.eslint,
        defaultScope: 'root',
      });
      expect(result).toBe('base.js');
    });

    test('app scope falls back to first app name', () => {
      const result = resolveDestination({
        relativePath: 'config.ts',
        ctx: turborepoCtx,
        defaultScope: 'root',
        frontmatter: { mono: { scope: 'app' } },
      });
      expect(result).toBe('apps/web/config.ts');
    });
  });

  describe('turborepo: stack (no addon)', () => {
    test('places files in apps/{appName}/', () => {
      const result = resolveDestination({
        relativePath: 'next.config.ts',
        ctx: turborepoCtx,
        appName: 'web',
      });
      expect(result).toBe('apps/web/next.config.ts');
    });

    test('single repo places files at root', () => {
      const result = resolveDestination({
        relativePath: 'next.config.ts',
        ctx: singleCtx,
      });
      expect(result).toBe('next.config.ts');
    });
  });

  describe('frontmatter mono.path override', () => {
    test('uses frontmatter mono.path over relativePath in turborepo', () => {
      const result = resolveDestination({
        relativePath: 'original.ts',
        ctx: turborepoCtx,
        appName: 'web',
        frontmatter: { mono: { scope: 'app', path: 'overridden.ts' } },
      });
      expect(result).toBe('apps/web/overridden.ts');
    });
  });
});

describe('resolveAddonNames', () => {
  test('returns addon name as-is when no compose', () => {
    expect(resolveAddonNames('linter', 'eslint')).toEqual(['eslint']);
  });

  test('returns addon name as-is for biome', () => {
    expect(resolveAddonNames('linter', 'biome')).toEqual(['biome']);
  });

  test('expands compose array for eslint-prettier', () => {
    expect(resolveAddonNames('linter', 'eslint-prettier')).toEqual(['eslint', 'prettier']);
  });

  test('returns addon name as-is for prettier', () => {
    expect(resolveAddonNames('linter', 'prettier')).toEqual(['prettier']);
  });
});

describe('deployment template resolution', () => {
  test('terraform deployment resolves infra/ templates in single repo', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'single',
      apps: [{ appName: 'test', stackName: 'nextjs', libraries: [] }],
      project: { deployment: 'terraform-aws', tooling: [] },
      git: false,
    };

    const templates = getAllTemplatesForContext(ctx);
    const infraTemplates = templates.filter((t) => t.destination.startsWith('infra/'));
    expect(infraTemplates.length).toBeGreaterThan(0);
  });

  test('terraform deployment resolves at repo root in turborepo', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'turborepo',
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
      project: { deployment: 'terraform-aws', tooling: [] },
      git: false,
    };

    const templates = getAllTemplatesForContext(ctx);
    const infraTemplates = templates.filter((t) => t.destination.startsWith('infra/'));
    expect(infraTemplates.length).toBeGreaterThan(0);
    for (const t of infraTemplates) {
      expect(t.destination).not.toMatch(/^apps\//);
      expect(t.destination).not.toMatch(/^packages\//);
    }
  });
});

describe('blueprint template resolution', () => {
  test('getAllTemplatesForContext works with blueprint set', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'turborepo',
      apps: [
        {
          appName: 'web',
          stackName: 'nextjs',
          libraries: [
            'shadcn',
            'better-auth',
            'trpc',
            'tanstack-query',
            'tanstack-devtools',
            'tanstack-form',
            'next-themes',
          ],
        },
        { appName: 'batch', stackName: 'node', libraries: [] },
      ],
      project: { database: 'postgres', orm: 'drizzle', tooling: [] },
      git: false,
      blueprint: 'org-dashboard',
    };

    const templates = getAllTemplatesForContext(ctx);
    expect(templates).toBeDefined();
    expect(Array.isArray(templates)).toBe(true);
  });

  test('blueprint templates have no duplicate destinations', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'turborepo',
      apps: [
        {
          appName: 'web',
          stackName: 'nextjs',
          libraries: [
            'shadcn',
            'better-auth',
            'trpc',
            'tanstack-query',
            'tanstack-devtools',
            'tanstack-form',
            'next-themes',
          ],
        },
        { appName: 'batch', stackName: 'node', libraries: [] },
      ],
      project: { database: 'postgres', orm: 'drizzle', tooling: [] },
      git: false,
      blueprint: 'org-dashboard',
    };

    const templates = getAllTemplatesForContext(ctx);
    const destinations = templates.map((t) => t.destination);
    const unique = new Set(destinations);
    expect(unique.size).toBe(destinations.length);
  });
});
