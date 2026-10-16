import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';

describe('META.libraries validation', () => {
  test('all libraries have label', () => {
    for (const [name, lib] of Object.entries(META.libraries)) {
      expect(lib.label, `${name} should have label`).toBeDefined();
    }
  });

  test('all libraries have a category', () => {
    for (const [name, lib] of Object.entries(META.libraries)) {
      expect(lib.category, `${name} should have a category`).toBeDefined();
      expect(typeof lib.category, `${name} category should be a string`).toBe('string');
    }
  });

  test('libraries with pkg mono have name', () => {
    for (const [name, lib] of Object.entries(META.libraries)) {
      if (lib.mono?.scope === 'pkg') {
        expect(lib.mono.name, `${name} pkg mono needs name`).toBeDefined();
      }
    }
  });

  test('shadcn is a library', () => {
    expect(META.libraries.shadcn).toBeDefined();
    expect(META.libraries.shadcn!.label).toBe('shadcn/ui');
  });
});

describe('META.project validation', () => {
  test('database category exists with options', () => {
    expect(META.project.database).toBeDefined();
    expect(META.project.database.selection).toBe('single');
    expect(META.project.database.options.postgres).toBeDefined();
    expect(META.project.database.options.mysql).toBeDefined();
  });

  test('orm category requires database', () => {
    expect(META.project.orm).toBeDefined();
    expect(META.project.orm.require).toContain('database');
    expect(META.project.orm.options.drizzle).toBeDefined();
    expect(META.project.orm.options.prisma).toBeDefined();
  });

  test('linter category is single-select with all options', () => {
    expect(META.project.linter).toBeDefined();
    expect(META.project.linter.selection).toBe('single');
    expect(META.project.linter.options.biome).toBeDefined();
    expect(META.project.linter.options['eslint-prettier']).toBeDefined();
    expect(META.project.linter.options.eslint).toBeDefined();
    expect(META.project.linter.options.prettier).toBeDefined();
    expect(META.project.linter.options.oxc).toBeDefined();
  });

  test('linter prompt reflects broader code quality scope', () => {
    expect(META.project.linter.prompt).toBe('Code quality tools?');
  });

  test('eslint has pkg-scoped mono with eslint-config name', () => {
    const eslint = META.project.linter.options.eslint!;
    expect(eslint.mono?.scope).toBe('pkg');
    if (eslint.mono?.scope === 'pkg') {
      expect(eslint.mono.name).toBe('eslint-config');
    }
  });

  test('eslint has all expected devDependencies', () => {
    const eslint = META.project.linter.options.eslint!;
    const devDeps = eslint.packageJson?.devDependencies;
    expect(devDeps?.eslint).toBeDefined();
    expect(devDeps?.['@eslint/js']).toBeDefined();
    expect(devDeps?.['typescript-eslint']).toBeDefined();
    expect(devDeps?.globals).toBeDefined();
    expect(devDeps?.['eslint-plugin-react']).toBeDefined();
    expect(devDeps?.['eslint-plugin-react-hooks']).toBeDefined();
    expect(devDeps?.['@next/eslint-plugin-next']).toBeDefined();
  });

  test('eslint has shared config exports', () => {
    const exports = META.project.linter.options.eslint!.packageJson?.exports;
    expect(exports?.['./base']).toBeDefined();
    expect(exports?.['./next']).toBeDefined();
    expect(exports?.['./react']).toBeDefined();
    expect(exports?.['./react-native']).toBeDefined();
    expect(exports?.['./server']).toBeDefined();
  });

  test('eslint has appPackageJson with lint script', () => {
    const eslint = META.project.linter.options.eslint!;
    expect(eslint.appPackageJson?.scripts?.lint).toBe('eslint .');
  });

  test('biome has root-scoped mono', () => {
    const biome = META.project.linter.options.biome!;
    expect(biome.mono?.scope).toBe('root');
  });

  test('oxc has root-scoped mono with oxlint and oxfmt', () => {
    const oxc = META.project.linter.options.oxc!;
    expect(oxc.mono?.scope).toBe('root');
    expect(oxc.packageJson?.devDependencies?.oxlint).toBeDefined();
    expect(oxc.packageJson?.devDependencies?.oxfmt).toBeDefined();
    expect(oxc.packageJson?.scripts?.lint).toBe('oxlint');
    expect(oxc.packageJson?.scripts?.format).toBe('oxfmt');
    expect(oxc.packageJson?.scripts?.check).toBe('oxlint --fix && oxfmt');
  });

  test('prettier has root-scoped mono with formatter deps', () => {
    const prettier = META.project.linter.options.prettier!;
    expect(prettier.mono?.scope).toBe('root');
    expect(prettier.packageJson?.devDependencies?.prettier).toBeDefined();
    expect(prettier.packageJson?.devDependencies?.['prettier-plugin-tailwindcss']).toBeDefined();
    expect(prettier.packageJson?.scripts?.format).toContain('prettier');
    expect(prettier.packageJson?.scripts?.['format:check']).toContain('prettier');
  });

  test('eslint-prettier composes eslint and prettier', () => {
    const eslintPrettier = META.project.linter.options['eslint-prettier']!;
    expect(eslintPrettier.compose).toEqual(['eslint', 'prettier']);
    expect(eslintPrettier.mono?.scope).toBe('pkg');
    if (eslintPrettier.mono?.scope === 'pkg') {
      expect(eslintPrettier.mono.name).toBe('eslint-config');
    }
    expect(eslintPrettier.packageJson?.devDependencies?.['eslint-config-prettier']).toBeDefined();
  });

  test('eslint-prettier compose references exist as linter options', () => {
    const eslintPrettier = META.project.linter.options['eslint-prettier']!;
    for (const ref of eslintPrettier.compose ?? []) {
      expect(META.project.linter.options[ref], `compose ref '${ref}' should exist`).toBeDefined();
    }
  });

  test('deployment category is single-select with sst option', () => {
    expect(META.project.deployment).toBeDefined();
    expect(META.project.deployment.selection).toBe('single');
    expect(META.project.deployment.options.sst).toBeDefined();
    expect(META.project.deployment.options.sst!.packageJson?.devDependencies?.sst).toBeDefined();
  });

  test('tooling category is multi-select', () => {
    expect(META.project.tooling).toBeDefined();
    expect(META.project.tooling.selection).toBe('multi');
    expect(META.project.tooling.options.husky).toBeDefined();
  });

  // deployment must come before database so that deployment-dependent database options
  // (e.g. d1 requires cloudflare) are reachable in the interactive prompt loop, which
  // iterates Object.keys(META.project) in declaration order.
  test('project category order is deployment, database, orm, linter, tooling', () => {
    const keys = Object.keys(META.project);
    expect(keys).toEqual(['deployment', 'database', 'orm', 'linter', 'tooling']);
  });
});

