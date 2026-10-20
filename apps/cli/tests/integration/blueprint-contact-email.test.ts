import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINTS = ['org-dashboard-nextjs', 'org-dashboard-tanstack-start'];

const FORM = 'apps/web/src/components/contacts/contact-form.tsx';
const ROUTER = 'packages/api/src/router/contact.ts';

interface Schema {
  safeParse: (value: unknown) => { success: boolean; data?: Record<string, unknown> };
}
interface ProcedureStub {
  input?: Schema;
  handler: (args: { ctx: unknown; input: unknown }) => Promise<unknown>;
}

// A procedure builder that keeps the input schema and the handler the generated router gives it, and a database
// that records what the router writes.
const STUBS: Record<string, string> = {
  'db.mjs': `export const contactTable = { createdAt: 'createdAt', id: 'id' };
export const desc = (column) => column;
export const eq = (column, value) => [column, value];
export const count = () => 'count';`,
  'trpc.mjs': 'export const router = (procedures) => procedures;',
  'pagination.mjs': 'export const pageInput = undefined;\nexport const pageOffset = () => 0;',
  'rbac.mjs': `const build = (input) => ({
  input: (schema) => build(schema),
  query: (handler) => ({ input, handler }),
  mutation: (handler) => ({ input, handler }),
});
export const permissionProcedure = () => build(undefined);`,
};

describe.each(BLUEPRINTS)('%s contact optional fields', (blueprint) => {
  let tempDir: string;
  let formSchema: Schema;
  let create: ProcedureStub;
  let update: ProcedureStub;
  let writes: { table: string; values: Record<string, unknown> }[];

  const database = () => {
    writes = [];
    const returning = async () => [{ id: 'c1' }];
    return {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          writes.push({ table: 'insert', values });
          return { returning };
        },
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          writes.push({ table: 'update', values });
          return { where: () => ({ returning }) };
        },
      }),
    };
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const project = join(tempDir, blueprint);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [file, source] of Object.entries(STUBS)) await Bun.write(join(stubs, file), source);
    const zod = Bun.resolveSync('zod', import.meta.dir);
    const { z } = (await import(zod)) as { z: { object: unknown } };

    const router = await evaluateGeneratedModule<{ contactRouter: { create: ProcedureStub; update: ProcedureStub } }>(
      await readTextFile(join(project, ROUTER)),
      join(stubs, 'generated-contact.mjs'),
      { zod, '../trpc': './trpc.mjs', '../middleware/rbac': './rbac.mjs', '../pagination': './pagination.mjs', '@repo/db': './db.mjs' },
    );
    create = router.contactRouter.create;
    update = router.contactRouter.update;

    const form = await readTextFile(join(project, FORM));
    const expression = form.match(/const schema = (z\.object\([^]*?\n\}\));/)?.[1];
    expect(expression, 'the form declares its schema').toBeDefined();
    formSchema = new Function('z', `return ${expression}`)(z) as Schema;
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const emptyForm = { firstName: 'Ada', lastName: 'Lovelace', email: '', phone: '', company: '', notes: '' };

  test('the router accepts every value the form accepts', () => {
    for (const email of ['', 'ada@example.com']) {
      const value = { ...emptyForm, email };
      expect(formSchema.safeParse(value).success, email).toBe(true);
      expect(create.input?.safeParse(value).success, email).toBe(true);
      expect(update.input?.safeParse({ id: 'c1', data: value }).success, email).toBe(true);
    }
  });

  test('the form and the router both refuse an address that is not an email', () => {
    const value = { ...emptyForm, email: 'not-an-email' };
    expect(formSchema.safeParse(value).success).toBe(false);
    expect(create.input?.safeParse(value).success).toBe(false);
  });

  const OPTIONAL_FIELDS = ['email', 'phone', 'company', 'notes'];

  test('creating a contact with empty optional fields saves them as null', async () => {
    const input = create.input?.safeParse(emptyForm).data;
    await create.handler({ ctx: { db: database(), session: { user: { id: 'u1' } } }, input });
    expect(writes).toHaveLength(1);
    for (const field of OPTIONAL_FIELDS) expect(writes[0]?.values[field], field).toBeNull();
    expect(writes[0]?.values.firstName).toBe('Ada');
  });

  test('editing a contact down to empty optional fields clears them', async () => {
    const input = update.input?.safeParse({ id: 'c1', data: emptyForm }).data;
    await update.handler({ ctx: { db: database() }, input });
    for (const field of OPTIONAL_FIELDS) expect(writes[0]?.values[field], field).toBeNull();
  });

  test('optional fields that have a value are saved as typed', async () => {
    const filled = { ...emptyForm, email: 'ada@example.com', phone: '555', company: 'Analytical Engines', notes: 'Hi' };
    const input = create.input?.safeParse(filled).data;
    await create.handler({ ctx: { db: database(), session: { user: { id: 'u1' } } }, input });
    expect(writes[0]?.values).toMatchObject({ email: 'ada@example.com', phone: '555', company: 'Analytical Engines', notes: 'Hi' });
  });

  test('editing a contact without touching the email keeps it', async () => {
    const input = update.input?.safeParse({ id: 'c1', data: { company: 'Analytical Engines' } }).data;
    await update.handler({ ctx: { db: database() }, input });
    expect(writes[0]?.values.email).toBeUndefined();
    expect(writes[0]?.values.company).toBe('Analytical Engines');
  });
});
