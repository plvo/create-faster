import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  REACT_HOOKS_STUB,
  type RenderedChild,
  type RenderedElement,
  cleanupTempDir,
  createTempDir,
  elementsOf,
  evaluateGeneratedModule,
  readTextFile,
  renderElementTree,
  runCli,
  textOf,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINT = 'cloudflare-fullstack-nextjs';

type Component = (props: Record<string, unknown>) => unknown;

interface MutationOptions {
  path: string;
  onMutate?: (variables: unknown) => void;
  onSuccess?: (data: unknown, variables: unknown) => unknown;
  onError?: (error: { message: string }, variables: unknown) => unknown;
  onSettled?: (data: unknown, error: unknown, variables: unknown) => unknown;
}

interface Globals {
  __pending?: boolean;
  __matrix?: unknown;
  __mutations?: { path: string; variables: Record<string, unknown>; options: MutationOptions }[];
  __invalidated?: string[];
  __toasts?: [string, string][];
  __formOptions?: { validators: { onSubmit: { safeParse: (value: unknown) => { success: boolean; error?: { issues: { message: string }[] } } } }; onSubmit: (input: { value: unknown }) => void };
}

const globals = globalThis as Globals;

// Stand-ins for the packages the generated components import. Components render to `{ type, props }` objects.
const STUBS: Record<string, string> = {
  'react.mjs': REACT_HOOKS_STUB,
  'query.mjs': `export const useSuspenseQuery = () => ({ data: globalThis.__matrix });
export const useQueryClient = () => ({ invalidateQueries: async (filter) => { globalThis.__invalidated.push(filter.path); } });
export const useMutation = (options) => ({
  mutate: (variables) => { options.onMutate?.(variables); globalThis.__mutations.push({ path: options.path, variables, options }); },
  isPending: globalThis.__pending ?? false,
});`,
  'sonner.mjs': `export const toast = {
  success: (message) => globalThis.__toasts.push(['success', message]),
  error: (message) => globalThis.__toasts.push(['error', message]),
};`,
  'icons.mjs': `import { createElement } from './react.mjs';
const icon = (name) => () => createElement('svg', { 'aria-hidden': 'true', 'data-icon': name });
export const Check = icon('Check');
export const Minus = icon('Minus');
export const Trash2 = icon('Trash2');
export const Plus = icon('Plus');`,
  'trpc.mjs': `// trpc.roles.setPermission.mutationOptions(options) is { ...options, path: 'roles.setPermission' }.
const make = (path) => new Proxy({}, {
  get: (_, key) => {
    if (key === 'mutationOptions') return (options) => ({ ...options, path: path.join('.') });
    if (key === 'queryOptions' || key === 'queryFilter') return () => ({ path: path.join('.') });
    return make([...path, key]);
  },
});
export const useTRPC = () => make([]);`,
  'button.mjs': `import { createElement } from './react.mjs';
export const Button = ({ children, ...props }) => createElement('button', props, ...children);`,
  'checkbox.mjs': `import { createElement } from './react.mjs';
export const Checkbox = (props) => createElement('checkbox', props);`,
  'table.mjs': `import { createElement } from './react.mjs';
const part = (tag) => ({ children, ...props }) => createElement(tag, props, ...children);
export const Table = part('table');
export const TableBody = part('tbody');
export const TableCaption = part('caption');
export const TableCell = part('td');
export const TableHead = part('th');
export const TableHeader = part('thead');
export const TableRow = part('tr');`,
  'confirm-dialog.mjs': `import { createElement } from './react.mjs';
export const ConfirmDialog = ({ description, children, ...props }) => createElement('confirm-dialog', props, description);`,
  'dialog.mjs': `import { createElement } from './react.mjs';
const part = (tag) => ({ children, ...props }) => createElement(tag, props, ...children);
export const Dialog = part('dialog');
export const DialogContent = part('div');
export const DialogDescription = part('p');
export const DialogFooter = part('div');
export const DialogHeader = part('div');
export const DialogTitle = part('h2');
export const DialogTrigger = part('div');`,
  'form.mjs': `import { createElement } from './react.mjs';
export const useAppForm = (options) => {
  globalThis.__formOptions = options;
  return {
    handleSubmit() {},
    reset() {},
    AppField: ({ children }) => children[0]({ InputField: () => createElement('input', {}) }),
    AppForm: ({ children }) => children[0],
    SubmitButton: ({ children, props }) => createElement('button', { type: 'submit', ...props }, ...children),
  };
};`,
};

