import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  cleanupTempDir,
  createTempDir,
  elementsOf,
  evaluateGeneratedModule,
  REACT_ELEMENT_STUB,
  type RenderedChild,
  readTextFile,
  renderElementTree,
  runCli,
  textOf,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINT = 'multitenant-saas-nextjs';
const WEB = 'apps/web/src';

// The actions the organization plugin of better-auth checks on its own resources, read from
// `dist/plugins/organization/access/statement.mjs` and the `hasPermission` calls of `routes/*.mjs` (1.7.x): a role
// that lacks one of them cannot call the matching endpoint, whatever the tRPC gate says.
const BETTER_AUTH_ACTIONS: Record<string, string[]> = {
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  ac: ['create', 'read', 'update', 'delete'],
};

type Statement = Record<string, readonly string[]>;
interface Permissions {
  statement: Statement;
  owner: Statement;
  admin: Statement;
  member: Statement;
}

const ACCESS_STUB = `export const createAccessControl = (statement) => ({ statement, newRole: (grants) => grants });`;

const roleCan = (grants: Statement, resource: string, action: string): boolean => grants[resource]?.includes(action) ?? false;

describe(`${BLUEPRINT} permissions`, () => {
  let tempDir: string;
  let project: string;
  let permissions: Permissions;
  let gates: { resource: string; action: string; file: string }[];

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    project = join(tempDir, BLUEPRINT);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'access.mjs'), ACCESS_STUB);
    permissions = await evaluateGeneratedModule<Permissions>(
      await readTextFile(join(project, 'packages/auth/src/permissions.ts')),
      join(stubs, 'permissions.mjs'),
      { 'better-auth/plugins/access': join(stubs, 'access.mjs') },
    );

    const routers = join(project, 'packages/api/src/router');
    gates = [];
    for (const file of await readdir(routers)) {
      const source = await readTextFile(join(routers, file));
      for (const match of source.matchAll(/permissionProcedure\('(\w+)',\s*'(\w+)'\)/g)) {
        gates.push({ resource: match[1] ?? '', action: match[2] ?? '', file });
      }
    }
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the statement uses the action names better-auth checks', () => {
    for (const [resource, actions] of Object.entries(BETTER_AUTH_ACTIONS)) {
      expect(permissions.statement[resource], resource).toEqual(actions);
    }
  });

  test('every permission a router gates is declared and granted to a role', () => {
    expect(gates.length).toBeGreaterThan(0);
    for (const { resource, action, file } of gates) {
      expect(permissions.statement[resource], `${file}: ${resource}.${action}`).toContain(action);
      const holders = [permissions.owner, permissions.admin].filter((grants) => roleCan(grants, resource, action));
      expect(holders.length, `${file}: ${resource}.${action}`).toBeGreaterThan(0);
    }
  });

  test('no role is granted an action the statement does not declare', () => {
    for (const grants of [permissions.owner, permissions.admin, permissions.member]) {
      for (const [resource, actions] of Object.entries(grants)) {
        for (const action of actions) expect(permissions.statement[resource], `${resource}.${action}`).toContain(action);
      }
    }
  });

  test('an owner and an admin can remove a member, and a member cannot', async () => {
    const removal = (await readTextFile(join(project, 'packages/api/src/router/member.ts'))).match(
      /remove:\s*permissionProcedure\('(\w+)',\s*'(\w+)'\)/,
    );
    const [resource, action] = [removal?.[1] ?? '', removal?.[2] ?? ''];
    expect(roleCan(permissions.owner, resource, action)).toBe(true);
    expect(roleCan(permissions.admin, resource, action)).toBe(true);
    expect(roleCan(permissions.member, resource, action)).toBe(false);
  });

  test('the sidebar links ask for declared permissions', async () => {
    const stubs = join(tempDir, 'stubs');
    await Bun.write(join(stubs, 'icons.mjs'), 'export const DashboardSquare01Icon = 1, FolderLibraryIcon = 1, Settings02Icon = 1, UserGroupIcon = 1, UserIcon = 1;');
    const constants = await evaluateGeneratedModule<{ ROUTES: { permission?: { resource: string; action: string } }[] }>(
      await readTextFile(join(project, WEB, 'lib/constants.ts')),
      join(stubs, 'constants.mjs'),
      { '@hugeicons/core-free-icons': join(stubs, 'icons.mjs') },
    );
    const asked = constants.ROUTES.flatMap((route) => (route.permission ? [route.permission] : []));
    expect(asked.length).toBeGreaterThan(0);
    for (const { resource, action } of asked) expect(permissions.statement[resource], `${resource}.${action}`).toContain(action);
  });
});

