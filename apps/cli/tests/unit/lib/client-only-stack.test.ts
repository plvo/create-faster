import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { collectEnvFiles, collectEnvGroups } from '@/lib/env-generator';
import { generateAllPackageJsons } from '@/lib/package-json-generator';
import type { ProjectContext, TemplateContext } from '@/types/ctx';

const CLIENT_APP = 'mobile';
const SERVER_APPS = ['web', 'start', 'api', 'worker'];

const PROJECTS: { title: string; project: Partial<ProjectContext> }[] = [
  { title: 'postgres + drizzle', project: { database: 'postgres', orm: 'drizzle' } },
  { title: 'postgres + prisma', project: { database: 'postgres', orm: 'prisma' } },
  { title: 'mysql + drizzle', project: { database: 'mysql', orm: 'drizzle' } },
  { title: 'mysql + prisma', project: { database: 'mysql', orm: 'prisma' } },
  { title: 'sqlite + drizzle', project: { database: 'sqlite', orm: 'drizzle' } },
  { title: 'postgres without an ORM', project: { database: 'postgres' } },
  { title: 'sqlite without an ORM', project: { database: 'sqlite' } },
];

function makeContext(project: Partial<ProjectContext>, overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    projectName: 'my-project',
    repo: 'turborepo',
    apps: [
      { appName: CLIENT_APP, stackName: 'expo', libraries: [] },
      { appName: 'web', stackName: 'nextjs', libraries: [] },
      { appName: 'start', stackName: 'tanstack-start', libraries: [] },
      { appName: 'api', stackName: 'hono', libraries: [] },
      { appName: 'worker', stackName: 'node', libraries: [] },
    ],
    project: { linter: 'biome', tooling: [], ...project },
    git: false,
    pm: 'bun',
    ...overrides,
  };
}

function dependenciesOf(ctx: TemplateContext, appName: string): string[] {
  const manifest = generateAllPackageJsons(ctx).find((file) => file.path === `apps/${appName}/package.json`);
  return Object.keys({ ...manifest?.content.dependencies, ...manifest?.content.devDependencies });
}

describe('META.stacks clientOnly', () => {
  test('marks the stacks that cannot run a server-side database client', () => {
    const clientOnly = Object.entries(META.stacks)
      .filter(([, stack]) => stack.clientOnly)
      .map(([name]) => name);

    expect(clientOnly).toEqual(['expo']);
  });

  test('is declared on the database and ORM addons as serverOnly', () => {
    const serverOnly = [...Object.values(META.project.database.options), ...Object.values(META.project.orm.options)];

    expect(serverOnly.every((addon) => addon.serverOnly)).toBe(true);
  });
});

describe.each(PROJECTS)('turborepo with a client-only app next to server apps ($title)', ({ project }) => {
  const ctx = makeContext(project);

  test('the client-only app has no dependency on the db package', () => {
    expect(dependenciesOf(ctx, CLIENT_APP)).not.toContain('@repo/db');
  });

  test('the server apps keep the db package when an ORM generates it', () => {
    for (const appName of SERVER_APPS) {
      const hasDbPackage = dependenciesOf(ctx, appName).includes('@repo/db');
      expect(hasDbPackage, appName).toBe(Boolean(project.orm));
    }
  });

  test('the client-only app receives no database variable', () => {
    const paths = collectEnvFiles(ctx).map((file) => file.destination);

    expect(paths).not.toContain(`apps/${CLIENT_APP}/.env.example`);
    expect(collectEnvGroups(ctx).map((group) => group.path)).not.toContain(`apps/${CLIENT_APP}/.env`);
  });

  test('the server apps keep the database variables', () => {
    const files = collectEnvFiles(ctx);

    for (const appName of SERVER_APPS) {
      const env = files.find((file) => file.destination === `apps/${appName}/.env.example`);
      expect(env?.content, appName).toContain('DATABASE_URL=');
    }
  });

  test('the db package keeps its own variables', () => {
    const paths = collectEnvFiles(ctx).map((file) => file.destination);

    expect(paths.includes('packages/db/.env.example')).toBe(Boolean(project.orm));
  });
});

describe('single repo with a client-only app', () => {
  const ctx = makeContext(
    { database: 'postgres', orm: 'drizzle' },
    { repo: 'single', apps: [{ appName: CLIENT_APP, stackName: 'expo', libraries: [] }] },
  );

  test('the only app owns the project database, so it keeps the dependencies and the variables', () => {
    const manifest = generateAllPackageJsons(ctx).find((file) => file.path === 'package.json');

    expect(Object.keys(manifest?.content.dependencies ?? {})).toEqual(expect.arrayContaining(['drizzle-orm', 'pg']));
    expect(collectEnvFiles(ctx).find((file) => file.destination === '.env.example')?.content).toContain('DATABASE_URL=');
  });
});
