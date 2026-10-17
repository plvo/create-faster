import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultStatements } from 'better-auth/plugins/organization/access';
import {
  cleanupTempDir,
  createTempDir,
  elementsOf,
  evaluateGeneratedModule,
  REACT_ELEMENT_STUB,
  REACT_STATE_STUB,
  type RenderedChild,
  type RenderedElement,
  readTextFile,
  renderElementTree,
  runCli,
  textOf,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINT = 'multitenant-saas-nextjs';
const WEB = 'apps/web/src';

type Statement = Record<string, readonly string[]>;
interface BetterAuthRole {
  authorize: (request: Record<string, string[]>) => { success: boolean };
  statements: Statement;
}
interface Permissions {
  statement: Statement;
  owner: BetterAuthRole;
  admin: BetterAuthRole;
  member: BetterAuthRole;
}

// The generated permissions run on better-auth itself: its access-control module builds the roles and answers
// `authorize`, and its organization plugin supplies the statements the module starts from.
const REAL = {
  access: Bun.resolveSync('better-auth/plugins/access', import.meta.dir),
  organizationAccess: Bun.resolveSync('better-auth/plugins/organization/access', import.meta.dir),
};

let tempDir: string;
let project: string;
let permissions: Permissions;

beforeAll(async () => {
  tempDir = await createTempDir();
  const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
  expect(result.exitCode, result.stderr).toBe(0);
  project = join(tempDir, BLUEPRINT);

  const stubs = join(tempDir, 'stubs');
  await mkdir(stubs, { recursive: true });
  permissions = await evaluateGeneratedModule<Permissions>(
    await readTextFile(join(project, 'packages/auth/src/permissions.ts')),
    join(stubs, 'permissions.mjs'),
    { 'better-auth/plugins/access': REAL.access, 'better-auth/plugins/organization/access': REAL.organizationAccess },
  );
});

afterAll(async () => {
  await cleanupTempDir(tempDir);
});

const isAuthorized = (role: BetterAuthRole, resource: string, action: string): boolean =>
  role.authorize({ [resource]: [action] }).success;

describe(`${BLUEPRINT} permissions`, () => {
  let gates: { resource: string; action: string; file: string }[];

  beforeAll(async () => {
    const routers = join(project, 'packages/api/src/router');
    gates = [];
    for (const file of await readdir(routers)) {
      const source = await readTextFile(join(routers, file));
      for (const match of source.matchAll(/permissionProcedure\('(\w+)',\s*'(\w+)'\)/g)) {
        gates.push({ resource: match[1] ?? '', action: match[2] ?? '', file });
      }
    }
  });

  test('the statement declares every action of the organization plugin, and the project actions', () => {
    const { team: _team, ...organization } = defaultStatements;
    expect(permissions.statement).toEqual({ ...organization, project: ['create', 'read', 'update', 'delete'] });
  });

  test('every permission a router gates is declared and held by the owner', () => {
    expect(gates.length).toBeGreaterThan(0);
    for (const { resource, action, file } of gates) {
      expect(permissions.statement[resource], `${file}: ${resource}.${action}`).toContain(action);
      expect(isAuthorized(permissions.owner, resource, action), `${file}: ${resource}.${action}`).toBe(true);
    }
  });

  test('no role is granted an action the statement does not declare', () => {
    for (const role of [permissions.owner, permissions.admin, permissions.member]) {
      for (const [resource, actions] of Object.entries(role.statements)) {
        for (const action of actions) expect(permissions.statement[resource], `${resource}.${action}`).toContain(action);
      }
    }
  });

  test('an owner and an admin can remove a member, and a member cannot', async () => {
    const removal = (await readTextFile(join(project, 'packages/api/src/router/member.ts'))).match(
      /remove:\s*permissionProcedure\('(\w+)',\s*'(\w+)'\)/,
    );
    const [resource, action] = [removal?.[1] ?? '', removal?.[2] ?? ''];
    expect(isAuthorized(permissions.owner, resource, action)).toBe(true);
    expect(isAuthorized(permissions.admin, resource, action)).toBe(true);
    expect(isAuthorized(permissions.member, resource, action)).toBe(false);
  });

  test('an admin keeps the organization but cannot delete it', () => {
    expect(isAuthorized(permissions.admin, 'organization', 'update')).toBe(true);
    expect(isAuthorized(permissions.admin, 'organization', 'delete')).toBe(false);
    expect(isAuthorized(permissions.owner, 'organization', 'delete')).toBe(true);
  });

  test('the sidebar links ask for declared permissions', async () => {
    const stubs = join(tempDir, 'stubs');
    await Bun.write(
      join(stubs, 'icons.mjs'),
      'export const DashboardSquare01Icon = 1, FolderLibraryIcon = 1, Settings02Icon = 1, UserGroupIcon = 1, UserIcon = 1;',
    );
    const constants = await evaluateGeneratedModule<{ ROUTES: { permission?: { resource: string; action: string } }[] }>(
      await readTextFile(join(project, WEB, 'lib/constants.ts')),
      join(stubs, 'constants.mjs'),
      { '@hugeicons/core-free-icons': join(stubs, 'icons.mjs') },
    );
    const asked = constants.ROUTES.flatMap((route) => (route.permission ? [route.permission] : []));
    expect(asked.length).toBeGreaterThan(0);
    for (const { resource, action } of asked) {
      expect(permissions.statement[resource], `${resource}.${action}`).toContain(action);
    }
  });
});

// Stand-ins for what the generated pages and components import. A UI component becomes the host element it renders
// (a table cell for TableCell, a button for Button, a div carrying its name and props for anything else), a dialog
// shows its trigger and, when `open`, its content.
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
  Breadcrumb: 'nav',
  BreadcrumbList: 'ol',
  BreadcrumbItem: 'li',
  BreadcrumbPage: 'span',
};

