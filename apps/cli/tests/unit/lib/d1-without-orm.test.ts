import { describe, expect, test } from 'bun:test';
import { generateAllPackageJsons, getAppScripts, getRootScripts } from '@/lib/package-json-generator';
import type { TemplateContext } from '@/types/ctx';
import type { StackName } from '@/types/stack-name';

const D1_SCRIPTS = ['db:generate', 'db:migrate', 'db:migrate:local', 'db:migrate:remote', 'local-setup'];

function makeContext(repo: TemplateContext['repo'], stacks: StackName[], orm?: 'drizzle'): TemplateContext {
  return {
    projectName: 'd1-project',
    repo,
    apps: stacks.map((stackName, index) => ({ appName: index === 0 ? 'web' : `app${index}`, stackName, libraries: [] })),
    project: { database: 'd1', orm, deployment: 'cloudflare', tooling: [] },
    git: false,
    pm: 'bun',
  };
}

const COMBINATIONS: [string, TemplateContext['repo'], StackName[]][] = [
  ['single repo, Next.js', 'single', ['nextjs']],
  ['single repo, TanStack Start', 'single', ['tanstack-start']],
  ['single repo, Hono', 'single', ['hono']],
  ['turborepo, two Next.js apps', 'turborepo', ['nextjs', 'nextjs']],
  ['turborepo, Hono and Next.js', 'turborepo', ['hono', 'nextjs']],
];

describe.each(COMBINATIONS)('D1 without an ORM: %s', (_, repo, stacks) => {
  const manifests = generateAllPackageJsons(makeContext(repo, stacks));

  test('no package.json, root script or app script is a Drizzle or Wrangler migration script', () => {
    const context = makeContext(repo, stacks);
    const defined = [
      ...manifests.flatMap(({ content }) => Object.keys(content.scripts ?? {})),
      ...Object.keys(getRootScripts(context)),
      ...getAppScripts(context).flatMap(({ scripts }) => Object.keys(scripts)),
    ];
    expect(defined.filter((script) => D1_SCRIPTS.includes(script))).toEqual([]);
  });

  test('no package.json mentions Drizzle or declares the libSQL client', () => {
    const text = JSON.stringify(manifests.map(({ content }) => content));
    expect(text).not.toMatch(/drizzle/i);
    expect(text).not.toContain('@libsql/client');
  });
});

describe.each(COMBINATIONS)('D1 with an ORM: %s', (_, repo, stacks) => {
  test('the migration scripts and the libSQL client are still generated', () => {
    const manifests = generateAllPackageJsons(makeContext(repo, stacks, 'drizzle'));
    const scripts = manifests.flatMap(({ content }) => Object.keys(content.scripts ?? {}));
    for (const script of D1_SCRIPTS) expect(scripts).toContain(script);
    expect(JSON.stringify(manifests.map(({ content }) => content))).toContain('@libsql/client');
  });
});
