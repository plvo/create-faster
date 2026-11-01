import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';
import type { PgTable } from 'drizzle-orm/pg-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  cleanupTempDir,
  createPostgresTable,
  createTempDir,
  evaluateGeneratedModule,
  readTextFile,
  runCli,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINT = 'multitenant-saas-nextjs';
const API = 'packages/api/src';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct-horse-battery';
const SECRET = 'integration-secret-integration-secret-0123';

interface SearchItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

interface SearchGroup {
  type: string;
  label: string;
  items: SearchItem[];
}

interface Caller {
  search: { records: (input: { query: string }) => Promise<SearchGroup[]> };
  project: { list: () => Promise<unknown[]> };
  member: { list: () => Promise<unknown[]> };
}

interface LoggedQuery {
  query: string;
}

interface AuthApi {
  signUpEmail: (input: { body: Record<string, string>; returnHeaders: true }) => Promise<{ headers: Headers; response: { user: { id: string } } }>;
  getSession: (input: { headers: Headers }) => Promise<unknown>;
  createOrganization: (input: { body: Record<string, string>; headers: Headers }) => Promise<{ id: string }>;
  setActiveOrganization: (input: { body: { organizationId: string | null }; headers: Headers }) => Promise<unknown>;
  addMember: (input: { body: { userId: string; organizationId: string; role: string } }) => Promise<{ id: string }>;
  removeMember: (input: { body: { memberIdOrEmail: string; organizationId: string }; headers: Headers }) => Promise<unknown>;
  createOrgRole: (input: { body: Record<string, unknown>; headers: Headers }) => Promise<unknown>;
}

const REAL = {
  trpcServer: Bun.resolveSync('@trpc/server', import.meta.dir),
  zod: Bun.resolveSync('zod', import.meta.dir),
  drizzle: Bun.resolveSync('drizzle-orm', import.meta.dir),
  pgCore: Bun.resolveSync('drizzle-orm/pg-core', import.meta.dir),
  betterAuth: Bun.resolveSync('better-auth', import.meta.dir),
  betterAuthApi: Bun.resolveSync('better-auth/api', import.meta.dir),
  betterAuthPlugins: Bun.resolveSync('better-auth/plugins', import.meta.dir),
  access: Bun.resolveSync('better-auth/plugins/access', import.meta.dir),
  adminAccess: Bun.resolveSync('better-auth/plugins/admin/access', import.meta.dir),
  organizationAccess: Bun.resolveSync('better-auth/plugins/organization/access', import.meta.dir),
  drizzleAdapter: Bun.resolveSync('@better-auth/drizzle-adapter', import.meta.dir),
};

const STUBS: Record<string, string> = {
  // A real tRPC instance whose protected procedure is the generated one: no session, no answer.
  'trpc.mjs': `import { initTRPC, TRPCError } from '${REAL.trpcServer}';
import { trpcErrorFromAuthError } from './auth-errors.mjs';
const t = initTRPC.context().create();
const mapAuthErrors = t.middleware(async (opts) => {
  const result = await opts.next();
  if (!result.ok) {
    const mapped = trpcErrorFromAuthError(result.error.cause);
    if (mapped) throw mapped;
  }
  return result;
});
export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const protectedProcedure = t.procedure.use(mapAuthErrors).use(async (opts) => {
  if (!opts.ctx.session?.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return opts.next({ ctx: { ...opts.ctx, session: opts.ctx.session, user: opts.ctx.session.user } });
});`,
  // The database of the project: Drizzle over the real Postgres engine (PGlite) the test hands it.
  'db.mjs': `export * from '${REAL.drizzle}';
export * from './schema.mjs';
export const db = globalThis.__searchTestDb;`,
  'link-delivery.mjs': 'export async function deliverLink() {}',
};

const must = <T,>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`${what} is not there`);
  return value;
};

const titles = (group: SearchGroup | undefined): string[] => group?.items.map((item) => item.title) ?? [];
const groupNamed = (groups: SearchGroup[], type: string): SearchGroup | undefined =>
  groups.find((group) => group.type === type);