describe(`${BLUEPRINT} query client`, () => {
  let tempDir: string;
  let retry: (failureCount: number, error: unknown) => boolean;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(
      join(stubs, 'query.mjs'),
      `export const defaultShouldDehydrateQuery = () => false;
export class QueryClient { constructor(options) { this.options = options; } }`,
    );
    await Bun.write(join(stubs, 'superjson.mjs'), 'export default { serialize: (value) => value, deserialize: (value) => value };');
    const module = await evaluateGeneratedModule<{ makeQueryClient: () => { options: { defaultOptions: { queries: { retry: typeof retry } } } } }>(
      await readTextFile(join(tempDir, BLUEPRINT, WEB, 'trpc/query-client.ts')),
      join(stubs, 'query-client.mjs'),
      { '@tanstack/react-query': join(stubs, 'query.mjs'), superjson: join(stubs, 'superjson.mjs') },
    );
    retry = module.makeQueryClient().options.defaultOptions.queries.retry;
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const refused = (httpStatus: number) => ({ data: { httpStatus } });

  test('a refused query is not retried', () => {
    expect(retry(0, refused(403))).toBe(false);
    expect(retry(0, refused(404))).toBe(false);
    expect(retry(0, refused(401))).toBe(false);
  });

  test('a failing server or network is retried a few times', () => {
    expect(retry(0, refused(500))).toBe(true);
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(retry(3, refused(500))).toBe(false);
  });
});

// Stand-ins for what the generated pages and components import. A UI component becomes the host element it renders
// (a table cell for TableCell, a button for Button), a dialog shows its trigger and, when `open`, its content.
const HOST_TAGS: Record<string, string> = {
  Button: 'button',
  Input: 'input',
  Label: 'label',
  Select: 'select',
  Table: 'table',
  TableBody: 'tbody',
  TableCell: 'td',
  TableHead: 'th',
  TableHeader: 'thead',
  TableRow: 'tr',
  Card: 'section',
  CardTitle: 'h2',
};

const REACT_STUB = `${REACT_ELEMENT_STUB}
let slots = [];
let next = 0;
export const resetState = () => { slots = []; next = 0; };
export const useState = (initial) => {
  const index = next++;
  if (!(index in slots)) slots[index] = initial;
  return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
};
export const useRef = (current) => ({ current });
export const useEffect = () => {};
export const useMemo = (factory) => factory();
export const useCallback = (callback) => callback;`;

const QUERY_STUB = `const procedures = (path) => new Proxy(function () {}, {
  get: (_, key) => (key === 'then' ? undefined : key === 'queryOptions' ? () => ({ procedure: path.join('.') }) : procedures([...path, key])),
  apply: () => ({}),
});
export const useTRPC = () => procedures([]);
export const useQuery = (options) => ({ data: globalThis.__data?.[options.procedure], isLoading: false });
export const useMutation = () => ({ mutate() {}, isPending: false });
export const useQueryClient = () => ({ invalidateQueries() {} });`;

const PERMISSION_STUB = `export const usePermission = (permissions) => {
  globalThis.__asked.push(permissions);
  const allowed = Object.entries(permissions).every(([resource, actions]) => actions.every((action) => globalThis.__granted.has(resource + '.' + action)));
  return { allowed, loading: false };
};`;

const FORM_STUB = `import { createElement } from './react.mjs';
const field = (tag) => ({ label }) => createElement(tag, { 'aria-label': label });
export const useAppForm = () => ({
  AppField: ({ children }) => children[0]({ InputField: field('input'), SelectField: field('select') }),
  AppForm: ({ children }) => children,
  SubmitButton: ({ children }) => createElement('button', { type: 'submit' }, ...children),
  handleSubmit() {},
  reset() {},
  setFieldValue() {},
});`;

const DEEP_STUB = `const deep = () => new Proxy(function () {}, { get: (_, key) => (key === 'then' ? undefined : deep()), apply: () => deep() });
export const z = deep();`;

const EXPLICIT: Record<string, string> = {
  react: REACT_STUB,
  '@tanstack/react-query': QUERY_STUB,
  '@/trpc/providers': QUERY_STUB,
  '@/hooks/use-permission': PERMISSION_STUB,
  '@repo/ui/lib/form': FORM_STUB,
  zod: DEEP_STUB,
  sonner: 'export const toast = { success() {}, error() {} };',
  '@/lib/get-app-url': "export const getAppUrl = () => 'http://localhost:3000';",
  'next/navigation': 'export const useRouter = () => ({ push() {}, refresh() {} });',
  'next/link': 'export default ({ href, children, ...props }) => ({ type: "a", props: { href, ...props, children } });',
  '@repo/auth/auth-client': `export const useActiveOrganization = () => ({ data: { id: 'org1', name: 'Acme', slug: 'acme' }, refetch() {} });
export const useListOrganizations = () => ({ data: globalThis.__organizations ?? [] });
export const authClient = { organization: { setActive: async () => ({}), create: async () => ({}) } };`,
};