const MATRIX = {
  permissions: [
    { name: 'document.create', editable: true },
    { name: 'document.read', editable: true },
    { name: 'user.ban', editable: false },
  ],
  roles: [
    { id: 'admin', label: 'Admin', permissions: ['document.create', 'document.read', 'user.ban'], holders: 1, editable: false, deletable: false },
    { id: 'auditor', label: 'Auditor', permissions: ['document.read'], holders: 0, editable: true, deletable: true },
    { id: 'manager', label: 'Manager', permissions: [], holders: 2, editable: true, deletable: true },
    { id: 'user', label: 'User', permissions: ['document.create'], holders: 5, editable: true, deletable: false },
  ],
};

const tagged = (tree: RenderedChild[], tag: string): RenderedElement[] => elementsOf(tree).filter((element) => element.tag === tag);
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('the element is not in the rendered tree');
  return value;
}
const treeText = (tree: RenderedChild[]): string => tree.map(textOf).join('');

describe(`${BLUEPRINT} role matrix`, () => {
  let tempDir: string;
  let react: { beginRender: () => void; resetState: () => void };
  let RoleMatrix: Component;
  let CreateRoleDialog: Component;
  let permissions: { ADMIN_ROLE: string; DEFAULT_ROLE: string; ROLE_ID: RegExp; MAX_ROLE_ID_LENGTH: number; MAX_ROLE_LABEL_LENGTH: number };

  const render = async (component: Component, props: Record<string, unknown> = {}): Promise<RenderedChild[]> => {
    react.beginRender();
    return renderElementTree({ type: component, props });
  };

  const renderMatrix = (currentRole = 'admin') => render(RoleMatrix, { currentRole });

  // Each box is read through the label that wraps it ("Auditor may document.read").
  const checkboxes = (tree: RenderedChild[]): Map<string, RenderedElement> => {
    const found = new Map<string, RenderedElement>();
    for (const label of tagged(tree, 'label')) {
      const box = tagged(label.children, 'checkbox')[0];
      if (box) found.set(treeText(label.children).trim(), box);
    }
    return found;
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const project = join(tempDir, BLUEPRINT);
    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [name, source] of Object.entries(STUBS)) await Bun.write(join(stubs, name), source);
    react = (await import(join(stubs, 'react.mjs'))) as typeof react;

    const load = async <T,>(file: string, name: string, imports: Record<string, string>): Promise<T> =>
      evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports, 'tsx');

    const shared = {
      react: './react.mjs',
      '@tanstack/react-query': './query.mjs',
      sonner: './sonner.mjs',
      'lucide-react': './icons.mjs',
      '@/trpc/providers': './trpc.mjs',
      '@repo/ui/components/ui/button': './button.mjs',
    };
    ({ RoleMatrix } = await load<{ RoleMatrix: Component }>('apps/web/src/components/admin/role-matrix.tsx', 'role-matrix.mjs', {
      ...shared,
      '@repo/ui/components/ui/checkbox': './checkbox.mjs',
      '@repo/ui/components/ui/table': './table.mjs',
      '@/components/confirm-dialog': './confirm-dialog.mjs',
    }));
    permissions = await evaluateGeneratedModule(
      await readTextFile(join(project, 'packages/auth/src/permissions.ts')),
      join(stubs, 'permissions.mjs'),
      {
        'better-auth/plugins/access': Bun.resolveSync('better-auth/plugins/access', import.meta.dir),
        'better-auth/plugins/admin/access': Bun.resolveSync('better-auth/plugins/admin/access', import.meta.dir),
      },
    );
    ({ CreateRoleDialog } = await load<{ CreateRoleDialog: Component }>('apps/web/src/components/admin/create-role-dialog.tsx', 'create-role-dialog.mjs', {
      ...shared,
      zod: Bun.resolveSync('zod', import.meta.dir),
      '@repo/auth/permissions': './permissions.mjs',
      '@repo/ui/components/ui/dialog': './dialog.mjs',
      '@repo/ui/lib/form': './form.mjs',
    }));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  beforeEach(() => {
    react.resetState();
    globals.__matrix = MATRIX;
    globals.__mutations = [];
    globals.__invalidated = [];
    globals.__toasts = [];
    globals.__pending = false;
  });

  describe('the boxes', () => {
    test('a business permission has a labelled box for each stored role, ticked as the server says', async () => {
      const boxes = checkboxes(await renderMatrix());
      expect([...boxes.keys()].sort()).toEqual([
        'Auditor may document.create',
        'Auditor may document.read',
        'Manager may document.create',
        'Manager may document.read',
        'User may document.create',
        'User may document.read',
      ]);
      expect(boxes.get('Auditor may document.read')?.props.checked).toBe(true);
      expect(boxes.get('Auditor may document.create')?.props.checked).toBe(false);
      expect(boxes.get('User may document.create')?.props.checked).toBe(true);
    });

    test('admin and the account permissions have no box: they are compiled, so they are shown, not edited', async () => {
      const tree = await renderMatrix();
      const labels = [...checkboxes(tree).keys()];
      expect(labels.some((label) => label.startsWith('Admin'))).toBe(false);
      expect(labels.some((label) => label.includes('user.ban'))).toBe(false);
      expect(treeText(tree)).toContain('user.ban');
    });

    test('each label points at its own box by id, so the name is read even where the box is not nested', async () => {
      const labels = tagged(await renderMatrix(), 'label');
      expect(labels).toHaveLength(6);
      const ids = labels.map((label) => label.props.htmlFor);
      expect(new Set(ids).size).toBe(6);
      for (const label of labels) expect(tagged(label.children, 'checkbox')[0]?.props.id).toBe(label.props.htmlFor);
    });

    test('a box is as big as a finger on a phone and is reached by its label', async () => {
      const tree = await renderMatrix();
      const label = tagged(tree, 'label')[0];
      expect(String(label?.props.className)).toContain('min-h-11');
    });

    test('ticking a box asks the server to grant, and the box keeps what the server said until the matrix is fetched again', async () => {
      const tree = await renderMatrix();
      const box = checkboxes(tree).get('Manager may document.read');
      (box?.props.onCheckedChange as (next: boolean) => void)(true);

      expect(globals.__mutations?.map(({ path, variables }) => ({ path, variables }))).toEqual([
        { path: 'roles.setPermission', variables: { id: 'manager', permission: 'document.read', granted: true } },
      ]);
      const after = checkboxes(await renderMatrix()).get('Manager may document.read');
      expect(after?.props.checked).toBe(false);
      expect(after?.props['aria-busy']).toBe(true);
    });

    test('clearing a box asks the server to revoke', async () => {
      const box = checkboxes(await renderMatrix()).get('Auditor may document.read');
      (box?.props.onCheckedChange as (next: boolean) => void)(false);
      expect(globals.__mutations?.[0]?.variables).toEqual({ id: 'auditor', permission: 'document.read', granted: false });
    });

    test('only the box being saved is busy and ignores clicks, never disabled so the keyboard keeps its focus, and it is free again once the change settled', async () => {
      const box = checkboxes(await renderMatrix()).get('Manager may document.read');
      (box?.props.onCheckedChange as (next: boolean) => void)(true);

      const saving = checkboxes(await renderMatrix());
      expect([...saving].filter(([, each]) => each.props['aria-busy']).map(([label]) => label)).toEqual(['Manager may document.read']);
      expect([...saving].some(([, each]) => each.props.disabled)).toBe(false);
      (saving.get('Manager may document.read')?.props.onCheckedChange as (next: boolean) => void)(false);
      expect(globals.__mutations).toHaveLength(1);

      const { options, variables } = globals.__mutations?.[0] ?? {};
      await options?.onSettled?.(undefined, new Error('refused'), variables);
      expect(globals.__invalidated).toEqual(['roles.matrix', 'users.assignableRoles']);
      const settled = checkboxes(await renderMatrix());
      expect([...settled].some(([, each]) => each.props['aria-busy'])).toBe(false);
      (settled.get('Manager may document.read')?.props.onCheckedChange as (next: boolean) => void)(true);
      expect(globals.__mutations).toHaveLength(2);
    });

    describe('what a screen reader hears', () => {
      const region = async (): Promise<RenderedElement> =>
        must(tagged(await renderMatrix(), 'p').find((element) => element.props['aria-live'] === 'polite'));
      const heard = async (): Promise<string> => treeText((await region()).children);
      const tick = async (label: string, next: boolean) =>
        (checkboxes(await renderMatrix()).get(label)?.props.onCheckedChange as (next: boolean) => void)(next);

      test('a polite status region is always in the page, empty until something happens', async () => {
        expect((await region()).props.role).toBe('status');
        expect(String((await region()).props.className)).toContain('sr-only');
        expect(await heard()).toBe('');
      });

      test('says which change is being saved, then that it is saved', async () => {
        await tick('Manager may document.read', true);
        expect(await heard()).toBe('Saving: Manager may document.read');

        const { options, variables } = globals.__mutations?.[0] ?? {};
        await options?.onSuccess?.({ granted: true }, variables);
        expect(await heard()).toBe('Saved: Manager may document.read');
      });

      test('says when a revoke is saved, not only a grant', async () => {
        await tick('Auditor may document.read', false);
        expect(await heard()).toBe('Saving: Auditor may not document.read');
        const { options, variables } = globals.__mutations?.[0] ?? {};
        await options?.onSuccess?.({ granted: false }, variables);
        expect(await heard()).toBe('Saved: Auditor may not document.read');
      });

      test('says why a change was not saved, and what the box shows is still what the server said', async () => {
        await tick('Manager may document.read', true);
        globals.__mutations?.[0]?.options.onError?.({ message: 'No role has that id' }, globals.__mutations[0].variables);
        expect(await heard()).toBe('Not saved: No role has that id');
      });

      test('says a click on a box that is still saving was ignored', async () => {
        await tick('Manager may document.read', true);
        await tick('Manager may document.read', false);
        expect(globals.__mutations).toHaveLength(1);
        expect(await heard()).toBe('Still saving Manager document.read: wait a moment');
      });
    });

    test('a refused change toasts the reason the server gave', async () => {
      const box = checkboxes(await renderMatrix()).get('Manager may document.read');
      (box?.props.onCheckedChange as (next: boolean) => void)(true);
      globals.__mutations?.[0]?.options.onError?.({ message: 'No role has that id' }, undefined);
      expect(globals.__toasts).toEqual([['error', 'No role has that id']]);
    });

    test('the column of the signed-in role is marked', async () => {
      expect(treeText(await renderMatrix('manager'))).toContain('Manager(you)');
      expect(treeText(await renderMatrix('manager'))).not.toContain('Admin(you)');
    });
  });

  describe('deleting a role asks first', () => {
    const deleteButtons = (tree: RenderedChild[]) =>
      elementsOf(tree).filter((element) => String(element.props['aria-label'] ?? '').startsWith('Delete role '));
    const dialogOf = (tree: RenderedChild[]): RenderedElement => {
      const dialog = tagged(tree, 'confirm-dialog')[0];
      if (!dialog) throw new Error('the confirmation dialog is not rendered');
      return dialog;
    };

    test('every role but admin and the default one has a delete button', async () => {
      expect(deleteButtons(await renderMatrix()).map((button) => button.props['aria-label'])).toEqual([
        'Delete role Auditor',
        'Delete role Manager',
      ]);
    });

    test('the button only opens the dialog: nothing is deleted until it is confirmed', async () => {
      const tree = await renderMatrix();
      expect(dialogOf(tree).props.open).toBe(false);
      (deleteButtons(tree)[0]?.props.onClick as () => void)();

      const open = dialogOf(await renderMatrix());
      expect(open.props.open).toBe(true);
      expect(globals.__mutations).toEqual([]);

      (open.props.onConfirm as () => void)();
      expect(globals.__mutations?.map(({ path, variables }) => ({ path, variables }))).toEqual([
        { path: 'roles.remove', variables: { id: 'auditor' } },
      ]);
    });

    test('cancelling closes the dialog and deletes nothing', async () => {
      (deleteButtons(await renderMatrix())[0]?.props.onClick as () => void)();
      (dialogOf(await renderMatrix()).props.onOpenChange as (open: boolean) => void)(false);
      expect(dialogOf(await renderMatrix()).props.open).toBe(false);
      expect(globals.__mutations).toEqual([]);
    });

    test('a role someone holds says so and cannot be confirmed', async () => {
      (deleteButtons(await renderMatrix())[1]?.props.onClick as () => void)();
      const dialog = dialogOf(await renderMatrix());
      expect(treeText(dialog.children)).toContain('Manager is held by 2 users');
      expect(dialog.props.disabled).toBe(true);
    });

    test('while the delete is running it cannot be confirmed again, though the role has no holder', async () => {
      globals.__pending = true;
      (deleteButtons(await renderMatrix())[0]?.props.onClick as () => void)();
      expect(dialogOf(await renderMatrix()).props.disabled).toBe(true);
    });

    test('a role nobody holds can be confirmed', async () => {
      (deleteButtons(await renderMatrix())[0]?.props.onClick as () => void)();
      expect(dialogOf(await renderMatrix()).props.disabled).toBe(false);
    });

    test('a refusal of the server, when the role was given to someone meanwhile, is toasted and the matrix is fetched again', async () => {
      (deleteButtons(await renderMatrix())[0]?.props.onClick as () => void)();
      (dialogOf(await renderMatrix()).props.onConfirm as () => void)();
      const { options, variables } = globals.__mutations?.[0] ?? {};
      options?.onError?.({ message: '1 account holds this role: give it another role first' }, variables);
      await options?.onSettled?.(undefined, new Error('refused'), variables);

      expect(globals.__toasts).toEqual([['error', '1 account holds this role: give it another role first']]);
      expect(globals.__invalidated).toContain('roles.matrix');
      expect(dialogOf(await renderMatrix()).props.open).toBe(false);
    });
  });

  describe('without any stored role', () => {
    test('says how to write the default roles', async () => {
      globals.__matrix = { ...MATRIX, roles: MATRIX.roles.slice(0, 1) };
      const tree = await renderMatrix();
      expect(treeText(tree)).toContain('No role is stored in the database yet');
      expect(treeText(tree)).toContain('db:roles');
    });
  });

  describe('the create dialog', () => {
    const submit = (value: unknown) => globals.__formOptions?.onSubmit({ value });
    const validate = (value: unknown) => globals.__formOptions?.validators.onSubmit.safeParse(value);

    test('submits the id and the label and nothing else', async () => {
      await render(CreateRoleDialog);
      submit({ id: 'auditor', label: 'Auditor' });
      expect(globals.__mutations?.map(({ path, variables }) => ({ path, variables }))).toEqual([
        { path: 'roles.create', variables: { id: 'auditor', label: 'Auditor' } },
      ]);
    });

    test.each([
      ['an empty id', { id: '', label: 'Auditor' }],
      ['capitals', { id: 'Auditor', label: 'Auditor' }],
      ['a space', { id: 'my role', label: 'Auditor' }],
      ['a comma', { id: 'a,b', label: 'Auditor' }],
      ['admin, which is reserved', { id: 'admin', label: 'Auditor' }],
      ['the default role, which is reserved', { id: 'user', label: 'Auditor' }],
      ['a key every object has, which is reserved', { id: 'constructor', label: 'Auditor' }],
      ['an id that is too long', { id: 'a'.repeat(41), label: 'Auditor' }],
      ['a blank label', { id: 'auditor', label: '   ' }],
      ['a label that is too long', { id: 'auditor', label: 'x'.repeat(65) }],
    ])('the form refuses %s before it asks the server', async (_, value) => {
      await render(CreateRoleDialog);
      expect(validate(value)?.success).toBe(false);
    });

    test('the form accepts an id of lowercase letters, digits and hyphens', async () => {
      await render(CreateRoleDialog);
      expect(validate({ id: 'read-only-2', label: 'Read only' })?.success).toBe(true);
      expect(permissions.ROLE_ID.test('read-only-2')).toBe(true);
    });

    test('the submit button is enabled until the role is being created, then it is disabled so it cannot be sent twice', async () => {
      const submitButton = async () => must(tagged(await render(CreateRoleDialog), 'button').find((button) => button.props.type === 'submit'));
      expect((await submitButton()).props.disabled).toBe(false);
      globals.__pending = true;
      expect((await submitButton()).props.disabled).toBe(true);
    });

    test('a created role refreshes the matrix and the role selects, and a refusal is toasted with its reason', async () => {
      await render(CreateRoleDialog);
      submit({ id: 'auditor', label: 'Auditor' });
      const { options } = globals.__mutations?.[0] ?? {};
      await options?.onSuccess?.({ id: 'auditor' }, undefined);
      expect(globals.__invalidated).toEqual(['roles.matrix', 'users.assignableRoles']);
      expect(globals.__toasts).toEqual([['success', 'Role created']]);

      options?.onError?.({ message: 'A role with that id already exists' }, undefined);
      expect(globals.__toasts?.at(-1)).toEqual(['error', 'A role with that id already exists']);
    });
  });
});