describe('META.stacks validation', () => {
  test('expected stacks exist', () => {
    expect(META.stacks.nextjs).toBeDefined();
    expect(META.stacks['tanstack-start']).toBeDefined();
    expect(META.stacks.expo).toBeDefined();
    expect(META.stacks.hono).toBeDefined();
    expect(META.stacks.node).toBeDefined();
  });

  test('node stack is a server type with TypeScript deps', () => {
    const node = META.stacks.node;
    expect(node.type).toBe('server');
    expect(node.label).toBe('Node');
    expect(node.hint).toBe('Plain TypeScript');
    expect(node.packageJson.devDependencies?.typescript).toBeDefined();
    expect(node.packageJson.devDependencies?.['@types/node']).toBeDefined();
    expect(node.packageJson.scripts?.dev).toContain('src/index.ts');
    expect(node.packageJson.scripts?.start).toContain('src/index.ts');
  });

  test('node stack has no runtime dependencies', () => {
    const deps = META.stacks.node.packageJson.dependencies;
    expect(deps).toBeDefined();
    expect(Object.keys(deps!)).toHaveLength(0);
  });
});

describe('META env vars', () => {
  test('postgres declares DATABASE_URL with pkg and app scope', () => {
    const postgres = META.project.database.options.postgres!;
    expect(postgres.envs).toBeDefined();
    expect(postgres.envs).toHaveLength(1);
    expect(postgres.envs![0]!.value).toContain('DATABASE_URL');
    expect(postgres.envs![0]!.value).toContain('postgresql://');
    expect(postgres.envs![0]!.monoScope).toContainEqual({ pkg: 'db' });
    expect(postgres.envs![0]!.monoScope).toContain('app');
  });

  test('mysql declares DATABASE_URL with pkg and app scope', () => {
    const mysql = META.project.database.options.mysql!;
    expect(mysql.envs).toBeDefined();
    expect(mysql.envs).toHaveLength(1);
    expect(mysql.envs![0]!.value).toContain('DATABASE_URL');
    expect(mysql.envs![0]!.value).toContain('mysql://');
    expect(mysql.envs![0]!.monoScope).toContainEqual({ pkg: 'db' });
    expect(mysql.envs![0]!.monoScope).toContain('app');
  });

  test('better-auth declares BETTER_AUTH_SECRET and BETTER_AUTH_URL', () => {
    const auth = META.libraries['better-auth']!;
    expect(auth.envs).toBeDefined();
    expect(auth.envs).toHaveLength(2);

    const secret = auth.envs!.find((e) => e.value.includes('BETTER_AUTH_SECRET'));
    expect(secret).toBeDefined();
    expect(secret!.monoScope).toContainEqual({ pkg: 'auth' });
    expect(secret!.monoScope).toContain('app');

    const url = auth.envs!.find((e) => e.value.includes('BETTER_AUTH_URL'));
    expect(url).toBeDefined();
    expect(url!.value).toContain('{{appUrl}}');
    expect(url!.monoScope).toContain('app');
  });

  test('addons without env vars have no envs field', () => {
    expect(META.libraries.shadcn!.envs).toBeUndefined();
    expect(META.libraries['tanstack-query']!.envs).toBeUndefined();
    expect(META.project.linter.options.biome!.envs).toBeUndefined();
  });
});