const DIALOG_STUB = `import { createElement } from './react.mjs';
export const DialogTrigger = ({ asChild, children, ...props }) => (asChild ? children[0] : createElement('button', props, ...children));
export const Dialog = ({ open, children }) => children.flat().filter((child) => child?.type === DialogTrigger || open === true);
const host = (tag) => ({ children, ...props }) => createElement(tag, props, ...children);
export const DialogContent = host('div');
export const DialogHeader = host('div');
export const DialogFooter = host('div');
export const DialogTitle = host('h2');
export const DialogDescription = host('p');`;

function hostStub(names: string[], react: string): string {
  const lines = names.map((name) => {
    const tag = HOST_TAGS[name] ?? 'div';
    return `export const ${name} = ({ asChild, children, ...props }) => (asChild && children[0] ? children[0] : createElement('${tag}', { 'data-component': '${name}', ...props }, ...children));`;
  });
  return `import { createElement } from '${react}';\n${lines.join('\n')}`;
}

function namedImports(source: string): { specifier: string; names: string[] }[] {
  return [...source.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)].map((match) => ({
    specifier: match[2] ?? '',
    names: (match[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name && !name.startsWith('type ')),
  }));
}

/**
 * Writes a stand-in module for every import of `sources` and returns the specifier-to-path map for
 * `evaluateGeneratedModule`: the explicit stand-ins above, the dialog, and a host element per UI component.
 */
async function writeStubs(stubs: string, sources: string[], skip: string[] = []): Promise<Record<string, string>> {
  const reactPath = join(stubs, 'react.mjs');
  await Bun.write(reactPath, REACT_STUB);
  const imports: Record<string, string> = { react: reactPath };
  let index = 0;
  const write = async (specifier: string, body: string) => {
    const path = join(stubs, `stub-${index++}.mjs`);
    await Bun.write(path, body.replace("from './react.mjs'", `from '${reactPath}'`));
    imports[specifier] = path;
  };

  for (const [specifier, body] of Object.entries(EXPLICIT)) if (specifier !== 'react') await write(specifier, body);

  const names = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const { specifier, names: imported } of namedImports(source)) {
      const known = names.get(specifier) ?? new Set<string>();
      for (const name of imported) known.add(name);
      names.set(specifier, known);
    }
  }
  for (const [specifier, imported] of names) {
    if (imports[specifier] || skip.includes(specifier)) continue;
    await write(specifier, specifier.endsWith('/dialog') ? DIALOG_STUB : hostStub([...imported], reactPath));
  }
  return imports;
}

interface Component {
  (props: Record<string, unknown>): unknown;
}
type Globals = { __granted?: Set<string>; __asked?: Record<string, string[]>[]; __data?: Record<string, unknown>; __organizations?: unknown[] };
const globals = globalThis as Globals;

const OWNER_ROLE = 'owner';