// `trpc.a.b.queryOptions()` and `queryKey()` name the procedure, `mutationOptions(options)` keeps its callbacks. A
// query with a `queryFn` is a permission query: it answers on the next pass, once the test has awaited its function,
// like a query that is still loading.
const QUERY_STUB = `const procedures = (path) => new Proxy(function () {}, {
  get: (_, key) => {
    if (key === 'then') return undefined;
    if (key === 'queryOptions' || key === 'queryKey') return () => ({ procedure: path.join('.') });
    if (key === 'mutationOptions') return (options) => ({ ...options, procedure: path.join('.') });
    return procedures([...path, key]);
  },
  apply: () => ({}),
});
export const useTRPC = () => procedures([]);
export const useQuery = (options) => {
  if (options.queryFn) {
    globalThis.__retries.push(options.retry);
    const key = JSON.stringify(options.queryKey);
    if (globalThis.__permissionCache.has(key)) return { data: globalThis.__permissionCache.get(key), isLoading: false };
    globalThis.__pendingPermissions.set(key, options.queryFn);
    return { data: undefined, isLoading: true };
  }
  return { data: globalThis.__data?.[options.procedure], isLoading: false };
};
export const useMutation = (options) => ({
  mutate: (input) => globalThis.__mutations.push({ procedure: options.procedure, input }),
  isPending: false,
});
export const useQueryClient = () => ({
  invalidateQueries() {},
  getQueryCache: () => ({ subscribe: () => () => {} }),
  getQueryData: (key) => globalThis.__data?.[key.procedure],
});`;

// The permission endpoint of better-auth answers `{ data: { success } }` from the grants of the signed-in role.
const AUTH_CLIENT_STUB = `export const authClient = {
  organization: {
    hasPermission: async ({ permissions }) => {
      globalThis.__asked.push(permissions);
      const success = Object.entries(permissions).every(([resource, actions]) =>
        actions.every((action) => globalThis.__granted.has(resource + '.' + action)));
      return { data: { success } };
    },
    setActive: async () => ({}),
    create: async () => ({}),
  },
};
export const useActiveOrganization = () => ({ data: { id: 'org1', name: 'Acme', slug: 'acme' }, refetch() {} });
export const useListOrganizations = () => ({ data: globalThis.__organizations ?? [] });`;

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

const DIALOG_STUB = `import { createElement } from './react.mjs';
export const DialogTrigger = ({ asChild, children, ...props }) => (asChild ? children[0] : createElement('button', props, ...children));
export const Dialog = ({ open, children }) => children.flat().filter((child) => child?.type === DialogTrigger || open === true);
const host = (tag) => ({ children, ...props }) => createElement(tag, props, ...children);
export const DialogContent = host('div');
export const DialogHeader = host('div');
export const DialogFooter = host('div');
export const DialogTitle = host('h2');
export const DialogDescription = host('p');`;

