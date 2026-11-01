import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, REACT_ELEMENT_STUB, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const WEB = 'apps/web/src';

// The blueprints that render the permission hook, `<Can>`, the page filter and the sidebar from the shared partials, with
// what each one asks of its caller: its business resource, the links a caller sees, and the links that ask for nothing.
interface Setup {
  blueprint: string;
  router: 'next' | 'tanstack';
  resource: string;
  own: string[];
  everything: string[];
  alwaysShown: string[];
}

const BLUEPRINTS: Setup[] = [
  {
    blueprint: 'cloudflare-fullstack-nextjs',
    router: 'next',
    resource: 'document',
    own: ['Documents'],
    everything: ['Documents', 'Users', 'Roles'],
    alwaysShown: [],
  },
  {
    blueprint: 'org-dashboard-nextjs',
    router: 'next',
    resource: 'contact',
    own: ['Dashboard', 'Contacts'],
    everything: ['Dashboard', 'Contacts', 'Users', 'Roles'],
    alwaysShown: ['Dashboard'],
  },
  {
    blueprint: 'org-dashboard-tanstack-start',
    router: 'tanstack',
    resource: 'contact',
    own: ['Dashboard', 'Contacts'],
    everything: ['Dashboard', 'Contacts', 'Users', 'Roles'],
    alwaysShown: ['Dashboard'],
  },
];

const ICONS = ['FileText', 'LayoutDashboard', 'Shield', 'ShieldCheck', 'Users'];

interface Element {
  type: { name?: string } | string;
  props: { children?: unknown; item?: { title: string } };
}

type Verdict = 'unknown' | 'granted' | 'denied';

interface Permissions {
  ADMIN_PERMISSIONS: readonly string[];
  verdictOf: (granted: readonly string[] | undefined, request: Record<string, string[]>) => Verdict;
}

const globals = globalThis as { __granted?: readonly string[] };

function* descendants(node: unknown): Generator<Element> {
  if (Array.isArray(node)) {
    for (const child of node) yield* descendants(child);
  } else if (node && typeof node === 'object' && 'type' in node) {
    yield node as Element;
    yield* descendants((node as Element).props.children);
  }
}

const textOf = (node: unknown): string =>
  Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'string' ? node : '';

