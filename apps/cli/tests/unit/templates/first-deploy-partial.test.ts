import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { renderTemplate, setupTemplateEngine } from '@/lib/handlebars';
import type { TemplateContext } from '@/types/ctx';
import type { EnvVar } from '@/types/meta';

const BLUEPRINT = 'cloudflare-payload-nextjs';

const PAYLOAD: TemplateContext = {
  projectName: 'demo',
  repo: 'turborepo',
  apps: [
    { appName: 'web', stackName: 'nextjs', libraries: [] },
    { appName: 'cron', stackName: 'hono', libraries: [] },
  ],
  project: { database: 'd1', deployment: 'cloudflare', tooling: [] },
  git: false,
  pm: 'bun',
  blueprint: BLUEPRINT,
};

const PLAIN_NEXTJS: TemplateContext = {
  projectName: 'demo',
  repo: 'single',
  apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
  project: { database: 'd1', deployment: 'cloudflare', tooling: [] },
  git: false,
  pm: 'bun',
};

const render = (ctx: TemplateContext) => renderTemplate('{{> cloudflare/first-deploy}}', ctx);

describe('cloudflare/first-deploy: the secrets step follows the secrets of the apps', () => {
  const blueprint = META.blueprints[BLUEPRINT] as { envs?: EnvVar[] };
  const declared = blueprint.envs;

  beforeAll(() => {
    setupTemplateEngine();
  });

  afterEach(() => {
    blueprint.envs = declared;
  });

  test('generates a secret that has a command and tells to set one that has neither a command nor an origin', () => {
    blueprint.envs = [...(declared ?? []), { value: 'VENDOR_KEY=', monoScope: ['app'], secret: true }];

    const doc = render(PAYLOAD);

    expect(doc).toContain('export PAYLOAD_SECRET=$(openssl rand -base64 32)');
    expect(doc).toContain('   export VENDOR_KEY=\n');
    expect(doc).toContain('`VENDOR_KEY` has no generator: put the value its service gave you after `export VENDOR_KEY=`');
    expect(doc).not.toContain('PAYLOAD_SECRET` has no generator');
  });

  test('gives a secret shared by two apps one line', () => {
    blueprint.envs = [
      ...(declared ?? []),
      { value: 'SHARED_KEY=', monoScope: ['app'], secret: true, generateCommand: 'openssl rand -hex 8' },
    ];

    const doc = render(PAYLOAD);

    expect(doc.match(/export SHARED_KEY=/g)).toHaveLength(1);
  });

  test('has no secrets step for an app with no secret to set', () => {
    const doc = render(PLAIN_NEXTJS);

    expect(doc).not.toContain('a value in the shell');
    expect(doc).not.toContain('```bash\n   ```');
  });
});