describe(`${BLUEPRINT} write actions`, () => {
  let tempDir: string;
  let permissions: Permissions;
  let resetState: () => void;
  const components = new Map<string, Component>();

  const COMPONENTS = {
    projectCreate: { file: 'components/projects/project-create-dialog.tsx', name: 'ProjectCreateDialog' },
    projectDetail: { file: 'app/(dashboard)/projects/[id]/project.client.tsx', name: 'ProjectDetailClient' },
    members: { file: 'components/members/members-table.tsx', name: 'MembersTable' },
    invite: { file: 'components/members/invite-dialog.tsx', name: 'InviteDialog' },
    invitations: { file: 'components/members/pending-invitations-table.tsx', name: 'PendingInvitationsTable' },
    roles: { file: 'components/roles/roles-table.tsx', name: 'RolesTable' },
    general: { file: 'app/(dashboard)/settings/general/page.tsx', name: 'default' },
  } as const;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const project = join(tempDir, BLUEPRINT);
    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });

    await Bun.write(join(stubs, 'access.mjs'), ACCESS_STUB);
    permissions = await evaluateGeneratedModule<Permissions>(
      await readTextFile(join(project, 'packages/auth/src/permissions.ts')),
      join(stubs, 'permissions.mjs'),
      { 'better-auth/plugins/access': join(stubs, 'access.mjs') },
    );

    const sources = new Map<string, string>();
    for (const { file } of Object.values(COMPONENTS)) sources.set(file, await readTextFile(join(project, WEB, file)));
    sources.set('components/can.tsx', await readTextFile(join(project, WEB, 'components/can.tsx')));

    const imports = await writeStubs(stubs, [...sources.values()], ['@/components/can']);
    resetState = (await import(join(stubs, 'react.mjs'))).resetState;

    const can = await evaluateGeneratedModule<Record<string, Component>>(
      sources.get('components/can.tsx') ?? '',
      join(stubs, 'can.mjs'),
      imports,
      'tsx',
    );
    imports['@/components/can'] = join(stubs, 'can.mjs');
    expect(can.Can).toBeDefined();

    for (const [key, { file, name }] of Object.entries(COMPONENTS)) {
      const module = await evaluateGeneratedModule<Record<string, Component>>(
        sources.get(file) ?? '',
        join(stubs, `${key}.mjs`),
        imports,
        'tsx',
      );
      components.set(key, module[name] as Component);
    }
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const DATA = {
    'project.get': { id: 'p1', name: 'Roadmap', description: null, status: 'active' },
    'member.list': [{ id: 'm1', userId: 'u1', role: 'member', user: { email: 'jo@example.com' } }],
    'role.list': [{ roleName: 'auditor', permission: { project: ['read'] } }],
    'invitation.list': [{ id: 'i1', email: 'new@example.com', role: 'member', status: 'pending' }],
  };

  async function render(role: 'owner' | 'admin' | 'member', key: keyof typeof COMPONENTS): Promise<RenderedChild[]> {
    const grants = permissions[role];
    globals.__granted = new Set(Object.entries(grants).flatMap(([resource, actions]) => actions.map((action) => `${resource}.${action}`)));
    globals.__asked = [];
    globals.__data = DATA;
    resetState();
    const component = components.get(key) as Component;
    return renderElementTree(await component({ id: 'p1' }));
  }

  const buttonsOf = (tree: RenderedChild[]): string[] =>
    elementsOf(tree)
      .filter((element) => element.tag === 'button')
      .map((element) => textOf(element).trim());

  const WRITE_ACTIONS: { key: keyof typeof COMPONENTS; label: string; deniedTo: ('owner' | 'admin' | 'member')[] }[] = [
    { key: 'projectCreate', label: 'New project', deniedTo: ['member'] },
    { key: 'projectDetail', label: 'Edit', deniedTo: ['member'] },
    { key: 'projectDetail', label: 'Delete', deniedTo: ['member'] },
    { key: 'general', label: 'Save', deniedTo: ['member'] },
    { key: 'general', label: 'Delete organization', deniedTo: ['admin', 'member'] },
    { key: 'invite', label: 'Invite member', deniedTo: ['member'] },
    { key: 'members', label: 'Remove', deniedTo: ['member'] },
    { key: 'invitations', label: 'Cancel', deniedTo: ['member'] },
    { key: 'roles', label: 'Create role', deniedTo: ['member'] },
    { key: 'roles', label: 'Edit', deniedTo: ['member'] },
    { key: 'roles', label: 'Delete', deniedTo: ['member'] },
  ];

  describe.each(WRITE_ACTIONS)('$label ($key)', ({ key, label, deniedTo }) => {
    test.each(['owner', 'admin', 'member'] as const)('%s', async (role) => {
      const buttons = buttonsOf(await render(role, key));
      if (deniedTo.includes(role)) expect(buttons).not.toContain(label);
      else expect(buttons).toContain(label);
    });
  });

  test('a read-only member cannot change a member role', async () => {
    const tree = await render('member', 'members');
    const selects = elementsOf(tree).filter((element) => element.tag === 'select');
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) expect(select.props.disabled).toBe(true);
  });

  test('an admin can change a member role', async () => {
    const tree = await render('admin', 'members');
    const selects = elementsOf(tree).filter((element) => element.tag === 'select');
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) expect(select.props.disabled).toBeFalsy();
  });

  test('the components ask for permissions the statement declares', async () => {
    for (const key of Object.keys(COMPONENTS) as (keyof typeof COMPONENTS)[]) {
      await render(OWNER_ROLE, key);
      for (const asked of globals.__asked ?? []) {
        for (const [resource, actions] of Object.entries(asked)) {
          for (const action of actions) expect(permissions.statement[resource], `${key}: ${resource}.${action}`).toContain(action);
        }
      }
    }
  });
});