describe(`${BLUEPRINT} palette search`, () => {
  let tempDir: string;
  let postgres: PGlite;
  let api: AuthApi;
  let createCaller: (context: () => Promise<unknown>) => Caller;
  const queries: LoggedQuery[] = [];

  const cookies = new Map<string, string>();
  const ids = { acme: '', beta: '' };
  const memberIds = new Map<string, string>();
  const savedEnv = { url: process.env.BETTER_AUTH_URL, secret: process.env.BETTER_AUTH_SECRET };

  const headersOf = (name: string): Headers => new Headers({ cookie: must(cookies.get(name), `the session of ${name}`) });

  const callerOf = (name: string): Caller =>
    createCaller(async () => ({ session: await api.getSession({ headers: headersOf(name) }), headers: headersOf(name), db: globalThis.__searchTestDb }));

  const readingTable = (table: string): LoggedQuery[] => queries.filter(({ query }) => new RegExp(`\\bfrom "${table}"`, 'i').test(query));
  const searching = async (name: string, query: string): Promise<SearchGroup[]> => {
    queries.length = 0;
    return callerOf(name).search.records({ query });
  };

  const signUp = async (name: string, label: string): Promise<string> => {
    const { headers, response } = await api.signUpEmail({
      body: { email: `${name}@example.com`, password: PASSWORD, name: label },
      returnHeaders: true,
    });
    cookies.set(name, headers.getSetCookie().map((cookie) => must(cookie.split(';')[0], 'a cookie')).join('; '));
    return response.user.id;
  };

  const enrol = async (name: string, organizationId: string, role: string, activate = true): Promise<void> => {
    const userId = await userIdOf(name);
    const member = await api.addMember({ body: { userId, organizationId, role } });
    memberIds.set(`${name}:${organizationId}`, member.id);
    if (activate) await api.setActiveOrganization({ body: { organizationId }, headers: headersOf(name) });
  };

  const userIdOf = async (name: string): Promise<string> =>
    must((await postgres.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [`${name}@example.com`])).rows[0], name).id;

  const addProject = async (organizationId: string, name: string, description: string | null, createdAt: number): Promise<string> => {
    const id = `p-${name.toLowerCase().replace(/\W+/g, '-')}`;
    await postgres.query(
      'INSERT INTO project (id, organization_id, name, description, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)',
      [id, organizationId, name, description, 'active', new Date(1_700_000_000_000 + createdAt * 1000)],
    );
    return id;
  };

  const projectIds = new Map<string, string>();

  beforeAll(async () => {
    process.env.BETTER_AUTH_URL = ORIGIN;
    process.env.BETTER_AUTH_SECRET = SECRET;
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const project = join(tempDir, BLUEPRINT);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [file, source] of Object.entries(STUBS)) await Bun.write(join(stubs, file), source);

    const generated = async <T,>(file: string, name: string, imports: Record<string, string>): Promise<T> =>
      evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports);

    const schema = await generated<Record<string, PgTable>>('packages/db/src/schema.ts', 'schema.mjs', {
      'drizzle-orm': REAL.drizzle,
      'drizzle-orm/pg-core': REAL.pgCore,
    });
    postgres = new PGlite();
    for (const table of [
      'userTable',
      'userSessionTable',
      'userAccountTable',
      'userVerificationTable',
      'organizationTable',
      'memberTable',
      'invitationTable',
      'organizationRoleTable',
      'project',
    ]) {
      await createPostgresTable(postgres, must(schema[table], table));
    }
    globalThis.__searchTestDb = drizzle(postgres, {
      schema,
      logger: { logQuery: (query) => queries.push({ query }) },
    });

    // The generated auth, on the real better-auth and the real tables: what answers `hasPermission` and
    // `getActiveMember` is better-auth reading the members and roles of the database, as in a running project.
    await generated('packages/auth/src/permissions.ts', 'permissions.mjs', {
      'better-auth/plugins/access': REAL.access,
      'better-auth/plugins/organization/access': REAL.organizationAccess,
    });
    await generated('packages/auth/src/invitation-link.ts', 'invitation-link.mjs', {});
    await generated('packages/auth/src/email-change-guard.ts', 'email-change-guard.mjs', {
      'better-auth/api': REAL.betterAuthApi,
      './link-delivery': './link-delivery.mjs',
    });
    const { createAuth } = await generated<{ createAuth: () => { api: AuthApi } }>('packages/auth/src/auth.ts', 'create-auth.mjs', {
      '@repo/db': './db.mjs',
      '@better-auth/drizzle-adapter': REAL.drizzleAdapter,
      'better-auth': REAL.betterAuth,
      'better-auth/plugins': REAL.betterAuthPlugins,
      './email-change-guard': './email-change-guard.mjs',
      './invitation-link': './invitation-link.mjs',
      './link-delivery': './link-delivery.mjs',
      './permissions': './permissions.mjs',
    });
    await Bun.write(join(stubs, 'auth.mjs'), `import { createAuth } from './create-auth.mjs';\nexport const auth = createAuth();`);
    api = ((await import(join(stubs, 'auth.mjs'))) as { auth: { api: AuthApi } }).auth.api;

    await generated(`${API}/auth-errors.ts`, 'auth-errors.mjs', { '@trpc/server': REAL.trpcServer });
    await generated(`${API}/search-query.ts`, 'search-query.mjs', { zod: REAL.zod });
    await generated(`${API}/search-engine.ts`, 'search-engine.mjs', { './search-query': './search-query.mjs' });
    await generated(`${API}/text-match.ts`, 'text-match.mjs', { '@repo/db': './db.mjs' });
    await generated(`${API}/middleware/rbac.ts`, 'rbac.mjs', {
      '@trpc/server': REAL.trpcServer,
      '../auth': './auth.mjs',
      '../trpc': './trpc.mjs',
    });
    await generated(`${API}/search.ts`, 'search.mjs', {
      '@repo/db': './db.mjs',
      'better-auth/api': REAL.betterAuthApi,
      '../auth': './auth.mjs',
      './middleware/rbac': './rbac.mjs',
      './search-engine': './search-engine.mjs',
      './text-match': './text-match.mjs',
    });
    const { searchRouter } = await generated<{ searchRouter: unknown }>(`${API}/router/search.ts`, 'search-router.mjs', {
      '../trpc': './trpc.mjs',
      '../search-query': './search-query.mjs',
      '../search': './search.mjs',
    });
    const { projectRouter } = await generated<{ projectRouter: unknown }>(`${API}/router/project.ts`, 'project-router.mjs', {
      '@repo/db': './db.mjs',
      '@repo/db/schema': './schema.mjs',
      '@trpc/server': REAL.trpcServer,
      'drizzle-orm': REAL.drizzle,
      zod: REAL.zod,
      '../trpc': './trpc.mjs',
      '../middleware/rbac': './rbac.mjs',
    });
    const { memberRouter } = await generated<{ memberRouter: unknown }>(`${API}/router/member.ts`, 'member-router.mjs', {
      zod: REAL.zod,
      '../auth': './auth.mjs',
      '../trpc': './trpc.mjs',
      '../middleware/rbac': './rbac.mjs',
    });
    const trpc = (await import(join(stubs, 'trpc.mjs'))) as {
      router: (procedures: Record<string, unknown>) => unknown;
      createCallerFactory: (router: unknown) => (context: () => Promise<unknown>) => Caller;
    };
    createCaller = trpc.createCallerFactory(trpc.router({ search: searchRouter, project: projectRouter, member: memberRouter }));

    // Two organizations. Acme: Ada owns it, Cleo reads, Dan holds a role that reads no project. Beta: Ben owns it, Zora
    // reads. Iris belongs to both. Eve was removed from Acme while her session still names it.
    for (const [name, label] of [
      ['ada', 'Ada Archer'],
      ['ben', 'Ben Brook'],
      ['cleo', 'Cleo Cole'],
      ['dan', 'Dan Dube'],
      ['iris', 'Iris Ito'],
      ['eve', 'Eve Ellis'],
      ['fay', 'Fay Fox'],
      ['zora', 'Zora Zane'],
    ] as const) {
      await signUp(name, label);
    }
    const acme = await api.createOrganization({ body: { name: 'Acme', slug: 'acme' }, headers: headersOf('ada') });
    const beta = await api.createOrganization({ body: { name: 'Beta', slug: 'beta' }, headers: headersOf('ben') });
    ids.acme = acme.id;
    ids.beta = beta.id;

    await api.createOrgRole({
      body: { role: 'finance', permission: { organization: ['update'] }, organizationId: ids.acme },
      headers: headersOf('ada'),
    });
    await enrol('cleo', ids.acme, 'member');
    await enrol('dan', ids.acme, 'finance');
    await enrol('iris', ids.acme, 'member');
    await enrol('iris', ids.beta, 'member', false);
    await enrol('zora', ids.beta, 'member');
    await enrol('eve', ids.acme, 'member');
    await api.removeMember({ body: { memberIdOrEmail: must(memberIds.get(`eve:${ids.acme}`), 'the member row of Eve'), organizationId: ids.acme }, headers: headersOf('ada') });

    let tick = 0;
    for (const [organization, name, description] of [
      [ids.acme, 'Orchid rollout', 'Spring launch'],
      [ids.acme, 'Quartz audit', null],
      [ids.acme, '100% done', null],
      [ids.acme, 'A_B sync', null],
      [ids.acme, 'AXB sync', null],
      [ids.beta, 'Orchid migration', null],
      [ids.beta, 'Zebra pilot', null],
    ] as const) {
      projectIds.set(name, await addProject(organization, name, description, tick++));
    }
  });

  afterAll(async () => {
    for (const [name, value] of [
      ['BETTER_AUTH_URL', savedEnv.url],
      ['BETTER_AUTH_SECRET', savedEnv.secret],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await postgres.close();
    await cleanupTempDir(tempDir);
  });

  describe('what is searched', () => {
    test('an owner finds the projects and the members of the active organization, each with the page that opens it', async () => {
      const groups = await searching('ada', 'orchid');
      expect(groups.map((group) => [group.type, group.label])).toEqual([['projects', 'Projects']]);
      expect(must(groupNamed(groups, 'projects'), 'the group').items).toEqual([
        { id: must(projectIds.get('Orchid rollout'), 'the project'), title: 'Orchid rollout', subtitle: 'Spring launch', href: `/projects/${projectIds.get('Orchid rollout')}` },
      ]);

      const members = await searching('ada', 'cleo');
      expect(must(groupNamed(members, 'members'), 'the group')).toEqual({
        type: 'members',
        label: 'Members',
        items: [
          {
            id: must(memberIds.get(`cleo:${ids.acme}`), 'the member row'),
            title: 'Cleo Cole',
            subtitle: 'cleo@example.com',
            href: '/settings/members',
          },
        ],
      });
    });

    test('a project shows its status when it has no description, and is found by its description', async () => {
      const groups = await searching('ada', 'quartz');
      expect(must(groupNamed(groups, 'projects'), 'the group').items.map((item) => item.subtitle)).toEqual(['active']);
      expect(titles(groupNamed(await searching('ada', 'spring'), 'projects'))).toEqual(['Orchid rollout']);
    });

    test('a member is found by name or by email, whatever the case', async () => {
      expect(titles(groupNamed(await searching('ada', 'IRIS'), 'members'))).toEqual(['Iris Ito']);
      expect(titles(groupNamed(await searching('ada', 'dan@EXAMPLE'), 'members'))).toEqual(['Dan Dube']);
    });

    test('a group with no match is left out, and a search matching nothing returns no group', async () => {
      expect((await searching('ada', 'quartz')).map((group) => group.type)).toEqual(['projects']);
      expect(await searching('ada', 'nothing like this')).toEqual([]);
    });
  });

  describe('only the active organization', () => {
    test('the projects and the members of another organization never show', async () => {
      expect(await searching('ada', 'zebra')).toEqual([]);
      expect(await searching('ada', 'zora')).toEqual([]);
      expect(await searching('ada', 'ben')).toEqual([]);
      expect(titles(groupNamed(await searching('ben', 'orchid'), 'projects'))).toEqual(['Orchid migration']);
      expect(await searching('ben', 'quartz')).toEqual([]);
      expect(await searching('ben', 'cleo')).toEqual([]);
    });

    test('a user of two organizations finds what belongs to the one that is active, and the answer follows a switch', async () => {
      const find = async () => groupNamed(await searching('iris', 'orchid'), 'projects')?.items.map((item) => item.title);
      expect(await find()).toEqual(['Orchid rollout']);

      await api.setActiveOrganization({ body: { organizationId: ids.beta }, headers: headersOf('iris') });
      expect(await find()).toEqual(['Orchid migration']);
      expect(await searching('iris', 'quartz')).toEqual([]);

      await api.setActiveOrganization({ body: { organizationId: ids.acme }, headers: headersOf('iris') });
      expect(await find()).toEqual(['Orchid rollout']);
    });

    test('a member of two organizations is one member of the active one', async () => {
      const members = must(groupNamed(await searching('ada', 'iris'), 'members'), 'the group');
      expect(members.items.map((item) => item.id)).toEqual([must(memberIds.get(`iris:${ids.acme}`), 'the member row')]);
    });

    test('a user who was removed from the organization their session names finds nothing and reads no table', async () => {
      expect(await searching('eve', 'orchid')).toEqual([]);
      expect(readingTable('project')).toEqual([]);
      expect(await searching('eve', 'cleo')).toEqual([]);
      expect(queries.filter(({ query }) => /from "members" inner join "users"/i.test(query))).toEqual([]);
    });

    test('a user with no active organization finds nothing and reads no table', async () => {
      expect(await searching('fay', 'orchid')).toEqual([]);
      expect(await searching('fay', 'ada')).toEqual([]);
      expect(readingTable('project')).toEqual([]);
    });
  });

  describe('permissions', () => {
    test('a member who reads projects finds projects and members', async () => {
      expect((await searching('cleo', 'orchid')).map((group) => group.type)).toEqual(['projects']);
      expect((await searching('cleo', 'ada')).map((group) => group.type)).toEqual(['members']);
    });

    test('a role without project.read gets no group of projects and no query reads the project table', async () => {
      expect(await searching('dan', 'orchid')).toEqual([]);
      expect(readingTable('project')).toEqual([]);
      expect(groupNamed(await searching('dan', 'cleo'), 'members')).toBeDefined();
    });

    // The search asks what the lists ask: a caller gets a group of a type exactly when that list answers them.
    test.each(['ada', 'cleo', 'dan', 'eve', 'fay'])('%s finds projects exactly when the list of projects answers', async (name) => {
      const lists = async (list: () => Promise<unknown[]>): Promise<boolean> => {
        try {
          await list();
          return true;
        } catch {
          return false;
        }
      };
      const found = groupNamed(await searching(name, 'orchid'), 'projects') !== undefined;
      expect(found, 'projects').toBe(await lists(() => callerOf(name).project.list()));
      const foundMembers = groupNamed(await searching(name, 'ada'), 'members') !== undefined;
      expect(foundMembers, 'members').toBe(await lists(() => callerOf(name).member.list()));
    });

    test('a caller with no session gets no answer', async () => {
      const anonymous = createCaller(async () => ({ session: null, headers: new Headers(), db: globalThis.__searchTestDb }));
      await expect(anonymous.search.records({ query: 'orchid' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });

  describe('the minimum length', () => {
    test.each(['', 'a', ' a ', '  '])('"%s" asks the database nothing and returns no group', async (query) => {
      expect(await searching('ada', query)).toEqual([]);
      expect(readingTable('project')).toEqual([]);
    });

    test('two characters search, and blanks around them do not count', async () => {
      expect(titles(groupNamed(await searching('ada', '  qu  '), 'projects'))).toEqual(['Quartz audit']);
    });
  });

  describe('plain text', () => {
    test('a % matches itself and not any text', async () => {
      expect(titles(groupNamed(await searching('ada', '0%'), 'projects'))).toEqual(['100% done']);
      expect(await searching('ada', '%%')).toEqual([]);
    });

    test('a _ matches itself and not any one character', async () => {
      expect(titles(groupNamed(await searching('ada', 'a_b'), 'projects'))).toEqual(['A_B sync']);
      expect(await searching('ada', '__')).toEqual([]);
    });
  });

  describe('the limit per type', () => {
    test('each type returns at most five items, the newest project first and the members by name', async () => {
      for (let index = 1; index <= 7; index++) await addProject(ids.acme, `Batch ${index}`, null, 100 + index);
      const groups = await searching('ada', 'batch');
      expect(titles(groupNamed(groups, 'projects'))).toEqual(['Batch 7', 'Batch 6', 'Batch 5', 'Batch 4', 'Batch 3']);

      const people = await searching('ada', 'example.com');
      expect(titles(groupNamed(people, 'members'))).toEqual(['Ada Archer', 'Cleo Cole', 'Dan Dube', 'Iris Ito']);
    });
  });
});

declare global {
  // The database the generated modules read, set by the test before they load.
  var __searchTestDb: ReturnType<typeof drizzle>;
}
