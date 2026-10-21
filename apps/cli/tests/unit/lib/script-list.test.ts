import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { PARTIALS_DIR } from '@/lib/constants';
import { getRootScripts } from '@/lib/package-json-generator';
import {
  collectScriptDescriptions,
  collectScriptList,
  describeScript,
  isLifecycleScript,
  listScriptSources,
} from '@/lib/script-list';
import { isWhenItem } from '@/lib/when';
import type { TemplateContext } from '@/types/ctx';
import type { ScriptDescription } from '@/types/meta';
import type { StackName } from '@/types/stack-name';

const STACKS = Object.keys(META.stacks) as StackName[];
const REPOS = ['single', 'turborepo'] as const;

function project(repo: TemplateContext['repo'], stack: StackName, rest: Partial<TemplateContext> = {}): TemplateContext {
  return {
    projectName: 'demo',
    repo,
    apps: [{ appName: 'web', stackName: stack, libraries: [] }],
    project: { tooling: [] },
    git: false,
    pm: 'npm',
    ...rest,
  };
}

function withApp(ctx: TemplateContext, stackName: StackName, libraries: string[] = []): TemplateContext {
  return { ...ctx, apps: [...ctx.apps, { appName: 'api', stackName, libraries }] };
}

/** One project per choice of META, in both repo types, plus the projects that combine choices. */
function combinations(): [string, TemplateContext][] {
  const found: [string, TemplateContext][] = [];

  for (const repo of REPOS) {
    for (const stack of STACKS) {
      found.push([`${repo} ${stack}`, project(repo, stack)]);
      found.push([`${repo} ${stack} and a Node app`, withApp(project(repo, stack), 'node')]);
    }

    for (const [name, library] of Object.entries(META.libraries)) {
      const stacks = library.support?.stacks;
      for (const stack of stacks === 'all' || !stacks ? STACKS : stacks) {
        const ctx = project(repo, stack);
        found.push([`${repo} ${stack} with ${name}`, { ...ctx, apps: [{ ...ctx.apps[0]!, libraries: [name] }] }]);
      }
    }

    for (const [category, { options }] of Object.entries(META.project)) {
      for (const option of Object.keys(options)) {
        for (const stack of ['nextjs', 'hono', 'tanstack-start', 'expo'] as const) {
          const selection =
            category === 'tooling' ? { tooling: [option] } : { tooling: [], [category]: option };
          const dependencies = category === 'orm' ? { database: 'postgres' } : {};
          found.push([
            `${repo} ${stack} with ${category} ${option}`,
            project(repo, stack, { project: { ...selection, ...dependencies } }),
          ]);
        }
      }
    }

    found.push([
      `${repo} D1 with Drizzle on Cloudflare`,
      project(repo, 'nextjs', { project: { database: 'd1', orm: 'drizzle', deployment: 'cloudflare', tooling: [] } }),
    ]);
    found.push([
      `${repo} Vitest on Next.js and Jest on Expo`,
      {
        ...project(repo, 'nextjs'),
        apps: [
          { appName: 'web', stackName: 'nextjs', libraries: ['vitest'] },
          { appName: 'mobile', stackName: 'expo', libraries: ['jest-expo'] },
        ],
      },
    ]);
    found.push([
      `${repo} Prisma, Biome and Husky`,
      project(repo, 'nextjs', {
        project: { database: 'postgres', orm: 'prisma', linter: 'biome', tooling: ['husky', 'portless'] },
      }),
    ]);

    for (const [name, blueprint] of Object.entries(META.blueprints)) {
      found.push([
        `${repo} blueprint ${name}`,
        {
          ...project(repo, 'nextjs'),
          apps: blueprint.context.apps,
          project: { tooling: [], ...blueprint.context.project },
          blueprint: name,
        },
      ]);
    }
  }

  return found;
}

describe('every root script of a project has a description in META', () => {
  test('in each combination of choices', () => {
    const undescribed = combinations().flatMap(([label, ctx]) =>
      Object.keys(getRootScripts(ctx))
        .filter((script) => !isLifecycleScript(script, getRootScripts(ctx)) && describeScript(ctx, script) === undefined)
        .map((script) => `${label}: ${script}`),
    );

    expect(undescribed).toEqual([]);
  });
});

describe('one source per script sentence', () => {
  const unwrap = (items: unknown[] = []): ScriptDescription[] =>
    items.map((item) => (isWhenItem(item) ? item.value : item)) as ScriptDescription[];

  const entries = listScriptSources;

  test('a script is described by scriptDescriptions or by productionScripts, never both', () => {
    const production = new Set(entries().flatMap(({ source }) => unwrap(source.productionScripts).map((d) => d.script)));
    const twice = entries().flatMap(({ label, source }) =>
      unwrap(source.scriptDescriptions)
        .filter(({ script }) => production.has(script))
        .map(({ script }) => `${label}: ${script}`),
    );

    expect(twice).toEqual([]);
  });

  test('every declaration of a script says the same thing in each combination of choices', () => {
    const disagreeing = combinations().flatMap(([label, ctx]) => {
      const sentences = new Map<string, Set<string>>();
      for (const { script, description } of collectScriptDescriptions(ctx)) {
        sentences.set(script, (sentences.get(script) ?? new Set()).add(description));
      }
      return [...sentences].filter(([, set]) => set.size > 1).map(([script, set]) => `${label}: ${script}: ${[...set]}`);
    });

    expect(disagreeing).toEqual([]);
  });
});

