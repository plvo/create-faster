import { afterEach, describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { promptForContext } from '@/cli';
import { parseFlags } from '@/flags';

const ORIGINAL_ARGV = process.argv;
const BLUEPRINTS = Object.entries(META.blueprints);
const CONTEXT_APP_KEYS = ['appName', 'libraries', 'stackName'];

const ORIGINAL_STDOUT_WRITE = process.stdout.write;

afterEach(() => {
  process.argv = ORIGINAL_ARGV;
  process.stdout.write = ORIGINAL_STDOUT_WRITE;
});

/** The flow logs the blueprint it uses; the output is not what the test looks at. */
function silenceStdout(): void {
  process.stdout.write = (() => true) as typeof process.stdout.write;
}

const namesOf = (apps: object[]) => apps.map((app) => Object.keys(app).sort());

describe('the apps of a blueprint reach the context without what only the blueprint reads', () => {
  test.each(BLUEPRINTS)('flags: %s', (name, blueprint) => {
    process.argv = ['bun', 'create-faster', 'scoped-context', '--blueprint', name, '--yes'];

    const { apps = [] } = parseFlags();

    expect(apps.map(({ appName }) => appName)).toEqual(blueprint.context.apps.map(({ appName }) => appName));
    expect(namesOf(apps)).toEqual(apps.map(() => CONTEXT_APP_KEYS));
  });

  test.each(BLUEPRINTS)('interactive flow: %s', async (name, blueprint) => {
    silenceStdout();
    const { apps } = await promptForContext({
      blueprint: name,
      projectName: 'scoped-context',
      projectDir: 'scoped-context',
      git: false,
      skipInstall: true,
      skipPrompts: true,
      project: { tooling: [] },
    });

    expect(apps.map(({ appName }) => appName)).toEqual(blueprint.context.apps.map(({ appName }) => appName));
    expect(namesOf(apps)).toEqual(apps.map(() => CONTEXT_APP_KEYS));
  });

  test('a blueprint exists whose apps carry scoped data, so the check means something', () => {
    const scoped = BLUEPRINTS.flatMap(([, blueprint]) => blueprint.context.apps).filter(
      (app) => 'packageJson' in app || 'envs' in app,
    );

    expect(scoped.length).toBeGreaterThan(0);
  });
});
