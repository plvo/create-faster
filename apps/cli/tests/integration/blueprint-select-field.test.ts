import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  REACT_ELEMENT_STUB,
  cleanupTempDir,
  createTempDir,
  elementsOf,
  evaluateGeneratedModule,
  readTextFile,
  renderElementTree,
  runCli,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINTS = ['org-dashboard-nextjs', 'multitenant-saas-nextjs', 'cloudflare-fullstack-nextjs'];

const STUBS: Record<string, string> = {
  'react.mjs': REACT_ELEMENT_STUB,
  'field.mjs': `import { createElement } from './react.mjs';
export const Field = ({ children }) => createElement('div', {}, children);
export const FieldLabel = ({ children, ...props }) => createElement('label', props, children);
export const FieldDescription = () => null;
export const FieldError = () => null;`,
  'select.mjs': `import { createElement } from './react.mjs';
export const Select = ({ children }) => children;
export const SelectTrigger = ({ children, ...props }) => createElement('button', { role: 'combobox', ...props }, children);
export const SelectContent = () => null;
export const SelectItem = () => null;
export const SelectValue = () => null;`,
  'form-context.mjs': `export const useFieldContext = () => ({ name: 'role', state: { value: 'user', meta: { isValid: true, errors: [] } }, handleChange() {} });`,
};

const IMPORTS: Record<string, string> = {
  react: './react.mjs',
  '@repo/ui/components/ui/field': './field.mjs',
  '@repo/ui/components/ui/select': './select.mjs',
  '@repo/ui/components/ui/shuip/tanstack-form/form-context': './form-context.mjs',
};

describe.each(BLUEPRINTS)('%s select field', (blueprint) => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the label names the select trigger', async () => {
    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [name, source] of Object.entries(STUBS)) await Bun.write(join(stubs, name), source);
    const source = await readTextFile(join(tempDir, blueprint, 'packages/ui/src/components/ui/shuip/tanstack-form/select-field.tsx'));
    const module = await evaluateGeneratedModule<{ SelectField: (props: Record<string, unknown>) => unknown }>(
      source,
      join(stubs, 'select-field.mjs'),
      IMPORTS,
      'tsx',
    );

    const tree = elementsOf(await renderElementTree(module.SelectField({ label: 'Role', options: { User: 'user' } })));
    const label = tree.find((element) => element.tag === 'label');
    const trigger = tree.find((element) => element.props.role === 'combobox');
    expect(label?.props.htmlFor).toBe('role');
    expect(trigger?.props.id).toBe('role');
  });
});