describe('META.project.tooling.portless', () => {
  test('portless is defined in tooling options', () => {
    expect(META.project.tooling.options['portless']).toBeDefined();
  });

  test('portless has devDependency declared', () => {
    const portless = META.project.tooling.options['portless']!;
    expect(portless.packageJson?.devDependencies?.['portless']).toBeDefined();
  });

  test('portless has root mono scope', () => {
    const portless = META.project.tooling.options['portless']!;
    expect(portless.mono).toEqual({ scope: 'root' });
  });
});

describe('META.blueprints names', () => {
  test('every blueprint name ends with the stack of its main app', () => {
    expect(Object.keys(META.blueprints).sort()).toEqual([
      'cloudflare-fullstack-nextjs',
      'cloudflare-static-site-nextjs',
      'dapp-privy-nextjs',
      'dapp-rainbowkit-nextjs',
      'lambda-sst-hono',
      'lambda-terraform-aws-hono',
      'multitenant-saas-nextjs',
      'org-dashboard-nextjs',
      'org-dashboard-tanstack-start',
      'showcase-nextjs',
    ]);
  });
});

describe('META.blueprints.org-dashboard-nextjs', () => {
  test('org-dashboard-nextjs blueprint is defined', () => {
    expect(META.blueprints['org-dashboard-nextjs']).toBeDefined();
  });

  test('org-dashboard-nextjs has valid context with 2 apps', () => {
    const bp = META.blueprints['org-dashboard-nextjs']!;
    expect(bp.context.apps).toHaveLength(2);
    expect(bp.context.apps[0]!.appName).toBe('web');
    expect(bp.context.apps[0]!.stackName).toBe('nextjs');
    expect(bp.context.apps[0]!.libraries).toContain('shadcn');
    expect(bp.context.apps[0]!.libraries).toContain('better-auth');
    expect(bp.context.apps[0]!.libraries).toContain('trpc');
    expect(bp.context.apps[0]!.libraries).toContain('tanstack-query');
    expect(bp.context.apps[0]!.libraries).toContain('tanstack-devtools');
    expect(bp.context.apps[0]!.libraries).toContain('tanstack-form');
    expect(bp.context.apps[0]!.libraries).toContain('next-themes');
    expect(bp.context.apps[1]!.appName).toBe('batch');
    expect(bp.context.apps[1]!.stackName).toBe('node');
    expect(bp.context.project.database).toBe('postgres');
    expect(bp.context.project.orm).toBe('drizzle');
  });

  test('org-dashboard-nextjs libraries exist and are compatible with their stack', () => {
    const bp = META.blueprints['org-dashboard-nextjs']!;
    for (const app of bp.context.apps) {
      for (const lib of app.libraries) {
        const library = META.libraries[lib]!;
        expect(library, `library ${lib} must exist in META`).toBeDefined();
        const stacks = library.support?.stacks;
        if (stacks && stacks !== 'all') {
          expect(stacks, `library ${lib} must support ${app.stackName}`).toContain(app.stackName);
        }
      }
    }
  });
});

