import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

const NODE_PACKAGE_MANAGERS = ['npm', 'pnpm'] as const;

interface Manifest {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

let tempDir: string;

beforeAll(async () => {
  tempDir = await createTempDir();
});

afterAll(async () => {
  await cleanupTempDir(tempDir);
});

async function generate(name: string, args: string[], pm: string): Promise<string> {
  const result = await runCli([name, ...args, '--no-install', '--no-git', '--pm', pm], tempDir);
  expect(result.exitCode, result.stderr).toBe(0);
  return join(tempDir, name);
}

const manifestOf = (directory: string): Promise<Manifest> => readJsonFile<Manifest>(join(directory, 'package.json'));

describe.each([...NODE_PACKAGE_MANAGERS])('Hono app with %s', (pm) => {
  test('a single repo serves through @hono/node-server and runs the TypeScript with tsx', async () => {
    const project = await generate(`hono-single-${pm}`, ['--app', 'api:hono'], pm);
    const { scripts, dependencies, devDependencies } = await manifestOf(project);

    expect(scripts.dev).toBe('tsx watch src/server.ts');
    expect(scripts.start).toBe('NODE_ENV=production tsx src/server.ts');
    expect(dependencies?.['@hono/node-server']).toBeDefined();
    expect(devDependencies?.tsx).toBeDefined();

    const server = await readTextFile(join(project, 'src/server.ts'));
    expect(server).toContain('serve({ fetch: app.fetch');
    expect(server).toContain('process.env.PORT');
    expect(await readTextFile(join(project, 'src/index.ts'))).toContain('export default app');
  });

  test('a turborepo app binds its own port through the --port flag', async () => {
    const project = await generate(`hono-mono-${pm}`, ['--app', 'web:nextjs', '--app', 'api:hono'], pm);
    const { scripts } = await manifestOf(join(project, 'apps/api'));

    expect(scripts.dev).toBe('tsx watch src/server.ts --port 3001');
    expect(scripts.start).toBe('NODE_ENV=production tsx src/server.ts --port 3001');
    expect(await readTextFile(join(project, 'apps/api/src/server.ts'))).toContain("port: { type: 'string' }");
  });

  test('portless owns the port: the flag is stripped from the dev wrapper', async () => {
    const project = await generate(
      `hono-portless-${pm}`,
      ['--app', 'web:nextjs', '--app', 'api:hono', '--tooling', 'portless'],
      pm,
    );

    expect((await manifestOf(join(project, 'apps/api'))).scripts.dev).toBe('portless run tsx watch src/server.ts');
  });

  test('the agent notes say it runs on Node', async () => {
    const project = await generate(`hono-notes-${pm}`, ['--app', 'api:hono'], pm);
    const notes = await readTextFile(join(project, 'AGENTS.md'));

    expect(notes).toContain('run on Node through `tsx`');
    expect(notes).not.toMatch(/\bBun\b/);
  });
});

describe('Hono app with bun', () => {
  test('keeps the Bun entry, scripts and notes', async () => {
    const project = await generate('hono-bun', ['--app', 'api:hono'], 'bun');
    const { scripts, devDependencies } = await manifestOf(project);

    expect(scripts.dev).toBe('bun run --hot src/index.ts');
    expect(scripts.start).toBe('NODE_ENV=production bun run src/index.ts');
    expect(devDependencies?.tsx).toBeUndefined();
    expect(await fileExists(join(project, 'src/server.ts'))).toBe(false);
    expect(await readTextFile(join(project, 'AGENTS.md'))).toContain('run under Bun');
  });
});

describe.each([...NODE_PACKAGE_MANAGERS])('Node app with %s', (pm) => {
  test('runs the entry with tsx', async () => {
    const project = await generate(`node-${pm}`, ['--app', 'worker:node'], pm);
    const { scripts, devDependencies } = await manifestOf(project);

    expect(scripts.dev).toBe('tsx watch src/index.ts');
    expect(scripts.start).toBe('NODE_ENV=production tsx src/index.ts');
    expect(devDependencies?.tsx).toBeDefined();
  });
});

describe('Node app with bun', () => {
  test('keeps the Bun scripts', async () => {
    const project = await generate('node-bun', ['--app', 'worker:node'], 'bun');
    const { scripts } = await manifestOf(project);

    expect(scripts.dev).toBe('bun run --hot src/index.ts');
    expect(scripts.start).toBe('NODE_ENV=production bun run src/index.ts');
  });
});

const LAMBDA_BLUEPRINTS = [
  { blueprint: 'lambda-sst', output: 'dist/index.js', production: false },
  { blueprint: 'lambda-terraform-aws', output: 'dist/index.mjs', production: true },
] as const;

describe.each(LAMBDA_BLUEPRINTS)('$blueprint', ({ blueprint, output, production }) => {
  describe.each([...NODE_PACKAGE_MANAGERS])('with %s', (pm) => {
    let project: string;

    beforeAll(async () => {
      project = await generate(`${blueprint}-${pm}`, ['--blueprint', blueprint], pm);
    });

    test('every app bundles with esbuild for Node', async () => {
      for (const app of ['api', 'cron', 'worker']) {
        const { scripts, devDependencies } = await manifestOf(join(project, 'apps', app));

        expect(scripts.build).toStartWith('esbuild src/index.ts --bundle --platform=node --format=esm');
        expect(scripts.build).toContain(`--outfile=${output}`);
        expect(scripts.build).not.toContain('bun');
        expect(scripts.build?.includes('--define:process.env.NODE_ENV=')).toBe(production);
        expect(devDependencies?.esbuild).toBeDefined();
      }
    });

    test('the deploy workflow does not set up Bun', async () => {
      const workflow = await readTextFile(join(project, '.github/workflows/deploy.yml'));

      expect(workflow).not.toContain('setup-bun');
    });
  });

  test('with bun it keeps bun build and sets Bun up in CI', async () => {
    const project = await generate(`${blueprint}-bun`, ['--blueprint', blueprint], 'bun');
    const { scripts, devDependencies } = await manifestOf(join(project, 'apps/api'));

    expect(scripts.build).toStartWith(production ? 'NODE_ENV=production bun build' : 'bun build');
    expect(devDependencies?.esbuild).toBeUndefined();
    expect(await readTextFile(join(project, '.github/workflows/deploy.yml'))).toContain('oven-sh/setup-bun');
  });
});

describe('lambda-terraform-aws notes', () => {
  test('name the bundler of the package manager', async () => {
    const withNpm = await readTextFile(
      join(await generate('terraform-notes-npm', ['--blueprint', 'lambda-terraform-aws'], 'npm'), 'docs/agents/infrastructure.md'),
    );
    const withBun = await readTextFile(
      join(await generate('terraform-notes-bun', ['--blueprint', 'lambda-terraform-aws'], 'bun'), 'docs/agents/infrastructure.md'),
    );

    expect(withNpm).toContain('`esbuild`');
    expect(withNpm).not.toContain('bun build');
    expect(withBun).toContain('NODE_ENV=production bun build');
  });
});
