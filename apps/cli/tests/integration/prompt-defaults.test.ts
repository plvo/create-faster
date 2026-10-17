import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { META } from '@/__meta__';
import type { ProjectCategoryName } from '@/types/meta';
import { accept, cleanupTempDir, createTempDir, fileExists, runCliOnTerminal } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const FLAGS = ['--no-install', '--no-git'];
const ENTER = '\r';

const typeAndEnter = (prompt: string, text: string) => ({ prompt, keys: `${text}${ENTER}` });

/** The categories asked when none is answered: an ORM is only offered once a database is chosen. */
const askedCategories = (Object.keys(META.project) as ProjectCategoryName[]).filter((name) => name !== 'orm');
const acceptCategories = () => askedCategories.map((name) => accept(META.project[name].prompt));

const acceptStackAndLibraries = (appName: string) => [
  accept(`Stack for ${appName}`),
  accept(`libraries to ${appName}`),
];

describe('text prompts with a default value', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('typing in the project name does not append to the default', async () => {
    const { exitCode } = await runCliOnTerminal(FLAGS, tempDir, [
      typeAndEnter('Name of your project?', 'foo'),
      accept('How many apps?'),
      ...acceptStackAndLibraries('foo'),
      ...acceptCategories(),
    ]);

    expect(exitCode).toBe(0);
    expect(await fileExists(join(tempDir, 'foo', 'package.json'))).toBe(true);
    expect(await fileExists(join(tempDir, 'my-appfoo'))).toBe(false);
  }, 90_000);

  test('enter on an empty project name uses my-app', async () => {
    const { exitCode } = await runCliOnTerminal(FLAGS, tempDir, [
      accept('Name of your project?'),
      accept('How many apps?'),
      ...acceptStackAndLibraries('my-app'),
      ...acceptCategories(),
    ]);

    expect(exitCode).toBe(0);
    expect(await fileExists(join(tempDir, 'my-app', 'package.json'))).toBe(true);
  }, 90_000);

  test('typing in the app count does not append, and enter on empty app names uses app-1 and app-2', async () => {
    const { exitCode } = await runCliOnTerminal(FLAGS, tempDir, [
      accept('Name of your project?'),
      typeAndEnter('How many apps?', '2'),
      accept('Name of app #1?'),
      ...acceptStackAndLibraries('app-1'),
      accept('Name of app #2?'),
      ...acceptStackAndLibraries('app-2'),
      ...acceptCategories(),
    ]);

    expect(exitCode).toBe(0);
    expect((await readdir(join(tempDir, 'my-app', 'apps'))).sort()).toEqual(['app-1', 'app-2']);
  }, 90_000);
});