describe('META.blueprints.org-dashboard-tanstack-start', () => {
  const nextjs = META.blueprints['org-dashboard-nextjs']!;
  const tanstackStart = META.blueprints['org-dashboard-tanstack-start']!;

  test('extends the Next.js blueprint and runs the same libraries and project on TanStack Start', () => {
    expect(tanstackStart.extends).toBe('org-dashboard-nextjs');
    expect(tanstackStart.context.apps.map(({ appName, stackName }) => [appName, stackName])).toEqual([
      ['web', 'tanstack-start'],
      ['batch', 'node'],
    ]);
    expect(tanstackStart.context.apps[0]!.libraries).toEqual(nextjs.context.apps[0]!.libraries);
    expect(tanstackStart.context.project).toEqual(nextjs.context.project);
  });

  test('declares its own package.json, envs and first-run data, since META is not inherited', () => {
    expect(Object.keys(tanstackStart.packageJson?.dependencies ?? {})).toEqual(expect.arrayContaining(['sonner', 'zod']));
    expect(Object.keys(tanstackStart.pkgPackageJson ?? {}).sort()).toEqual(['auth', 'db', 'ui']);
    expect(tanstackStart.rootPackageJson?.scripts).toHaveProperty('local-setup');
    expect(tanstackStart.envs?.map(({ value }) => value)).toContain('SEED_PASSWORD=password');
    expect(tanstackStart.firstRun?.flatMap(({ commands }) => commands)).toEqual([{ script: 'local-setup' }]);
  });

  test('describes TanStack Start, not Next.js, in the agent architecture', () => {
    expect(tanstackStart.agentArchitecture).toContain('TanStack Start');
    expect(tanstackStart.agentArchitecture).not.toContain('Next.js');
  });
});

describe('META shared dependency versions', () => {
  function collectPins(value: unknown, name: string): string[] {
    if (typeof value !== 'object' || value === null) return [];
    return Object.entries(value).flatMap(([key, child]) =>
      key === name && typeof child === 'string' ? [child] : collectPins(child, name),
    );
  }

  test('every stack and addon types Node with the same @types/node version', () => {
    const pins = collectPins(META, '@types/node');
    expect(pins.length).toBeGreaterThan(1);
    expect(new Set(pins).size).toBe(1);
  });
});
