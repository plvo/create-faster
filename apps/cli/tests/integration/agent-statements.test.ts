import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  cleanupTempDir,
  createTempDir,
  fileExists,
  printedScriptsMissingFrom,
  readJsonFile,
  readTextFile,
  runCli,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const NEXTJS_LIBRARIES = 'shadcn,trpc,better-auth';
const GENERIC_ORM = ['--database', 'postgres', '--orm', 'drizzle'];

const PROJECTS = {
  single: ['--app', `single:nextjs:${NEXTJS_LIBRARIES}`, ...GENERIC_ORM],
  mono: ['--app', `web:nextjs:${NEXTJS_LIBRARIES}`, '--app', 'api:hono', ...GENERIC_ORM],
  'start-single': ['--app', 'start-single:tanstack-start:trpc,better-auth', ...GENERIC_ORM],
  'start-mono': ['--app', 'web:tanstack-start:trpc,better-auth', '--app', 'api:hono', ...GENERIC_ORM],
  'hono-single': ['--app', 'hono-single:hono', ...GENERIC_ORM],
  'node-only': ['--app', 'node-only:node', ...GENERIC_ORM],
  'prisma-single': ['--app', 'prisma-single:nextjs', '--database', 'postgres', '--orm', 'prisma'],
  'd1-single': ['--app', 'd1-single:nextjs', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare'],
  'd1-mono': [
    '--app',
    'web:nextjs',
    '--app',
    'api:hono',
    '--database',
    'd1',
    '--orm',
    'drizzle',
    '--deployment',
    'cloudflare',
  ],
  expo: ['--app', 'mobile:expo', '--app', 'web:nextjs'],
  'single-tests-biome': ['--app', 'single-tests-biome:nextjs:vitest,playwright', '--linter', 'biome'],
  'single-eslint-prettier': ['--app', 'single-eslint-prettier:nextjs', '--linter', 'eslint-prettier'],
  'mono-tests-oxc': ['--app', 'web:nextjs:vitest,playwright', '--app', 'api:hono:vitest-node', '--linter', 'oxc'],
  'mono-prettier': ['--app', 'web:nextjs', '--app', 'api:hono', '--linter', 'prettier'],
  'cloudflare-fullstack-nextjs': ['--blueprint', 'cloudflare-fullstack-nextjs'],
  'org-dashboard-nextjs': ['--blueprint', 'org-dashboard-nextjs'],
  'org-dashboard-tanstack-start': ['--blueprint', 'org-dashboard-tanstack-start'],
  'multitenant-saas-nextjs': ['--blueprint', 'multitenant-saas-nextjs'],
  'dapp-privy-nextjs': ['--blueprint', 'dapp-privy-nextjs'],
  'dapp-privy-eslint-prettier': ['--blueprint', 'dapp-privy-nextjs', '--linter', 'eslint-prettier'],
  'dapp-rainbowkit-nextjs': ['--blueprint', 'dapp-rainbowkit-nextjs'],
} as const;

type ProjectName = keyof typeof PROJECTS;

let dir: string;

beforeAll(async () => {
  dir = await createTempDir();
  for (const [name, args] of Object.entries(PROJECTS)) {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], dir);
    expect(result.exitCode, `${name}: ${result.stderr}`).toBe(0);
  }
});

afterAll(async () => {
  await cleanupTempDir(dir);
});

const projectPath = (name: string) => join(dir, name);

async function appDirectories(name: string): Promise<string[]> {
  const apps = join(projectPath(name), 'apps');
  if (!(await fileExists(apps))) return [projectPath(name)];
  return (await readdir(apps)).map((app) => join(apps, app));
}

/** The first line of a document that starts with the prefix. */
function lineStartingWith(document: string, prefix: string): string | undefined {
  return document.split('\n').find((line) => line.startsWith(prefix));
}

/** The paths a line writes in backticks. */
function pathsIn(line: string): string[] {
  return [...line.matchAll(/`([\w@./-]+\.\w+|[\w@./-]+\/)`/g)].map(([, path]) => path as string);
}