const DEEP_STUB = `const deep = () => new Proxy(function () {}, { get: (_, key) => (key === 'then' ? undefined : deep()), apply: () => deep() });
export const z = deep();`;

const EXPLICIT: Record<string, string> = {
  '@tanstack/react-query': QUERY_STUB,
  '@/trpc/providers': QUERY_STUB,
  '@repo/auth/auth-client': AUTH_CLIENT_STUB,
  '@repo/ui/lib/form': FORM_STUB,
  zod: DEEP_STUB,
  sonner: 'export const toast = { success() {}, error() {} };',
  '@/lib/get-app-url': "export const getAppUrl = () => 'http://localhost:3000';",
  'next/navigation': 'export const useRouter = () => ({ push() {}, refresh() {} });\nexport const usePathname = () => globalThis.__pathname;',
  'next/link':
    'export default ({ href, children, ...props }) => ({ type: "a", props: { href, ...props, children } });',
};

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

type Component = (props: Record<string, unknown>) => unknown;
interface Globals {
  __granted?: Set<string>;
  __asked?: Record<string, string[]>[];
  __data?: Record<string, unknown>;
  __organizations?: unknown[];
  __mutations?: { procedure: string; input: unknown }[];
  __retries?: unknown[];
  __permissionCache?: Map<string, unknown>;
  __pendingPermissions?: Map<string, () => Promise<unknown>>;
  __pathname?: string;
}
const globals = globalThis as Globals;

/** Components rendered from the generated project, over the stand-ins above and the generated permission hook. */
interface Rendering {
  stubs: string;
  imports: Record<string, string>;
  beginRender: () => void;
  resetState: () => void;
  load: (file: string, name?: string, extraImports?: Record<string, string>) => Promise<Component>;
}

async function createRendering(name: string, sourceFiles: string[]): Promise<Rendering> {
  const stubs = join(tempDir, `${name}-stubs`);
  await mkdir(stubs, { recursive: true });
  const reactPath = join(stubs, 'react.mjs');
  await Bun.write(reactPath, REACT_STATE_STUB);
  const imports: Record<string, string> = { react: reactPath };
  let index = 0;
  const write = async (specifier: string, body: string) => {
    const path = join(stubs, `stub-${index++}.mjs`);
    await Bun.write(path, body.replace("from './react.mjs'", `from '${reactPath}'`));
    imports[specifier] = path;
  };
  for (const [specifier, body] of Object.entries(EXPLICIT)) await write(specifier, body);

  const names = new Map<string, Set<string>>();
  for (const file of sourceFiles) {
    for (const { specifier, names: imported } of namedImports(await readTextFile(join(project, WEB, file)))) {
      const known = names.get(specifier) ?? new Set<string>();
      for (const name of imported) known.add(name);
      names.set(specifier, known);
    }
  }
  const generated = ['@/components/can', '@/hooks/use-permission'];
  for (const [specifier, imported] of names) {
    if (imports[specifier] || generated.includes(specifier)) continue;
    await write(specifier, specifier.endsWith('/dialog') ? DIALOG_STUB : hostStub([...imported], reactPath));
  }

  const load = async (file: string, exportName = 'default', extraImports: Record<string, string> = {}) => {
    const target = join(stubs, `${file.replace(/[^\w]/g, '-')}.mjs`);
    const module = await evaluateGeneratedModule<Record<string, Component>>(
      await readTextFile(join(project, WEB, file)),
      target,
      { ...imports, ...extraImports },
      file.endsWith('.tsx') ? 'tsx' : 'ts',
    );
    return module[exportName] as Component;
  };

  const usePermission = join(stubs, 'use-permission.mjs');
  await Bun.write(usePermission, '');
  await evaluateGeneratedModule(await readTextFile(join(project, WEB, 'hooks/use-permission.ts')), usePermission, imports);
  imports['@/hooks/use-permission'] = usePermission;
  const can = join(stubs, 'can.mjs');
  await evaluateGeneratedModule(await readTextFile(join(project, WEB, 'components/can.tsx')), can, imports, 'tsx');
  imports['@/components/can'] = can;

  const state = await import(reactPath);
  return { stubs, imports, beginRender: state.beginRender, resetState: state.resetState, load };
}

