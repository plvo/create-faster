import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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
const FILE_FIELD_TAG = 'ui-input';

type Component = (props: Record<string, unknown>) => unknown;

// Stand-ins for the packages the generated documents page imports. Components render to `{ type, props }` objects
// (see `renderElementTree`) and hooks keep their state in slots that survive a re-render.
const STUBS: Record<string, string> = {
  'react.mjs': REACT_HOOKS_STUB,
  'query.mjs': `export const useQueryClient = () => ({});
export const useMutation = () => ({
  mutate: (variables) => globalThis.__mutations.push(variables),
  isPending: false,
});
export const useSuspenseQueries = () => [{ data: globalThis.__documents }, { data: globalThis.__documents.length }];`,
  'sonner.mjs': 'export const toast = { success() {}, error() {} };',
  'icons.mjs': `import { createElement } from './react.mjs';
const icon = (name) => () => createElement('svg', { 'aria-hidden': 'true', 'data-icon': name });
export const Trash2 = icon('Trash2');
export const Upload = icon('Upload');`,
  'zod.mjs': `const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain });
export const z = chain;`,
  'form.mjs': `import { createElement } from './react.mjs';
const field = () => createElement('input', {});
export const useAppForm = () => ({
  handleSubmit() {},
  AppField: ({ children }) => children[0]({ InputField: field }),
  AppForm: ({ children }) => children[0],
  SubmitButton: ({ children }) => createElement('button', { type: 'submit' }, ...children),
});`,
  'field.mjs': `import { createElement } from './react.mjs';
export const Field = ({ children, ...props }) => createElement('div', props, ...children);
export const FieldLabel = ({ children, ...props }) => createElement('label', { 'data-component': 'FieldLabel', ...props }, ...children);`,
  'input.mjs': `import { createElement } from './react.mjs';
export const Input = ({ children, ...props }) => createElement('${FILE_FIELD_TAG}', props, ...children);`,
  'trpc.mjs': `const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain });
export const useTRPC = () => chain;`,
  'can.mjs': 'export const Can = ({ children }) => children[0];',
  'confirm-dialog.mjs': `import { createElement } from './react.mjs';
export const ConfirmDialog = ({ description, children, ...props }) => createElement('dialog', props, description);`,
  'pagination.mjs': `export const COUNT_STALE_TIME = 0;
export const parsePageParams = (search) => search;`,
  'paged-list.mjs': `export const PagedList = ({ children }) => children[0];`,
  'page-params.mjs': 'export const usePageParams = () => ({ page: 1, pageSize: 10 });',
  'invalidate.mjs': 'export const invalidatePagedList = () => {};',
  'response-error.mjs': 'export const responseErrorMessage = async () => "failed";',
  'tab-nav.mjs': `import { createElement } from './react.mjs';
export const ProfileTabNav = () => createElement('nav', {});`,
};

const globals = globalThis as { __mutations?: unknown[]; __documents?: unknown[] };

const tagged = (tree: RenderedChild[], tag: string): RenderedElement[] =>
  elementsOf(tree).filter((element) => element.tag === tag);

const treeText = (tree: RenderedChild[]): string => tree.map(textOf).join('');

