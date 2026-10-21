import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import type { MetaBlueprint } from '@/types/meta';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const DELETES_AND_REFUSES =
  '`--reset` makes it delete all %s first (accounts you created yourself included); it refuses a database that does not look local unless `--force` is passed.';
const DELETES_LOCALLY =
  '`--reset` makes it delete all %s first (accounts you created yourself included); the seed only touches the local database.';
const KEEPS_EXISTING_ACCOUNTS = 'which creates the demo accounts that are missing and keeps the ones that exist.';
const FLAGS = '`--fixtures` adds demo data and `--help` prints the usage.';

const SENTENCES: Record<string, string[]> = {
  'org-dashboard-nextjs': [
    KEEPS_EXISTING_ACCOUNTS,
    DELETES_AND_REFUSES.replace('%s', 'contacts, posts and users'),
    FLAGS,
  ],
  'org-dashboard-tanstack-start': [
    KEEPS_EXISTING_ACCOUNTS,
    DELETES_AND_REFUSES.replace('%s', 'contacts, posts and users'),
    FLAGS,
  ],
  'multitenant-saas-nextjs': [
    KEEPS_EXISTING_ACCOUNTS,
    DELETES_AND_REFUSES.replace('%s', 'invitations, projects, members, organizations and users'),
    FLAGS,
  ],
  'cloudflare-fullstack-nextjs': [
    KEEPS_EXISTING_ACCOUNTS,
    DELETES_LOCALLY.replace('%s', 'documents and users'),
    FLAGS,
  ],
  'dapp-privy-nextjs': [
    'which deletes all users before it inserts its sample rows: an account you created yourself is lost, so run it on a development database only.',
  ],
  'cloudflare-payload-nextjs': [
    'which adds the sample pages, posts, media and site settings that are missing and deletes nothing: what you changed in the admin stays, and running it again adds nothing.',
  ],
};

// A blueprint whose guide on the data is not `data-layer.md`.
const DATA_GUIDES: Record<string, string> = { 'cloudflare-payload-nextjs': 'docs/agents/payload.md' };
// The seed of a blueprint is `scripts/seed.ts` unless its META says where it is.
const seedScriptOf = (name: string) => (META.blueprints[name] as MetaBlueprint).seed?.file ?? 'scripts/seed.ts';

const SEEDING_BLUEPRINTS = Object.entries(META.blueprints)
  .filter(([, blueprint]) => 'seed' in blueprint)
  .map(([name]) => name);

const sectionOf = (document: string, heading: string): string =>
  document.split(`\n${heading}\n`)[1]?.split('\n## ')[0] ?? '';

let dir: string;

beforeAll(async () => {
  dir = await createTempDir();
  for (const name of SEEDING_BLUEPRINTS) {
    for (const [suffix, flags] of [
      ['', []],
      ['-no-agent-context', ['--no-agent-context']],
    ] as const) {
      const result = await runCli([`${name}${suffix}`, '--blueprint', name, '--no-git', '--no-install', '--pm', 'bun', ...flags], dir);
      expect(result.exitCode, `${name}${suffix}: ${result.stderr}`).toBe(0);
    }
  }
});

afterAll(async () => {
  await cleanupTempDir(dir);
});

describe('the blueprints that declare a seed', () => {
  test('are the ones this suite knows the sentence of', () => {
    expect(SEEDING_BLUEPRINTS.sort()).toEqual(Object.keys(SENTENCES).sort());
  });

  test.each(SEEDING_BLUEPRINTS)('%s: the README Seeding section states what the seed does', async (name) => {
    const readme = await readTextFile(join(dir, name, 'README.md'));
    const seeding = sectionOf(readme, '## Seeding');

    expect(seeding).toContain(`\`bun run db:seed\` runs \`${seedScriptOf(name)}\``);
    for (const sentence of SENTENCES[name] ?? []) expect(seeding).toContain(sentence);
    expect(seeding).not.toContain('always, or only with');
  });

  test.each(SEEDING_BLUEPRINTS)('%s: without agent context the README says the same', async (name) => {
    const project = join(dir, `${name}-no-agent-context`);
    expect(await fileExists(join(project, 'AGENTS.md'))).toBe(false);

    const withContext = sectionOf(await readTextFile(join(dir, name, 'README.md')), '## Seeding');
    const without = sectionOf(await readTextFile(join(project, 'README.md')), '## Seeding');
    expect(without).toBe(withContext);
  });

  test.each(SEEDING_BLUEPRINTS)('%s: the guide of the blueprint says the same as the README', async (name) => {
    const guide = await readTextFile(join(dir, name, DATA_GUIDES[name] ?? 'docs/agents/data-layer.md'));
    const section = guide.includes('\n## Seeding\n') ? sectionOf(guide, '## Seeding') : sectionOf(guide, '## Seed');

    for (const sentence of SENTENCES[name] ?? []) expect(section).toContain(sentence);
  });

  test.each(SEEDING_BLUEPRINTS)('%s: the README says what local-setup does, from its META sentence', async (name) => {
    const seeding = sectionOf(await readTextFile(join(dir, name, 'README.md')), '## Seeding');
    const hasLocalSetup = await fileExists(join(dir, name, 'scripts/local-setup.ts'));

    expect(seeding.includes('`bun run local-setup`: Set up the local database and seed it; it can delete the local data.')).toBe(
      hasLocalSetup,
    );
    expect(seeding).not.toContain('so the same applies');
  });

  test.each(SEEDING_BLUEPRINTS)('%s: the data in META describes the seed script', async (name) => {
    const source = await readTextFile(join(dir, name, seedScriptOf(name)));
    const seed = (META.blueprints[name] as MetaBlueprint).seed;
    if (!seed) throw new Error(`${name} declares no seed`);

    const hasFlag = (flag: string) => new RegExp(`${flag}: \\{ type: 'boolean'`).test(source);
    const withReset = seed.deletes === 'with-reset';
    expect(hasFlag('reset')).toBe(withReset);
    expect(hasFlag('fixtures')).toBe(withReset);
    expect(source.includes('help: { type')).toBe(withReset);

    const refusesRemote = withReset && seed.target === 'refuses-remote-without-force';
    expect(hasFlag('force')).toBe(refusesRemote);
    expect(source.includes('Refusing to --reset')).toBe(refusesRemote);

    const opensLocalFile = source.includes('.wrangler/v3/d1/miniflare-D1DatabaseObject');
    expect(opensLocalFile).toBe(withReset && seed.target === 'local-only');
    expect(source.includes('isLocalDatabase')).toBe(refusesRemote);

    // A seed that never deletes has no delete statement, and `rows` names what it adds.
    const deletedRows = [...source.matchAll(/db\.delete\((\w+)\)/g)].map(([, table]) => `${table?.replace(/Table$/, '')}s`);
    if (seed.deletes === 'never') {
      expect(source).not.toMatch(/\.delete(?:Many)?\(|\bdelete\w*\(/);
      expect(deletedRows).toEqual([]);
    } else {
      expect([...seed.rows].sort()).toEqual(deletedRows.sort());
    }
  });
});
