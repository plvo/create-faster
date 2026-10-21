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
  'mono-node': ['--app', 'web:nextjs', '--app', 'jobs:node', ...GENERIC_ORM],
  'hono-cloudflare': ['--app', 'hono-cloudflare:hono', '--deployment', 'cloudflare'],
  'hono-cloudflare-portless': ['--app', 'hono-cloudflare-portless:hono', '--deployment', 'cloudflare', '--tooling', 'portless'],
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
  'showcase-nextjs': ['--blueprint', 'showcase-nextjs'],
  'cloudflare-static-site-nextjs': ['--blueprint', 'cloudflare-static-site-nextjs'],
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

/** The headings of a Markdown document that follow a line of text directly, outside code fences. */
function gluedHeadings(markdown: string): string[] {
  const lines = markdown.split('\n');
  let inFence = false;
  const glued: string[] = [];

  for (const [index, line] of lines.entries()) {
    if (line.startsWith('```')) inFence = !inFence;
    if (!inFence && /^#{1,6} /.test(line) && index > 0 && lines[index - 1] !== '') glued.push(line);
  }
  return glued;
}

describe('generated READMEs keep a blank line before every heading', () => {
  test('the check sees a heading glued to the line above and ignores a comment in a code fence', () => {
    expect(gluedHeadings('## One\ntext\n## Two\n\n```bash\n# not a heading\n```\n')).toEqual(['## Two']);
  });

  test.each(Object.keys(PROJECTS) as ProjectName[])('%s', async (name) => {
    expect(gluedHeadings(await readTextFile(join(projectPath(name), 'README.md')))).toEqual([]);
  });
});

describe('the per-app AGENTS.md documents', () => {
  const TURBOREPOS = (Object.keys(PROJECTS) as ProjectName[]).filter((name) =>
    PROJECTS[name].filter((arg) => arg === '--app').length > 1,
  );

  test('the turborepo projects are covered', () => {
    expect(TURBOREPOS).toContain('mono-node');
    expect(TURBOREPOS).toContain('mono');
  });

  test.each(TURBOREPOS)('%s: the root promises one per app, and every app has it', async (name) => {
    const root = await readTextFile(join(projectPath(name), 'AGENTS.md'));
    const apps = await readdir(join(projectPath(name), 'apps'));

    expect(root).toContain('Per-app detail lives in each `apps/<app>/AGENTS.md`.');
    for (const app of apps) {
      expect(await fileExists(join(projectPath(name), 'apps', app, 'AGENTS.md')), app).toBe(true);
      expect(await readTextFile(join(projectPath(name), 'apps', app, 'CLAUDE.md'))).toBe('@AGENTS.md\n');
    }
  });

  test('the Node app describes its entry point, its runner and the absence of a build', async () => {
    const agents = await readTextFile(join(projectPath('mono-node'), 'apps', 'jobs', 'AGENTS.md'));

    expect(agents).toContain('## Node\n\nPlain TypeScript Node app: no framework and no HTTP server. `src/index.ts` is the entry point');
    expect(agents).toContain('`dev` runs the entry under Bun with `--hot`');
    expect(agents).toContain('There is no `build` script');
    expect(agents).toContain('The root `bun run dev` and `bun run start` run it together with the other apps.');
    const scripts = (await readJsonFile<{ scripts: Record<string, string> }>(join(projectPath('mono-node'), 'apps', 'jobs', 'package.json'))).scripts;
    expect(scripts.build).toBeUndefined();
    expect(scripts.dev).toBe('bun run --hot src/index.ts');
  });

  test('a single Node app on npm runs through tsx and has no root-script sentence', async () => {
    const dirNpm = await createTempDir();
    try {
      const result = await runCli(['node-npm', '--app', 'node-npm:node', '--no-git', '--no-install', '--pm', 'npm'], dirNpm);
      expect(result.exitCode).toBe(0);
      const agents = await readTextFile(join(dirNpm, 'node-npm', 'AGENTS.md'));

      expect(agents).toContain('`dev` runs the entry on Node through `tsx watch`');
      expect(agents).not.toContain('together with the other apps');
    } finally {
      await cleanupTempDir(dirNpm);
    }
  });

  test('the Hono Worker fiche names portless only for a project that uses it', async () => {
    const withoutPortless = await readTextFile(join(projectPath('hono-cloudflare'), 'AGENTS.md'));
    const withPortless = await readTextFile(join(projectPath('hono-cloudflare-portless'), 'AGENTS.md'));

    expect(withoutPortless).toContain('The `PORT` environment variable overrides it. There is no `start` script');
    expect(withoutPortless).not.toContain('portless reaches it');
    expect(withPortless).toContain('The `PORT` environment variable overrides it, which is how portless reaches it.');
  });
});

type LineKind = 'blank' | 'heading' | 'list' | 'table' | 'quote' | 'indented' | 'text';

function lineKind(line: string): LineKind {
  if (line === '') return 'blank';
  if (/^#{1,6} /.test(line)) return 'heading';
  if (/^([-*+]|\d+\.) /.test(line)) return 'list';
  if (line.startsWith('|')) return 'table';
  if (line.startsWith('>')) return 'quote';
  if (/^\s/.test(line)) return 'indented';
  return 'text';
}

/**
 * The lines of a Markdown document, outside code fences, that break the layout of the rendered text: a paragraph,
 * list item, table or quote that follows a paragraph line directly (Markdown renders them inside it), a paragraph that
 * follows a list item, table or quote directly, and the second blank line in a row.
 */
function layoutProblems(markdown: string): string[] {
  const lines = markdown.split('\n');
  let inFence = false;
  const problems: string[] = [];

  for (const [index, line] of lines.entries()) {
    if (line.startsWith('```')) inFence = !inFence;
    if (inFence || line.startsWith('```') || index === 0) continue;
    const kind = lineKind(line);
    const previous = lineKind(lines[index - 1] as string);
    const isGlued =
      (kind === 'text' && ['text', 'list', 'table', 'quote'].includes(previous)) ||
      (['list', 'table', 'quote'].includes(kind) && previous === 'text');
    if (isGlued) problems.push(`glued to the line above: ${line}`);
    if (kind === 'blank' && previous === 'blank') problems.push('a second blank line in a row');
  }
  return problems;
}

describe('generated READMEs keep paragraphs, lists and blank lines apart', () => {
  test('the check sees a list item or a paragraph glued to a paragraph, and a second blank line, outside code fences', () => {
    expect(layoutProblems('text\n- item\n\n- item\n- item\nafter the list\n\n\nnext\n```\ntext\ntext\n```\n')).toEqual([
      'glued to the line above: - item',
      'glued to the line above: after the list',
      'a second blank line in a row',
    ]);
    expect(layoutProblems('text\nanother line\n')).toEqual(['glued to the line above: another line']);
    expect(layoutProblems('- item\n  continued\n\ntext\n\n| a |\n| - |\n')).toEqual([]);
  });

  test.each(Object.keys(PROJECTS) as ProjectName[])('%s', async (name) => {
    expect(layoutProblems(await readTextFile(join(projectPath(name), 'README.md')))).toEqual([]);
  });
});
