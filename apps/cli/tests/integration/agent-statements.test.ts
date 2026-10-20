import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
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

describe('every path an agent document writes exists in the generated project', () => {
  const DOCUMENTED_PATH = /`((?:src|packages|apps|docs|scripts)\/[\w@./()-]*[\w)])`/g;
  const NOT_GENERATED: RegExp[] = [
    /(?:^|\/)\.[\w.]*env[\w.]*$/, // env files the user copies from .env.example
    /^packages\/db\/drizzle$/, // written by db:generate
    /^src\/start\.ts$/, // the TanStack Start fiche says it exists once a library adds middleware
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

  const SCRIPT_LIST_ONLY: ProjectName[] = ['dapp-privy-eslint-prettier', 'single-tests-biome', 'single-eslint-prettier', 'mono-tests-oxc', 'mono-prettier'];
  const SWEPT = (Object.keys(PROJECTS) as ProjectName[]).filter((name) => !SCRIPT_LIST_ONLY.includes(name));

  test.each(SWEPT)('%s', async (name) => {
    const project = projectPath(name);
    const apps = (await fileExists(join(project, 'apps'))) ? await readdir(join(project, 'apps')) : [];
    const missing: string[] = [];
    let documentedPaths = 0;

    for (const document of await agentDocuments(name)) {
      const text = await readTextFile(join(project, document));
      const startsFrom = document.startsWith('apps/')
        ? [join(project, document, '..'), project]
        : [project, ...apps.map((app) => join(project, 'apps', app))];

      for (const [, path] of text.matchAll(DOCUMENTED_PATH)) {
        const documented = path as string;
        documentedPaths++;
        const isDocumentedAsAbsent = text.includes(`no \`${documented}\``);
        const exists = startsFrom.some((start) => existsSync(join(start, documented)));
        if (!exists && !isDocumentedAsAbsent && !NOT_GENERATED.some((pattern) => pattern.test(documented))) {
          missing.push(`${document}: ${documented}`);
        }
      }
    }

    expect(documentedPaths).toBeGreaterThan(0);
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
    return texts.join('\n');
  }

  test.each(SEEDS)('%s: the seed deletes users, and AGENTS.md or its guides say so', async (name, seed) => {
    const source = await readTextFile(join(projectPath(name), seed));
    expect(source).toMatch(DELETES_USERS);

    expect(await documents(name)).toMatch(SAYS_USERS_ARE_DELETED);
  });

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
