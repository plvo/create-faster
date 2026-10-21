import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, PNPM_AVAILABLE, runCli, runCommand } from './helpers';
import { describeProject, groupChoices, listChoices, toCliArgs } from '../choice-projects';

/**
 * Fails when a dependency with an install script is brought by a choice without a ruling in META (`installScripts`).
 * pnpm 11 and later fails the install on the first unreviewed script and names every one: a pnpm older than that
 * is replaced by `pnpm@12` through npx. A script blocked only on another OS (`fsevents` on macOS) is not seen here.
 */
const STRICT_PNPM_MAJOR = 11;
const FALLBACK_PNPM = ['env', 'pnpm_config_manage_package_manager_versions=false', 'npx', '--yes', 'pnpm@12'];
const TIMEOUT_INSTALL = 600_000;

const CHOICE_PROJECTS = groupChoices().map((project, index) => ({
  name: `choices-${index + 1}`,
  description: describeProject(project),
  args: toCliArgs(project),
}));

const BLUEPRINT_PROJECTS = Object.keys(META.blueprints).map((blueprint) => ({
  name: blueprint,
  description: blueprint,
  args: ['--blueprint', blueprint],
}));

function strictPnpmCommand(): string[] {
  const version = Bun.spawnSync(['pnpm', '--version']).stdout.toString().trim();
  return Number.parseInt(version, 10) >= STRICT_PNPM_MAJOR ? ['pnpm'] : FALLBACK_PNPM;
}

const PACKAGE_WITH_VERSION = /(?:@[\w.-]+\/)?[\w.-]+@\d[\w.+-]*/g;

/** The packages pnpm lists after `Ignored build scripts:`, as a warning box (pnpm 10) or an error (pnpm 11 and later). */
function ignoredBuilds(output: string): string[] {
  const listing = output.match(/Ignored build scripts:([\s\S]*?)(?:Run "pnpm approve-builds|help:)/)?.[1] ?? '';
  return listing.match(PACKAGE_WITH_VERSION) ?? [];
}

test('the projects hold every library on each stack it supports and every project option', () => {
  const projects = groupChoices();
  for (const choice of listChoices()) {
    const held = projects.some((project) =>
      choice.kind === 'library'
        ? project.apps.get(choice.stack)?.includes(choice.name)
        : choice.category === 'tooling'
          ? project.tooling.includes(choice.name)
          : project[choice.category] === choice.name,
    );
    expect(held).toBe(true);
  }
});

if (!PNPM_AVAILABLE) {
  console.warn('Skipping install scripts e2e: pnpm is not installed');
}

describe.skipIf(!PNPM_AVAILABLE).each([...CHOICE_PROJECTS, ...BLUEPRINT_PROJECTS])('$name: $description', ({ name, args }) => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const git = args.includes('--git') ? [] : ['--no-git'];
    const result = await runCli([name, ...args, ...git, '--no-install', '--pm', 'pnpm'], tempDir);
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test(
    'every dependency with an install script has a ruling',
    async () => {
      const install = await runCommand([...strictPnpmCommand(), 'install'], join(tempDir, name));
      expect(ignoredBuilds(`${install.stdout}\n${install.stderr}`)).toEqual([]);
      expect(install.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );
});
