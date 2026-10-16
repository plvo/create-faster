import './timeout';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { accept, cleanupTempDir, createTempDir, fileExists, runCli, runCliOnTerminal } from './helpers';

const FLAGS = ['--yes', '--no-install', '--no-git'];
const CLEAR_FIELD = '\x7f'.repeat(40);
const typeText = (prompt: string, text: string) => ({ prompt, keys: `${CLEAR_FIELD}${text}\r` });

describe('app names', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('given with --app', () => {
    test.each([
      ['a space', 'my app'],
      ['an uppercase letter', 'MyApp'],
      ['a slash', 'web/api'],
      ['a parent directory', '..'],
      ['a leading dash', '-web'],
      ['a leading dot', '.web'],
    ])('%s is refused before anything is written', async (_title, appName) => {
      const result = await runCli(['demo', '--app', `${appName}:nextjs`, '--app', 'api:hono', ...FLAGS], tempDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain(`App name "${appName}"`);
      expect(await fileExists(join(tempDir, 'demo'))).toBe(false);
    });

    test('dots, underscores and digits are generated as the app directory', async () => {
      const result = await runCli(['demo', '--app', 'my.app_1:nextjs', '--app', 'api:hono', ...FLAGS], tempDir);

      expect(result.exitCode).toBe(0);
      expect(await fileExists(join(tempDir, 'demo', 'apps', 'my.app_1', 'package.json'))).toBe(true);
    });
  });

  describe('typed in the app name prompt', () => {
    test('an invalid name is refused and asked again', async () => {
      const { exitCode, output } = await runCliOnTerminal(['demo', ...FLAGS], tempDir, [
        typeText('How many apps?', '2'),
        typeText('Name of app #1?', 'My App'),
        typeText('App name "My App"', 'web'),
        accept('Stack for web'),
        accept('libraries to web'),
        typeText('Name of app #2?', 'api'),
        accept('Stack for api'),
        accept('libraries to api'),
      ]);

      expect(exitCode).toBe(0);
      expect(await fileExists(join(tempDir, 'demo', 'apps', 'web', 'package.json'))).toBe(true);
      expect(await fileExists(join(tempDir, 'demo', 'apps', 'My App'))).toBe(false);
      expect(output).toContain('App name "My App"');
    }, 90_000);
  });
});