describe.each(BLUEPRINTS)('$blueprint: the client reads the permission list with a three-state verdict', (setup) => {
  const { blueprint, router, resource, own, everything, alwaysShown } = setup;
  let tempDir: string;
  let permissions: Permissions;
  let usePermission: (request: Record<string, string[]>) => Verdict;
  let Can: (props: { permissions: Record<string, string[]>; children: unknown; fallback?: unknown }) => unknown;
  let SidebarLinks: (props: { role: string | null }) => unknown;

  const linksShown = (role: string | null = 'user') =>
    [...descendants(SidebarLinks({ role }))]
      .filter((element) => (element.type as { name?: string }).name === 'RouteItem')
      .map((element) => element.props.item?.title);
  const groupsShown = (role: string | null = 'user') =>
    [...descendants(SidebarLinks({ role }))]
      .filter((element) => (element.type as { name?: string }).name === 'SidebarGroupLabel')
      .map((element) => textOf(element.props.children));

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const project = join(tempDir, blueprint);
    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });

    const stubModules: Record<string, string> = {
      'react.mjs': REACT_ELEMENT_STUB,
      // The list the server resolved: the query cache of the Next.js dashboards, the route context of TanStack Start.
      'react-query.mjs': 'export const useQuery = () => ({ data: globalThis.__granted });',
      'providers.mjs': 'export const useTRPC = () => ({ permissions: { mine: { queryOptions: () => ({}) } } });',
      'router.mjs': `export const useRouteContext = ({ select }) => select({ permissions: globalThis.__granted });
export const useLocation = ({ select }) => select({ pathname: '/' });
export function Link() { return null; }`,
      'icons.mjs': ICONS.map((name) => `export function ${name}() { return null; }`).join('\n'),
      'next-link.mjs': 'export default function Link() { return null; }',
      'next-navigation.mjs': "export const usePathname = () => '/';",
      'sidebar.mjs': ['SidebarGroup', 'SidebarGroupLabel', 'SidebarMenu', 'SidebarMenuButton', 'SidebarMenuItem']
        .map((name) => `export function ${name}() { return null; }`)
        .join('\n'),
    };
    for (const [file, source] of Object.entries(stubModules)) await Bun.write(join(stubs, file), source);

    const generated = async <T>(file: string, name: string, imports: Record<string, string>, loader: 'ts' | 'tsx' = 'ts'): Promise<T> =>
      evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports, loader);

    permissions = await generated('packages/auth/src/permissions.ts', 'permissions.mjs', {
      'better-auth/plugins/access': Bun.resolveSync('better-auth/plugins/access', import.meta.dir),
      'better-auth/plugins/admin/access': Bun.resolveSync('better-auth/plugins/admin/access', import.meta.dir),
    });
    ({ usePermission } = await generated<{ usePermission: typeof usePermission }>(`${WEB}/hooks/use-permission.ts`, 'use-permission.mjs', {
      '@tanstack/react-query': './react-query.mjs',
      '@tanstack/react-router': './router.mjs',
      '@/trpc/providers': './providers.mjs',
      '@repo/auth/permissions': './permissions.mjs',
    }));
    await generated(`${WEB}/lib/constants.ts`, 'constants.mjs', { 'lucide-react': './icons.mjs' });
    await generated(`${WEB}/lib/allowed-routes.ts`, 'allowed-routes.mjs', {
      '@repo/auth/permissions': './permissions.mjs',
      '@/hooks/use-permission': './use-permission.mjs',
      '@/lib/constants': './constants.mjs',
    });
    const componentImports = { react: './react.mjs', '@/hooks/use-permission': './use-permission.mjs' };
    ({ Can } = await generated<{ Can: typeof Can }>(`${WEB}/components/can.tsx`, 'can.mjs', componentImports, 'tsx'));
    ({ SidebarLinks } = await generated<{ SidebarLinks: typeof SidebarLinks }>(
      `${WEB}/components/navigation/sidebar-links.tsx`,
      'sidebar-links.mjs',
      {
        ...componentImports,
        '@tanstack/react-router': './router.mjs',
        'next/link': './next-link.mjs',
        'next/navigation': './next-navigation.mjs',
        '@repo/ui/components/ui/sidebar': './sidebar.mjs',
        '@/lib/allowed-routes': './allowed-routes.mjs',
      },
      'tsx',
    ));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const withList = <T,>(granted: readonly string[] | undefined, read: () => T): T => {
    globals.__granted = granted;
    return read();
  };

  test('is unknown before the list is known, granted when every action is held and denied when one is not', () => {
    const request = { [resource]: ['read', 'delete'] };
    expect(permissions.verdictOf(undefined, request)).toBe('unknown');
    expect(permissions.verdictOf([`${resource}.read`, `${resource}.delete`], request)).toBe('granted');
    expect(permissions.verdictOf([`${resource}.read`], request)).toBe('denied');
    expect(permissions.verdictOf([], request)).toBe('denied');
    expect(permissions.verdictOf(['user.list'], { [resource]: ['read'] })).toBe('denied');
  });

  test('a check that asks for nothing is granted whatever the list says', () => {
    expect(permissions.verdictOf(undefined, {})).toBe('granted');
    expect(permissions.verdictOf([], { [resource]: [] })).toBe('granted');
  });

  test(`the hook answers from the list the page resolved, whatever the ${router === 'next' ? 'query cache' : 'route context'} holds`, () => {
    expect(withList(undefined, () => usePermission({ [resource]: ['read'] }))).toBe('unknown');
    expect(withList([`${resource}.read`], () => usePermission({ [resource]: ['read'] }))).toBe('granted');
    expect(withList([], () => usePermission({ [resource]: ['read'] }))).toBe('denied');
  });

  test('<Can> renders nothing while unknown, its children when granted and its fallback when denied', () => {
    const props = { permissions: { [resource]: ['read'] }, children: 'allowed', fallback: 'refused' };
    expect(withList(undefined, () => Can(props))).toBeNull();
    expect(withList([`${resource}.read`], () => Can(props))).toBe('allowed');
    expect(withList([], () => Can(props))).toBe('refused');
    expect(Can({ ...props, fallback: undefined })).toBeNull();
  });

  test('the sidebar lists the links the permission list grants, with no empty group', () => {
    expect(withList([`${resource}.read`], () => linksShown())).toEqual([...own]);
    expect(groupsShown()).toEqual([]);

    globals.__granted = [...permissions.ADMIN_PERMISSIONS];
    expect(linksShown()).toEqual([...everything]);
    expect(groupsShown()).toEqual(['Administration']);
  });

  test(`a role that lost ${resource}.read loses its link`, () => {
    expect(withList([`${resource}.create`], () => linksShown())).toEqual([...alwaysShown]);
  });

  test('the sidebar follows the permission list whatever the role name says', () => {
    expect(withList([`${resource}.read`], () => linksShown('admin'))).toEqual([...own]);
    globals.__granted = [...permissions.ADMIN_PERMISSIONS];
    expect(linksShown('ghost')).toEqual([...everything]);
    expect(linksShown(null)).toEqual([...everything]);
  });

  test('the sidebar lists only what asks for nothing while the list is unknown', () => {
    expect(withList(undefined, () => linksShown())).toEqual([...alwaysShown]);
    expect(groupsShown()).toEqual([]);
  });
});
