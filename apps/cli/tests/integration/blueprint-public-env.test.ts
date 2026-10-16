import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const blueprintsWithNonNextjsApp = Object.entries(META.blueprints).filter(([, blueprint]) =>
  blueprint.context.apps.some((app) => app.stackName !== 'nextjs'),
);

describe('Blueprint public env variables', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('some blueprint has an app that is not Next.js', () => {
    expect(blueprintsWithNonNextjsApp.length).toBeGreaterThan(0);
  });

  for (const [name, blueprint] of blueprintsWithNonNextjsApp) {
    test(`${name}: NEXT_PUBLIC_ variables reach the Next.js apps only`, async () => {
      const result = await runCli([`pub-${name}`, '--blueprint', name, '--no-git', '--no-install'], tempDir);
      expect(result.exitCode).toBe(0);
      const declaresAppUrl = blueprint.envs?.some((env) => env.value.startsWith('NEXT_PUBLIC_APP_URL=')) ?? false;

      for (const app of blueprint.context.apps) {
        const env = await readTextFile(join(tempDir, `pub-${name}`, 'apps', app.appName, '.env.example')).catch(
          () => '',
        );
        if (app.stackName === 'nextjs') {
          if (declaresAppUrl) expect(env).toContain('NEXT_PUBLIC_APP_URL=');
        } else {
          expect(env).not.toContain('NEXT_PUBLIC_');
        }
      }
    });
  }
});