/** Renders until no permission query is pending: each pass answers the queries the previous one started. */
async function settle(rendering: Rendering, component: Component, props: Record<string, unknown> = {}): Promise<RenderedChild[]> {
  for (let pass = 0; pass < 3; pass++) {
    rendering.beginRender();
    const tree = await renderElementTree(await component(props));
    const pending = globals.__pendingPermissions as Map<string, () => Promise<unknown>>;
    if (pending.size === 0) return tree;
    for (const [key, queryFn] of [...pending]) {
      (globals.__permissionCache as Map<string, unknown>).set(key, await queryFn());
      pending.delete(key);
    }
  }
  throw new Error('a permission query is still pending after three passes');
}

function signIn(role: BetterAuthRole): void {
  globals.__granted = new Set(
    Object.entries(role.statements).flatMap(([resource, actions]) => actions.map((action) => `${resource}.${action}`)),
  );
  globals.__asked = [];
  globals.__retries = [];
  globals.__mutations = [];
  globals.__permissionCache = new Map();
  globals.__pendingPermissions = new Map();
}

const buttonsOf = (tree: RenderedChild[]): RenderedElement[] => elementsOf(tree).filter((element) => element.tag === 'button');
const labelsOf = (tree: RenderedChild[]): string[] => buttonsOf(tree).map((button) => textOf(button).trim());
const componentNamed = (tree: RenderedChild[], name: string): RenderedElement | undefined =>
  elementsOf(tree).find((element) => element.props['data-component'] === name);

describe(`${BLUEPRINT} write actions`, () => {
  let rendering: Rendering;
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
  type ComponentKey = keyof typeof COMPONENTS;
  type RoleName = 'owner' | 'admin' | 'member';

  beforeAll(async () => {
    rendering = await createRendering(
      'write-actions',
      Object.values(COMPONENTS).map(({ file }) => file),
    );
    for (const [key, { file, name }] of Object.entries(COMPONENTS)) components.set(key, await rendering.load(file, name));
  });

  const DATA = {
    'project.get': { id: 'p1', name: 'Roadmap', description: null, status: 'active' },
    'member.list': [{ id: 'm1', userId: 'u1', role: 'member', user: { email: 'jo@example.com' } }],
    'role.list': [{ roleName: 'auditor', permission: { project: ['read'] } }],
    'invitation.list': [{ id: 'i1', email: 'new@example.com', role: 'member', status: 'pending' }],
  };

  async function mount(role: RoleName, key: ComponentKey): Promise<RenderedChild[]> {
    signIn(permissions[role]);
    globals.__data = DATA;
    rendering.resetState();
    return settle(rendering, components.get(key) as Component, { id: 'p1' });
  }

  const WRITE_ACTIONS: { key: ComponentKey; label: string; deniedTo: RoleName[] }[] = [
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
      const labels = labelsOf(await mount(role, key));
      if (deniedTo.includes(role)) expect(labels).not.toContain(label);
      else expect(labels).toContain(label);
    });
  });

  test('a read-only member cannot change a member role', async () => {
    const selects = elementsOf(await mount('member', 'members')).filter((element) => element.tag === 'select');
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) expect(select.props.disabled).toBe(true);
  });

  test('an admin can change a member role', async () => {
    const selects = elementsOf(await mount('admin', 'members')).filter((element) => element.tag === 'select');
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) expect(select.props.disabled).toBeFalsy();
  });

  test('removing a member opens the confirmation dialog, and only confirming removes', async () => {
    const tree = await mount('owner', 'members');
    expect(componentNamed(tree, 'ConfirmDialog')?.props.open).toBe(false);

    const remove = buttonsOf(tree).find((button) => textOf(button).trim() === 'Remove');
    (remove?.props.onClick as () => void)();
    const opened = await settle(rendering, components.get('members') as Component);
    const dialog = componentNamed(opened, 'ConfirmDialog');
    expect(dialog?.props.open).toBe(true);
    expect(String(dialog?.props.description)).toContain('jo@example.com');
    expect(globals.__mutations).toEqual([]);

    (dialog?.props.onConfirm as () => void)();
    expect(globals.__mutations).toEqual([{ procedure: 'member.remove', input: { memberId: 'm1' } }]);
  });

  test('the permission queries are asked from the declared statement and never retried', async () => {
    for (const key of Object.keys(COMPONENTS) as ComponentKey[]) {
      await mount('owner', key);
      expect(globals.__asked?.length, key).toBeGreaterThan(0);
      for (const asked of globals.__asked ?? []) {
        for (const [resource, actions] of Object.entries(asked)) {
          for (const action of actions) {
            expect(permissions.statement[resource], `${key}: ${resource}.${action}`).toContain(action);
          }
        }
      }
      expect(globals.__retries?.every((retry) => retry === false), key).toBe(true);
    }
  });
});

