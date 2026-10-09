import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import type { TemplateContext } from '@/types/ctx';

const SKIP_FRONTMATTER = '---\ndeploymentSkip:\n  - cloudflare\n---\nbody\n';

function moveFrontmatter(target: string, extra = ''): string {
  return `---\n${extra}deploymentPath:\n  cloudflare: ${target}\n---\nbody\n`;
}

const FIXTURE_FILES: Record<string, string> = {
  'repo/single/repo-skip.txt.hbs': SKIP_FRONTMATTER,
  'repo/single/repo-moved.txt.hbs': moveFrontmatter('cf/repo-moved.txt'),
  'repo/single/repo-plain.txt.hbs': 'body\n',
  'repo/turborepo/repo-skip.txt.hbs': SKIP_FRONTMATTER,
  'repo/turborepo/repo-moved.txt.hbs': moveFrontmatter('cf/repo-moved.txt'),
  'libraries/shadcn/lib-skip.txt.hbs': SKIP_FRONTMATTER,
  'libraries/shadcn/lib-moved.txt.hbs': moveFrontmatter('cf/lib-moved.txt'),
  'libraries/shadcn/lib-pinned.txt.hbs': moveFrontmatter('cf/lib-pinned.txt', 'path: pinned/lib-pinned.txt\n'),
  'libraries/shadcn/lib-plain.txt.hbs': 'body\n',
  'libraries/shadcn/lib-skip-nextjs.txt.nextjs.hbs': SKIP_FRONTMATTER,
  'project/orm/drizzle/orm-skip.txt.hbs': SKIP_FRONTMATTER,
  'project/orm/drizzle/orm-moved.txt.hbs': moveFrontmatter('cf/orm-moved.txt'),
  'project/linter/biome/linter-stack-skip.txt.nextjs.hbs': SKIP_FRONTMATTER,
  'project/linter/biome/linter-stack-moved.txt.nextjs.hbs': moveFrontmatter('cf/linter-stack-moved.txt'),
  'blueprints/fixture-blueprint/bp-skip.txt.hbs': SKIP_FRONTMATTER,
  'blueprints/fixture-blueprint/bp-moved.txt.hbs': moveFrontmatter('cf/bp-moved.txt'),
  'blueprints/fixture-blueprint/bp-stack-skip.txt.nextjs.hbs': SKIP_FRONTMATTER,
};

let templatesDir: string;

beforeAll(() => {
  templatesDir = mkdtempSync(join(tmpdir(), 'cf-deployment-operators-'));
  for (const [relative, content] of Object.entries(FIXTURE_FILES)) {
    const file = join(templatesDir, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
});

afterAll(() => {
  rmSync(templatesDir, { recursive: true, force: true });
});

function makeCtx(repo: TemplateContext['repo'], deployment?: string): TemplateContext {
  return {
    projectName: 'proj',
    repo,
    apps: [{ appName: repo === 'single' ? 'proj' : 'web', stackName: 'nextjs', libraries: ['shadcn'] }],
    project: { orm: 'drizzle', linter: 'biome', deployment, tooling: [] },
    git: false,
    blueprint: 'fixture-blueprint',
  };
}

const destinationsOf = (ctx: TemplateContext) =>
  getAllTemplatesForContext(ctx, templatesDir).map((t) => t.destination);

describe('deploymentSkip applies to every template kind', () => {
  const skipped = ['repo-skip', 'lib-skip', 'lib-skip-nextjs', 'orm-skip', 'linter-stack-skip', 'bp-skip', 'bp-stack-skip'];

  test.each(['single', 'turborepo'] as const)('skipped under the matching deployment (%s)', (repo) => {
    const destinations = destinationsOf(makeCtx(repo, 'cloudflare'));
    for (const name of skipped) {
      expect(destinations.filter((d) => d.endsWith(`${name}.txt`))).toEqual([]);
    }
  });

  test.each(['single', 'turborepo'] as const)('generated without a deployment (%s)', (repo) => {
    const destinations = destinationsOf(makeCtx(repo));
    for (const name of skipped) {
      expect(destinations.filter((d) => d.endsWith(`${name}.txt`))).toHaveLength(1);
    }
  });

  test('generated under a different deployment', () => {
    const destinations = destinationsOf(makeCtx('single', 'terraform-aws'));
    for (const name of skipped) {
      expect(destinations.filter((d) => d.endsWith(`${name}.txt`))).toHaveLength(1);
    }
  });

  test('templates without deploymentSkip are unaffected', () => {
    const destinations = destinationsOf(makeCtx('single', 'cloudflare'));
    expect(destinations).toContain('repo-plain.txt');
    expect(destinations).toContain('lib-plain.txt');
  });
});

describe('deploymentPath applies to every template kind', () => {
  test('single repo: path replaced under the matching deployment, default otherwise', () => {
    const cloudflare = destinationsOf(makeCtx('single', 'cloudflare'));
    const none = destinationsOf(makeCtx('single'));

    for (const [name, moved] of [
      ['repo-moved', 'cf/repo-moved.txt'],
      ['lib-moved', 'cf/lib-moved.txt'],
      ['orm-moved', 'cf/orm-moved.txt'],
      ['linter-stack-moved', 'cf/linter-stack-moved.txt'],
      ['bp-moved', 'cf/bp-moved.txt'],
    ] as const) {
      expect(cloudflare).toContain(moved);
      expect(cloudflare).not.toContain(`${name}.txt`);
      expect(none).toContain(`${name}.txt`);
      expect(none).not.toContain(moved);
    }
  });

  test('turborepo: the overridden path keeps the scope of each kind', () => {
    const cloudflare = destinationsOf(makeCtx('turborepo', 'cloudflare'));
    const none = destinationsOf(makeCtx('turborepo'));

    expect(cloudflare).toContain('cf/repo-moved.txt');
    expect(cloudflare).toContain('packages/ui/cf/lib-moved.txt');
    expect(cloudflare).toContain('packages/db/cf/orm-moved.txt');
    expect(cloudflare).toContain('apps/web/cf/linter-stack-moved.txt');
    expect(cloudflare).toContain('apps/web/cf/bp-moved.txt');

    expect(none).toContain('repo-moved.txt');
    expect(none).toContain('packages/ui/lib-moved.txt');
    expect(none).toContain('packages/db/orm-moved.txt');
    expect(none).toContain('apps/web/linter-stack-moved.txt');
    expect(none).toContain('apps/web/bp-moved.txt');
  });

  test('deploymentPath wins over frontmatter path', () => {
    expect(destinationsOf(makeCtx('single', 'cloudflare'))).toContain('cf/lib-pinned.txt');
    expect(destinationsOf(makeCtx('single'))).toContain('pinned/lib-pinned.txt');
  });

  test('other deployments keep the default path', () => {
    const destinations = destinationsOf(makeCtx('single', 'terraform-aws'));
    expect(destinations).toContain('lib-moved.txt');
    expect(destinations).not.toContain('cf/lib-moved.txt');
  });
});
