import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import type { FirstRunCommand, FirstRunStep, MetaAddon, MetaBlueprint } from '@/types/meta';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const GENERATE_SECRET = 'openssl rand -base64 32';
const SECRET_LINE = `BETTER_AUTH_SECRET= # generate with: ${GENERATE_SECRET}`;
const ENV_STEP = 'Set up environment variables';

interface Generated {
  projectDir: string;
  readme: string;
  stdout: string;
}

interface Step {
  description: string;
  commands: string[];
}

function resolveCommand(command: FirstRunCommand): string {
  return 'script' in command ? `bun run ${command.script}` : command.command;
}

function firstCommandOf(steps: FirstRunStep[] | undefined): string | undefined {
  const command = steps?.[0]?.commands[0];
  return command ? resolveCommand(command) : undefined;
}

function firstCommandOfFirstRun(blueprint: MetaBlueprint): string | undefined {
  if (blueprint.firstRun) return firstCommandOf(blueprint.firstRun);
  const { database, orm } = blueprint.context.project ?? {};
  const addons = [
    database ? META.project.database.options[database as keyof typeof META.project.database.options] : undefined,
    orm ? META.project.orm.options[orm as keyof typeof META.project.orm.options] : undefined,
  ] as (MetaAddon | undefined)[];
  return firstCommandOf(addons.flatMap((addon) => addon?.firstRun ?? []));
}

const blueprintsWithBetterAuth = (Object.entries(META.blueprints) as [string, MetaBlueprint][]).flatMap(
  ([name, blueprint]) => {
    const apps = blueprint.context.apps.filter((app) => app.libraries.includes('better-auth'));
    return apps.length > 0
      ? [{ name, appNames: apps.map((app) => app.appName), nextCommand: firstCommandOfFirstRun(blueprint) }]
      : [];
  },
);

function generateStep(envFiles: string[]): Step {
  const [only] = envFiles;
  return {
    description:
      envFiles.length === 1
        ? `Generate BETTER_AUTH_SECRET and set it in ${only}`
        : `Generate BETTER_AUTH_SECRET once and set the same value in ${envFiles.join(', ')}`,
    commands: [GENERATE_SECRET],
  };
}

function envCopyStep(envFiles: string[]): Step {
  return { description: ENV_STEP, commands: envFiles.map((file) => `cp ${file}.example ${file}`) };
}

/** The lines the user reads: the README as written, the summary without its frame. */
function printedLines(text: string): string[] {
  return text.split('\n').map((line) => line.replace(/^[│\s]+|[│\s]+$/g, ''));
}

function expectLinesInOrder(lines: string[], expected: string[]): void {
  let from = 0;
  for (const wanted of expected) {
    const position = lines.findIndex((line, index) => index >= from && (line === wanted || line.startsWith(`${wanted} `)));
    expect(position, `line "${wanted}" after line ${from}`).toBeGreaterThanOrEqual(0);
    from = position + 1;
  }
}

/** The steps as the README prints them, then as the summary prints them (`# description:`), each followed by dev. */
function expectStepsInOrder({ readme, stdout }: Generated, steps: Step[], nextCommands: string[] = []): void {
  const lines = (describe: (description: string) => string) => [
    ...steps.flatMap((step) => [describe(step.description), ...step.commands]),
    ...nextCommands,
    'bun run dev',
  ];

  expectLinesInOrder(printedLines(readme), lines((description) => `${description}:`));
  expectLinesInOrder(printedLines(stdout), lines((description) => `# ${description}:`));
}

async function envFileOf(projectDir: string, appName: string): Promise<string> {
  return (await fileExists(join(projectDir, 'apps', appName, '.env.example'))) ? `apps/${appName}/.env` : '.env';
}

async function expectBlankSecret(projectDir: string, envFile: string): Promise<void> {
  const example = await readTextFile(join(projectDir, `${envFile}.example`));
  expect(example.split('\n')).toContain(SECRET_LINE);
  expect(example).not.toMatch(/^BETTER_AUTH_SECRET=\S/m);
}

describe('BETTER_AUTH_SECRET first-run step', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]): Promise<Generated> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    const projectDir = join(tempDir, name);
    return { projectDir, readme: await readTextFile(join(projectDir, 'README.md')), stdout: result.stdout };
  }

  test('a single repo with Better Auth generates the secret after copying the env file and before dev', async () => {
    const generated = await generate('single-auth', [
      '--app',
      'web:nextjs:better-auth',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ]);

    expectStepsInOrder(generated, [envCopyStep(['.env']), generateStep(['.env'])]);
    await expectBlankSecret(generated.projectDir, '.env');
  });

  test('a turborepo names the env file of the app that reads the secret', async () => {
    const generated = await generate('turbo-auth', [
      '--app',
      'web:nextjs:better-auth',
      '--app',
      'batch:node',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ]);
    const envFiles = ['apps/web/.env'];

    expectStepsInOrder(generated, [envCopyStep(envFiles), generateStep(envFiles)]);
    await expectBlankSecret(generated.projectDir, 'apps/web/.env');
  });

  test('several apps with Better Auth share one generated value', async () => {
    const generated = await generate('turbo-two-auth', [
      '--app',
      'web:nextjs:better-auth',
      '--app',
      'admin:nextjs:better-auth',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ]);
    const envFiles = ['apps/web/.env', 'apps/admin/.env'];

    expectStepsInOrder(generated, [envCopyStep(envFiles), generateStep(envFiles)]);
  });

  test('a project without Better Auth is not asked for a secret', async () => {
    const { readme, stdout } = await generate('no-auth', ['--app', 'web:nextjs', '--database', 'postgres']);

    expect(readme).not.toContain(GENERATE_SECRET);
    expect(stdout).not.toContain(GENERATE_SECRET);
  });

  test('every blueprint with Better Auth is covered by the META scan', () => {
    const names = blueprintsWithBetterAuth.map(({ name }) => name);

    expect(names).toContain('org-dashboard-nextjs');
    expect(names).toContain('dapp-rainbowkit-nextjs');
  });

  for (const { name, appNames, nextCommand } of blueprintsWithBetterAuth) {
    test(`${name} generates the secret after the env copy and before its own first-run steps`, async () => {
      const generated = await generate(`bp-${name}`, ['--blueprint', name]);
      const envFiles = await Promise.all(appNames.map((appName) => envFileOf(generated.projectDir, appName)));

      expectStepsInOrder(generated, [envCopyStep(envFiles), generateStep(envFiles)], nextCommand ? [nextCommand] : []);
      for (const envFile of envFiles) await expectBlankSecret(generated.projectDir, envFile);
    });
  }
});