/** A documented path exists from the app that documents it, or from the project root. */
function resolveDocumented(project: string, appDirectory: string, documented: string): string | undefined {
  return [join(appDirectory, documented), join(project, documented)].find(existsSync);
}

/** The repo paths a document writes in backticks, a directory with its trailing slash. */
function documentedPaths(text: string): { path: string; isAfterNo: boolean }[] {
  return [...text.matchAll(/`((?:src|packages|apps|docs|scripts)\/[\w@./()-]*[\w)/])`/g)].map((match) => ({
    path: match[1] as string,
    isAfterNo: /\bnot? $/.test(text.slice(Math.max(0, (match.index ?? 0) - 4), match.index)),
  }));
}

describe('every path an agent document writes exists in the generated project', () => {
  const NOT_GENERATED: { pattern: RegExp; reason: string; only?: RegExp }[] = [
    { pattern: /(?:^|\/)\.[\w.]*env[\w.]*$/, reason: 'env files the user copies from .env.example' },
    { pattern: /^packages\/db\/drizzle\/?$/, reason: 'written by db:generate' },
    { pattern: /^src\/start\.ts$/, reason: 'a TanStack Start file the fiche says a library adds', only: /start/ },
  ];

  async function agentDocuments(name: string): Promise<string[]> {
    const project = projectPath(name);
    const apps = (await fileExists(join(project, 'apps'))) ? await readdir(join(project, 'apps')) : [];
    const guides = (await fileExists(join(project, 'docs/agents'))) ? await readdir(join(project, 'docs/agents')) : [];
    const documents = [
      'AGENTS.md',
      ...apps.map((app) => `apps/${app}/AGENTS.md`),
      ...guides.map((guide) => `docs/agents/${guide}`),
    ];
    return documents.filter((document) => existsSync(join(project, document)));
  }

  /**
   * An app document resolves against its own app and the root. A root document resolves against the root, and its
   * `src/` paths, which the sections of the stacks write relative to the app they describe, against any app too.
   */
  const startsFrom = (project: string, document: string, path: string, apps: string[]): string[] => {
    if (document.startsWith('apps/')) return [join(project, dirname(document)), project];
    return path.startsWith('src/') ? [project, ...apps.map((app) => join(project, 'apps', app))] : [project];
  };

  const SCRIPT_LIST_ONLY: ProjectName[] = [
    'dapp-privy-eslint-prettier',
    'single-tests-biome',
    'single-eslint-prettier',
    'mono-tests-oxc',
    'mono-prettier',
  ];
  const SWEPT = (Object.keys(PROJECTS) as ProjectName[]).filter((name) => !SCRIPT_LIST_ONLY.includes(name));

  test('the sweep reads directory paths with their trailing slash', () => {
    expect(documentedPaths('in `packages/ui/src/components/ui/`, `src/trpc/` but no `src/server.ts`, not `src/proxy.ts`')).toEqual([
      { path: 'packages/ui/src/components/ui/', isAfterNo: false },
      { path: 'src/trpc/', isAfterNo: false },
      { path: 'src/server.ts', isAfterNo: true },
      { path: 'src/proxy.ts', isAfterNo: true },
    ]);
  });

  test('the sweep reaches the directories the fiches document', async () => {
    const mono = await readTextFile(join(projectPath('mono'), 'apps/web/AGENTS.md'));
    const paths = documentedPaths(mono).map(({ path }) => path);

    expect(paths).toContain('packages/ui/src/components/ui/');
    expect(paths).toContain('packages/api/src/router/');
  });

  test.each(SWEPT)('%s', async (name) => {
    const project = projectPath(name);
    const missing: string[] = [];
    const apps = (await fileExists(join(project, 'apps'))) ? await readdir(join(project, 'apps')) : [];
    let checked = 0;

    for (const document of await agentDocuments(name)) {
      const text = await readTextFile(join(project, document));

      for (const { path, isAfterNo } of documentedPaths(text)) {
        checked++;
        const exists = startsFrom(project, document, path, apps).some((start) => existsSync(join(start, path)));
        const isGeneratedLater = NOT_GENERATED.some(({ pattern, only }) => pattern.test(path) && (!only || only.test(name)));
        if (!exists && !isAfterNo && !isGeneratedLater) missing.push(`${document}: ${path}`);
      }
    }

    expect(checked).toBeGreaterThan(0);
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe('tRPC fiche names the directory of the routers', () => {
  const CASES: ProjectName[] = [
    'single',
    'mono',
    'start-single',
    'start-mono',
    'cloudflare-fullstack-nextjs',
    'org-dashboard-nextjs',
    'org-dashboard-tanstack-start',
    'multitenant-saas-nextjs',
    'dapp-privy-nextjs',
    'dapp-rainbowkit-nextjs',
  ];

  test.each(CASES)('%s: the first router of the project is in a directory the fiche names', async (name) => {
    const project = projectPath(name);
    const webApp = join(project, (await fileExists(join(project, 'apps'))) ? 'apps/web' : '.');
    const agents = await readTextFile(join(webApp, 'AGENTS.md'));

    const line = lineStartingWith(agents, 'tRPC router') as string;
    expect(line, 'a line "tRPC router..." in the app AGENTS.md').toBeDefined();
    const documented = pathsIn(line).map((path) => resolveDocumented(project, webApp, path));

    expect(documented.filter((path) => path !== undefined), `every path of "${line.slice(0, 120)}" exists`).toHaveLength(
      documented.length,
    );
    const routerFile = 'hello.ts';
    const routerDirectories = documented.filter((path) => existsSync(join(path as string, routerFile)));
    expect(routerDirectories, `a documented directory holds ${routerFile}`).not.toHaveLength(0);
  });
});

describe('Better Auth fiche says where a social provider is added', () => {
  const CASES: ProjectName[] = [
    'single',
    'mono',
    'start-mono',
    'cloudflare-fullstack-nextjs',
    'org-dashboard-nextjs',
    'multitenant-saas-nextjs',
    'dapp-rainbowkit-nextjs',
  ];

  test.each(CASES)('%s: the file it names calls betterAuth, and the option is not an existing key to edit', async (name) => {
    const project = projectPath(name);
    const webApp = join(project, (await fileExists(join(project, 'apps'))) ? 'apps/web' : '.');
    const agents = await readTextFile(join(webApp, 'AGENTS.md'));

    const line = lineStartingWith(agents, 'Add a social provider');
    expect(line, 'a line "Add a social provider ..." in the app AGENTS.md').toBeDefined();
    const [factory] = pathsIn(line as string);
    const file = resolveDocumented(project, webApp, factory as string);
    expect(file, `${factory} exists`).toBeDefined();

    const source = await readTextFile(file as string);
    expect(source).toContain('betterAuth(');
    if (!source.includes('socialProviders')) expect(line).not.toMatch(/\bedit/i);
  });
});

describe('Hono fiche names the file that registers the routes', () => {
  const CASES: ProjectName[] = ['hono-single', 'mono', 'start-mono', 'd1-mono', 'cloudflare-fullstack-nextjs'];

  test.each(CASES)('%s: every Hono app registers its routes in the file the fiche names', async (name) => {
    const project = projectPath(name);
    const honoApps: string[] = [];
    for (const app of await appDirectories(name)) {
      const agents = await readTextFile(join(app, 'AGENTS.md'));
      if (agents.includes('Hono server.')) honoApps.push(app);
    }
    expect(honoApps).not.toHaveLength(0);

    for (const app of honoApps) {
      const line = lineStartingWith(await readTextFile(join(app, 'AGENTS.md')), 'Hono server.');
      const [routesFile] = pathsIn(line as string);
      const file = resolveDocumented(project, app, routesFile as string);
      expect(file, `${routesFile} exists in ${app}`).toBeDefined();
      expect(await readTextFile(file as string), `${routesFile} creates the app`).toContain('new Hono');
    }
  });
});

describe('NODE_ENV list of the database fiche', () => {
  test.each(['node-only', 'start-single', 'hono-single', 'single'] as const)(
    '%s: the first item stands on its own',
    async (name) => {
      const agents = await readTextFile(join(projectPath(name), 'AGENTS.md'));
      const items = agents.match(/^- (?:Next\.js|TanStack Start|Hono|Node): .*$/gm) ?? [];

      expect(items).toHaveLength(1);
      expect(items[0]).not.toMatch(/the same way|\btoo\b/);
    },
  );
});

describe('cloudflare-fullstack-nextjs data-layer.md describes local-setup', () => {
  test('it names the scripts local-setup runs, in the order it runs them', async () => {
    const project = projectPath('cloudflare-fullstack-nextjs');
    const setup = await readTextFile(join(project, 'scripts/local-setup.ts'));
    const ran = [...setup.matchAll(/sh\('bun run ([\w:-]+)/g)].map(([, script]) => script as string);
    expect(ran).toContain('db:generate');

    const dataLayer = await readTextFile(join(project, 'docs/agents/data-layer.md'));
    const line = lineStartingWith(dataLayer, '- `bun run local-setup`') as string;
    expect(line).toBeDefined();

    const described = [...line.matchAll(/`([\w:-]+)`/g)].map(([, script]) => script as string);
    const inOrder = ran.filter((script) => described.includes(script));
    expect(described.filter((script) => ran.includes(script))).toEqual(inOrder);
    expect(described).toEqual(expect.arrayContaining(['db:generate', 'db:migrate', 'db:seed']));
    expect(line).toContain('deletes the local D1 state');
  });

  test('the seed section says the seed only touches the local database, and has no --force', async () => {
    const dataLayer = await readTextFile(join(projectPath('cloudflare-fullstack-nextjs'), 'docs/agents/data-layer.md'));
    const seeding = dataLayer.split('## Seeding')[1] ?? '';

    expect(seeding).toContain('only touches the local database');
    expect(seeding).not.toContain('--force');
  });
});

describe('seed scripts', () => {
  const GENERIC_SEEDS: [ProjectName, string][] = [
    ['single', 'scripts/seed.ts'],
    ['mono', 'packages/db/scripts/seed.ts'],
    ['d1-single', 'scripts/seed.ts'],
    ['d1-mono', 'packages/db/scripts/seed.ts'],
    ['prisma-single', 'scripts/seed.ts'],
    ['dapp-rainbowkit-nextjs', 'scripts/seed.ts'],
  ];

  test.each(GENERIC_SEEDS)('%s: the scripts the seed names exist at the project root', async (name, seed) => {
    const source = await readTextFile(join(projectPath(name), seed));
    expect(await printedScriptsMissingFrom(projectPath(name), source)).toEqual([]);
  });
});

describe('docs say the seed deletes the users', () => {
  const SEEDS: [ProjectName, string][] = [
    ['single', 'scripts/seed.ts'],
    ['mono', 'packages/db/scripts/seed.ts'],
    ['d1-single', 'scripts/seed.ts'],
    ['d1-mono', 'packages/db/scripts/seed.ts'],
    ['prisma-single', 'scripts/seed.ts'],
    ['start-single', 'scripts/seed.ts'],
    ['dapp-privy-nextjs', 'scripts/seed.ts'],
    ['dapp-rainbowkit-nextjs', 'scripts/seed.ts'],
    ['cloudflare-fullstack-nextjs', 'scripts/seed.ts'],
    ['org-dashboard-nextjs', 'scripts/seed.ts'],
    ['org-dashboard-tanstack-start', 'scripts/seed.ts'],
    ['multitenant-saas-nextjs', 'scripts/seed.ts'],
  ];
  const DELETES_USERS = /delete\(userTable\)|user\.deleteMany\(\)/;
  const SAYS_USERS_ARE_DELETED = /\bseed\b[^\n]*\b(?:deletes?|clears?|wipes?)\b[^\n]*\busers\b/i;

  async function documents(name: string): Promise<string> {
    const project = projectPath(name);
    const docs = join(project, 'docs/agents');
    const guides = (await fileExists(docs)) ? await readdir(docs) : [];
    const texts = await Promise.all([
      readTextFile(join(project, 'AGENTS.md')),
      ...guides.map((guide) => readTextFile(join(docs, guide))),
    ]);
    return texts
      .join('\n')
      .split('\n')
      .filter((line) => !line.startsWith('- `'))
      .join('\n');
  }

  test.each(SEEDS)('%s: the seed deletes users, and AGENTS.md or its guides say so', async (name, seed) => {
    const source = await readTextFile(join(projectPath(name), seed));
    expect(source).toMatch(DELETES_USERS);

    expect(await documents(name)).toMatch(SAYS_USERS_ARE_DELETED);
  });

  test.each(SEEDS)('%s: the README has a Seeding section that says so', async (name) => {
    const readme = await readTextFile(join(projectPath(name), 'README.md'));
    const seeding = readme.split('\n## Seeding')[1]?.split('\n## ')[0] ?? '';

    expect(seeding).toMatch(SAYS_USERS_ARE_DELETED);
  });

  test.each(['single', 'cloudflare-fullstack-nextjs'] as const)(
    '%s: without agent context the README still has the Seeding section',
    async (name) => {
      const args = [...PROJECTS[name], '--no-git', '--no-install', '--pm', 'bun', '--no-agent-context'];
      const projectName = `${name}-no-agent-context`;
      const result = await runCli([projectName, ...args], dir);
      expect(result.exitCode, result.stderr).toBe(0);

      const project = projectPath(projectName);
      expect(await fileExists(join(project, 'AGENTS.md'))).toBe(false);
      const readme = await readTextFile(join(project, 'README.md'));
      expect(readme.split('\n## Seeding')[1] ?? '').toMatch(SAYS_USERS_ARE_DELETED);
    },
  );

  test.each(['dapp-rainbowkit-nextjs', 'dapp-privy-nextjs', 'org-dashboard-nextjs', 'multitenant-saas-nextjs'] as const)(
    '%s: the guide of the blueprint renders the seed paragraph, and a script-list line does not stand in for it',
    async (name) => {
      const guide = await readTextFile(join(projectPath(name), 'docs/agents/data-layer.md'));
      const seed = guide.split('## Seed')[1] ?? '';

      expect(seed).toMatch(SAYS_USERS_ARE_DELETED);
    },
  );

  test.each(['single', 'mono', 'prisma-single', 'd1-mono', 'dapp-privy-nextjs'] as const)(
    '%s: the seed prints that it deletes the users before it does',
    async (name) => {
      const seed = (await fileExists(join(projectPath(name), 'packages/db/scripts/seed.ts')))
        ? 'packages/db/scripts/seed.ts'
        : 'scripts/seed.ts';
      expect(await readTextFile(join(projectPath(name), seed))).toMatch(/console\.log\([^)]*(?:Deleting|Clearing)[^)]*users/i);
    },
  );
});

describe('AGENTS.md lists the scripts the root package.json defines', () => {
  const NOT_COMMANDS = new Set(['predev', 'prebuild', 'postinstall', 'prepare']);
  const CASES: ProjectName[] = [
    'single',
    'mono',
    'start-single',
    'start-mono',
    'hono-single',
    'prisma-single',
    'd1-single',
    'd1-mono',
    'expo',
    'single-tests-biome',
    'single-eslint-prettier',
    'mono-tests-oxc',
    'mono-prettier',
    'cloudflare-fullstack-nextjs',
    'org-dashboard-nextjs',
    'multitenant-saas-nextjs',
    'dapp-privy-nextjs',
    'dapp-privy-eslint-prettier',
    'dapp-rainbowkit-nextjs',
  ];

  test.each(CASES)('%s: the Scripts section is the root scripts', async (name) => {
    const project = projectPath(name);
    const { scripts } = await readJsonFile<{ scripts: Record<string, string> }>(join(project, 'package.json'));
    const agents = await readTextFile(join(project, 'AGENTS.md'));

    const section = agents.split('\n## Scripts')[1]?.split('\n## ')[0] ?? '';
    const listed = [...section.matchAll(/^- `(?:bun|npm|pnpm) run ([\w:-]+)`/gm)].map(([, script]) => script);
    const defined = Object.keys(scripts).filter((script) => !NOT_COMMANDS.has(script));
    expect(listed.sort()).toEqual(defined.sort());
  });

  test('a root script that runs in every app is described so only when every app defines it', async () => {
    const project = projectPath('expo');
    const agents = await readTextFile(join(project, 'AGENTS.md'));
    const section = agents.split('\n## Scripts')[1]?.split('\n## ')[0] ?? '';

    const apps = await appDirectories('expo');
    const scriptsOfApps = await Promise.all(
      apps.map(async (app) => (await readJsonFile<{ scripts: Record<string, string> }>(join(app, 'package.json'))).scripts),
    );
    const described = [...section.matchAll(/^- `\w+ run ([\w:-]+)` - (.*)$/gm)];
    expect(described.length).toBeGreaterThan(0);
    for (const [, script, description] of described) {
      if (!/\b(?:every|all) apps?\b/i.test(description as string) || /\bthat (?:has|define)/.test(description as string)) continue;
      expect(scriptsOfApps.every((scripts) => (script as string) in scripts), `${script}: ${description}`).toBe(true);
    }
  });
});

describe('shadcn fiche names the directory of the components', () => {
  const CASES: ProjectName[] = ['single', 'mono', 'org-dashboard-nextjs'];

  test.each(CASES)('%s: the documented directory holds the generated button', async (name) => {
    const project = projectPath(name);
    const webApp = join(project, (await fileExists(join(project, 'apps'))) ? 'apps/web' : '.');
    const agents = await readTextFile(join(webApp, 'AGENTS.md'));

    const line = lineStartingWith(agents, 'shadcn/ui components live in') as string;
    expect(line, 'a line "shadcn/ui components live in ..." in the app AGENTS.md').toBeDefined();
    const directories = pathsIn(line).map((path) => resolveDocumented(project, webApp, path));

    expect(directories.some((directory) => directory !== undefined && existsSync(join(directory, 'button.tsx')))).toBe(true);
  });
});

describe('PORT overrides the port under the root scripts', () => {
  const CASES: ProjectName[] = ['mono', 'start-mono', 'd1-mono', 'cloudflare-fullstack-nextjs'];

  test.each(CASES)('%s: a Hono fiche that says PORT overrides the port has PORT in the pass-through env of the root tasks', async (name) => {
    const project = projectPath(name);
    const fiches = await Promise.all((await appDirectories(name)).map((app) => readTextFile(join(app, 'AGENTS.md'))));
    expect(fiches.some((fiche) => /Hono server\.[\s\S]*`PORT` environment variable overrides/.test(fiche))).toBe(true);

    const { tasks } = await readJsonFile<{ tasks: Record<string, { passThroughEnv?: string[] }> }>(join(project, 'turbo.json'));
    const { scripts } = await readJsonFile<{ scripts: Record<string, string> }>(join(project, 'package.json'));
    const rootTasks = ['dev', 'start'].filter((script) => script in scripts);
    expect(rootTasks).toContain('dev');
    for (const task of rootTasks) expect(tasks[task]?.passThroughEnv, task).toContain('PORT');
  });
});

describe('a root script the project does not define is not documented', () => {
  test.each(Object.keys(PROJECTS) as ProjectName[])('%s: no start line in the README or AGENTS.md without a root start script', async (name) => {
    const project = projectPath(name);
    const { scripts } = await readJsonFile<{ scripts: Record<string, string> }>(join(project, 'package.json'));
    if ('start' in scripts) return;

    for (const document of ['README.md', 'AGENTS.md']) {
      expect(await readTextFile(join(project, document)), document).not.toMatch(/^- `(?:bun|npm|pnpm) run start`/m);
    }
  });

  test('the cloudflare-fullstack-nextjs root has no start script, so the check above looks at something', async () => {
    const { scripts } = await readJsonFile<{ scripts: Record<string, string> }>(
      join(projectPath('cloudflare-fullstack-nextjs'), 'package.json'),
    );

    expect(scripts.start).toBeUndefined();
  });

  test('a turborepo with a root dev script words the dev step the same in Getting Started and in the script list', async () => {
    const readme = await readTextFile(join(projectPath('mono'), 'README.md'));

    expect(readme.match(/Start the dev server of every app that has a `dev` script/g)).toHaveLength(2);
  });
});
