import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { evaluateGeneratedModule, readTextFile } from './helpers';

interface LinkDelivery {
  kind: string;
  to: string;
  link: string;
}

export interface DeliveryHarness {
  delivered: LinkDelivery[];
  /** Deliveries wait for this promise: a test makes it a slow mailer by holding it. */
  gate: Promise<void>;
  /** Kinds whose delivery throws, as a mailer that is down. */
  failing: Set<string>;
}

export interface DatabaseHarness {
  tables: Record<string, Record<string, unknown>[]>;
}

const resolve = (specifier: string): string => Bun.resolveSync(specifier, import.meta.dir);

// The generated auth modules import the Drizzle adapter and the table objects of `@repo/db`. Their stand-ins give
// better-auth a memory database with the same tables, and give the delivery module a mailer a test controls: what
// is under test is the generated configuration on the real better-auth.
const DRIZZLE_STUB = `import { memoryAdapter } from ${JSON.stringify(resolve('better-auth/adapters/memory'))};
export const harness = { tables: {} };
export const drizzleAdapter = () => memoryAdapter(harness.tables);`;

const DB_STUB = `export const userTable = {};
export const userAccountTable = {};
export const userSessionTable = {};
export const userVerificationTable = {};
export const organizationTable = {};
export const memberTable = {};
export const invitationTable = {};
export const organizationRoleTable = {};
export const db = { query: { memberTable: { findFirst: async () => undefined } } };`;

const DELIVERY_STUB = `export const harness = { delivered: [], gate: Promise.resolve(), failing: new Set() };
export async function deliverLink(link) {
  harness.delivered.push(link);
  await harness.gate;
  if (harness.failing.has(link.kind)) throw new Error('the mailer is down: ' + link.kind);
}`;

interface GeneratedAuth<Factory> {
  createAuth: Factory;
  database: DatabaseHarness;
  delivery: DeliveryHarness;
}

/**
 * Evaluates the generated `createAuth` of a project's auth package, with the generated modules it imports
 * (`modules`, in dependency order, as file names without extension under `packages/auth/src`) and the stand-ins above.
 * Other imports of `auth.ts` resolve to the real packages. `deliveryModule` is the module `auth.ts` imports its
 * `deliverLink` from, as written in its source (`./email`, `./link-delivery`).
 */
export async function loadGeneratedAuth<Factory>(
  projectPath: string,
  workDir: string,
  { modules, deliveryModule }: { modules: string[]; deliveryModule: string },
): Promise<GeneratedAuth<Factory>> {
  const stubs = join(workDir, 'auth-stubs');
  await mkdir(stubs, { recursive: true });
  await Bun.write(join(stubs, 'drizzle.mjs'), DRIZZLE_STUB);
  await Bun.write(join(stubs, 'db.mjs'), DB_STUB);
  await Bun.write(join(stubs, 'delivery.mjs'), DELIVERY_STUB);

  const imports: Record<string, string> = {
    '@repo/db': join(stubs, 'db.mjs'),
    '@better-auth/drizzle-adapter': join(stubs, 'drizzle.mjs'),
    [deliveryModule]: join(stubs, 'delivery.mjs'),
  };
  for (const name of ['better-auth', 'better-auth/api', 'better-auth/plugins', 'better-auth/plugins/access']) {
    imports[name] = resolve(name);
  }
  for (const name of ['plugins/admin/access', 'plugins/organization/access']) {
    imports[`better-auth/${name}`] = resolve(`better-auth/${name}`);
  }

  const authDir = join(projectPath, 'packages/auth/src');
  for (const name of [...modules, 'auth']) {
    const source = await readTextFile(join(authDir, `${name}.ts`));
    const target = join(stubs, `${name}.mjs`);
    await evaluateGeneratedModule(source, target, imports);
    imports[`./${name}`] = target;
  }

  const { createAuth } = (await import(join(stubs, 'auth.mjs'))) as { createAuth: Factory };
  const database = ((await import(join(stubs, 'drizzle.mjs'))) as { harness: DatabaseHarness }).harness;
  const delivery = ((await import(join(stubs, 'delivery.mjs'))) as { harness: DeliveryHarness }).harness;
  return { createAuth, database, delivery };
}