describe(`${BLUEPRINT} pages`, () => {
  let tempDir: string;
  let project: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    project = join(tempDir, BLUEPRINT);
    await mkdir(join(tempDir, 'stubs'), { recursive: true });
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('an unknown project id answers not found at once', async () => {
    const stubs = join(tempDir, 'stubs');
    const calls: string[] = [];
    (globalThis as { __calls?: string[] }).__calls = calls;
    await Bun.write(join(stubs, 'react.mjs'), REACT_ELEMENT_STUB);
    await Bun.write(
      join(stubs, 'navigation.mjs'),
      "export const notFound = () => { globalThis.__calls.push('notFound'); throw new Error('NEXT_NOT_FOUND'); };",
    );
    await Bun.write(
      join(stubs, 'session.mjs'),
      "export const requireSession = async () => { globalThis.__calls.push('requireSession'); return {}; };",
    );
    await Bun.write(
      join(stubs, 'trpc-client.mjs'),
      'export class TRPCClientError extends Error { constructor(message, data) { super(message); this.data = data; } }',
    );
    await Bun.write(
      join(stubs, 'trpc-server.mjs'),
      `import { TRPCClientError } from './trpc-client.mjs';
export const trpc = { project: { get: { queryOptions: ({ id }) => ({ id }) } } };
export const getQueryClient = () => ({
  fetchQuery: async ({ id }) => {
    globalThis.__calls.push('fetchQuery');
    if (id === 'missing') throw new TRPCClientError('NOT_FOUND', { code: 'NOT_FOUND', httpStatus: 404 });
    if (id === 'broken') throw new TRPCClientError('Internal server error', { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 });
    return { id };
  },
});
export const HydrateClient = ({ children }) => children;`,
    );
    await Bun.write(join(stubs, 'client.mjs'), 'export const ProjectDetailClient = () => null;');

    const page = await evaluateGeneratedModule<{ default: (props: { params: Promise<{ id: string }> }) => Promise<unknown> }>(
      await readTextFile(join(project, WEB, 'app/(dashboard)/projects/[id]/page.tsx')),
      join(stubs, 'project-page.mjs'),
      {
        react: join(stubs, 'react.mjs'),
        'next/navigation': join(stubs, 'navigation.mjs'),
        '@/lib/auth/session': join(stubs, 'session.mjs'),
        '@/trpc/server': join(stubs, 'trpc-server.mjs'),
        '@trpc/client': join(stubs, 'trpc-client.mjs'),
        './project.client': join(stubs, 'client.mjs'),
      },
      'tsx',
    );

    await expect(page.default({ params: Promise.resolve({ id: 'missing' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(calls).toEqual(['requireSession', 'fetchQuery', 'notFound']);

    await expect(page.default({ params: Promise.resolve({ id: 'broken' }) })).rejects.toThrow('Internal server error');

    calls.length = 0;
    const found = await renderElementTree(await page.default({ params: Promise.resolve({ id: 'p1' }) }));
    expect(calls).toEqual(['requireSession', 'fetchQuery']);
    expect(found).toEqual([]);
  });

  test('a user without an active organization can reach the organizations they belong to', async () => {
    const stubs = join(tempDir, 'onboarding-stubs');
    await mkdir(stubs, { recursive: true });
    const source = await readTextFile(join(project, WEB, 'app/(onboarding)/onboarding/page.tsx'));
    const imports = await writeStubs(stubs, [source]);
    const page = await evaluateGeneratedModule<{ default: Component }>(source, join(stubs, 'onboarding.mjs'), imports, 'tsx');
    globals.__organizations = [
      { id: 'org1', name: 'Acme', slug: 'acme' },
      { id: 'org2', name: 'Globex', slug: 'globex' },
    ];
    const tree = await renderElementTree(await page.default({}));
    const labels = elementsOf(tree)
      .filter((element) => element.tag === 'button')
      .map((element) => textOf(element));
    expect(labels.join('|')).toContain('Acme');
    expect(labels.join('|')).toContain('Globex');

    globals.__organizations = [];
    const empty = await renderElementTree(await page.default({}));
    expect(elementsOf(empty).filter((element) => element.tag === 'button').map((element) => textOf(element)).join('|')).not.toContain('Acme');
  });
});

describe(`${BLUEPRINT} confirmations`, () => {
  let tempDir: string;
  let sources: { file: string; source: string }[];

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const root = join(tempDir, BLUEPRINT, WEB);
    const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith('.tsx'));
    sources = await Promise.all(files.map(async (file) => ({ file, source: await readTextFile(join(root, file)) })));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('no component asks for confirmation with the browser dialog', () => {
    const native = sources.filter(({ source }) => /(^|[^\w.])(window\.)?confirm\(/m.test(source)).map(({ file }) => file);
    expect(native).toEqual([]);
  });
});