describe(`${BLUEPRINT} pages`, () => {
  test('an unknown project id answers not found at once', async () => {
    const stubs = join(tempDir, 'page-stubs');
    await mkdir(stubs, { recursive: true });
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
    const rendering = await createRendering('onboarding', ['app/(onboarding)/onboarding/page.tsx']);
    const page = await rendering.load('app/(onboarding)/onboarding/page.tsx');
    signIn(permissions.member);

    globals.__organizations = [
      { id: 'org1', name: 'Acme', slug: 'acme' },
      { id: 'org2', name: 'Globex', slug: 'globex' },
    ];
    const labels = labelsOf(await settle(rendering, page));
    expect(labels).toEqual(expect.arrayContaining(['Acme', 'Globex']));

    globals.__organizations = [];
    expect(labelsOf(await settle(rendering, page))).toEqual(['Create organization']);
  });
});

describe(`${BLUEPRINT} header`, () => {
  let rendering: Rendering;

  const FILES = [
    'components/navigation/app-header.tsx',
    'components/navigation/app-breadcrumb.tsx',
    'app/(dashboard)/layout.tsx',
  ];

  const breadcrumbAt = async (pathname: string, data: Record<string, unknown> = {}): Promise<RenderedChild[]> => {
    globals.__pathname = pathname;
    globals.__data = data;
    const breadcrumb = await rendering.load('components/navigation/app-breadcrumb.tsx', 'AppBreadcrumb', {
      '@/lib/constants': join(rendering.stubs, 'constants.mjs'),
    });
    return settle(rendering, breadcrumb);
  };

  beforeAll(async () => {
    rendering = await createRendering('header', FILES);
    const stubs = rendering.stubs;
    await Bun.write(join(stubs, 'session.mjs'), 'export const requireSession = async () => ({});');
    await Bun.write(
      join(stubs, 'icons.mjs'),
      'export const DashboardSquare01Icon = 1, FolderLibraryIcon = 1, Settings02Icon = 1, UserGroupIcon = 1, UserIcon = 1;',
    );
    await evaluateGeneratedModule(await readTextFile(join(project, WEB, 'lib/constants.ts')), join(stubs, 'constants.mjs'), {
      '@hugeicons/core-free-icons': join(stubs, 'icons.mjs'),
    });
    signIn(permissions.owner);
  });

  test('the dashboard layout renders the header, which puts the breadcrumb after the sidebar trigger', async () => {
    const header = await rendering.load('components/navigation/app-header.tsx', 'AppHeader');
    const tree = await settle(rendering, header);
    const names = elementsOf(tree).map((element) => element.props['data-component']);
    expect(names.indexOf('SidebarTrigger')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('AppBreadcrumb')).toBeGreaterThan(names.indexOf('SidebarTrigger'));

    const layout = await rendering.load('app/(dashboard)/layout.tsx', 'default', {
      '@/lib/auth/session': join(rendering.stubs, 'session.mjs'),
    });
    const rendered = await renderElementTree(await layout({ children: 'page' }));
    expect(componentNamed(rendered, 'AppHeader')).toBeDefined();
  });

  test('the breadcrumb names a project by its name and a settings page by its title', async () => {
    const project = await breadcrumbAt('/projects/p1', { 'project.get': { name: 'Roadmap' } });
    expect(project.map(textOf).join('|')).toContain('Home');
    const text = elementsOf(project).map((element) => textOf(element));
    expect(text).toEqual(expect.arrayContaining(['Projects', 'Roadmap']));

    const settings = elementsOf(await breadcrumbAt('/settings/members')).map((element) => textOf(element));
    expect(settings).toEqual(expect.arrayContaining(['Settings', 'Members']));
  });
});

describe(`${BLUEPRINT} confirmations`, () => {
  test('no component asks for confirmation with the browser dialog', async () => {
    const root = join(project, WEB);
    const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith('.tsx'));
    const native: string[] = [];
    for (const file of files) {
      if (/(^|[^\w.])(window\.)?confirm\(/m.test(await readTextFile(join(root, file)))) native.push(file);
    }
    expect(native).toEqual([]);
  });
});