describe('isLifecycleScript', () => {
  test('the scripts the package manager runs itself are not commands', () => {
    const rootScripts = { dev: 'x', build: 'x', predev: 'x', prebuild: 'x', postinstall: 'x', prepare: 'x', preview: 'x' };

    expect(Object.keys(rootScripts).filter((script) => isLifecycleScript(script, rootScripts))).toEqual([
      'predev',
      'prebuild',
      'postinstall',
      'prepare',
    ]);
  });

  test('a hook of a script the project does not define is not hidden', () => {
    expect(isLifecycleScript('prebuild', { dev: 'x' })).toBe(false);
  });
});

describe('collectScriptList', () => {
  const lines = (ctx: TemplateContext) => collectScriptList(ctx).map(({ command }) => command);

  test('a Next.js app lists its development, analysis, type-check and production scripts', () => {
    expect(collectScriptList(project('single', 'nextjs'))).toEqual([
      { command: 'npm run dev', description: 'Start the development server' },
      { command: 'npm run analyze', description: 'Analyze the bundle size' },
      { command: 'npm run typecheck', description: 'Type-check the code' },
      { command: 'npm run build', description: 'Build for production' },
      { command: 'npm run start', description: 'Start the production server' },
    ]);
  });

  test('the sentence of a script changes with the repo type', () => {
    expect(describeScript(project('single', 'nextjs'), 'dev')).toBe('Start the development server');
    expect(describeScript(project('turborepo', 'nextjs'), 'dev')).toBe(
      'Start the dev server of every app that has a `dev` script',
    );
  });

  test('a script the root does not define is not listed: a turborepo root forwards only some app scripts', () => {
    expect(lines(project('turborepo', 'nextjs'))).not.toContain('npm run analyze');
    expect(lines(project('single', 'nextjs'))).toContain('npm run analyze');
  });

  test('a turborepo lists the scripts of its own root', () => {
    expect(lines(project('turborepo', 'nextjs'))).toEqual(
      expect.arrayContaining(['npm run clean', 'npm run versions:list', 'npm run versions:fix']),
    );
    expect(lines(project('single', 'nextjs'))).not.toContain('npm run clean');
  });

  test('the scripts of the choices follow the stacks, then the development and production steps', () => {
    const ctx = project('single', 'nextjs', {
      project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: [] },
    });

    expect(lines(ctx)).toEqual([
      'npm run dev',
      'npm run analyze',
      'npm run typecheck',
      'npm run build',
      'npm run start',
      'npm run db:generate',
      'npm run db:migrate',
      'npm run db:push',
      'npm run db:seed',
      'npm run db:studio',
      'npm run lint',
      'npm run format',
      'npm run check',
    ]);
  });

  test('a script that waits for a terminal in a turborepo is listed once per app, from its directory', () => {
    const ctx = withApp(project('turborepo', 'nextjs'), 'expo');

    expect(lines(ctx)).toContain('(cd apps/api && npm run dev:expo)');
  });

  test('a Prisma project describes db:generate as the client generation, a Drizzle one as a migration', () => {
    const prisma = project('single', 'nextjs', { project: { database: 'postgres', orm: 'prisma', tooling: [] } });
    const drizzle = project('single', 'nextjs', { project: { database: 'postgres', orm: 'drizzle', tooling: [] } });

    expect(describeScript(prisma, 'db:generate')).toBe('Generate the Prisma client');
    expect(describeScript(drizzle, 'db:generate')).toBe('Write a SQL migration from the schema');
  });

  test('a script that points to a README section carries it', () => {
    const ctx = project('single', 'nextjs', { project: { database: 'postgres', orm: 'drizzle', tooling: [] } });
    const seed = collectScriptList(ctx).find(({ command }) => command === 'npm run db:seed');

    expect(seed).toEqual({
      command: 'npm run db:seed',
      description: 'Seed the database; it can delete users',
      readmeSection: 'Seeding',
    });
  });

  test('the database scripts stay together: local-setup does not split them', () => {
    const ctx = project('single', 'nextjs', {
      project: { database: 'd1', orm: 'drizzle', deployment: 'cloudflare', tooling: [] },
    });
    const database = lines(ctx).filter((command) => /db:|local-setup/.test(command));

    expect(database.at(-1)).toBe('npm run local-setup');
    expect(database.slice(0, -1).every((command) => command.includes('db:'))).toBe(true);
  });

  test('a single repo gets the Prisma prebuild only on a stack that defines build', () => {
    const prisma = { database: 'postgres', orm: 'prisma', tooling: [] };

    expect(getRootScripts(project('single', 'nextjs', { project: prisma }))).toHaveProperty('prebuild');
    expect(getRootScripts(project('single', 'hono', { project: prisma }))).not.toHaveProperty('prebuild');
    expect(getRootScripts(project('single', 'hono', { project: prisma }))).toHaveProperty('predev');
  });

  test('the commands follow the package manager', () => {
    expect(lines({ ...project('single', 'nextjs'), pm: 'bun' })).toEqual([
      'bun run dev',
      'bun run analyze',
      'bun run typecheck',
      'bun run build',
      'bun run start',
    ]);
  });
});

describe('the Scripts list partial', () => {
  test('renders the collected list and names no script', async () => {
    const partial = await Bun.file(join(PARTIALS_DIR, 'scripts/root-list.hbs')).text();

    expect(partial).toContain('(scriptList)');
    expect(partial).not.toMatch(/hasRootScript|runScript|has "orm"/);
  });
});
