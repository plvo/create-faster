import { beforeAll, describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import { setupTemplateEngine } from '@/lib/handlebars';
import type { EnrichedTemplateContext, TemplateContext } from '@/types/ctx';

describe('Handlebars helpers', () => {
  beforeAll(() => {
    setupTemplateEngine();
  });

  describe('eq', () => {
    test('returns true for equal values', () => {
      const template = Handlebars.compile('{{#if (eq a b)}}yes{{else}}no{{/if}}');
      expect(template({ a: 'foo', b: 'foo' })).toBe('yes');
    });

    test('returns false for different values', () => {
      const template = Handlebars.compile('{{#if (eq a b)}}yes{{else}}no{{/if}}');
      expect(template({ a: 'foo', b: 'bar' })).toBe('no');
    });
  });

  describe('ne', () => {
    test('returns true for different values', () => {
      const template = Handlebars.compile('{{#if (ne a b)}}yes{{else}}no{{/if}}');
      expect(template({ a: 'foo', b: 'bar' })).toBe('yes');
    });

    test('returns false for equal values', () => {
      const template = Handlebars.compile('{{#if (ne a b)}}yes{{else}}no{{/if}}');
      expect(template({ a: 'foo', b: 'foo' })).toBe('no');
    });
  });

  describe('and', () => {
    test('returns true when all values are truthy', () => {
      const template = Handlebars.compile('{{#if (and a b c)}}yes{{else}}no{{/if}}');
      expect(template({ a: true, b: true, c: true })).toBe('yes');
    });

    test('returns false when any value is falsy', () => {
      const template = Handlebars.compile('{{#if (and a b c)}}yes{{else}}no{{/if}}');
      expect(template({ a: true, b: false, c: true })).toBe('no');
    });
  });

  describe('or', () => {
    test('returns true when any value is truthy', () => {
      const template = Handlebars.compile('{{#if (or a b c)}}yes{{else}}no{{/if}}');
      expect(template({ a: false, b: true, c: false })).toBe('yes');
    });

    test('returns false when all values are falsy', () => {
      const template = Handlebars.compile('{{#if (or a b c)}}yes{{else}}no{{/if}}');
      expect(template({ a: false, b: false, c: false })).toBe('no');
    });
  });

  describe('isTurborepo', () => {
    test('returns true for turborepo', () => {
      const template = Handlebars.compile('{{#if (isMono)}}yes{{else}}no{{/if}}');
      expect(template({ repo: 'turborepo' })).toBe('yes');
    });

    test('returns false for single', () => {
      const template = Handlebars.compile('{{#if (isMono)}}yes{{else}}no{{/if}}');
      expect(template({ repo: 'single' })).toBe('no');
    });
  });

  describe('hasLibrary', () => {
    test('returns true when library exists', () => {
      const template = Handlebars.compile('{{#if (hasLibrary "shadcn")}}yes{{else}}no{{/if}}');
      const ctx: Partial<EnrichedTemplateContext> = {
        libraries: ['shadcn', 'mdx'],
      };
      expect(template(ctx)).toBe('yes');
    });

    test('returns false when library does not exist', () => {
      const template = Handlebars.compile('{{#if (hasLibrary "shadcn")}}yes{{else}}no{{/if}}');
      const ctx: Partial<EnrichedTemplateContext> = {
        libraries: ['mdx'],
      };
      expect(template(ctx)).toBe('no');
    });

    test('falls back to checking all apps when libraries is not enriched', () => {
      const template = Handlebars.compile('{{#if (hasLibrary "trpc")}}yes{{else}}no{{/if}}');
      const ctx: Partial<EnrichedTemplateContext> = {
        apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['trpc', 'tanstack-query'] }],
      };
      expect(template(ctx)).toBe('yes');
    });

    test('falls back returns false when no app has the library', () => {
      const template = Handlebars.compile('{{#if (hasLibrary "trpc")}}yes{{else}}no{{/if}}');
      const ctx: Partial<EnrichedTemplateContext> = {
        apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['shadcn'] }],
      };
      expect(template(ctx)).toBe('no');
    });
  });

  describe('databaseBinding', () => {
    const template = Handlebars.compile('{{#if (databaseBinding "hyperdrive")}}yes{{else}}no{{/if}}');

    test('matches the binding META declares for the selected database', () => {
      expect(template({ project: { database: 'postgres', tooling: [] } })).toBe('yes');
      expect(template({ project: { database: 'mysql', tooling: [] } })).toBe('yes');
    });

    test('rejects a database with another binding, or no database', () => {
      expect(template({ project: { database: 'd1', tooling: [] } })).toBe('no');
      expect(template({ project: { tooling: [] } })).toBe('no');
    });
  });

  describe('has', () => {
    test('checks database value', () => {
      const template = Handlebars.compile('{{#if (has "database" "postgres")}}yes{{else}}no{{/if}}');
      expect(template({ project: { database: 'postgres', tooling: [] } })).toBe('yes');
      expect(template({ project: { database: 'mysql', tooling: [] } })).toBe('no');
    });

    test('checks orm value', () => {
      const template = Handlebars.compile('{{#if (has "orm" "drizzle")}}yes{{else}}no{{/if}}');
      expect(template({ project: { orm: 'drizzle', tooling: [] } })).toBe('yes');
      expect(template({ project: { orm: 'prisma', tooling: [] } })).toBe('no');
    });

    test('checks linter value', () => {
      const template = Handlebars.compile('{{#if (has "linter" "biome")}}yes{{else}}no{{/if}}');
      expect(template({ project: { linter: 'biome', tooling: [] } })).toBe('yes');
      expect(template({ project: { linter: 'eslint', tooling: [] } })).toBe('no');
    });

    test('checks tooling array', () => {
      const template = Handlebars.compile('{{#if (has "tooling" "husky")}}yes{{else}}no{{/if}}');
      expect(template({ project: { tooling: ['husky'] } })).toBe('yes');
      expect(template({ project: { tooling: [] } })).toBe('no');
    });

    test('checks stack existence in apps', () => {
      const template = Handlebars.compile('{{#if (has "stack" "nextjs")}}yes{{else}}no{{/if}}');
      expect(template({ apps: [{ stackName: 'nextjs' }, { stackName: 'hono' }] })).toBe('yes');
      expect(template({ apps: [{ stackName: 'hono' }] })).toBe('no');
    });

    test('returns false for unknown category', () => {
      const template = Handlebars.compile('{{#if (has "unknown" "value")}}yes{{else}}no{{/if}}');
      expect(template({ project: { tooling: [] } })).toBe('no');
    });
  });

  describe('direct project access', () => {
    test('can access project.database directly', () => {
      const template = Handlebars.compile('{{#if project.database}}{{project.database}}{{else}}none{{/if}}');
      const ctx: Partial<EnrichedTemplateContext> = {
        project: { database: 'postgres', tooling: [] },
      };
      expect(template(ctx)).toBe('postgres');
    });

    test('can check if project.orm exists', () => {
      const template = Handlebars.compile('{{#if project.orm}}has orm{{else}}no orm{{/if}}');
      const ctx: Partial<EnrichedTemplateContext> = {
        project: { tooling: [] },
      };
      expect(template(ctx)).toBe('no orm');
    });
  });

  describe('hasContext', () => {
    test('returns true when context has key with value', () => {
      const template = Handlebars.compile('{{#if (hasContext "project")}}yes{{else}}no{{/if}}');
      expect(template({ project: { tooling: [] } })).toBe('yes');
    });

    test('returns false when context key is undefined', () => {
      const template = Handlebars.compile('{{#if (hasContext "project")}}yes{{else}}no{{/if}}');
      expect(template({})).toBe('no');
    });
  });

  describe('hasRootScript', () => {
    const template = Handlebars.compile('{{#if (hasRootScript "lint")}}yes{{else}}no{{/if}}');
    const monorepo = (linter?: string): TemplateContext => ({
      projectName: 'demo',
      repo: 'turborepo',
      apps: [
        { appName: 'api', stackName: 'hono', libraries: [] },
        { appName: 'worker', stackName: 'node', libraries: [] },
      ],
      project: { linter, tooling: [] },
      git: false,
    });
    const singleApp = (linter?: string): TemplateContext => ({
      projectName: 'demo',
      repo: 'single',
      apps: [{ appName: 'demo', stackName: 'nextjs', libraries: [] }],
      project: { linter, tooling: [] },
      git: false,
    });

    test('is true in a turborepo whose linter defines a lint script', () => {
      for (const linter of ['biome', 'oxc', 'eslint', 'eslint-prettier']) {
        expect(template(monorepo(linter))).toBe('yes');
      }
    });

    test('is false in a turborepo without a linter or with a formatter only', () => {
      expect(template(monorepo())).toBe('no');
      expect(template(monorepo('prettier'))).toBe('no');
    });

    test('reads the single app package.json in a single repo', () => {
      expect(template(singleApp('biome'))).toBe('yes');
      expect(template(singleApp())).toBe('no');
    });

    test('finds scripts that do not come from the linter', () => {
      const build = Handlebars.compile('{{#if (hasRootScript "build")}}yes{{else}}no{{/if}}');
      expect(build(monorepo())).toBe('yes');
      expect(build(singleApp())).toBe('yes');
      const unknown = Handlebars.compile('{{#if (hasRootScript "nope")}}yes{{else}}no{{/if}}');
      expect(unknown(monorepo('biome'))).toBe('no');
    });
  });

  describe('hasPackage', () => {
    const template = Handlebars.compile('{{#each apps}}{{#if (hasPackage "db")}}yes{{else}}no{{/if}}{{/each}}');
    const monorepo = (orm?: string): TemplateContext => ({
      projectName: 'demo',
      repo: 'turborepo',
      apps: [{ appName: 'api', stackName: 'hono', libraries: [] }],
      project: { database: 'postgres', orm, tooling: [] },
      git: false,
    });

    test('is true when a selected addon creates the package, from inside a block', () => {
      expect(template(monorepo('drizzle'))).toBe('yes');
    });

    test('is false when no selected addon creates the package', () => {
      expect(template(monorepo())).toBe('no');
    });

    test('is false in a single repo, which has no packages', () => {
      expect(template({ ...monorepo('drizzle'), repo: 'single' })).toBe('no');
    });
  });

  describe('runScript and packageRunner', () => {
    const template = Handlebars.compile('{{runScript "db:push"}} | {{packageRunner}} shadcn@latest');
    const ctx = (pm?: TemplateContext['pm'], repo: TemplateContext['repo'] = 'single'): TemplateContext => ({
      projectName: 'demo',
      repo,
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
      project: { tooling: [] },
      git: false,
      pm,
    });

    test('writes the script as the selected package manager runs it', () => {
      expect(template(ctx('bun'))).toBe('bun run db:push | bunx shadcn@latest');
      expect(template(ctx('npm'))).toBe('npm run db:push | npx shadcn@latest');
      expect(template(ctx('pnpm'))).toBe('pnpm run db:push | pnpm dlx shadcn@latest');
    });

    test('falls back to npm when no package manager is selected', () => {
      expect(template(ctx(undefined))).toBe('npm run db:push | npx shadcn@latest');
    });

    test('resolves from inside a block', () => {
      const inBlock = Handlebars.compile('{{#each apps}}{{runScript "dev"}}{{/each}}');
      expect(inBlock(ctx('pnpm'))).toBe('pnpm run dev');
    });

    test('forwards arguments to the script the way each package manager needs', () => {
      const withArgs = Handlebars.compile('{{runScript "db:seed" "--fixtures"}}', { noEscape: true });
      expect(withArgs(ctx('bun'))).toBe('bun run db:seed --fixtures');
      expect(withArgs(ctx('pnpm'))).toBe('pnpm run db:seed --fixtures');
      expect(withArgs(ctx('npm'))).toBe('npm run db:seed -- --fixtures');
    });

    test('tsRunner is the command that runs a TypeScript file', () => {
      const runner = Handlebars.compile('{{tsRunner}} scripts/seed.ts');
      expect(runner(ctx('bun'))).toBe('bun scripts/seed.ts');
      expect(runner(ctx('npm'))).toBe('tsx scripts/seed.ts');
    });
  });

  describe('runAppScript and stackApps', () => {
    const template = Handlebars.compile('{{runAppScript "deploy"}}', { noEscape: true });
    const ctx = (repo: TemplateContext['repo'], pm?: TemplateContext['pm']): TemplateContext => ({
      projectName: 'demo',
      repo,
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: [] },
        { appName: 'docs', stackName: 'nextjs', libraries: [] },
        { appName: 'api', stackName: 'hono', libraries: [] },
      ],
      project: { tooling: [] },
      git: false,
      pm,
    });

    test('a single repo runs the script from the root', () => {
      expect(template(ctx('single', 'bun'))).toBe('bun run deploy');
    });

    test('a turborepo runs the script from the app directory, whatever the package manager', () => {
      expect(template(ctx('turborepo', 'bun'))).toBe('cd apps/<app> && bun run deploy');
      expect(template(ctx('turborepo', 'npm'))).toBe('cd apps/<app> && npm run deploy');
      expect(template(ctx('turborepo', 'pnpm'))).toBe('cd apps/<app> && pnpm run deploy');
    });

    test('stackApps lists the apps on a stack and nothing for an unused one', () => {
      const list = Handlebars.compile('{{#each (stackApps stack)}}{{appName}};{{/each}}');
      expect(list({ ...ctx('turborepo'), stack: 'nextjs' })).toBe('web;docs;');
      expect(list({ ...ctx('turborepo'), stack: 'expo' })).toBe('');
    });
  });

  describe('appUrl and monoPackages', () => {
    const monorepo = (tooling: string[] = []): TemplateContext => ({
      projectName: 'demo',
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: ['shadcn'] },
        { appName: 'api', stackName: 'hono', libraries: [] },
        { appName: 'worker', stackName: 'node', libraries: [] },
        { appName: 'mobile', stackName: 'expo', libraries: [] },
      ],
      project: { database: 'postgres', orm: 'drizzle', tooling },
      git: false,
    });
    const urls = Handlebars.compile('{{#each apps}}{{appName}}={{appUrl appName}};{{/each}}');

    test('gives the dev URL of every app that listens on a port, none for the others', () => {
      expect(urls(monorepo())).toBe('web=http://localhost:3000;api=http://localhost:3001;worker=;mobile=;');
    });

    test('follows the URL a selected tooling addon provides', () => {
      expect(urls(monorepo(['portless']))).toBe(
        'web=https://web.localhost:1355;api=https://api.localhost:1355;worker=;mobile=;',
      );
    });

    test('lists the packages a turborepo generates', () => {
      const packages = Handlebars.compile('{{#each (monoPackages)}}{{this}},{{/each}}');
      expect(packages(monorepo())).toBe('ui,db,');
      expect(packages({ ...monorepo(), repo: 'single' })).toBe('');
    });
  });

  describe('raw', () => {
    test('preserves inner {{ }} sequences literally', () => {
      const template = Handlebars.compile('{{{{raw}}}}{{variable}}{{{{/raw}}}}');
      expect(template({})).toBe('{{variable}}');
    });

    test('preserves ${{ }} sequences for GitHub Actions workflows', () => {
      const template = Handlebars.compile('{{{{raw}}}}${{ secrets.TOKEN }}{{{{/raw}}}}');
      expect(template({})).toBe('${{ secrets.TOKEN }}');
    });
  });

  describe('appPort', () => {
    test('returns 3000 for first app', () => {
      const template = Handlebars.compile('{{appPort "web"}}');
      expect(template({ apps: [{ appName: 'web' }, { appName: 'api' }] })).toBe('3000');
    });

    test('returns 3001 for second app', () => {
      const template = Handlebars.compile('{{appPort "api"}}');
      expect(template({ apps: [{ appName: 'web' }, { appName: 'api' }] })).toBe('3001');
    });

    test('returns 3000 for unknown app', () => {
      const template = Handlebars.compile('{{appPort "unknown"}}');
      expect(template({ apps: [{ appName: 'web' }] })).toBe('3000');
    });
  });
});
