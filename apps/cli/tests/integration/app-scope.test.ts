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

/** Read from the shell or by the tool that starts the app, never from a `.env` file the project ships. */
const PROVIDED_BY_THE_ENVIRONMENT = new Set([
  'NODE_ENV',
  'PORT',
  'PORTLESS_URL',
  'BASE_URL',
  'DEV',
  'PROD',
  'MODE',
  'SSR',
]);

/** Variables a dependency reads itself, so no source of the app names them: the variable and the package that reads it. */
const READ_BY_DEPENDENCY: Record<string, string> = {
  BETTER_AUTH_SECRET: 'better-auth',
  BETTER_AUTH_URL: 'better-auth',
};

type DatabaseName = keyof typeof META.project.database.options;

const WORKSPACE_SCOPE = '@repo/';
const ENV_EXAMPLE = /(?:^|\/)\.env(?:\.[\w-]+)?\.example$/;
const ENV_FILE_FLAG = /--env-file(?:-if-exists)?[= ]([^\s'"]+)/g;
const NOT_READ_BY_RUNNING_CODE = /\.mdx?$|(?:^|\/)(?:\.env[^/]*|turbo\.json|\.gitignore|[\w-]+\.lock|[\w-]+-lock\.yaml)$/;

interface GeneratedApp {
  appName: string;
  stackName: StackName;
  directory: string;
}

interface Project {
  name: string;
  args: string[];
  apps: { appName: string; stackName: StackName }[];
  database?: string;
  orm?: string;
}

interface Generated extends Project {
  root: string;
  files: string[];
  isTurborepo: boolean;
  generatedApps: GeneratedApp[];
}

const BLUEPRINT_PROJECTS: Project[] = Object.entries(META.blueprints).map(([name, blueprint]) => ({
  name: `blueprint ${name}`,
  args: ['--blueprint', name],
  apps: blueprint.context.apps.map(({ appName, stackName }) => ({ appName, stackName })),
  database: (blueprint.context.project as { database?: string }).database,
  orm: (blueprint.context.project as { orm?: string }).orm,
}));

/** The choices of META packed into as few projects as their requirements allow: the apps are named after their stack. */
const CHOICE_PROJECTS: Project[] = groupChoices().map((project, index) => ({
  name: `choices ${index + 1}`,
  args: toCliArgs(project),
  apps: [...project.apps.keys()].map((stackName) => ({ appName: stackName, stackName })),
  database: project.database,
  orm: project.orm,
}));

const PROJECTS = [...BLUEPRINT_PROJECTS, ...CHOICE_PROJECTS];

/** Without an ORM, the connection variables of the database are for the client the user brings. */
function databaseVariables(project: Project): Set<string> {
  const database = project.database ? META.project.database.options[project.database as DatabaseName] : undefined;
  const envs: EnvVar[] = (database as MetaAddon | undefined)?.envs ?? [];
  return new Set(envs.flatMap(({ value }) => declaredVariables(value)));
}

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

async function generate(project: Project, directory: string): Promise<Generated> {
  const name = project.name.replace(/\W+/g, '-');
  const gitFlag = project.args.includes('--git') ? [] : ['--no-git'];
  const result = await runCli([name, ...project.args, ...gitFlag, '--no-install', '--pm', 'bun'], directory);
  expect(result.exitCode, `${project.name}: ${result.stderr}`).toBe(0);

  const root = join(directory, name);
  const isTurborepo = project.apps.length > 1;
  return {
    ...project,
    root,
    files: await listFiles(root, new Set(['.git'])),
    isTurborepo,
    generatedApps: project.apps.map((app) => ({ ...app, directory: isTurborepo ? join('apps', app.appName) : '' })),
  };
}

function readDependencies(project: Generated, directory: string): Promise<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> {
  return readJsonFile(join(project.root, directory, 'package.json'));
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

    test.each(PROJECTS.map(({ name }) => name))('%s', async (name) => {
      const project = generatedProject(name);
      const uiDependencies = new Set([...uiFromMeta, ...(await jsxOnlyPackages(project))]);
      const serverApps = project.generatedApps.filter(({ stackName }) => META.stacks[stackName].type === 'server');

      const found = await Promise.all(
        serverApps.map(async ({ appName, directory }) => {
          const manifest = await readDependencies(project, directory);
          const declared = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
          return { appName, uiDependencies: declared.filter((dependency) => uiDependencies.has(dependency)) };
        }),
      );

      expect(found.filter(({ uiDependencies: ui }) => ui.length > 0)).toEqual([]);
    });
  });

  describe('what the blueprints scope to their web app', () => {
    const exampleOf = (project: Generated, file: string): Promise<string | undefined> =>
      project.files.includes(file) ? readTextFile(join(project.root, file)) : Promise.resolve(undefined);

    test('the cron Worker of cloudflare-fullstack-nextjs has no .env.example and no UI dependency', async () => {
      const project = generatedProject('blueprint cloudflare-fullstack-nextjs');
      const cron = await readDependencies(project, 'apps/cron');

      expect(project.files).not.toContain('apps/cron/.env.example');
      expect(Object.keys(cron.dependencies ?? {})).not.toContain('lucide-react');
      expect(Object.keys(cron.dependencies ?? {})).not.toContain('sonner');
    });

    test('the seed password of cloudflare-fullstack-nextjs stays out of the .env that build:cf bundles into the web Worker', async () => {
      const project = generatedProject('blueprint cloudflare-fullstack-nextjs');

      expect(await exampleOf(project, '.env.example')).toContain('SEED_PASSWORD=');
      expect(await exampleOf(project, 'apps/web/.env.example')).not.toContain('SEED_PASSWORD');
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
      const withTrpc = generatedProject('choices 3');
      const plain = generatedProject('choices 5');

      expect(await exampleOf(withTrpc, 'apps/nextjs/.env.example')).toContain('NEXT_PUBLIC_APP_URL=');
      expect(plain.files).not.toContain('src/lib/get-app-url.ts');
    });
  });

  describe('every .env.example declares only what its package reads', () => {
    test.each(PROJECTS.map(({ name }) => name))('%s', async (name) => {
      const project = generatedProject(name);
      const manifests = await manifestsOf(project);
      const sources = new Map<string, string>();
      const sourceOf = async (file: string) => {
        if (!sources.has(file)) sources.set(file, await readTextFile(join(project.root, file)));
        return sources.get(file) ?? '';
      };

      const unread: string[] = [];
      for (const example of project.files.filter((file) => ENV_EXAMPLE.test(file))) {
        const directory = dirname(example) === '.' ? '' : dirname(example);
        const readers = readerFiles(project, directory, manifests, example);
        const runsCode = project.generatedApps.some((app) => app.directory === directory);
        const dependencies = Object.keys(manifests.get(directory)?.dependencies ?? {});

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

  describe('every variable a source reads is declared', () => {
    test.each(PROJECTS.map(({ name }) => name))('%s', async (name) => {
      const project = generatedProject(name);
      const declared = new Set<string>();
      for (const example of project.files.filter((file) => ENV_EXAMPLE.test(file))) {
        for (const variable of declaredVariables(await readTextFile(join(project.root, example)))) declared.add(variable);
      }
      const bindings = new Set<string>();
      for (const file of project.files.filter((candidate) => candidate.endsWith('wrangler.jsonc'))) {
        for (const [, binding] of (await readTextFile(join(project.root, file))).matchAll(/"binding":\s*"(\w+)"/g)) {
          if (binding) bindings.add(binding);
        }
      }

      const undeclared: string[] = [];
      for (const { file, source } of await readScriptFiles(project.root, project.files)) {
        for (const variable of envReads(source)) {
          if (!declared.has(variable) && !PROVIDED_BY_THE_ENVIRONMENT.has(variable) && !bindings.has(variable)) {
            undeclared.push(`${file}: ${variable}`);
          }
        }
      }

      expect(undeclared).toEqual([]);
    });
  });
});

type Manifest = { dependencies?: Record<string, string>; scripts?: Record<string, string> };

async function manifestsOf(project: Generated): Promise<Map<string, Manifest>> {
  const directories = project.files
    .filter((file) => file === 'package.json' || /^(?:apps|packages)\/[^/]+\/package\.json$/.test(file))
    .map((file) => (dirname(file) === '.' ? '' : dirname(file)));
  const entries = await Promise.all(
    directories.map(async (directory) => [directory, await readJsonFile<Manifest>(join(project.root, directory, 'package.json'))] as const),
  );
  return new Map(entries);
}

const isInside = (file: string, directory: string): boolean => directory === '' || file.startsWith(`${directory}/`);

/** The files whose code runs with the `.env` of a directory: its package, the workspace packages an app uses, the scripts that load it. */
function readerFiles(project: Generated, directory: string, manifests: Map<string, Manifest>, example: string): string[] {
  const workspaceDirectories = [...manifests.keys()].filter((candidate) => candidate !== '');
  const ownsFile = (file: string, owner: string): boolean =>
    isInside(file, owner) && (owner !== '' || !workspaceDirectories.some((workspace) => isInside(file, workspace)));

  const owners = new Set([directory]);
  const isApp = project.generatedApps.some((app) => app.directory === directory);
  if (isApp) {
    const pending = [directory];
    while (pending.length > 0) {
      const dependencies = Object.keys(manifests.get(pending.pop() ?? '')?.dependencies ?? {});
      for (const dependency of dependencies.filter((name) => name.startsWith(WORKSPACE_SCOPE))) {
        const owner = `packages/${dependency.slice(WORKSPACE_SCOPE.length)}`;
        if (manifests.has(owner) && !owners.has(owner)) {
          owners.add(owner);
          pending.push(owner);
        }
      }
    }
  }

  const loaded = example.replace(/\.example$/, '');
  for (const [owner, manifest] of manifests) {
    const scripts = Object.values(manifest.scripts ?? {}).join('\n');
    const flags = [...scripts.matchAll(ENV_FILE_FLAG)].map(([, path = '']) => normalize(join(owner, path)));
    if (flags.includes(loaded)) owners.add(owner);
  }

  return project.files.filter(
    (file) => !NOT_READ_BY_RUNNING_CODE.test(file) && [...owners].some((owner) => ownsFile(file, owner)),
  );
}

