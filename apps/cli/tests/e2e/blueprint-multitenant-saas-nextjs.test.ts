import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { describeWithDocker } from './docker-database';
import { cleanupTempDir, generateInstalledProject, type RunningServer, runCommand } from './helpers';
import { buildAndStartWeb, callTrpc, describeFailure, post, signIn } from './org-dashboard';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_SETUP = 240_000;
const TIMEOUT_BUILD = 300_000;
const TIMEOUT_SERVER = 120_000;

const BLUEPRINT = 'multitenant-saas-nextjs';
const SEED_PASSWORD = 'password';
const OWNER = 'owner@example.com';
const SEEDED_MEMBER = 'member@example.com';
const NEWCOMER_PASSWORD = 'newcomer-password';

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

const titles = (groups: SearchGroup[], type: string): string[] =>
  groups.find((group) => group.type === type)?.items.map((item) => item.title) ?? [];

describeWithDocker(`${BLUEPRINT} palette search e2e`)(`${BLUEPRINT}: records of the active organization, on the production server and Postgres`, () => {
  let projectDir: string;
  let server: RunningServer;
  let ownerInAcme: string;
  let ownerInBeta: string;
  let betaId: string;
  let nextIp = 20;

  const ip = (): string => `10.4.0.${nextIp++}`;

  // The tRPC endpoint speaks superjson: a query is a GET with its input in the URL, wrapped as superjson wraps it.
  const search = async (cookie: string, query: string): Promise<SearchGroup[]> => {
    const input = encodeURIComponent(JSON.stringify({ json: { query } }));
    const response = await fetch(new URL(`/api/trpc/search.records?input=${input}`, server.url), { headers: { cookie } });
    expect(response.status, `${query}: ${await response.clone().text()}`).toBe(200);
    const body = (await response.json()) as { result: { data: { json: SearchGroup[] } } };
    return body.result.data.json;
  };

  const status = async (cookie: string, procedure: string): Promise<number> =>
    (await fetch(new URL(`/api/trpc/${procedure}`, server.url), { headers: { cookie } })).status;

  const createProject = async (cookie: string, name: string): Promise<void> => {
    const created = await callTrpc(server, 'project.create', cookie, { name, description: null });
    expect([name, created.status]).toEqual([name, 200]);
  };

  // Signs a person up, invites them to the organization their inviter works in with the role, accepts, and returns the
  // cookie of a session that works in that organization.
  const joinAs = async (email: string, role: string, inviterCookie: string, organizationId: string): Promise<string> => {
    const signUp = await post(server, '/api/auth/sign-up/email', { email, password: NEWCOMER_PASSWORD, name: email.split('@')[0] }, { 'x-forwarded-for': ip() });
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    const cookie = await signIn(server, email, ip(), NEWCOMER_PASSWORD);

    const invited = await callTrpc<{ id: string }>(server, 'invitation.create', inviterCookie, { email, role });
    expect([email, invited.status]).toEqual([email, 200]);
    const accepted = await post(server, '/api/auth/organization/accept-invitation', { invitationId: invited.data.id }, { cookie });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const active = await post(server, '/api/auth/organization/set-active', { organizationId }, { cookie });
    expect(active.status, await active.clone().text()).toBe(200);
    return cookie;
  };

  beforeAll(async () => {
    projectDir = await generateInstalledProject('bp-multitenant-palette', ['--blueprint', BLUEPRINT]);
    const setup = await runCommand(['bun', 'run', 'local-setup'], projectDir);
    expect(setup.exitCode, describeFailure(setup)).toBe(0);
    server = await buildAndStartWeb(projectDir);

    // Two organizations that one account owns, each in a session of its own: Acme is the seeded one, Beta is new.
    ownerInAcme = await signIn(server, OWNER, ip());
    const owned = await signIn(server, OWNER, ip());
    const beta = await post(server, '/api/auth/organization/create', { name: 'Beta Works', slug: 'beta-works' }, { cookie: owned });
    expect(beta.status, await beta.clone().text()).toBe(200);
    betaId = ((await beta.json()) as { id: string }).id;
    ownerInBeta = owned;
    const switched = await post(server, '/api/auth/organization/set-active', { organizationId: betaId }, { cookie: ownerInBeta });
    expect(switched.status, await switched.clone().text()).toBe(200);

    await createProject(ownerInAcme, 'Orchid Rollout');
    await createProject(ownerInAcme, 'Quartz Audit');
    await createProject(ownerInBeta, 'Orchid Migration');
    await createProject(ownerInBeta, 'Zebra Pilot');
  }, TIMEOUT_INSTALL + TIMEOUT_SETUP + TIMEOUT_BUILD + TIMEOUT_SERVER);

  afterAll(async () => {
    await server?.stop();
    if (projectDir) {
      await runCommand(['docker', 'compose', 'down', '--volumes'], projectDir);
      await cleanupTempDir(join(projectDir, '..'));
    }
  });

  test('a signed-in owner finds the projects and the members of the active organization, with the page that opens each', async () => {
    const projects = await search(ownerInAcme, 'orchid');
    expect(projects.map((group) => [group.type, group.label])).toEqual([['projects', 'Projects']]);
    const [found] = projects[0]?.items ?? [];
    expect(found).toMatchObject({ title: 'Orchid Rollout', subtitle: 'active' });
    expect(found?.href).toBe(`/projects/${found?.id}`);

    const members = await search(ownerInAcme, 'member demo');
    const [member] = members.find((group) => group.type === 'members')?.items ?? [];
    expect(member).toMatchObject({ title: 'Member Demo', subtitle: SEEDED_MEMBER, href: '/settings/members' });

    const page = await fetch(new URL(found?.href ?? '/', server.url), { headers: { cookie: ownerInAcme } });
    expect(page.status).toBe(200);
  });

  test('the two organizations of one account never mix: each session finds only what belongs to its active one', async () => {
    expect(titles(await search(ownerInAcme, 'orchid'), 'projects')).toEqual(['Orchid Rollout']);
    expect(titles(await search(ownerInBeta, 'orchid'), 'projects')).toEqual(['Orchid Migration']);

    expect(await search(ownerInAcme, 'zebra')).toEqual([]);
    expect(titles(await search(ownerInBeta, 'zebra'), 'projects')).toEqual(['Zebra Pilot']);
    expect(await search(ownerInBeta, 'quartz')).toEqual([]);
    expect(titles(await search(ownerInAcme, 'quartz'), 'projects')).toEqual(['Quartz Audit']);

    expect(titles(await search(ownerInAcme, 'member demo'), 'members')).toEqual(['Member Demo']);
    expect(await search(ownerInBeta, 'member demo')).toEqual([]);
  });

  test('switching the active organization of a session switches the results', async () => {
    const traveller = await signIn(server, OWNER, ip());
    expect(titles(await search(traveller, 'orchid'), 'projects')).toEqual(['Orchid Rollout']);

    const toBeta = await post(server, '/api/auth/organization/set-active', { organizationId: betaId }, { cookie: traveller });
    expect(toBeta.status, await toBeta.clone().text()).toBe(200);
    expect(titles(await search(traveller, 'orchid'), 'projects')).toEqual(['Orchid Migration']);
    expect(await search(traveller, 'quartz')).toEqual([]);
  });

  test('a member of one organization finds nothing of the other, although the text matches', async () => {
    const member = await signIn(server, SEEDED_MEMBER, ip());
    expect(titles(await search(member, 'orchid'), 'projects')).toEqual(['Orchid Rollout']);
    expect(await search(member, 'zebra')).toEqual([]);
    expect(await search(member, 'orchid migration')).toEqual([]);
  });

  test('a member who reads projects finds them and the members, as the lists answer them', async () => {
    const reader = await joinAs('reader@example.com', 'member', ownerInBeta, betaId);
    expect(titles(await search(reader, 'zebra'), 'projects')).toEqual(['Zebra Pilot']);
    expect(titles(await search(reader, 'reader'), 'members')).toEqual(['reader']);
    expect(await status(reader, 'project.list')).toBe(200);
  });

  test('a role without the permission to read projects gets no group of projects, and the project list refuses it too', async () => {
    const role = await callTrpc(server, 'role.create', ownerInBeta, { role: 'finance', permission: { organization: ['update'] } });
    expect(role.status).toBe(200);
    const finance = await joinAs('finance@example.com', 'finance', ownerInBeta, betaId);

    expect(await status(finance, 'project.list')).toBe(403);
    const groups = await search(finance, 'zebra');
    expect(groups.map((group) => group.type)).not.toContain('projects');
    expect(titles(await search(finance, 'reader'), 'members')).toEqual(['reader']);
  });

  test('a person who left the organization their session names finds nothing', async () => {
    const leaver = await joinAs('leaver@example.com', 'member', ownerInBeta, betaId);
    expect(titles(await search(leaver, 'zebra'), 'projects')).toEqual(['Zebra Pilot']);

    const members = await fetch(new URL('/api/trpc/member.list', server.url), { headers: { cookie: ownerInBeta } });
    const { result } = (await members.json()) as { result: { data: { json: { id: string; user: { email: string } }[] } } };
    const row = result.data.json.find((member) => member.user.email === 'leaver@example.com');
    const removed = await callTrpc(server, 'member.remove', ownerInBeta, { memberId: row?.id });
    expect(removed.status).toBe(200);

    expect(await search(leaver, 'zebra')).toEqual([]);
    expect(await search(leaver, 'reader')).toEqual([]);
  });

  test('a request without a session is refused, and a text under two characters returns nothing', async () => {
    const anonymous = await fetch(new URL(`/api/trpc/search.records?input=${encodeURIComponent(JSON.stringify({ json: { query: 'orchid' } }))}`, server.url));
    expect(anonymous.status).toBe(401);
    expect(await search(ownerInAcme, 'o')).toEqual([]);
    expect(await search(ownerInAcme, '  ')).toEqual([]);
  });

  test('the server logs no error', async () => {
    const { stdout, stderr } = await server.stop();
    expect(`${stdout}\n${stderr}`).not.toMatch(/Error|⨯/);
  });
});
