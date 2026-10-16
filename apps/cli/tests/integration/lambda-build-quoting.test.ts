import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmod, mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { $ } from 'bun';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, readJsonFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const DEFINE_FLAG = '--define:';
const BANNER_FLAG = '--banner:js=';
const COMMAND_SEPARATORS = /&&|\|\||[;|\n]/;
const PORTABLE_COMMAND_NAME = /^[\w.@-]+$/;
const ASSIGNMENT = /^\w+=/;

const BLUEPRINT_PACKAGE_MANAGERS = ['npm', 'pnpm'];
const APP_COMBINATIONS = [
  ['--app', 'web:nextjs', '--app', 'api:hono:aws-lambda', '--deployment', 'sst'],
  ['--app', 'api:hono:aws-lambda', '--deployment', 'terraform-aws'],
  ['--app', 'site:tanstack-start', '--app', 'jobs:node'],
  ['--app', 'mobile:expo'],
];
const TERRAFORM_LAMBDA_APPS = ['api', 'cron', 'worker'];

interface FlagWord {
  script: string;
  word: string;
}

/**
 * The command names a package.json script starts: the first word of each segment, without leading VAR=value
 * assignments. A name that is not a plain word (a path, a quote left over from splitting) is ignored.
 */
function commandNamesOf(script: string): string[] {
  const names = script.split(COMMAND_SEPARATORS).flatMap((segment) => {
    const name = segment
      .trim()
      .split(/\s+/)
      .find((word) => !ASSIGNMENT.test(word));
    return name && PORTABLE_COMMAND_NAME.test(name) ? [name] : [];
  });
  return [...new Set(names)];
}

const PRINTER = '.print-arguments';

/**
 * A directory where every command name is an executable that prints its arguments one per line and does nothing
 * else, so a script run with only this directory on PATH shows the words `sh` hands to each command without
 * running anything.
 */
async function createArgumentPrinter(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, PRINTER), "#!/bin/sh\nfor argument in \"$@\"; do printf '%s\\n' \"$argument\"; done\n");
  await chmod(join(dir, PRINTER), 0o755);
}

async function linkCommandNames(dir: string, names: string[]): Promise<void> {
  await Promise.all(names.map((name) => symlink(join(dir, PRINTER), join(dir, name)).catch(() => undefined)));
}

async function wordsAfterShellSplitting(script: string, printersDir: string): Promise<string[]> {
  const { stdout } = await $`/bin/sh -c ${script}`.env({ PATH: printersDir }).cwd(printersDir).quiet().nothrow();
  return stdout.toString().split('\n');
}

function isJavaScriptLiteral(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

async function packageJsonFilesOf(projectDir: string): Promise<string[]> {
  const entries = await readdir(projectDir, { recursive: true });
  return entries.filter((entry) => basename(entry) === 'package.json').map((entry) => join(projectDir, entry));
}

describe('--define flags of the scripts of generated projects', () => {
  let tempDir: string;
  let printersDir: string;
  const defines = new Map<string, FlagWord[]>();
  const banners = new Map<string, FlagWord[]>();

  async function collectFlags(project: string, args: string[]): Promise<void> {
    const result = await runCli([project, ...args, '--no-git', '--no-install'], tempDir);
    expect(result.exitCode).toBe(0);
    const projectDir = join(tempDir, project);
    for (const file of await packageJsonFilesOf(projectDir)) {
      const { scripts = {} } = await readJsonFile<{ scripts?: Record<string, string> }>(file);
      for (const script of Object.values(scripts).filter(
        (script) => script.includes(DEFINE_FLAG) || script.includes(BANNER_FLAG),
      )) {
        await linkCommandNames(printersDir, commandNamesOf(script));
        const words = await wordsAfterShellSplitting(script, printersDir);
        const key = `${project}/${dirname(file).slice(projectDir.length + 1) || '.'}`;
        for (const [flag, flagged] of [
          [DEFINE_FLAG, defines],
          [BANNER_FLAG, banners],
        ] as const) {
          if (!script.includes(flag)) continue;
          // A script whose flag never reaches a command (a shell syntax error) is kept as an empty word, which no check accepts.
          const found = words.filter((word) => word.startsWith(flag));
          const reached = (found.length > 0 ? found : ['']).map((word) => ({ script, word }));
          flagged.set(key, [...(flagged.get(key) ?? []), ...reached]);
        }
      }
    }
  }

  beforeAll(async () => {
    tempDir = await createTempDir();
    printersDir = join(tempDir, 'printers');
    await createArgumentPrinter(printersDir);
    const blueprintRuns = Object.keys(META.blueprints).flatMap((blueprint) =>
      BLUEPRINT_PACKAGE_MANAGERS.map((pm) =>
        collectFlags(`${blueprint}-${pm}`, ['--blueprint', blueprint, '--pm', pm]),
      ),
    );
    const combinationRuns = APP_COMBINATIONS.map((args, index) =>
      collectFlags(`combination-${index}`, [...args, '--pm', 'npm']),
    );
    await Promise.all([...blueprintRuns, ...combinationRuns]);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the terraform Lambda blueprint defines NODE_ENV once in each of api, cron and worker, under npm and pnpm', () => {
    for (const pm of BLUEPRINT_PACKAGE_MANAGERS) {
      const project = `lambda-terraform-aws-hono-${pm}`;
      for (const app of TERRAFORM_LAMBDA_APPS) {
        expect(defines.get(`${project}/apps/${app}`)?.map(({ word }) => word.split('=')[0])).toEqual([
          `${DEFINE_FLAG}process.env.NODE_ENV`,
        ]);
      }
    }
  });

  test('every define reaches its command as a JavaScript literal after sh splits the script', () => {
    const notLiterals = [...defines.entries()].flatMap(([location, words]) =>
      words
        .filter(({ word }) => !isJavaScriptLiteral(word.slice(word.indexOf('=') + 1)))
        .map(({ word, script }) => `${location}: ${word} (script: ${script})`),
    );

    expect(notLiterals).toEqual([]);
  });

  test('every banner reaches its command as one argument holding the quoted module name', () => {
    const splitBanners = [...banners.entries()].flatMap(([location, words]) =>
      words.filter(({ word }) => !word.includes("'node:module'")).map(({ word }) => `${location}: ${word}`),
    );

    expect([...banners.keys()].length).toBeGreaterThan(0);
    expect(splitBanners).toEqual([]);
  });
});
