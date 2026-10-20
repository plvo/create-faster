import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { dirname, join, normalize } from 'node:path';
import { META } from '@/__meta__';
import { isLibraryCompatible } from '@/lib/addon-utils';
import type { EnvVar, MetaAddon, PackageJsonConfig } from '@/types/meta';
import type { StackName } from '@/types/stack-name';
import { groupChoices, toCliArgs } from '../e2e/install-scripts-projects';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';
import {
  declaredVariables,
  envReads,
  importedPackages,
  isJsxFile,
  listFiles,
  readScriptFiles,
} from './project-sources';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

type DatabaseName = keyof typeof META.project.database.options;

const WORKSPACE_SCOPE = '@repo/';

/** Read from the shell or by the tool that starts the app, never from a `.env` file the project ships. */
const PROVIDED_BY_THE_ENVIRONMENT = new Set(['NODE_ENV', 'PORT', 'PORTLESS_URL']);

/** Filled by the bundler: `import.meta.env.DEV` and the like. */
const VITE_BUILT_INS = new Set(['DEV', 'PROD', 'MODE', 'SSR', 'BASE_URL']);

/** Variables a dependency reads itself, so no source of the app names them: the variable and the package that reads it. */
const READ_BY_DEPENDENCY: Record<string, string> = {
  BETTER_AUTH_SECRET: 'better-auth',
  BETTER_AUTH_URL: 'better-auth',
};