describe(`${BLUEPRINT} documents`, () => {
  let tempDir: string;
  let stubs: string;
  let projectPath: string;
  let react: { beginRender: () => void; resetState: () => void };

  const generated = (file: string): Promise<string> => readTextFile(join(projectPath, 'apps/web', file));
  const stubPath = (name: string): string => join(stubs, name);

  const load = async <T,>(file: string, name: string, imports: Record<string, string>): Promise<T> =>
    evaluateGeneratedModule<T>(await generated(file), stubPath(name), imports, file.endsWith('.tsx') ? 'tsx' : 'ts');

  const render = async (component: Component, props: Record<string, unknown> = {}): Promise<RenderedChild[]> => {
    react.beginRender();
    return renderElementTree({ type: component, props });
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    projectPath = join(tempDir, BLUEPRINT);
    stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [name, source] of Object.entries(STUBS)) await Bun.write(stubPath(name), source);
    react = (await import(stubPath('react.mjs'))) as typeof react;
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('file sizes', () => {
    test('a small file shows its bytes, not 0.0 KB', async () => {
      const { formatFileSize } = await load<{ formatFileSize: (bytes: number) => string }>(
        'src/lib/format-file-size.ts',
        'format-file-size.mjs',
        {},
      );
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(300)).toBe('300 B');
      expect(formatFileSize(1023)).toBe('1023 B');
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    });
  });

  describe('documents page', () => {
    let DocumentsClient: Component;

    beforeAll(async () => {
      await load('src/lib/format-date.ts', 'format-date.mjs', {});
      await load('src/lib/format-file-size.ts', 'format-file-size.mjs', {});
      ({ DocumentsClient } = await load<{ DocumentsClient: Component }>(
        'src/app/(dashboard)/documents.client.tsx',
        'documents-client.mjs',
        {
          react: './react.mjs',
          '@tanstack/react-query': './query.mjs',
          sonner: './sonner.mjs',
          'lucide-react': './icons.mjs',
          zod: './zod.mjs',
          '@repo/ui/components/ui/field': './field.mjs',
          '@repo/ui/components/ui/input': './input.mjs',
          '@repo/ui/lib/form': './form.mjs',
          '@/trpc/providers': './trpc.mjs',
          '@/components/can': './can.mjs',
          '@/components/confirm-dialog': './confirm-dialog.mjs',
          '@repo/api/pagination': './pagination.mjs',
          '@/lib/format-date': './format-date.mjs',
          '@/lib/format-file-size': './format-file-size.mjs',
          '@/lib/invalidate-paged-list': './invalidate.mjs',
          '@/lib/response-error': './response-error.mjs',
          '@/components/table-pagination': './paged-list.mjs',
          '@/hooks/use-page-params': './page-params.mjs',
        },
      ));
    });

    const renderDocuments = async (): Promise<RenderedChild[]> => {
      globals.__mutations = [];
      globals.__documents = [
        { id: 'doc-1', title: 'Quarterly report', size: 300, createdAt: '2026-10-21T23:30:00.000Z' },
      ];
      react.resetState();
      return render(DocumentsClient);
    };

    const deleteDialog = (tree: RenderedChild[]): RenderedElement => {
      const dialog = tagged(tree, 'dialog')[0];
      if (!dialog) throw new Error('the confirmation dialog is not rendered');
      return dialog;
    };

    const clickDeleteButton = (tree: RenderedChild[]): void => {
      const button = elementsOf(tree).find((element) => element.props['aria-label'] === 'Delete Quarterly report');
      (button?.props.onClick as (() => void) | undefined)?.();
    };

    test('the page has its own h1', async () => {
      const headings = tagged(await renderDocuments(), 'h1');
      expect(headings.map(textOf)).toEqual(['Documents']);
    });

    test('a row shows the exact size of a small file and a date that does not depend on the machine', async () => {
      const text = treeText(await renderDocuments());
      expect(text).toContain('300 B');
      expect(text).not.toContain('0.0 KB');
      expect(text).toContain('Oct 21, 2026');
    });

    test('the file field is the design system input, named by a design system label', async () => {
      const tree = await renderDocuments();
      const fileFields = elementsOf(tree).filter((element) => element.props.type === 'file');
      expect(fileFields.map((field) => field.tag)).toEqual([FILE_FIELD_TAG]);
      const label = elementsOf(tree).find((element) => element.props['data-component'] === 'FieldLabel' && textOf(element) === 'File');
      expect(label, 'a FieldLabel reads File').toBeDefined();
      expect(label?.props.htmlFor).toBe(fileFields[0]?.props.id);
    });

    test('deleting asks first and removes nothing until confirmed', async () => {
      const initial = await renderDocuments();
      expect(deleteDialog(initial).props.open).toBe(false);

      clickDeleteButton(initial);
      const asking = await render(DocumentsClient);
      expect(globals.__mutations).toEqual([]);
      expect(deleteDialog(asking).props.open).toBe(true);
      expect(treeText([deleteDialog(asking)])).toContain('Quarterly report');

      (deleteDialog(asking).props.onConfirm as () => void)();
      expect(globals.__mutations).toEqual([{ id: 'doc-1' }]);
    });

    test('cancelling the confirmation keeps the document', async () => {
      const initial = await renderDocuments();
      clickDeleteButton(initial);
      const asking = await render(DocumentsClient);
      (deleteDialog(asking).props.onOpenChange as (open: boolean) => void)(false);
      const cancelled = await render(DocumentsClient);
      expect(deleteDialog(cancelled).props.open).toBe(false);
      expect(globals.__mutations).toEqual([]);
    });
  });

  describe('profile pages', () => {
    test('the profile layout gives every profile page an h1', async () => {
      const { default: ProfileLayout } = await load<{ default: Component }>(
        'src/app/(dashboard)/profile/layout.tsx',
        'profile-layout.mjs',
        { react: './react.mjs', '@/components/profile/tab-nav': './tab-nav.mjs' },
      );
      const tree = await render(ProfileLayout, { children: 'page content' });
      expect(tagged(tree, 'h1').map(textOf)).toEqual(['Profile']);
      expect(tagged(tree, 'nav')).toHaveLength(1);
      expect(treeText(tree)).toContain('page content');
    });
  });

  describe('local setup', () => {
    test('ends without printing a demo password the seed may not have used', async () => {
      const script = await readTextFile(join(projectPath, 'scripts/local-setup.ts'));
      expect(script).not.toMatch(/admin@example\.com\s*\/\s*password/);
    });
  });
});