const ENV_EXAMPLE = /(?:^|\/)\.env(?:\.[\w-]+)?\.example$/;
const ENV_FILE_FLAG = /--env-file(?:-if-exists)?[= ]([^\s'"]+)/g;
/** `wrangler.jsonc` is not read by the app: its `secrets.required` is generated from the declarations. */
const NOT_READ_BY_RUNNING_CODE =
  /\.mdx?$|(?:^|\/)(?:\.env[^/]*|turbo\.json|wrangler\.jsonc|\.gitignore|[\w-]+\.lock|[\w-]+-lock\.yaml)$/;

interface ProjectApp {
  appName: string;
  stackName: StackName;
  libraries: string[];
}

interface Project {
  name: string;
  args: string[];
  apps: ProjectApp[];
  database?: string;
  orm?: string;
}

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface Generated extends Project {
  root: string;
  files: string[];
  isTurborepo: boolean;
  /** The directory of each app relative to the project root, and of each package: `''` is the root. */
  appDirectories: Map<string, string>;
  manifests: Map<string, Manifest>;
}

const BLUEPRINT_PROJECTS: Project[] = Object.entries(META.blueprints).map(([name, blueprint]) => ({
  name: `blueprint ${name}`,
  args: ['--blueprint', name],
  apps: blueprint.context.apps.map(({ appName, stackName, libraries }) => ({ appName, stackName, libraries })),
  database: (blueprint.context.project as { database?: string }).database,
  orm: (blueprint.context.project as { orm?: string }).orm,
}));

/** The choices of META packed into as few projects as their requirements allow: the apps are named after their stack. */
const CHOICE_PROJECTS: Project[] = groupChoices().map((project, index) => ({
  name: `choices ${index + 1}`,
  args: toCliArgs(project),
  apps: [...project.apps].map(([stackName, libraries]) => ({ appName: stackName, stackName, libraries })),
  database: project.database,
  orm: project.orm,
}));

const PROJECTS = [...BLUEPRINT_PROJECTS, ...CHOICE_PROJECTS];
const PROJECT_NAMES = PROJECTS.map(({ name }) => name);

function dependencyNames(config: PackageJsonConfig | undefined): string[] {
  return Object.keys(config?.dependencies ?? {});
}

/** The runtime dependencies META gives to the stacks and libraries that only run in a UI app, and to no server stack. */
function uiDependenciesOfMeta(): Set<string> {
  const stacks = Object.entries(META.stacks) as [StackName, (typeof META.stacks)[StackName]][];
  const byKind = (type: 'app' | 'server') => stacks.filter(([, stack]) => stack.type === type).map(([name]) => name);
  const [uiStacks, serverStacks] = [byKind('app'), byKind('server')];

  const isUiLibrary = (library: (typeof META.libraries)[string]) =>
    !library.needsServerRuntime && serverStacks.every((stack) => !isLibraryCompatible(library, stack));
  const libraryNames = (stack: StackName, library: (typeof META.libraries)[string]) => [
    ...dependencyNames(library.packageJson),
    ...dependencyNames(library.appPackageJson),
    ...dependencyNames(library.stackPackageJson?.[stack]),
  ];
  const stackNames = (stack: StackName) => dependencyNames(META.stacks[stack].packageJson);

  const server = new Set(serverStacks.flatMap(stackNames));
  const ui = [
    ...uiStacks.flatMap(stackNames),
    ...uiStacks.flatMap((stack) =>
      Object.values(META.libraries)
        .filter((library) => isUiLibrary(library) && isLibraryCompatible(library, stack))
        .flatMap((library) => libraryNames(stack, library)),
    ),
  ];
  return new Set(ui.filter((name) => !server.has(name) && !name.startsWith(WORKSPACE_SCOPE)));
}

/** Without an ORM, the connection variables of the database are for the client the user brings. */
function databaseVariables(project: Project): Set<string> {
  const database = project.database ? META.project.database.options[project.database as DatabaseName] : undefined;
  const envs: EnvVar[] = (database as MetaAddon | undefined)?.envs ?? [];
  return new Set(envs.flatMap(({ value }) => declaredVariables(value)));
}

async function generate(project: Project, directory: string): Promise<Generated> {
  const name = project.name.replace(/\W+/g, '-');
  const gitFlag = project.args.includes('--git') ? [] : ['--no-git'];
  const result = await runCli([name, ...project.args, ...gitFlag, '--no-install', '--pm', 'bun'], directory);
  expect(result.exitCode, `${project.name}: ${result.stderr}`).toBe(0);

  const root = join(directory, name);
  const files = await listFiles(root);
  const isTurborepo = project.apps.length > 1;

  const manifestDirectories = files
    .filter((file) => file === 'package.json' || /^(?:apps|packages)\/[^/]+\/package\.json$/.test(file))
    .map((file) => (dirname(file) === '.' ? '' : dirname(file)));
  const manifests = new Map(
    await Promise.all(
      manifestDirectories.map(
        async (directoryOfManifest) =>
          [directoryOfManifest, await readJsonFile<Manifest>(join(root, directoryOfManifest, 'package.json'))] as const,
      ),
    ),
  );

  return {
    ...project,
    root,
    files,
    isTurborepo,
    manifests,
    appDirectories: new Map(project.apps.map((app) => [app.appName, isTurborepo ? join('apps', app.appName) : ''])),
  };
}

const isInside = (file: string, directory: string): boolean => directory === '' || file.startsWith(`${directory}/`);

/** The workspace packages a directory depends on, directly or not. */
function workspaceClosure(project: Generated, directory: string): string[] {
  const reached = new Set<string>();
  const pending = [directory];
  while (pending.length > 0) {
    const dependencies = Object.keys(project.manifests.get(pending.pop() ?? '')?.dependencies ?? {});
    for (const dependency of dependencies.filter((name) => name.startsWith(WORKSPACE_SCOPE))) {
      const owner = `packages/${dependency.slice(WORKSPACE_SCOPE.length)}`;
      if (project.manifests.has(owner) && !reached.has(owner)) {
        reached.add(owner);
        pending.push(owner);
      }
    }
  }
  return [...reached];
}

/** The package that owns a file: the deepest directory with a manifest above it. */
function ownerOf(project: Generated, file: string): string {
  return [...project.manifests.keys()]
    .filter((directory) => directory !== '' && isInside(file, directory))
    .sort((a, b) => b.length - a.length)[0] ?? '';
}

/** The directories whose `.env` a script of the directory loads through `--env-file`. */
function loadedEnvDirectories(project: Generated, directory: string): string[] {
  const scripts = Object.values(project.manifests.get(directory)?.scripts ?? {}).join('\n');
  return [...scripts.matchAll(ENV_FILE_FLAG)].map(([, path = '']) => dirname(normalize(join(directory, path))).replace(/^\.$/, ''));
}

describe('apps receive what they use', () => {
  let tempDir: string;
  const generated = new Map<string, Generated>();

  beforeAll(async () => {
    tempDir = await createTempDir();
    for (const project of PROJECTS) generated.set(project.name, await generate(project, tempDir));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const generatedProject = (name: string): Generated => {
    const project = generated.get(name);
    if (!project) throw new Error(`${name} was not generated`);
    return project;
  };

  /** The first project that satisfies the predicate: found by what it holds, not by its place in the list. */
  const findProject = (describeIt: string, predicate: (project: Project) => boolean): Generated => {
    const found = PROJECTS.find(predicate);
    if (!found) throw new Error(`no project ${describeIt}`);
    return generatedProject(found.name);
  };

  const serverAppsOf = (project: Generated) =>
    project.apps.filter(({ stackName }) => META.stacks[stackName].type === 'server');

  /** The packages imported by JSX files only: a component library, whatever it is called. */
  async function jsxOnlyPackages(project: Generated): Promise<Set<string>> {
    const usage = new Map<string, { jsx: boolean; other: boolean }>();
    for (const { file, source } of await readScriptFiles(project.root, project.files)) {
      for (const name of importedPackages(source)) {
        const seen = usage.get(name) ?? { jsx: false, other: false };
        if (isJsxFile(file)) seen.jsx = true;
        else seen.other = true;
        usage.set(name, seen);
      }
    }
    return new Set(
      [...usage]
        .filter(([name, { jsx, other }]) => jsx && !other && !name.startsWith(WORKSPACE_SCOPE))
        .map(([name]) => name),
    );
  }

  describe('a server-only app has no UI dependency', () => {
    const uiFromMeta = uiDependenciesOfMeta();

    test('META tells UI dependencies apart', () => {
      expect(uiFromMeta.has('lucide-react')).toBe(true);
      expect(uiFromMeta.has('react')).toBe(true);
      expect(uiFromMeta.has('hono')).toBe(false);
    });

    test.each(PROJECT_NAMES)('%s', async (name) => {
      const project = generatedProject(name);
      const uiDependencies = new Set([...uiFromMeta, ...(await jsxOnlyPackages(project))]);

      const found = serverAppsOf(project).map(({ appName }) => {
        const manifest = project.manifests.get(project.appDirectories.get(appName) ?? '');
        const declared = [...Object.keys(manifest?.dependencies ?? {}), ...Object.keys(manifest?.devDependencies ?? {})];
        return { appName, uiDependencies: declared.filter((dependency) => uiDependencies.has(dependency)) };
      });

      expect(found.filter(({ uiDependencies: ui }) => ui.length > 0)).toEqual([]);
    });
  });

  // Blueprints only: a custom project can still pick a library for an app on a stack it supports without a template
  // for it (`tanstack-query` is supported on every stack, and Hono and Node import nothing of it).
  describe('a server-only app of a blueprint declares only the dependencies something imports', () => {
    test.each(BLUEPRINT_PROJECTS.map(({ name }) => name))('%s', async (name) => {
      const project = generatedProject(name);
      const sources = await readScriptFiles(project.root, project.files);

      const unused = serverAppsOf(project).flatMap(({ appName }) => {
        const directory = project.appDirectories.get(appName) ?? '';
        const manifest = project.manifests.get(directory);
        const scopes = [directory, ...workspaceClosure(project, directory)];
        const imported = new Set(
          sources
            .filter(({ file }) => scopes.some((scope) => ownerOf(project, file) === scope))
            .flatMap(({ source }) => importedPackages(source)),
        );
        const scripts = Object.values(manifest?.scripts ?? {}).join('\n');

        return Object.keys(manifest?.dependencies ?? {})
          .filter((dependency) => !dependency.startsWith(WORKSPACE_SCOPE))
          .filter((dependency) => !imported.has(dependency) && !scripts.includes(dependency))
          .map((dependency) => `${appName}: ${dependency}`);
      });

      expect(unused).toEqual([]);
    });
  });

  describe('what the blueprints scope to their web app', () => {
    const exampleOf = (project: Generated, file: string): Promise<string | undefined> =>
      project.files.includes(file) ? readTextFile(join(project.root, file)) : Promise.resolve(undefined);

    test('the cron Worker of cloudflare-fullstack-nextjs has no .env.example and no UI dependency', async () => {
      const project = generatedProject('blueprint cloudflare-fullstack-nextjs');
      const cron = project.manifests.get('apps/cron');

      expect(project.files).not.toContain('apps/cron/.env.example');
      expect(Object.keys(cron?.dependencies ?? {})).not.toContain('lucide-react');
      expect(Object.keys(cron?.dependencies ?? {})).not.toContain('sonner');
    });

    test.each(['blueprint org-dashboard-nextjs', 'blueprint multitenant-saas-nextjs'])(
      '%s gives the seed password to the web app only',
      async (name) => {
        const project = generatedProject(name);

        expect(await exampleOf(project, 'apps/web/.env.example')).toContain('SEED_PASSWORD=');
        expect(await exampleOf(project, 'apps/batch/.env.example')).not.toContain('SEED_PASSWORD');
      },
    );

    test('a Next.js app with tRPC declares the URL getAppUrl reads, a plain one reads none', async () => {
      const withTrpc = findProject('with a Next.js app that has tRPC', (project) =>
        project.apps.some((app) => app.stackName === 'nextjs' && app.libraries.includes('trpc')),
      );
      const plain = findProject('with a Next.js app that has no tRPC and no blueprint', (project) =>
        !project.name.startsWith('blueprint') &&
        project.apps.some((app) => app.stackName === 'nextjs' && !app.libraries.includes('trpc')),
      );
      const trpcApp = withTrpc.apps.find((app) => app.stackName === 'nextjs' && app.libraries.includes('trpc'));
      const plainApp = plain.apps.find((app) => app.stackName === 'nextjs' && !app.libraries.includes('trpc'));
      const directory = (project: Generated, app: ProjectApp | undefined) =>
        join(project.appDirectories.get(app?.appName ?? '') ?? '');

      expect(await exampleOf(withTrpc, join(directory(withTrpc, trpcApp), '.env.example'))).toContain(
        'NEXT_PUBLIC_APP_URL=',
      );
      expect(withTrpc.files).toContain(join(directory(withTrpc, trpcApp), 'src/lib/get-app-url.ts'));
      expect(plain.files).not.toContain(join(directory(plain, plainApp), 'src/lib/get-app-url.ts'));
    });
  });

  describe('no variable only a seed or a CLI loads sits in a .env that a Worker build bundles', () => {
    /** OpenNext bundles `.env`, `.env.local` and their mode variants of the app and of the monorepo root. */
    const BUNDLED_ENV_FILE = /(?:^|\/)\.env(?:\.(?:local|development|production|test)(?:\.local)?)?\.example$/;
    const cloudflareProjects = () =>
      PROJECTS.filter((project) => project.args.includes('cloudflare') || project.name.includes('cloudflare'));

    test('some project deploys to Cloudflare', () => {
      expect(cloudflareProjects().length).toBeGreaterThan(0);
    });

    test('SEED_PASSWORD is in no .env.example OpenNext reads, in the app or at the root', async () => {
      for (const { name } of cloudflareProjects()) {
        const project = generatedProject(name);
        for (const example of project.files.filter((file) => BUNDLED_ENV_FILE.test(file))) {
          expect(await readTextFile(join(project.root, example)), `${name}: ${example}`).not.toContain('SEED_PASSWORD');
        }
      }
    });

    test('the seed password sits in a dedicated file the seed loads and git ignores', async () => {
      const project = generatedProject('blueprint cloudflare-fullstack-nextjs');
      const { scripts } = project.manifests.get('') ?? {};

      expect(await readTextFile(join(project.root, '.env.seed.example'))).toContain('SEED_PASSWORD=');
      expect(scripts?.['db:seed']).toContain('--env-file=.env.seed');
      expect((await readTextFile(join(project.root, '.gitignore'))).split('\n')).toContain('.env.seed');
    });
  });

  describe('every .env.example declares only what its package reads', () => {
    test.each(PROJECT_NAMES)('%s', async (name) => {
      const project = generatedProject(name);
      const sources = new Map<string, string>();
      const sourceOf = async (file: string) => {
        if (!sources.has(file)) sources.set(file, await readTextFile(join(project.root, file)));
        return sources.get(file) ?? '';
      };

      const unread: string[] = [];
      for (const example of project.files.filter((file) => ENV_EXAMPLE.test(file))) {
        const directory = dirname(example) === '.' ? '' : dirname(example);
        const readers = readerFiles(project, directory, example);
        const runsCode = [...project.appDirectories.values()].includes(directory);
        const dependencies = Object.keys(project.manifests.get(directory)?.dependencies ?? {});

        for (const variable of declaredVariables(await sourceOf(example))) {
          if (!project.orm && databaseVariables(project).has(variable)) continue;
          if (runsCode && dependencies.includes(READ_BY_DEPENDENCY[variable] ?? '')) continue;
          const pattern = new RegExp(`\\b${variable}\\b`);
          const read = await Promise.all(readers.map(async (file) => pattern.test(await sourceOf(file))));
          if (!read.some(Boolean)) unread.push(`${example}: ${variable}`);
        }
      }

      expect(unread).toEqual([]);
    });
  });

  describe('every variable a source reads is declared for the package that reads it', () => {
    test.each(PROJECT_NAMES)('%s', async (name) => {
      const project = generatedProject(name);
      const examples = project.files.filter((file) => ENV_EXAMPLE.test(file));
      const declaredIn = new Map<string, Set<string>>();
      for (const example of examples) {
        const directory = dirname(example) === '.' ? '' : dirname(example);
        const names = declaredVariables(await readTextFile(join(project.root, example)));
        declaredIn.set(directory, new Set([...(declaredIn.get(directory) ?? []), ...names]));
      }
      const bindings = new Set<string>();
      for (const file of project.files.filter((candidate) => candidate.endsWith('wrangler.jsonc'))) {
        for (const [, binding] of (await readTextFile(join(project.root, file))).matchAll(/"binding":\s*"(\w+)"/g)) {
          if (binding) bindings.add(binding);
        }
      }

      /** What the code of a package sees: its own examples, those of the workspace packages it uses, those of the apps that run it. */
      const visibleFrom = (owner: string): Set<string> => {
        const directories = new Set([
          owner,
          ...workspaceClosure(project, owner),
          ...[...project.manifests.keys()].filter((other) => workspaceClosure(project, other).includes(owner)),
          ...loadedEnvDirectories(project, owner),
        ]);
        return new Set([...directories].flatMap((directory) => [...(declaredIn.get(directory) ?? [])]));
      };

      const undeclared: string[] = [];
      for (const { file, source } of await readScriptFiles(project.root, project.files)) {
        const visible = visibleFrom(ownerOf(project, file));
        for (const { name: variable, source: via } of envReads(source)) {
          const provided =
            via === 'import.meta.env' ? VITE_BUILT_INS.has(variable) : PROVIDED_BY_THE_ENVIRONMENT.has(variable);
          if (!visible.has(variable) && !provided && !bindings.has(variable)) undeclared.push(`${file}: ${variable}`);
        }
      }

      expect(undeclared).toEqual([]);
    });
  });
});

/** The files whose code runs with the `.env` of a directory: its package, the workspace packages an app uses, the scripts that load it. */
function readerFiles(project: Generated, directory: string, example: string): string[] {
  const owners = new Set([directory]);
  if ([...project.appDirectories.values()].includes(directory)) {
    for (const owner of workspaceClosure(project, directory)) owners.add(owner);
  }

  const loaded = example.replace(/\.example$/, '');
  for (const owner of project.manifests.keys()) {
    const scripts = Object.values(project.manifests.get(owner)?.scripts ?? {}).join('\n');
    const flags = [...scripts.matchAll(ENV_FILE_FLAG)].map(([, path = '']) => normalize(join(owner, path)));
    if (flags.includes(loaded)) owners.add(owner);
  }

  return project.files.filter((file) => !NOT_READ_BY_RUNNING_CODE.test(file) && owners.has(ownerOf(project, file)));
}
